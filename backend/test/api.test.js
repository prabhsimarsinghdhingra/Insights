import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, rejects } from './helpers.js';

const { handlers: h } = build();

test('health summary matches the cleaned data', async () => {
  const { body: s } = await h.healthSummary({});
  assert.equal(s.records.total, 2000);
  assert.equal(s.records.unique_reports, 100);
  assert.deepEqual([s.refresh.SUCCESS, s.refresh.FAILED, s.refresh.TIMED_OUT, s.refresh.UNKNOWN], [1336, 382, 182, 100]);
  assert.equal(s.refresh.problem_records, 564);
  assert.equal(s.latency.warning_records, 580);
  assert.equal(s.latency.critical_records, 910);
  assert.equal(s.latency.max_sec, 55);
  assert.equal(s.ownership.orphaned_records, 245);
  assert.equal(s.ownership.orphaned_records_pct, 12.25);
  assert.equal(s.ownership.reports_with_orphan_history, 94);
  assert.equal(s.ownership.reports_currently_orphaned, 14);
  assert.equal(s.ownership.reports_with_conflicting_owners, 100);
  assert.equal(s.data_quality.issues_total, 2053);
  assert.equal(s.data_quality.negative_credit_records, 24);
  assert.equal(s.cost.quarantined_windows, 24);
  assert.ok(Math.abs(s.cost.metered_valid_credits - 1206352.48) < 0.01);
  assert.ok(Math.abs(s.cost.unattributed_credits) < 0.01);
});

test('reports list: paging, filters, sorting, validation', async () => {
  const page1 = (await h.listReports({ query: { page_size: '10' } })).body;
  assert.equal(page1.total, 100);
  assert.equal(page1.data.length, 10);
  assert.equal(page1.total_pages, 10);
  assert.equal(page1.data[0].report_id, 'RPT_200');

  const orphaned = (await h.listReports({ query: { owner_status: 'ORPHANED' } })).body;
  assert.equal(orphaned.total, 14);
  assert.ok(orphaned.data.every((r) => r.current_owner === null));

  const failed = (await h.listReports({ query: { latest_refresh_status: 'FAILED' } })).body;
  assert.ok(failed.data.every((r) => r.latest_refresh_status === 'FAILED'));

  const search = (await h.listReports({ query: { search: 'dashboard 24' } })).body;
  assert.ok(search.data.some((r) => r.report_id === 'RPT_223'));

  const sorted = (await h.listReports({ query: { sort: 'avg_load_time_sec', order: 'desc', page_size: '5' } })).body.data;
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].avg_load_time_sec >= sorted[i].avg_load_time_sec);

  await rejects(h.listReports({ query: { sort: 'password; DROP TABLE' } }), 400);
  await rejects(h.listReports({ query: { order: 'sideways' } }), 400);
  await rejects(h.listReports({ query: { page: '0' } }), 400);
  await rejects(h.listReports({ query: { page_size: '101' } }), 400);
  await rejects(h.listReports({ query: { owner_status: ['a', 'b'] } }), 400);
  await rejects(h.listReports({ query: { has_orphan_history: 'maybe' } }), 400);
});

test('orphaned reports endpoint lists reports with no current owner', async () => {
  const { body } = await h.listOrphanedReports({ query: {} });
  assert.equal(body.total, 14);
  assert.ok(body.data.every((r) => r.owner_status === 'ORPHANED'));
});

test('report detail, 404, and owner assignment (admin write)', async () => {
  const { handlers, repo } = build();
  const orphan = (await handlers.listOrphanedReports({ query: {} })).body.data[0];
  const detail = (await handlers.getReport({ params: { id: orphan.report_id } })).body;
  assert.equal(detail.snapshots_detail.length, 20);
  assert.ok(detail.cost.attributed_credits > 0);
  await rejects(handlers.getReport({ params: { id: 'RPT_999' } }), 404, 'NOT_FOUND');

  const before = (await repo.healthSummary()).ownership.reports_currently_orphaned;
  const res = await handlers.assignOwner({
    params: { id: orphan.report_id }, body: { owner_email: 'New.Owner@company.com' }, user: { email: 'admin@pureinsights.demo' },
  });
  assert.equal(res.body.owner_status, 'ASSIGNED');
  assert.equal(res.body.current_owner, 'new.owner@company.com');
  assert.equal(res.body.owner_assigned_by, 'admin@pureinsights.demo');
  assert.equal((await repo.healthSummary()).ownership.reports_currently_orphaned, before - 1);

  await rejects(handlers.assignOwner({ params: { id: orphan.report_id }, body: { owner_email: 'not-an-email' }, user: {} }), 400);
  await rejects(handlers.assignOwner({ params: { id: orphan.report_id }, body: {}, user: {} }), 400);
  await rejects(handlers.assignOwner({ params: { id: 'RPT_999' }, body: { owner_email: 'a@b.co' }, user: {} }), 404);
});

test('anomalies: filters, summary and enum validation', async () => {
  const all = (await h.listAnomalies({ query: {} })).body;
  assert.equal(all.total, 2053);
  assert.equal(all.data.length, 50);
  const neg = (await h.listAnomalies({ query: { type: 'NEGATIVE_CREDITS' } })).body;
  assert.equal(neg.total, 24);
  assert.equal(neg.summary[0].severity, 'HIGH');
  const orph = (await h.listAnomalies({ query: { type: 'ORPHANED_REPORT', severity: 'HIGH' } })).body;
  assert.equal(orph.total, 245);
  await rejects(h.listAnomalies({ query: { type: 'MADE_UP' } }), 400);
  await rejects(h.listAnomalies({ query: { severity: 'EXTREME' } }), 400);
});

test('cost attribution matches the independent SQL / pandas results', async () => {
  const { body } = await h.costAttribution({ query: {} });
  assert.equal(body.total, 100);
  assert.equal(body.credit_price_usd, 3);
  const top = body.data[0];
  // Verified separately in SQL (V_REPORT_UNIT_COST) and pandas: RPT_223, $4.9934/view
  assert.equal(top.report_id, 'RPT_223');
  assert.equal(top.cost_per_view_rank, 1);
  assert.ok(Math.abs(top.attributed_credits - 17034.7589) < 0.01);
  assert.ok(Math.abs(top.total_cost_per_view_usd - 4.9934) < 0.0005);
  assert.equal(top.active_views, 11259);
  const asc = (await h.costAttribution({ query: { sort: 'total_cost_usd', order: 'asc', page_size: '3' } })).body.data;
  assert.ok(asc[0].total_cost_usd <= asc[1].total_cost_usd);
  await rejects(h.costAttribution({ query: { sort: 'bogus' } }), 400);
});

test('cost reconciliation: nothing lost, negatives quarantined, attribution within tolerance', async () => {
  const { body: r } = await h.costReconciliation({});
  assert.ok(Math.abs(r.metered_valid_credits - 1206352.48) < 0.01);
  assert.ok(Math.abs(r.unattributed_credits) < 0.01);
  assert.equal(r.quarantined_windows, 24);
  assert.ok(Math.abs(r.quarantined_negative_credits - -161.04) < 0.001);
  assert.equal(r.validation.reports_checked, 100);
  assert.equal(r.validation.reports_outside_tolerance, 0);
  assert.ok(r.validation.max_abs_diff_credits < 0.01);
});

test('ping and me', async () => {
  assert.equal((await h.ping({})).body.status, 'ok');
  const u = { id: 'u1', email: 'a@b.co', role: 'viewer' };
  assert.deepEqual((await h.me({ user: u })).body.user, u);
});
