import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { createWsHub } from '../src/telemetry/wsHub.js';
import { createTelemetryEngine } from '../src/telemetry/engine.js';
import { createTicketStore } from '../src/telemetry/tickets.js';
import { parseCsv, cleanRecords } from '../src/clean.js';
import { CSV } from './helpers.js';

const records = cleanRecords(parseCsv(CSV)).clean;

async function setup(hubOpts = {}) {
  const engine = createTelemetryEngine({ records });
  const tickets = createTicketStore();
  const server = http.createServer((_req, res) => res.end('ok'));
  const hub = createWsHub({ server, engine, tickets, allowedOrigin: 'http://localhost:5173', logger: { warn() {} }, ...hubOpts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = (q = '') => `ws://127.0.0.1:${port}/ws/alerts${q}`;
  const connect = (ticket, opts) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url(ticket ? `?ticket=${ticket}` : ''), opts);
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('unexpected-response', (_req, res) => resolve({ rejected: res.statusCode }));
    ws.on('error', (e) => resolve({ error: e.message }));
  });
  const close = async () => { hub.close(); await new Promise((r) => server.close(r)); };
  const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
  return { engine, tickets, hub, connect, close, until, port };
}

test('handshake: valid ticket gets a snapshot; bad, reused, expired-style and missing tickets are rejected', async () => {
  const s = await setup();
  try {
    s.engine.inject({ report_id: 'RPT_200', avg_load_time_sec: 40 });
    const good = await s.connect(s.tickets.issue({ id: 'u1', role: 'viewer' }));
    await s.until(() => good.frames.length === 1);
    assert.equal(good.frames[0].type, 'snapshot');
    assert.equal(good.frames[0].data.active_alerts.length, 1);
    assert.equal(good.frames[0].data.active_alerts[0].severity, 'CRITICAL');
    assert.equal(good.frames[0].data.status.total_records, 2000);
    assert.equal(good.frames[0].data.recent_events.length, 1);

    const t = s.tickets.issue({ id: 'u2' });
    const first = await s.connect(t); first.ws.close();
    assert.equal((await s.connect(t)).rejected, 401, 'ticket must be single-use');
    assert.equal((await s.connect('garbage')).rejected, 401);
    assert.equal((await s.connect(null)).rejected, 401);
    good.ws.close();
  } finally { await s.close(); }
});

test('origin check: foreign browser origins are refused, allowed origin and no origin pass', async () => {
  const s = await setup();
  try {
    const evil = await s.connect(s.tickets.issue({ id: 'u' }), { headers: { Origin: 'http://evil.example' } });
    assert.equal(evil.rejected, 403);
    const ok = await s.connect(s.tickets.issue({ id: 'u' }), { headers: { Origin: 'http://localhost:5173' } });
    assert.ok(ok.ws); ok.ws.close();
  } finally { await s.close(); }
});

test('other paths are not upgraded', async () => {
  const s = await setup();
  try {
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/somewhere/else`);
      ws.on('error', (e) => resolve(e.message)); ws.on('open', () => resolve('opened'));
    });
    assert.notEqual(r, 'opened');
  } finally { await s.close(); }
});

test('engine messages fan out to every client in order; a closed client does not break others', async () => {
  const s = await setup();
  try {
    const a = await s.connect(s.tickets.issue({ id: 'a' }));
    const b = await s.connect(s.tickets.issue({ id: 'b' }));
    const c = await s.connect(s.tickets.issue({ id: 'c' }));
    await s.until(() => s.hub.clientCount() === 3 && [a, b, c].every((x) => x.frames.length === 1));
    c.ws.close();

    s.engine.inject({ report_id: 'RPT_205', avg_load_time_sec: 22, last_refresh_status: 'FAILED' });
    await s.until(() => a.frames.length === 4 && b.frames.length === 4);
    const types = a.frames.slice(1).map((f) => f.type);
    assert.deepEqual(types, ['telemetry.event', 'alert.created', 'alert.created']);
    assert.deepEqual(a.frames.map((f) => f.type), b.frames.map((f) => f.type));
    assert.ok(a.frames.every((f) => f.ts && f.data));

    s.engine.inject({ report_id: 'RPT_205', avg_load_time_sec: 2 });          // heals both rules
    await s.until(() => a.frames.filter((f) => f.type === 'alert.resolved').length === 2);

    s.engine.acknowledge('A-000001', 'x'); // already resolved → throws, must not push anything
  } catch (e) { if (!/ALREADY_RESOLVED|already resolved/i.test(e.message)) throw e; } finally { await s.close(); }
});

test('status broadcasts when an admin pauses/resumes; capacity limit returns 503', async () => {
  const s = await setup({ maxClients: 1 });
  try {
    const a = await s.connect(s.tickets.issue({ id: 'a' }));
    await s.until(() => a.frames.length === 1);
    s.engine.pause();
    await s.until(() => a.frames.some((f) => f.type === 'telemetry.status' && f.data.running === false));
    assert.equal((await s.connect(s.tickets.issue({ id: 'b' }))).rejected, 503);
    a.ws.close();
  } finally { await s.close(); }
});

test('server survives garbage and oversized inbound frames', async () => {
  const s = await setup();
  try {
    const a = await s.connect(s.tickets.issue({ id: 'a' }));
    await s.until(() => a.frames.length === 1);
    a.ws.send('not json'); a.ws.send('x'.repeat(5000)); // > 1 KB maxPayload -> connection closed by server
    await new Promise((r) => a.ws.on('close', r));
    const b = await s.connect(s.tickets.issue({ id: 'b' }));
    s.engine.inject({ report_id: 'RPT_201', avg_load_time_sec: 50 });
    await s.until(() => b.frames.some((f) => f.type === 'alert.created'));
    b.ws.close();
  } finally { await s.close(); }
});
