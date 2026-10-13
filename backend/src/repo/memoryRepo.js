// Demo data source: cleans the CSV, simulates ACCOUNT_USAGE and computes
// everything in memory. It implements the same repository interface the
// Snowflake source will, and its cost attribution mirrors
// snowflake/04_cost_attribution.sql so the two can be cross-checked.
//
// "Latest snapshot": the CSV has no timestamp column, so row order is used
// as the time proxy. This is a documented assumption.

import { parseCsv, cleanRecords, quantile, THRESHOLDS } from '../clean.js';
import { simulate } from '../simulate-account-usage.js';
import { badRequest, notFound } from '../errors.js';
import { paginate, sortRows } from '../http/params.js';

const round = (v, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const pct = (n, d) => (d === 0 ? 0 : round((100 * n) / d, 2));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[key])) map.set(r[key], []);
    map.get(r[key]).push(r);
  }
  return map;
}

// Same method as V_QUERY_CREDIT_ATTRIBUTION: split each valid hourly window's
// credits across the queries that started in it, by execution time.
function attributeCredits(metering, queries) {
  const windows = new Map();
  for (const m of metering) {
    if (m.credits_used >= 0) {
      windows.set(`${m.warehouse_name}|${m.start_time}`, { credits: m.credits_used, execTotal: 0 });
    }
  }
  const keyOf = (q) => `${q.warehouse_name}|${q.start_time.slice(0, 13)}:00:00`;
  for (const q of queries) {
    const w = windows.get(keyOf(q));
    if (w) w.execTotal += q.execution_time;
  }
  const byReport = new Map();
  let attributed = 0;
  for (const q of queries) {
    const w = windows.get(keyOf(q));
    if (!w || w.execTotal === 0) continue;
    const credits = (w.credits * q.execution_time) / w.execTotal;
    const tag = q.query_tag ?? 'UNTAGGED';
    byReport.set(tag, (byReport.get(tag) ?? 0) + credits);
    attributed += credits;
  }
  const negatives = metering.filter((m) => m.credits_used < 0);
  const meteredValid = metering.filter((m) => m.credits_used >= 0).reduce((s, m) => s + m.credits_used, 0);
  return {
    byReport,
    reconciliation: {
      metered_valid_credits: round(meteredValid, 4),
      attributed_credits: round(attributed, 4),
      unattributed_credits: round(meteredValid - attributed, 4),
      quarantined_negative_credits: round(negatives.reduce((s, m) => s + m.credits_used, 0), 4),
      quarantined_windows: negatives.length,
    },
  };
}

export function createMemoryRepo({ csvText, creditPriceUsd = 3 }) {
  const rawRows = parseCsv(csvText);
  const { clean, issues } = cleanRecords(rawRows);
  const { metering, queries } = simulate(clean);
  const attribution = attributeCredits(metering, queries);
  const generatedAt = new Date().toISOString();

  const issueRows = issues.map((x, i) => ({ issue_id: i + 1, ...x }));
  const rowsByReport = groupBy(clean, 'report_id');
  const ownerOverrides = new Map(); // report_id -> { owner_email, assigned_by, assigned_at }

  // ---- cost rollup (valid-credit snapshots only, like-for-like) ----
  const costRows = [];
  for (const [reportId, rows] of rowsByReport) {
    const valid = rows.filter((r) => r.credits_valid);
    const views = valid.reduce((s, r) => s + r.monthly_active_views, 0);
    const aws = valid.reduce((s, r) => s + r.aws_hosting_cost_usd, 0);
    const credits = attribution.byReport.get(reportId) ?? 0;
    const snowflakeCost = credits * creditPriceUsd;
    costRows.push({
      report_id: reportId,
      report_name: rows[0].report_name,
      snapshots: valid.length,
      active_views: views,
      attributed_credits: round(credits, 4),
      snowflake_cost_usd: round(snowflakeCost),
      aws_cost_usd: round(aws),
      total_cost_usd: round(snowflakeCost + aws),
      credits_per_view: views ? round(credits / views, 6) : null,
      snowflake_cost_per_view_usd: views ? round(snowflakeCost / views, 4) : null,
      total_cost_per_view_usd: views ? round((snowflakeCost + aws) / views, 4) : null,
      avg_load_time_sec: round(valid.reduce((s, r) => s + r.avg_load_time_sec, 0) / (valid.length || 1)),
    });
  }
  const ranked = [...costRows].sort((a, b) => (b.total_cost_per_view_usd ?? -1) - (a.total_cost_per_view_usd ?? -1));
  ranked.forEach((r, i) => {
    r.cost_per_view_rank = i > 0 && r.total_cost_per_view_usd === ranked[i - 1].total_cost_per_view_usd
      ? ranked[i - 1].cost_per_view_rank
      : i + 1;
  });
  const costByReport = new Map(costRows.map((r) => [r.report_id, r]));

  // ---- report rollup ----
  function summarize(reportId) {
    const rows = rowsByReport.get(reportId);
    const last = rows[rows.length - 1];
    const override = ownerOverrides.get(reportId);
    const currentOwner = override?.owner_email ?? last.owner_email;
    return {
      report_id: reportId,
      report_name: last.report_name,
      snapshots: rows.length,
      current_owner: currentOwner,
      owner_status: currentOwner ? 'ASSIGNED' : 'ORPHANED',
      owner_assigned_by: override?.assigned_by ?? null,
      orphaned_snapshots: rows.filter((r) => r.is_orphaned).length,
      distinct_owners: new Set(rows.filter((r) => r.owner_email).map((r) => r.owner_email)).size,
      latest_refresh_status: last.last_refresh_status,
      refresh_problem_snapshots: rows.filter((r) => r.refresh_alert_level === 'CRITICAL').length,
      latest_load_time_sec: last.avg_load_time_sec,
      avg_load_time_sec: round(rows.reduce((s, r) => s + r.avg_load_time_sec, 0) / rows.length),
      max_load_time_sec: Math.max(...rows.map((r) => r.avg_load_time_sec)),
      latency_breaches: rows.filter((r) => r.latency_tier !== 'OK').length,
      total_views: rows.reduce((s, r) => s + r.monthly_active_views, 0),
      aws_cost_usd: round(rows.reduce((s, r) => s + r.aws_hosting_cost_usd, 0)),
    };
  }
  const allSummaries = () => [...rowsByReport.keys()].map(summarize);

  return {
    sourceName: 'demo-csv',

    async healthSummary() {
      const total = clean.length;
      const lat = clean.map((r) => r.avg_load_time_sec).sort((a, b) => a - b);
      const statusCounts = { SUCCESS: 0, FAILED: 0, TIMED_OUT: 0, UNKNOWN: 0 };
      for (const r of clean) statusCounts[r.last_refresh_status] = (statusCounts[r.last_refresh_status] ?? 0) + 1;
      const orphanRecords = clean.filter((r) => r.is_orphaned);
      const byType = {};
      for (const i of issues) byType[i.issue_type] = (byType[i.issue_type] ?? 0) + 1;
      const summaries = allSummaries();
      const warn = clean.filter((r) => r.latency_tier === 'WARNING').length;
      const crit = clean.filter((r) => r.latency_tier === 'CRITICAL').length;
      return {
        generated_at: generatedAt,
        data_source: 'demo-csv',
        records: { total, unique_reports: rowsByReport.size },
        refresh: {
          ...statusCounts,
          problem_records: statusCounts.FAILED + statusCounts.TIMED_OUT,
          problem_rate_pct: pct(statusCounts.FAILED + statusCounts.TIMED_OUT, total),
        },
        latency: {
          warning_threshold_sec: THRESHOLDS.LATENCY_WARNING_SEC,
          critical_threshold_sec: THRESHOLDS.LATENCY_CRITICAL_SEC,
          avg_sec: round(lat.reduce((s, v) => s + v, 0) / total),
          p50_sec: round(quantile(lat, 0.5)),
          p95_sec: round(quantile(lat, 0.95)),
          max_sec: lat[lat.length - 1],
          warning_records: warn,
          critical_records: crit,
          breach_rate_pct: pct(warn + crit, total),
        },
        ownership: {
          orphaned_records: orphanRecords.length,
          orphaned_records_pct: pct(orphanRecords.length, total),
          missing_owner_records: orphanRecords.filter((r) => r.orphan_reason === 'MISSING_OWNER').length,
          literal_orphan_records: orphanRecords.filter((r) => r.orphan_reason === 'ORPHANED_REPORT_LITERAL').length,
          reports_with_orphan_history: summaries.filter((s) => s.orphaned_snapshots > 0).length,
          reports_currently_orphaned: summaries.filter((s) => s.owner_status === 'ORPHANED').length,
          reports_with_conflicting_owners: summaries.filter((s) => s.distinct_owners > 1).length,
        },
        data_quality: {
          issues_total: issues.length,
          by_type: byType,
          negative_credit_records: clean.filter((r) => !r.credits_valid).length,
          records_with_issues: clean.filter((r) => r.issue_count > 0).length,
        },
        cost: {
          credit_price_usd: creditPriceUsd,
          ...attribution.reconciliation,
          snowflake_cost_usd: round(attribution.reconciliation.attributed_credits * creditPriceUsd),
          aws_cost_usd: round(clean.filter((r) => r.credits_valid).reduce((s, r) => s + r.aws_hosting_cost_usd, 0)),
        },
      };
    },

    async listReports({ search, ownerStatus, latestStatus, hasOrphanHistory, sort, order, paging }) {
      let rows = allSummaries();
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.report_id.toLowerCase().includes(s) || r.report_name.toLowerCase().includes(s));
      }
      if (ownerStatus) rows = rows.filter((r) => r.owner_status === ownerStatus);
      if (latestStatus) rows = rows.filter((r) => r.latest_refresh_status === latestStatus);
      if (hasOrphanHistory !== undefined) rows = rows.filter((r) => (r.orphaned_snapshots > 0) === hasOrphanHistory);
      return paginate(sortRows(rows, sort, order), paging);
    },

    async getReport(reportId) {
      if (!rowsByReport.has(reportId)) throw notFound(`Report ${reportId} not found`);
      const rows = rowsByReport.get(reportId);
      const issuesByType = {};
      for (const i of issueRows.filter((x) => x.report_id === reportId)) {
        issuesByType[i.issue_type] = (issuesByType[i.issue_type] ?? 0) + 1;
      }
      return {
        ...summarize(reportId),
        cost: costByReport.get(reportId) ?? null,
        issues_by_type: issuesByType,
        snapshots_detail: rows.map((r) => ({
          src_row_num: r.src_row_num,
          owner_email: r.owner_email,
          is_orphaned: r.is_orphaned,
          last_refresh_status: r.last_refresh_status,
          avg_load_time_sec: r.avg_load_time_sec,
          latency_tier: r.latency_tier,
          monthly_active_views: r.monthly_active_views,
          snowflake_credits_consumed: r.snowflake_credits_consumed,
          credits_valid: r.credits_valid,
          aws_hosting_cost_usd: r.aws_hosting_cost_usd,
          issue_count: r.issue_count,
        })),
      };
    },

    async assignOwner(reportId, ownerEmail, assignedBy) {
      if (!rowsByReport.has(reportId)) throw notFound(`Report ${reportId} not found`);
      if (typeof ownerEmail !== 'string' || ownerEmail.length > 254 || !EMAIL_RE.test(ownerEmail.trim())) {
        throw badRequest('owner_email must be a valid email address');
      }
      ownerOverrides.set(reportId, {
        owner_email: ownerEmail.trim().toLowerCase(),
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
      });
      return summarize(reportId);
    },

    async listAnomalies({ type, severity, reportId, paging }) {
      let rows = issueRows;
      if (type) rows = rows.filter((r) => r.issue_type === type);
      if (severity) rows = rows.filter((r) => r.severity === severity);
      if (reportId) rows = rows.filter((r) => r.report_id === reportId);
      const summary = {};
      for (const r of rows) {
        const k = `${r.issue_type}|${r.severity}`;
        summary[k] = (summary[k] ?? 0) + 1;
      }
      return {
        ...paginate(rows, paging),
        summary: Object.entries(summary)
          .map(([k, count]) => {
            const [issue_type, sev] = k.split('|');
            return { issue_type, severity: sev, count };
          })
          .sort((a, b) => b.count - a.count),
      };
    },

    issueTypes: () => [...new Set(issueRows.map((r) => r.issue_type))].sort(),

    async costAttribution({ sort, order, paging }) {
      return { ...paginate(sortRows(costRows, sort, order), paging), credit_price_usd: creditPriceUsd };
    },

    async costReconciliation() {
      const diffs = costRows.map((r) => {
        const source = rowsByReport
          .get(r.report_id)
          .filter((x) => x.credits_valid)
          .reduce((s, x) => s + x.snowflake_credits_consumed, 0);
        return Math.abs(source - r.attributed_credits);
      });
      return {
        ...attribution.reconciliation,
        validation: {
          reports_checked: diffs.length,
          tolerance_credits: 0.05,
          reports_outside_tolerance: diffs.filter((d) => d > 0.05).length,
          max_abs_diff_credits: round(Math.max(...diffs), 6),
        },
      };
    },

    // Used by the telemetry engine (next step): ordered cleaned records.
    telemetryRecords: () => clean,
  };
}
