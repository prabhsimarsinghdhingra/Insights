import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryEngine } from '../src/telemetry/engine.js';
import { createTicketStore } from '../src/telemetry/tickets.js';
import { parseCsv, cleanRecords } from '../src/clean.js';
import { CSV, build, rejects } from './helpers.js';

const records = cleanRecords(parseCsv(CSV)).clean;
const fresh = () => createTelemetryEngine({ records });
const ev = (report_id, avg_load_time_sec, last_refresh_status = 'SUCCESS') => ({ report_id, avg_load_time_sec, last_refresh_status });
const types = (r) => r.messages.map((m) => m.type);
const alertMsgs = (r) => r.messages.filter((m) => m.type.startsWith('alert.'));

test('latency rule: warning > 15s, critical > 30s, boundary values are healthy', () => {
  const e = fresh();
  assert.deepEqual(alertMsgs(e.inject(ev('RPT_200', 15))), []);            // exactly 15 is not "exceeds"
  const w = alertMsgs(e.inject(ev('RPT_200', 15.1)));
  assert.equal(w[0].type, 'alert.created');
  assert.equal(w[0].data.severity, 'WARNING');
  assert.equal(w[0].data.threshold, 15);
  const c = alertMsgs(e.inject(ev('RPT_201', 30.1)));
  assert.equal(c[0].data.severity, 'CRITICAL');
  assert.equal(c[0].data.threshold, 30);
  assert.match(c[0].data.message, /load time 30.1s exceeded the 30s critical threshold/);
});

test('duplicate breaches are deduplicated into one alert with an occurrence count', () => {
  const e = fresh();
  e.inject(ev('RPT_200', 20)); e.inject(ev('RPT_200', 22)); e.inject(ev('RPT_200', 25));
  const { data, total } = e.listAlerts({ paging: { page: 1, pageSize: 50 } });
  assert.equal(total, 1);
  assert.equal(data[0].occurrences, 3);
  assert.equal(data[0].value, 25);
  assert.equal(e.status().counters.alerts_created, 1);
});

test('escalation, downgrade and auto-resolution on a healthy reading', () => {
  const e = fresh();
  e.inject(ev('RPT_200', 20));
  const up = alertMsgs(e.inject(ev('RPT_200', 55)))[0];
  assert.equal(up.type, 'alert.updated'); assert.equal(up.data.change, 'escalated'); assert.equal(up.data.severity, 'CRITICAL');
  const down = alertMsgs(e.inject(ev('RPT_200', 18)))[0];
  assert.equal(down.data.change, 'downgraded'); assert.equal(down.data.severity, 'WARNING');
  const res = alertMsgs(e.inject(ev('RPT_200', 3)))[0];
  assert.equal(res.type, 'alert.resolved'); assert.equal(res.data.state, 'RESOLVED'); assert.ok(res.data.resolved_at);
  assert.equal(e.status().alerts.open, 0);
  // a new breach after resolution is a NEW alert
  const again = alertMsgs(e.inject(ev('RPT_200', 40)))[0];
  assert.equal(again.type, 'alert.created'); assert.notEqual(again.data.id, res.data.id);
});

test('refresh rule: FAILED/TIMED_OUT critical, UNKNOWN warning, SUCCESS resolves; rules are independent', () => {
  const e = fresh();
  assert.equal(alertMsgs(e.inject(ev('RPT_200', 5, 'FAILED')))[0].data.severity, 'CRITICAL');
  assert.equal(alertMsgs(e.inject(ev('RPT_201', 5, 'TIMED_OUT')))[0].data.severity, 'CRITICAL');
  assert.equal(alertMsgs(e.inject(ev('RPT_202', 5, 'UNKNOWN')))[0].data.severity, 'WARNING');
  assert.equal(alertMsgs(e.inject(ev('RPT_200', 5, 'SUCCESS')))[0].type, 'alert.resolved');
  // one reading, both rules
  const both = alertMsgs(e.inject(ev('RPT_203', 40, 'FAILED')));
  assert.deepEqual(both.map((m) => m.data.rule).sort(), ['LATENCY', 'REFRESH']);
  // resolving latency leaves the refresh alert open
  const partial = alertMsgs(e.inject(ev('RPT_203', 4, 'FAILED')));
  assert.equal(partial.find((m) => m.data.rule === 'LATENCY').type, 'alert.resolved');
  assert.equal(partial.find((m) => m.data.rule === 'REFRESH').type, 'alert.updated');
});

test('acknowledge flow: ack, idempotent, stays quiet on same severity, re-opens on escalation, 409/404', () => {
  const e = fresh();
  const id = alertMsgs(e.inject(ev('RPT_200', 20)))[0].data.id;
  const acked = e.acknowledge(id, 'admin@x.co');
  assert.equal(acked.state, 'ACKNOWLEDGED'); assert.equal(acked.acknowledged_by, 'admin@x.co');
  assert.equal(e.acknowledge(id, 'someone-else@x.co').acknowledged_by, 'admin@x.co'); // idempotent
  assert.equal(alertMsgs(e.inject(ev('RPT_200', 21)))[0].data.state, 'ACKNOWLEDGED');  // still acked
  const esc = alertMsgs(e.inject(ev('RPT_200', 50)))[0];
  assert.equal(esc.data.state, 'OPEN'); assert.equal(esc.data.acknowledged_by, null);   // got worse: re-opened
  e.inject(ev('RPT_200', 1));
  assert.throws(() => e.acknowledge(id, 'a@b.co'), (err) => err.status === 409 && err.code === 'ALREADY_RESOLVED');
  assert.throws(() => e.acknowledge('A-999999', 'a@b.co'), (err) => err.status === 404);
});

test('inject validation', () => {
  const e = fresh();
  assert.throws(() => e.inject(ev('RPT_999', 5)), (err) => err.status === 404);
  assert.throws(() => e.inject(ev('RPT_200', 500)), (err) => err.status === 400);
  assert.throws(() => e.inject(ev('RPT_200', -1)), (err) => err.status === 400);
  assert.throws(() => e.inject(ev('RPT_200', '20')), (err) => err.status === 400);
  assert.throws(() => e.inject(ev('RPT_200', 5, 'EXPLODED')), (err) => err.status === 400);
  assert.throws(() => e.inject({}), (err) => err.status === 404);
  assert.equal(e.status().counters.events, 0); // rejected input never entered the pipeline
});

test('replaying the full dataset: invariants hold at every step', () => {
  const e = fresh();
  const lastLatency = new Map(); const lastStatus = new Map();
  let created = 0; let resolved = 0;
  for (let i = 0; i < records.length; i++) {
    const r = e.tick();
    created += r.messages.filter((m) => m.type === 'alert.created').length;
    resolved += r.messages.filter((m) => m.type === 'alert.resolved').length;
    lastLatency.set(r.event.report_id, r.event.avg_load_time_sec);
    lastStatus.set(r.event.report_id, r.event.last_refresh_status);
  }
  const st = e.status();
  assert.equal(st.counters.events, 2000);
  assert.equal(st.loops, 1); assert.equal(st.cursor, 0);                 // wrapped exactly once
  assert.equal(st.counters.alerts_created, created);
  assert.equal(st.counters.alerts_resolved, resolved);
  const open = e.listAlerts({ state: 'OPEN', paging: { page: 1, pageSize: 200 } }).data;
  const keys = open.map((a) => `${a.report_id}|${a.rule}`);
  assert.equal(new Set(keys).size, keys.length, 'at most one live alert per (report, rule)');
  // final state matches the final reading of every report
  for (const [rid, lat] of lastLatency) {
    assert.equal(keys.includes(`${rid}|LATENCY`), lat > 15, `${rid} latency ${lat}`);
    assert.equal(keys.includes(`${rid}|REFRESH`), lastStatus.get(rid) !== 'SUCCESS', `${rid} ${lastStatus.get(rid)}`);
  }
  assert.equal(created - resolved, open.length);
  assert.ok(created < 2000, `dedupe must cut alert volume (${created} alerts for 2000 readings)`);
  console.log(`      replay: ${created} alerts created, ${resolved} resolved, ${open.length} open after one pass over 2000 readings`);
});

test('history is bounded and never drops live alerts', () => {
  const e = createTelemetryEngine({ records, maxHistory: 5 });
  e.inject(ev('RPT_200', 20)); // stays open
  for (let i = 1; i <= 20; i++) { e.inject(ev(`RPT_${200 + i}`, 20)); e.inject(ev(`RPT_${200 + i}`, 1)); }
  const all = e.listAlerts({ paging: { page: 1, pageSize: 200 } });
  assert.ok(all.total <= 6, `kept ${all.total}`);
  assert.ok(all.data.some((a) => a.report_id === 'RPT_200' && a.state === 'OPEN'));
});

test('subscribers: receive messages, can unsubscribe, a throwing subscriber is isolated', () => {
  const e = fresh(); const got = [];
  const off = e.subscribe((m) => got.push(m.type));
  e.subscribe(() => { throw new Error('boom'); });
  e.inject(ev('RPT_200', 20));
  assert.deepEqual(got, ['telemetry.event', 'alert.created']);
  off(); e.inject(ev('RPT_201', 20));
  assert.equal(got.length, 2);
});

test('timer control: start, pause, resume, speed re-arms the interval', () => {
  const calls = [];
  const timers = {
    setInterval: (fn, ms) => { calls.push(['set', ms]); return calls.length; },
    clearInterval: (id) => calls.push(['clear', id]),
  };
  const e = createTelemetryEngine({ records, intervalMs: 1000, timers });
  e.start();
  assert.deepEqual(calls.at(-1), ['set', 1000]);
  e.setSpeed(4);
  assert.deepEqual(calls.at(-1), ['set', 250]);
  assert.equal(e.status().effective_interval_ms, 250);
  e.pause();
  assert.equal(e.status().running, false);
  assert.equal(calls.at(-1)[0], 'clear');
  e.resume();
  assert.equal(e.status().running, true);
  for (const bad of [0, 0.1, 21, NaN, '2', null]) assert.throws(() => e.setSpeed(bad), (err) => err.status === 400, String(bad));
});

test('ticket store: single use, expiry, unknown input', () => {
  let t = 0;
  const s = createTicketStore({ ttlMs: 1000, now: () => t });
  const a = s.issue({ id: 'u1' });
  assert.deepEqual(s.redeem(a), { id: 'u1' });
  assert.equal(s.redeem(a), null);               // single use
  const b = s.issue({ id: 'u2' });
  t = 1000;
  assert.equal(s.redeem(b), null);               // expired
  assert.equal(s.redeem('nope'), null);
  assert.equal(s.redeem(undefined), null);
  assert.equal(s.redeem({}), null);
  assert.equal(s.size(), 0);
});

test('alert + telemetry handlers (REST layer)', async () => {
  const { handlers: h } = build();
  const inj = await h.injectEvent({ body: { report_id: 'RPT_210', avg_load_time_sec: 55, last_refresh_status: 'FAILED' }, user: { email: 'admin@x.co' } });
  assert.equal(inj.status, 201);
  assert.equal(inj.body.alert_changes.length, 2);
  assert.ok(inj.body.alert_changes.every((c) => c.alert.severity === 'CRITICAL'));

  const list = (await h.listAlerts({ query: { report_id: 'RPT_210', state: 'OPEN' } })).body;
  assert.equal(list.total, 2);
  assert.equal(list.counts.open_critical, 2);
  const id = list.data[0].id;

  const acked = (await h.ackAlert({ params: { id }, user: { email: 'admin@x.co' } })).body;
  assert.equal(acked.state, 'ACKNOWLEDGED');
  await rejects(h.ackAlert({ params: { id: 'A-424242' }, user: {} }), 404);

  await rejects(h.listAlerts({ query: { state: 'DONE' } }), 400);
  await rejects(h.listAlerts({ query: { rule: 'CPU' } }), 400);
  await rejects(h.injectEvent({ body: null, user: {} }), 400);
  await rejects(h.injectEvent({ body: { report_id: 'RPT_210', avg_load_time_sec: 'fast' }, user: {} }), 400);

  assert.equal((await h.telemetryControl({ body: { action: 'set_speed', speed: 5 } })).body.speed, 5);
  await rejects(h.telemetryControl({ body: { action: 'set_speed', speed: 999 } }), 400);
  await rejects(h.telemetryControl({ body: { action: 'explode' } }), 400);
  await rejects(h.telemetryControl({ body: null }), 400);
  assert.equal((await h.telemetryStatus({})).body.total_records, 2000);

  const t = (await h.wsTicket({ user: { id: 'u1', role: 'viewer' } })).body;
  assert.ok(t.ticket.length >= 40); assert.equal(t.expires_in_sec, 30);
});
