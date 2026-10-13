// Generates simulated SNOWFLAKE.ACCOUNT_USAGE data (QUERY_HISTORY and
// WAREHOUSE_METERING_HISTORY) calibrated to the cleaned CSV.
//
// Why simulate: ACCOUNT_USAGE is read-only system data, and the CSV has no
// per-query records. The generator is deterministic (seeded), so the same
// input always yields the same output.
//
// Model:
//  * Valid-credit rows are packed 4 per hourly metering window, so each
//    window is SHARED by 4 different reports (the realistic case that makes
//    attribution non-trivial).
//  * Each row produces 5 queries tagged with its report_id. Their execution
//    times sum to credits * MS_PER_CREDIT, so execution-time share equals
//    credit share and the SQL result can be validated against the CSV.
//  * Negative-credit rows become their own metering windows with no queries,
//    reproducing the injected anomaly for the SQL filter to quarantine.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, cleanRecords, toCsv } from './clean.js';

const BASE = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01 00:00:00 UTC
const HOUR = 3_600_000;
const WAREHOUSE = 'PORTAL_WH';
const WINDOW_SIZE = 4;
const QUERIES_PER_ROW = 5;
const MS_PER_CREDIT = 1000;

const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(cleanRows) {
  const valid = cleanRows.filter((r) => r.credits_valid);
  const negative = cleanRows.filter((r) => !r.credits_valid);
  const metering = [];
  const queries = [];
  const windowCount = Math.ceil(valid.length / WINDOW_SIZE);

  for (let w = 0; w < windowCount; w++) {
    const group = valid.slice(w * WINDOW_SIZE, (w + 1) * WINDOW_SIZE);
    const start = BASE + w * HOUR;
    const credits = round(group.reduce((s, r) => s + r.snowflake_credits_consumed, 0), 2);
    const compute = round(credits * 0.97, 4);
    metering.push({
      start_time: fmt(start),
      end_time: fmt(start + HOUR),
      warehouse_name: WAREHOUSE,
      credits_used: credits,
      credits_used_compute: compute,
      credits_used_cloud_services: round(credits - compute, 4),
    });

    for (const r of group) {
      const rng = mulberry32(r.src_row_num);
      const weights = Array.from({ length: QUERIES_PER_ROW }, () => 0.5 + rng());
      const wSum = weights.reduce((a, b) => a + b, 0);
      const targetMs = r.snowflake_credits_consumed * MS_PER_CREDIT;
      weights.forEach((wt, i) => {
        const exec = Math.round((targetMs * wt) / wSum);
        const qStart = start + Math.floor(rng() * 3500) * 1000;
        const overhead = Math.floor(rng() * 1900) + 100;
        queries.push({
          query_id: `SIMQ${String(r.src_row_num).padStart(5, '0')}${i + 1}`,
          query_tag: r.report_id,
          query_type: 'SELECT',
          user_name: r.owner_email ?? 'PORTAL_SVC',
          warehouse_name: WAREHOUSE,
          start_time: fmt(qStart),
          end_time: fmt(qStart + exec + overhead),
          total_elapsed_time: exec + overhead,
          execution_time: exec,
        });
      });
    }
  }

  negative.forEach((r, j) => {
    const start = BASE + (windowCount + j) * HOUR;
    const credits = r.snowflake_credits_consumed;
    const compute = round(credits * 0.97, 4);
    metering.push({
      start_time: fmt(start),
      end_time: fmt(start + HOUR),
      warehouse_name: WAREHOUSE,
      credits_used: credits,
      credits_used_compute: compute,
      credits_used_cloud_services: round(credits - compute, 4),
    });
  });

  return { metering, queries };
}

// ---- CLI: node src/simulate-account-usage.js <input.csv> <outDir> ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, outDir = 'data/out/load'] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node src/simulate-account-usage.js <input.csv> [outDir]');
    process.exit(1);
  }
  const { clean } = cleanRecords(parseCsv(fs.readFileSync(input, 'utf8')));
  const { metering, queries } = simulate(clean);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '4_sim_query_history.csv'), toCsv(queries));
  fs.writeFileSync(path.join(outDir, '5_sim_warehouse_metering_history.csv'), toCsv(metering));
  console.log(JSON.stringify({
    query_rows: queries.length,
    metering_windows: metering.length,
    negative_windows: metering.filter((m) => m.credits_used < 0).length,
    total_valid_credits: round(metering.filter((m) => m.credits_used >= 0).reduce((s, m) => s + m.credits_used, 0), 2),
  }, null, 2));
}
