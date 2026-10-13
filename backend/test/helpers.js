import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { createUserStore } from '../src/auth/users.js';
import { createLoginLimiter } from '../src/auth/loginLimiter.js';
import { createHandlers } from '../src/http/handlers.js';
import { buildRoutes } from '../src/http/routes.js';
import { createTelemetryEngine } from '../src/telemetry/engine.js';
import { createTicketStore } from '../src/telemetry/tickets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CSV = fs.readFileSync(path.join(here, '../data/raw/pure_insights_monitoring.csv'), 'utf8');

// Fake token service: no jsonwebtoken needed to test handler logic.
export const fakeTokens = { expiresInSec: 3600, sign: (claims) => `fake.${Buffer.from(JSON.stringify(claims)).toString('base64url')}` };

export function build({ limiter } = {}) {
  const repo = createMemoryRepo({ csvText: CSV, creditPriceUsd: 3 });
  const users = createUserStore({ demoPassword: 'TestPassw0rd!' });
  const engine = createTelemetryEngine({ records: repo.telemetryRecords() }); // not started: tests call tick()
  const tickets = createTicketStore();
  const handlers = createHandlers({
    repo, users, tokens: fakeTokens, limiter: limiter ?? createLoginLimiter(), config: {}, engine, tickets,
  });
  return { repo, users, handlers, engine, tickets, routes: buildRoutes(handlers) };
}

export const rejects = async (promise, status, code) => {
  try {
    await promise;
  } catch (e) {
    if (e.status !== status || (code && e.code !== code)) {
      throw new Error(`expected ${status}/${code}, got ${e.status}/${e.code}: ${e.message}`);
    }
    return;
  }
  throw new Error(`expected rejection with ${status}`);
};
