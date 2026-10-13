// Real-time telemetry and alerting engine.
//
// The CSV is replayed as a live stream of monitoring readings. Each reading
// is evaluated against two rules:
//   LATENCY  load time > 15s  -> WARNING, > 30s -> CRITICAL   (brief: > 15s)
//   REFRESH  FAILED / TIMED_OUT -> CRITICAL, UNKNOWN -> WARNING
//
// Because 74.5% of the records breach 15s, naive "one alert per breach"
// would flood operators. Alerts therefore have a lifecycle, one per
// (report, rule):
//   OPEN -> ACKNOWLEDGED (by an admin) -> RESOLVED (a healthy reading)
// A repeat breach only increments `occurrences`; a worse severity escalates
// (and re-opens an acknowledged alert). Every state change is published to
// subscribers (the WebSocket hub) as a typed message.
//
// The engine is framework-free: time and timers are injected, so the whole
// lifecycle is unit-testable without waiting on real clocks.

import { THRESHOLDS } from '../clean.js';
import { badRequest, notFound, conflict } from '../errors.js';
import { paginate } from '../http/params.js';

const RANK = { WARNING: 1, CRITICAL: 2 };
export const REFRESH_STATUSES = ['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'];
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 20;

const publicAlert = ({ key, ...rest }) => ({ ...rest });

export function createTelemetryEngine({
  records,
  intervalMs = 1000,
  maxHistory = 1000,
  maxRecentEvents = 50,
  now = () => Date.now(),
  timers = { setInterval, clearInterval },
}) {
  if (!records?.length) throw new Error('telemetry engine needs at least one record');

  const reportNames = new Map(records.map((r) => [r.report_id, r.report_name]));
  const listeners = new Set();
  const alertsById = new Map(); // insertion order == creation order
  const activeByKey = new Map(); // `${report}|${rule}` -> alert (OPEN or ACKNOWLEDGED)
  const recentEvents = [];

  const state = {
    cursor: 0,
    loops: 0,
    running: false,
    speed: 1,
    seq: 0,
    alertSeq: 0,
    startedAt: null,
    timer: null,
    counters: { events: 0, injected: 0, alerts_created: 0, alerts_resolved: 0, alerts_escalated: 0 },
  };

  const iso = () => new Date(now()).toISOString();
  const emit = (type, data) => {
    const message = { type, ts: iso(), data };
    for (const fn of listeners) {
      try { fn(message); } catch { /* a bad subscriber must not stop the engine */ }
    }
    return message;
  };

  function trimHistory() {
    if (alertsById.size <= maxHistory) return;
    for (const [id, alert] of alertsById) {
      if (alertsById.size <= maxHistory) break;
      if (alert.state === 'RESOLVED') alertsById.delete(id); // never drop live alerts
    }
  }

  function describe(rule, evt, severity) {
    if (rule === 'LATENCY') {
      const thr = severity === 'CRITICAL' ? THRESHOLDS.LATENCY_CRITICAL_SEC : THRESHOLDS.LATENCY_WARNING_SEC;
      return {
        value: evt.avg_load_time_sec,
        threshold: thr,
        message: `${evt.report_name} load time ${evt.avg_load_time_sec}s exceeded the ${thr}s ${severity.toLowerCase()} threshold`,
      };
    }
    return {
      value: evt.last_refresh_status,
      threshold: null,
      message: `${evt.report_name} automated refresh ${evt.last_refresh_status.replace('_', ' ')}`,
    };
  }

  // Applies one rule's verdict (severity or null for healthy) to the alert set.
  function evaluate(rule, evt, severity, out) {
    const key = `${evt.report_id}|${rule}`;
    const existing = activeByKey.get(key);

    if (!severity) {
      if (!existing) return;
      existing.state = 'RESOLVED';
      existing.resolved_at = iso();
      activeByKey.delete(key);
      state.counters.alerts_resolved += 1;
      out.push(emit('alert.resolved', publicAlert(existing)));
      trimHistory();
      return;
    }

    const detail = describe(rule, evt, severity);
    if (!existing) {
      state.alertSeq += 1;
      const alert = {
        id: `A-${String(state.alertSeq).padStart(6, '0')}`,
        key,
        rule,
        severity,
        state: 'OPEN',
        report_id: evt.report_id,
        report_name: evt.report_name,
        ...detail,
        first_seen: iso(),
        last_seen: iso(),
        occurrences: 1,
        acknowledged_by: null,
        acknowledged_at: null,
        resolved_at: null,
        source: evt.source,
      };
      alertsById.set(alert.id, alert);
      activeByKey.set(key, alert);
      state.counters.alerts_created += 1;
      out.push(emit('alert.created', publicAlert(alert)));
      trimHistory();
      return;
    }

    existing.occurrences += 1;
    existing.last_seen = iso();
    let change = 'recurred';
    if (RANK[severity] > RANK[existing.severity]) {
      change = 'escalated';
      existing.severity = severity;
      state.counters.alerts_escalated += 1;
      if (existing.state === 'ACKNOWLEDGED') {
        existing.state = 'OPEN'; // got worse after being acknowledged: tell people again
        existing.acknowledged_by = null;
        existing.acknowledged_at = null;
      }
    } else if (RANK[severity] < RANK[existing.severity]) {
      change = 'downgraded';
      existing.severity = severity;
    }
    Object.assign(existing, detail);
    out.push(emit('alert.updated', { ...publicAlert(existing), change }));
  }

  function processEvent(evt) {
    state.seq += 1;
    state.counters.events += 1;
    if (evt.source === 'injected') state.counters.injected += 1;
    const event = { seq: state.seq, ts: iso(), ...evt };
    recentEvents.push(event);
    if (recentEvents.length > maxRecentEvents) recentEvents.shift();

    const out = [emit('telemetry.event', event)];

    const lat = evt.avg_load_time_sec;
    const latSeverity = lat > THRESHOLDS.LATENCY_CRITICAL_SEC ? 'CRITICAL' : lat > THRESHOLDS.LATENCY_WARNING_SEC ? 'WARNING' : null;
    evaluate('LATENCY', evt, latSeverity, out);

    const s = evt.last_refresh_status;
    const refreshSeverity = s === 'FAILED' || s === 'TIMED_OUT' ? 'CRITICAL' : s === 'UNKNOWN' ? 'WARNING' : null;
    evaluate('REFRESH', evt, refreshSeverity, out);
    return { event, messages: out };
  }

  function tick() {
    const rec = records[state.cursor];
    const result = processEvent({
      report_id: rec.report_id,
      report_name: rec.report_name,
      avg_load_time_sec: rec.avg_load_time_sec,
      last_refresh_status: rec.last_refresh_status,
      source: 'replay',
      src_row_num: rec.src_row_num,
    });
    state.cursor += 1;
    if (state.cursor >= records.length) {
      state.cursor = 0;
      state.loops += 1;
    }
    return result;
  }

  const effectiveMs = () => Math.max(10, Math.round(intervalMs / state.speed));
  function arm() {
    if (state.timer !== null) timers.clearInterval(state.timer);
    state.timer = state.running ? timers.setInterval(tick, effectiveMs()) : null;
    if (state.timer?.unref) state.timer.unref();
  }

  const counts = () => {
    const live = [...activeByKey.values()];
    return {
      open: live.filter((a) => a.state === 'OPEN').length,
      acknowledged: live.filter((a) => a.state === 'ACKNOWLEDGED').length,
      open_critical: live.filter((a) => a.state === 'OPEN' && a.severity === 'CRITICAL').length,
      open_warning: live.filter((a) => a.state === 'OPEN' && a.severity === 'WARNING').length,
      resolved: [...alertsById.values()].filter((a) => a.state === 'RESOLVED').length,
    };
  };

  const engine = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    start() {
      if (state.running) return;
      state.running = true;
      state.startedAt ??= iso();
      arm();
      emit('telemetry.status', engine.status());
    },
    stop() {
      state.running = false;
      arm();
    },
    pause() {
      engine.stop();
      emit('telemetry.status', engine.status());
    },
    resume() {
      engine.start();
    },
    setSpeed(speed) {
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
        throw badRequest(`speed must be a number between ${SPEED_MIN} and ${SPEED_MAX}`);
      }
      state.speed = speed;
      arm();
      emit('telemetry.status', engine.status());
    },

    tick,

    // Admin tool: push a hand-made reading through the same pipeline.
    inject({ report_id, avg_load_time_sec = 5, last_refresh_status = 'SUCCESS' }, by) {
      if (typeof report_id !== 'string' || !reportNames.has(report_id)) throw notFound(`Report ${report_id} not found`);
      if (typeof avg_load_time_sec !== 'number' || !Number.isFinite(avg_load_time_sec) || avg_load_time_sec < 0 || avg_load_time_sec > 120) {
        throw badRequest('avg_load_time_sec must be a number between 0 and 120');
      }
      if (!REFRESH_STATUSES.includes(last_refresh_status)) {
        throw badRequest(`last_refresh_status must be one of: ${REFRESH_STATUSES.join(', ')}`);
      }
      return processEvent({
        report_id,
        report_name: reportNames.get(report_id),
        avg_load_time_sec,
        last_refresh_status,
        source: 'injected',
        injected_by: by,
      });
    },

    acknowledge(id, by) {
      const alert = alertsById.get(id);
      if (!alert) throw notFound(`Alert ${id} not found`);
      if (alert.state === 'RESOLVED') throw conflict('ALREADY_RESOLVED', 'Alert is already resolved');
      if (alert.state === 'ACKNOWLEDGED') return publicAlert(alert); // idempotent
      alert.state = 'ACKNOWLEDGED';
      alert.acknowledged_by = by;
      alert.acknowledged_at = iso();
      emit('alert.updated', { ...publicAlert(alert), change: 'acknowledged' });
      return publicAlert(alert);
    },

    listAlerts({ state: wantState, severity, rule, reportId, paging }) {
      let rows = [...alertsById.values()].reverse(); // newest first
      if (wantState) rows = rows.filter((a) => a.state === wantState);
      if (severity) rows = rows.filter((a) => a.severity === severity);
      if (rule) rows = rows.filter((a) => a.rule === rule);
      if (reportId) rows = rows.filter((a) => a.report_id === reportId);
      const page = paginate(rows.map(publicAlert), paging);
      return { ...page, counts: counts() };
    },

    activeAlerts: (limit = 200) => [...activeByKey.values()].reverse().slice(0, limit).map(publicAlert),
    recentEvents: () => [...recentEvents],

    status() {
      return {
        running: state.running,
        speed: state.speed,
        interval_ms: intervalMs,
        effective_interval_ms: effectiveMs(),
        cursor: state.cursor,
        total_records: records.length,
        loops: state.loops,
        started_at: state.startedAt,
        counters: { ...state.counters },
        alerts: counts(),
        thresholds: {
          latency_warning_sec: THRESHOLDS.LATENCY_WARNING_SEC,
          latency_critical_sec: THRESHOLDS.LATENCY_CRITICAL_SEC,
        },
      };
    },

    snapshot() {
      return { status: engine.status(), active_alerts: engine.activeAlerts(), recent_events: engine.recentEvents() };
    },
  };
  return engine;
}
