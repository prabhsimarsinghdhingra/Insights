import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createUserStore } from '../src/auth/users.js';
import { createLoginLimiter } from '../src/auth/loginLimiter.js';
import { loadConfig } from '../src/config.js';
import { build, rejects } from './helpers.js';

test('password hashing is salted and verifies correctly', () => {
  const a = hashPassword('correct horse');
  const b = hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('correct horse', a));
  assert.ok(!verifyPassword('wrong horse', a));
});

test('user store authenticates demo accounts without exposing hashes', () => {
  const store = createUserStore({ demoPassword: 'TestPassw0rd!' });
  const u = store.authenticate('ADMIN@pureinsights.demo ', 'TestPassw0rd!');
  assert.equal(u.role, 'admin');
  assert.equal(u.passwordHash, undefined);
  assert.equal(store.authenticate('admin@pureinsights.demo', 'nope'), null);
  assert.equal(store.authenticate('nobody@x.com', 'TestPassw0rd!'), null);
  assert.throws(() => createUserStore({ demoPassword: 'short' }));
});

test('login limiter blocks after max failures, expires, and resets on success', () => {
  let t = 0;
  const lim = createLoginLimiter({ max: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) { assert.ok(lim.check('k').allowed); lim.fail('k'); }
  assert.equal(lim.check('k').allowed, false);
  assert.ok(lim.check('k').retryAfterSec >= 1);
  assert.ok(lim.check('other').allowed);
  t = 1000;
  assert.ok(lim.check('k').allowed);
  lim.fail('k'); lim.success('k');
  assert.ok(lim.check('k').allowed);
});

test('login handler: success, validation, generic failure, throttling', async () => {
  const { handlers } = build({ limiter: createLoginLimiter({ max: 2 }) });
  const ok = await handlers.login({ body: { email: 'analyst@pureinsights.demo', password: 'TestPassw0rd!' }, ip: '1.1.1.1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'analyst');
  assert.equal(ok.body.token_type, 'Bearer');
  assert.ok(ok.body.token.startsWith('fake.'));

  await rejects(handlers.login({ body: {}, ip: 'x' }), 400, 'BAD_REQUEST');
  await rejects(handlers.login({ body: { email: 'a@b.co', password: 123 }, ip: 'x' }), 400);
  const bad = { body: { email: 'admin@pureinsights.demo', password: 'wrong' }, ip: '9.9.9.9' };
  await rejects(handlers.login(bad), 401, 'UNAUTHORIZED');
  await rejects(handlers.login(bad), 401, 'UNAUTHORIZED');
  await rejects(handlers.login(bad), 429, 'TOO_MANY_REQUESTS');
  // a different IP is unaffected
  assert.equal((await handlers.login({ ...bad, body: { ...bad.body, password: 'TestPassw0rd!' }, ip: '8.8.8.8' })).status, 200);
});

test('config: production requires secrets, dev generates one, ports validated', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }), /DEMO_PASSWORD/);
  const dev = loadConfig({});
  assert.ok(dev.jwtSecretGenerated && dev.jwtSecret.length >= 32);
  assert.equal(dev.port, 4000);
  assert.throws(() => loadConfig({ PORT: '99999' }));
  assert.throws(() => loadConfig({ DATA_SOURCE: 'mongo' }));
  assert.throws(() => loadConfig({ CREDIT_PRICE_USD: '-1' }));
});
