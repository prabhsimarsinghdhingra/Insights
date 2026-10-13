// Data-cleaning module for the Pure Insights monitoring dataset.
// Pure functions + a small CLI. Nothing is silently dropped: every record
// is kept and annotated, and every defect becomes a row in the issue log.

import fs from 'node:fs';
import path from 'node:path';

// ---- Thresholds (single source of truth, reused by the alert engine) ----
export const THRESHOLDS = {
  LATENCY_WARNING_SEC: 15,   // brief: alert when load latency exceeds 15s
  LATENCY_CRITICAL_SEC: 30,
  IQR_FENCE_MULTIPLIER: 3,   // extreme-outlier fence for AWS cost per view
};

const ORPHAN_LITERAL = 'ORPHANED_REPORT';

export function quantile(sortedAsc, q) {
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

export function latencyTier(sec) {
  if (sec > THRESHOLDS.LATENCY_CRITICAL_SEC) return 'CRITICAL';
  if (sec > THRESHOLDS.LATENCY_WARNING_SEC) return 'WARNING';
  return 'OK';
}

export function refreshAlertLevel(status) {
  if (status === 'FAILED' || status === 'TIMED_OUT') return 'CRITICAL';
  if (status === 'UNKNOWN') return 'WARNING';
  return 'NONE';
}

// Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). Returns array of objects.
export function parseCsv(text) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === '')) records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') { /* ignore, handled by \n */ }
    else field += c;
  }
  if (field !== '' || row.length) pushRow();

  const [header, ...body] = records;
  const cols = header.map((h) => h.trim());
  return body.map((vals) =>
    Object.fromEntries(cols.map((c, idx) => [c, (vals[idx] ?? '').trim()])));
}

export function cleanRecords(rawRows) {
  // Pass 1: normalize and type every record.
  const rows = rawRows.map((r, i) => {
    const ownerRaw = (r.owner_email ?? '').trim();
    const isLiteral = ownerRaw.toUpperCase() === ORPHAN_LITERAL;
    const isMissing = ownerRaw === '' || ownerRaw.toLowerCase() === 'nan';
    const views = Number(r.monthly_active_views);
    const aws = Number(r.aws_hosting_cost_usd);
    const credits = Number(r.snowflake_credits_consumed);
    const load = Number(r.avg_load_time_sec);

    return {
      src_row_num: i + 1,
      report_id: r.report_id,
      report_name: r.report_name,
      owner_email: isLiteral || isMissing ? null : ownerRaw,
      is_orphaned: isLiteral || isMissing,
      orphan_reason: isLiteral ? 'ORPHANED_REPORT_LITERAL' : isMissing ? 'MISSING_OWNER' : null,
      last_refresh_status: (r.last_refresh_status || 'UNKNOWN').toUpperCase(),
      monthly_active_views: views,
      snowflake_credits_consumed: credits,
      credits_valid: credits >= 0,
      avg_load_time_sec: load,
      latency_tier: latencyTier(load),
      aws_hosting_cost_usd: aws,
      aws_cost_per_view: views > 0 ? aws / views : null,
      query_count_last_30d: Number(r.query_count_last_30d),
      concurrent_user_peak: Number(r.concurrent_user_peak),
    };
  });

  // Dataset-level fence for AWS cost per view (rows with views > 0 only).
  const ratios = rows
    .map((r) => r.aws_cost_per_view)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  const q1 = quantile(ratios, 0.25);
  const q3 = quantile(ratios, 0.75);
  const fence = q3 + THRESHOLDS.IQR_FENCE_MULTIPLIER * (q3 - q1);

  // Pass 2: detect issues.
  const issues = [];
  const add = (r, issue_type, severity, detail) =>
    issues.push({ src_row_num: r.src_row_num, report_id: r.report_id, issue_type, severity, detail });

  for (const r of rows) {
    if (r.is_orphaned) {
      add(r, 'ORPHANED_REPORT', 'HIGH',
        r.orphan_reason === 'ORPHANED_REPORT_LITERAL'
          ? "owner_email is the literal 'ORPHANED_REPORT'"
          : 'owner_email is missing (NaN/blank)');
    }
    if (!r.credits_valid) {
      add(r, 'NEGATIVE_CREDITS', 'HIGH',
        `snowflake_credits_consumed = ${r.snowflake_credits_consumed}; excluded from cost attribution`);
    }
    if (r.latency_tier !== 'OK') {
      add(r, 'LATENCY_SPIKE', r.latency_tier === 'CRITICAL' ? 'MEDIUM' : 'LOW',
        `avg_load_time_sec = ${r.avg_load_time_sec} (${r.latency_tier})`);
    }
    if (r.monthly_active_views === 0) {
      add(r, 'ZERO_VIEWS', 'MEDIUM',
        `monthly_active_views = 0 with aws_hosting_cost_usd = ${r.aws_hosting_cost_usd}; unit cost undefined`);
    }
    if (r.concurrent_user_peak > r.monthly_active_views) {
      add(r, 'PEAK_EXCEEDS_VIEWS', 'MEDIUM',
        `concurrent_user_peak ${r.concurrent_user_peak} > monthly_active_views ${r.monthly_active_views}`);
    }
    if (r.aws_cost_per_view !== null && r.aws_cost_per_view > fence) {
      add(r, 'AWS_COST_PER_VIEW_OUTLIER', 'MEDIUM',
        `aws cost per view ${r.aws_cost_per_view.toFixed(2)} > fence ${fence.toFixed(2)}`);
    }
    if (r.query_count_last_30d < r.monthly_active_views) {
      add(r, 'QUERIES_BELOW_VIEWS', 'LOW',
        `query_count_last_30d ${r.query_count_last_30d} < monthly_active_views ${r.monthly_active_views}`);
    }
  }

  const perRow = new Map();
  for (const i of issues) perRow.set(i.src_row_num, (perRow.get(i.src_row_num) ?? 0) + 1);

  const clean = rows.map((r) => ({
    ...r,
    refresh_alert_level: refreshAlertLevel(r.last_refresh_status),
    issue_count: perRow.get(r.src_row_num) ?? 0,
  }));

  return { clean, issues, meta: { fence, q1, q3 } };
}

export function summarize(rawRows, { clean, issues, meta }) {
  const byType = {};
  for (const i of issues) byType[i.issue_type] = (byType[i.issue_type] ?? 0) + 1;
  const uniqueReports = new Set(clean.map((r) => r.report_id)).size;
  const byStatus = {};
  for (const r of clean) byStatus[r.last_refresh_status] = (byStatus[r.last_refresh_status] ?? 0) + 1;
  return {
    input_rows: rawRows.length,
    clean_rows: clean.length,
    unique_report_ids: uniqueReports,
    orphaned: clean.filter((r) => r.is_orphaned).length,
    orphan_missing_owner: clean.filter((r) => r.orphan_reason === 'MISSING_OWNER').length,
    orphan_literal: clean.filter((r) => r.orphan_reason === 'ORPHANED_REPORT_LITERAL').length,
    negative_credit_rows: clean.filter((r) => !r.credits_valid).length,
    latency_critical: clean.filter((r) => r.latency_tier === 'CRITICAL').length,
    latency_warning: clean.filter((r) => r.latency_tier === 'WARNING').length,
    refresh_status: byStatus,
    refresh_critical: clean.filter((r) => r.refresh_alert_level === 'CRITICAL').length,
    issues_total: issues.length,
    issues_by_type: byType,
    records_with_any_issue: clean.filter((r) => r.issue_count > 0).length,
    cost_per_view_fence: Number(meta.fence.toFixed(4)),
  };
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

// ---- CLI: node src/clean.js <input.csv> <outDir> ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, outDir = 'data/out'] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node src/clean.js <input.csv> [outDir]');
    process.exit(1);
  }
  const rawRows = parseCsv(fs.readFileSync(input, 'utf8'));
  const result = cleanRecords(rawRows);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report_metrics_clean.csv'), toCsv(result.clean));
  fs.writeFileSync(path.join(outDir, 'data_quality_issues.csv'), toCsv(result.issues));
  const summary = summarize(rawRows, result);
  fs.writeFileSync(path.join(outDir, 'cleaning_summary.json'), JSON.stringify(summary, null, 2));

  // Load-ready files: column order matches snowflake/02_tables.sql exactly,
  // so Snowsight's "Load data into a table" maps by position with no edits.
  const loadDir = path.join(outDir, 'load');
  fs.mkdirSync(loadDir, { recursive: true });
  const pick = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  const RAW_COLS = ['src_row_num', 'report_id', 'report_name', 'owner_email', 'last_refresh_status',
    'monthly_active_views', 'snowflake_credits_consumed', 'avg_load_time_sec',
    'aws_hosting_cost_usd', 'query_count_last_30d', 'concurrent_user_peak'];
  const CLEAN_COLS = ['src_row_num', 'report_id', 'report_name', 'owner_email', 'is_orphaned',
    'orphan_reason', 'last_refresh_status', 'refresh_alert_level', 'monthly_active_views',
    'snowflake_credits_consumed', 'credits_valid', 'avg_load_time_sec', 'latency_tier',
    'aws_hosting_cost_usd', 'aws_cost_per_view', 'query_count_last_30d',
    'concurrent_user_peak', 'issue_count'];
  const rawWithRow = rawRows.map((r, i) => ({ src_row_num: i + 1, ...r }));
  const detectedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const issuesWithIds = result.issues.map((x, i) => ({ issue_id: i + 1, ...x, detected_at: detectedAt }));
  fs.writeFileSync(path.join(loadDir, '1_raw_report_metrics.csv'), toCsv(pick(rawWithRow, RAW_COLS)));
  fs.writeFileSync(path.join(loadDir, '2_clean_report_metrics.csv'), toCsv(pick(result.clean, CLEAN_COLS)));
  fs.writeFileSync(path.join(loadDir, '3_data_quality_issues.csv'), toCsv(issuesWithIds));
  console.log(JSON.stringify(summary, null, 2));
}
