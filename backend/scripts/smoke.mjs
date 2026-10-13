// End-to-end smoke test against a RUNNING server: authentication, RBAC and
// the main endpoints. Usage: npm start (one terminal), npm run smoke (another).
// Env: API_URL (default http://localhost:4000), DEMO_PASSWORD (default below).

import WebSocket from 'ws';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'PureInsights#2026';
let failures = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   -> ${detail}`}`);
  if (!ok) failures++;
};

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}


function openSocket(ticket) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/alerts?ticket=${ticket}`);
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.on('error', (e) => resolve({ error: e.message }));
  });
}
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
};

async function login(email, password = PASSWORD) {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  return { ...r, token: r.json?.token };
}

try {
  const ping = await call('GET', '/api/ping');
  check('ping is public', ping.status === 200 && ping.json?.status === 'ok', JSON.stringify(ping));

  check('no token -> 401', (await call('GET', '/api/health/summary')).status === 401);
  check('garbage token -> 401', (await call('GET', '/api/health/summary', { token: 'abc.def.ghi' })).status === 401);
  check('wrong password -> 401', (await login('admin@pureinsights.demo', 'wrong-password')).status === 401);
  check('malformed JSON body -> 400', (await call('POST', '/api/auth/login', { raw: '{"email":' })).status === 400);

  const viewer = await login('viewer@pureinsights.demo');
  const analyst = await login('analyst@pureinsights.demo');
  const admin = await login('admin@pureinsights.demo');
  check('viewer, analyst and admin can log in', viewer.token && analyst.token && admin.token,
    `statuses ${viewer.status}/${analyst.status}/${admin.status} (is DEMO_PASSWORD right?)`);
  if (!(viewer.token && analyst.token && admin.token)) throw new Error('cannot continue without logins');

  const me = await call('GET', '/api/auth/me', { token: viewer.token });
  check('/auth/me returns the role', me.json?.user?.role === 'viewer', JSON.stringify(me.json));

  // viewer: health only
  const health = await call('GET', '/api/health/summary', { token: viewer.token });
  check('viewer sees health summary (2000 records)', health.status === 200 && health.json?.records?.total === 2000, JSON.stringify(health.json)?.slice(0, 120));
  check('viewer blocked from reports (403)', (await call('GET', '/api/reports', { token: viewer.token })).status === 403);
  check('viewer blocked from costs (403)', (await call('GET', '/api/costs/attribution', { token: viewer.token })).status === 403);

  // analyst: read everything, no writes
  const reports = await call('GET', '/api/reports?page_size=5', { token: analyst.token });
  check('analyst lists reports (100 total)', reports.status === 200 && reports.json?.total === 100 && reports.json.data.length === 5);
  const orphaned = await call('GET', '/api/reports/orphaned', { token: analyst.token });
  check('analyst sees 14 currently orphaned reports', orphaned.status === 200 && orphaned.json?.total === 14, `total=${orphaned.json?.total}`);
  const costs = await call('GET', '/api/costs/attribution?page_size=1', { token: analyst.token });
  check('top cost-per-view report is RPT_223', costs.json?.data?.[0]?.report_id === 'RPT_223', JSON.stringify(costs.json?.data?.[0]));
  const rec = await call('GET', '/api/costs/reconciliation', { token: analyst.token });
  check('cost reconciliation: 24 quarantined windows, 0 reports outside tolerance',
    rec.json?.quarantined_windows === 24 && rec.json?.validation?.reports_outside_tolerance === 0, JSON.stringify(rec.json));
  const dq = await call('GET', '/api/data-quality/anomalies?type=NEGATIVE_CREDITS', { token: analyst.token });
  check('anomalies: 24 negative-credit issues', dq.json?.total === 24, `total=${dq.json?.total}`);
  check('bad sort rejected (400)', (await call('GET', '/api/reports?sort=nope', { token: analyst.token })).status === 400);
  check('unknown report -> 404', (await call('GET', '/api/reports/RPT_999', { token: analyst.token })).status === 404);

  const target = orphaned.json?.data?.[0]?.report_id;
  check('analyst cannot assign owners (403)',
    (await call('POST', `/api/reports/${target}/owner`, { token: analyst.token, body: { owner_email: 'x@y.co' } })).status === 403);

  // admin: write
  check('admin: invalid email -> 400',
    (await call('POST', `/api/reports/${target}/owner`, { token: admin.token, body: { owner_email: 'nope' } })).status === 400);
  const assigned = await call('POST', `/api/reports/${target}/owner`, { token: admin.token, body: { owner_email: 'smoke.test@company.com' } });
  check('admin assigns an owner to an orphaned report',
    assigned.status === 200 && assigned.json?.owner_status === 'ASSIGNED', JSON.stringify(assigned.json)?.slice(0, 160));
  const after = await call('GET', '/api/reports/orphaned', { token: admin.token });
  check('orphaned count drops to 13', after.json?.total === 13, `total=${after.json?.total}`);
  check('unknown route -> 404', (await call('GET', '/api/nope', { token: admin.token })).status === 404);

  // ---- real-time alerting ------------------------------------------------
  const vAlerts = await call('GET', '/api/alerts', { token: viewer.token });
  check('viewer can read alerts', vAlerts.status === 200 && vAlerts.json?.counts !== undefined, JSON.stringify(vAlerts.json)?.slice(0, 120));
  const tstat = await call('GET', '/api/telemetry/status', { token: viewer.token });
  check('telemetry status: replaying 2000 readings', tstat.status === 200 && tstat.json?.total_records === 2000, JSON.stringify(tstat.json)?.slice(0, 120));
  check('viewer cannot inject (403)', (await call('POST', '/api/telemetry/inject', { token: viewer.token, body: { report_id: 'RPT_250' } })).status === 403);
  check('analyst cannot control telemetry (403)', (await call('POST', '/api/telemetry/control', { token: analyst.token, body: { action: 'pause' } })).status === 403);

  // pause the replay so the next checks are deterministic
  const paused = await call('POST', '/api/telemetry/control', { token: admin.token, body: { action: 'pause' } });
  check('admin pauses the replay', paused.status === 200 && paused.json?.running === false, JSON.stringify(paused.json)?.slice(0, 120));
  check('invalid speed rejected (400)', (await call('POST', '/api/telemetry/control', { token: admin.token, body: { action: 'set_speed', speed: 999 } })).status === 400);
  check('invalid injection rejected (400)', (await call('POST', '/api/telemetry/inject', { token: admin.token, body: { report_id: 'RPT_250', avg_load_time_sec: 500 } })).status === 400);
  check('unknown report injection -> 404', (await call('POST', '/api/telemetry/inject', { token: admin.token, body: { report_id: 'RPT_999' } })).status === 404);

  // live socket as the VIEWER (least privilege can still watch)
  const tk = await call('POST', '/api/auth/ws-ticket', { token: viewer.token });
  check('viewer gets a ws ticket', tk.status === 200 && typeof tk.json?.ticket === 'string', JSON.stringify(tk.json));
  const sock = await openSocket(tk.json.ticket);
  check('websocket connects with the ticket', !!sock.ws, JSON.stringify(sock));
  const reuse = await openSocket(tk.json.ticket);
  check('ticket is single-use (reuse -> 401)', reuse.status === 401, JSON.stringify(reuse));
  check('missing ticket -> 401', (await openSocket('')).status === 401);

  if (sock.ws) {
    check('first frame is a snapshot', await waitFor(() => sock.frames[0]?.type === 'snapshot'));

    // inject a 55s spike + failed refresh and watch it arrive live
    const inj = await call('POST', '/api/telemetry/inject', {
      token: admin.token, body: { report_id: 'RPT_250', avg_load_time_sec: 55, last_refresh_status: 'FAILED' },
    });
    check('inject 55s + FAILED -> two CRITICAL alerts',
      inj.status === 201 && inj.json?.alert_changes?.length === 2 && inj.json.alert_changes.every((c) => c.alert.severity === 'CRITICAL'),
      JSON.stringify(inj.json)?.slice(0, 200));
    check('socket receives alert.created for LATENCY and REFRESH',
      await waitFor(() => ['LATENCY', 'REFRESH'].every((r) => sock.frames.some((f) => f.type === 'alert.created' && f.data.report_id === 'RPT_250' && f.data.rule === r))));

    const open = await call('GET', '/api/alerts?report_id=RPT_250&state=OPEN', { token: viewer.token });
    check('REST agrees: 2 open alerts for RPT_250', open.json?.total === 2, `total=${open.json?.total}`);
    const alertId = open.json?.data?.[0]?.id;
    check('viewer cannot acknowledge (403)', (await call('POST', `/api/alerts/${alertId}/ack`, { token: viewer.token })).status === 403);
    const ack = await call('POST', `/api/alerts/${alertId}/ack`, { token: admin.token });
    check('admin acknowledges', ack.status === 200 && ack.json?.state === 'ACKNOWLEDGED' && ack.json?.acknowledged_by === 'admin@pureinsights.demo', JSON.stringify(ack.json)?.slice(0, 160));
    check('socket receives the acknowledgement',
      await waitFor(() => sock.frames.some((f) => f.type === 'alert.updated' && f.data.change === 'acknowledged' && f.data.id === alertId)));
    check('unknown alert -> 404', (await call('POST', '/api/alerts/A-999999/ack', { token: admin.token })).status === 404);

    // heal it
    await call('POST', '/api/telemetry/inject', { token: admin.token, body: { report_id: 'RPT_250', avg_load_time_sec: 3, last_refresh_status: 'SUCCESS' } });
    check('socket receives alert.resolved for both rules',
      await waitFor(() => sock.frames.filter((f) => f.type === 'alert.resolved' && f.data.report_id === 'RPT_250').length === 2));
    check('acknowledging a resolved alert -> 409', (await call('POST', `/api/alerts/${alertId}/ack`, { token: admin.token })).status === 409);
    sock.ws.close();
  }

  const resumed = await call('POST', '/api/telemetry/control', { token: admin.token, body: { action: 'resume' } });
  check('admin resumes the replay', resumed.status === 200 && resumed.json?.running === true);
} catch (err) {
  console.error('\nSmoke test aborted:', err.message);
  failures++;
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
