// Framework-free request handlers. Each takes { query, params, body, user, ip }
// and returns { status, body } or throws an HttpError. Express is only the
// adapter in app.js, so everything here is unit-testable without a server.

import { badRequest, unauthorized, tooManyRequests } from '../errors.js';
import { parsePaging, parseSort, parseBool, parseEnum, parseText } from './params.js';

const OWNER_STATUS = ['ASSIGNED', 'ORPHANED'];
const REFRESH_STATUS = ['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'];
const SEVERITY = ['HIGH', 'MEDIUM', 'LOW'];
const REPORT_SORTS = [
  'report_id', 'report_name', 'orphaned_snapshots', 'distinct_owners', 'refresh_problem_snapshots',
  'avg_load_time_sec', 'max_load_time_sec', 'latency_breaches', 'total_views', 'aws_cost_usd',
];
const ALERT_STATE = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
const ALERT_SEVERITY = ['CRITICAL', 'WARNING'];
const ALERT_RULE = ['LATENCY', 'REFRESH'];
const CONTROL_ACTIONS = ['pause', 'resume', 'set_speed'];
const COST_SORTS = [
  'cost_per_view_rank', 'report_id', 'attributed_credits', 'snowflake_cost_usd', 'aws_cost_usd',
  'total_cost_usd', 'credits_per_view', 'total_cost_per_view_usd', 'active_views',
];

export function createHandlers({ repo, users, tokens, limiter, config, engine, tickets }) {
  const ok = (body, status = 200) => ({ status, body });

  return {
    // --- auth ---------------------------------------------------------
    async login({ body, ip }) {
      const { email, password } = body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        throw badRequest('email and password are required');
      }
      if (email.length > 254 || password.length > 200) throw badRequest('email or password too long');

      const key = `${ip}|${email.trim().toLowerCase()}`;
      const gate = limiter.check(key);
      if (!gate.allowed) throw tooManyRequests(gate.retryAfterSec);

      const user = users.authenticate(email, password);
      if (!user) {
        limiter.fail(key);
        throw unauthorized('Invalid email or password');
      }
      limiter.success(key);
      const token = tokens.sign({ sub: user.id, email: user.email, name: user.name, role: user.role });
      return ok({ token, token_type: 'Bearer', expires_in: tokens.expiresInSec, user });
    },

    async me({ user }) {
      return ok({ user });
    },

    async ping() {
      return ok({ status: 'ok', data_source: repo.sourceName, time: new Date().toISOString() });
    },

    // --- health & reports -----------------------------------------------
    async healthSummary() {
      return ok(await repo.healthSummary());
    },

    async listReports({ query }) {
      return ok(
        await repo.listReports({
          search: parseText(query.search, 'search'),
          ownerStatus: parseEnum(query.owner_status, 'owner_status', OWNER_STATUS),
          latestStatus: parseEnum(query.latest_refresh_status, 'latest_refresh_status', REFRESH_STATUS),
          hasOrphanHistory: parseBool(query.has_orphan_history, 'has_orphan_history'),
          ...parseSort(query, REPORT_SORTS, { sort: 'report_id', order: 'asc' }),
          paging: parsePaging(query),
        }),
      );
    },

    // Reports that currently have no owner (latest snapshot has none and no
    // owner has been assigned since).
    async listOrphanedReports({ query }) {
      return ok(
        await repo.listReports({
          ownerStatus: 'ORPHANED',
          ...parseSort(query, REPORT_SORTS, { sort: 'orphaned_snapshots', order: 'desc' }),
          paging: parsePaging(query),
        }),
      );
    },

    async getReport({ params }) {
      return ok(await repo.getReport(params.id));
    },

    async assignOwner({ params, body, user }) {
      if (!body || typeof body.owner_email !== 'string') throw badRequest('owner_email is required');
      return ok(await repo.assignOwner(params.id, body.owner_email, user.email));
    },


    // --- real-time alerting ---------------------------------------------
    async wsTicket({ user }) {
      return ok({ ticket: tickets.issue(user), expires_in_sec: tickets.ttlSec, path: '/ws/alerts' });
    },

    async listAlerts({ query }) {
      return ok(
        engine.listAlerts({
          state: parseEnum(query.state, 'state', ALERT_STATE),
          severity: parseEnum(query.severity, 'severity', ALERT_SEVERITY),
          rule: parseEnum(query.rule, 'rule', ALERT_RULE),
          reportId: parseText(query.report_id, 'report_id'),
          paging: parsePaging(query, { defaultSize: 50, maxSize: 200 }),
        }),
      );
    },

    async ackAlert({ params, user }) {
      return ok(engine.acknowledge(params.id, user.email));
    },

    async telemetryStatus() {
      return ok(engine.status());
    },

    async telemetryControl({ body }) {
      const action = body?.action;
      if (!CONTROL_ACTIONS.includes(action)) throw badRequest(`action must be one of: ${CONTROL_ACTIONS.join(', ')}`);
      if (action === 'pause') engine.pause();
      else if (action === 'resume') engine.resume();
      else engine.setSpeed(body.speed);
      return ok(engine.status());
    },

    // Admin tool for demos and validation: push a hand-made reading through
    // the same pipeline as the replayed data.
    async injectEvent({ body, user }) {
      if (!body || typeof body !== 'object') throw badRequest('JSON body required');
      const { event, messages } = engine.inject(body, user.email);
      return ok({
        event,
        alert_changes: messages.filter((m) => m.type.startsWith('alert.')).map((m) => ({ type: m.type, alert: m.data })),
      }, 201);
    },

    // --- data quality & cost --------------------------------------------
    async listAnomalies({ query }) {
      return ok(
        await repo.listAnomalies({
          type: parseEnum(query.type, 'type', repo.issueTypes()),
          severity: parseEnum(query.severity, 'severity', SEVERITY),
          reportId: parseText(query.report_id, 'report_id'),
          paging: parsePaging(query, { defaultSize: 50, maxSize: 200 }),
        }),
      );
    },

    async costAttribution({ query }) {
      return ok(
        await repo.costAttribution({
          ...parseSort(query, COST_SORTS, { sort: 'cost_per_view_rank', order: 'asc' }),
          paging: parsePaging(query),
        }),
      );
    },

    async costReconciliation() {
      return ok(await repo.costReconciliation());
    },
  };
}
