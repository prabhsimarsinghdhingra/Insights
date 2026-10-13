// Entry point: loads config, builds the data source, wires everything and listens.

import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createMemoryRepo } from './repo/memoryRepo.js';
import { createUserStore, DEMO_ACCOUNTS } from './auth/users.js';
import { createLoginLimiter } from './auth/loginLimiter.js';
import { createTokenService } from './auth/tokens.js';
import { createHandlers } from './http/handlers.js';
import { buildRoutes } from './http/routes.js';
import { createApp } from './http/app.js';
import { createTelemetryEngine } from './telemetry/engine.js';
import { createTicketStore } from './telemetry/tickets.js';
import { createWsHub } from './telemetry/wsHub.js';
import { createSnowflakeRepo } from './repo/snowflakeRepo.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig();


const csvText = fs.readFileSync(
  path.resolve(backendDir, config.dataCsv),
  'utf8',
);

const fallbackRepo = createMemoryRepo({
  csvText,
  creditPriceUsd: config.creditPriceUsd,
});

const repo = config.dataSource === 'snowflake'
  ? await createSnowflakeRepo({
      fallbackRepo,
      creditPriceUsd: config.creditPriceUsd,
    })
  : fallbackRepo;

const users = createUserStore({ demoPassword: config.demoPassword });
const tokens = createTokenService({ secret: config.jwtSecret, expiresInSec: config.jwtExpiresInSec });
const limiter = createLoginLimiter();
const engine = createTelemetryEngine({ records: repo.telemetryRecords(), intervalMs: config.telemetryIntervalMs });
const tickets = createTicketStore();
const handlers = createHandlers({ repo, users, tokens, limiter, config, engine, tickets });
const app = createApp({ routes: buildRoutes(handlers), tokens, config });

const server = http.createServer(app);
const hub = createWsHub({ server, engine, tickets, allowedOrigin: config.corsOrigin });

server.listen(config.port, () => {
  engine.start();
  console.log(`Pure Insights API listening on http://localhost:${config.port} (data source: ${repo.sourceName})`);
  console.log(`Live alerts: ws://localhost:${config.port}/ws/alerts (replaying one reading every ${config.telemetryIntervalMs} ms)`);
  if (config.jwtSecretGenerated) console.log('No JWT_SECRET set: using a random dev secret (tokens reset on restart).');
  if (!config.isProd) {
    console.log('Demo logins (password from DEMO_PASSWORD, default shown in README):');
    for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(8)} ${a.email}`);
  }
});


const shutdown = () => {
  engine.stop();
  hub.close();

  server.close(async () => {
    try {
      await repo.close?.();
    } catch (err) {
      console.error('Repository shutdown error:', err.message);
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
