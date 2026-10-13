import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, ROLES, ALL_PERMISSIONS } from '../src/auth/rbac.js';
import { build } from './helpers.js';

test('roles accumulate permissions', () => {
  for (const p of ['health:read', 'alerts:read']) assert.ok(can('viewer', p));
  for (const p of ['reports:read', 'dq:read', 'costs:read']) {
    assert.ok(!can('viewer', p), `viewer must not have ${p}`);
    assert.ok(can('analyst', p));
    assert.ok(can('admin', p));
  }
  for (const p of ['alerts:ack', 'reports:assign', 'telemetry:control']) {
    assert.ok(!can('viewer', p));
    assert.ok(!can('analyst', p), `analyst must not have ${p}`);
    assert.ok(can('admin', p));
  }
  assert.equal(can('ghost', 'health:read'), false);
  assert.equal(can('admin', 'nonsense:perm'), false);
});

test('every route is either public, any-signed-in, or guarded by a known permission', () => {
  const { routes } = build();
  for (const r of routes) {
    assert.equal(typeof r.handler, 'function', `${r.method} ${r.path} has no handler`);
    if (r.auth === false) continue;
    assert.ok(r.permission === null || ALL_PERMISSIONS.includes(r.permission), `${r.path}: unknown permission ${r.permission}`);
  }
  // the only unauthenticated routes
  const open = routes.filter((r) => r.auth === false).map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(open, ['GET /api/ping', 'POST /api/auth/login']);
  // static path must come before the parametrised one
  const paths = routes.map((r) => r.path);
  assert.ok(paths.indexOf('/api/reports/orphaned') < paths.indexOf('/api/reports/:id'));
});

test('printed access matrix (role x route)', () => {
  const { routes } = build();
  const matrix = routes.filter((r) => r.auth !== false).map((r) => ({
    route: `${r.method} ${r.path}`,
    ...Object.fromEntries(ROLES.map((role) => [role, r.permission === null || can(role, r.permission)])),
  }));
  const viewerOnly = matrix.filter((m) => m.viewer).map((m) => m.route);
  assert.deepEqual(viewerOnly.sort(), [
    'GET /api/alerts', 'GET /api/auth/me', 'GET /api/health/summary', 'GET /api/telemetry/status', 'POST /api/auth/ws-ticket',
  ]);
  const adminOnly = matrix.filter((m) => m.admin && !m.analyst).map((m) => m.route);
  assert.deepEqual(adminOnly.sort(), [
    'POST /api/alerts/:id/ack', 'POST /api/reports/:id/owner', 'POST /api/telemetry/control', 'POST /api/telemetry/inject',
  ]);
});
