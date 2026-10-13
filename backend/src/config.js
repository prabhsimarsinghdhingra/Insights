// Environment configuration with validation. Pure function of `env` so it
// can be tested without touching process.env.

import crypto from 'node:crypto';

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  let jwtSecret = env.JWT_SECRET;
  let jwtSecretGenerated = false;
  if (!jwtSecret) {
    if (isProd) throw new Error('JWT_SECRET is required in production');
    jwtSecret = crypto.randomBytes(32).toString('hex'); // dev only: tokens die on restart
    jwtSecretGenerated = true;
  }

  const demoPassword = env.DEMO_PASSWORD ?? (isProd ? undefined : 'PureInsights#2026');
  if (!demoPassword) throw new Error('DEMO_PASSWORD is required in production');

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535');

  const creditPriceUsd = Number(env.CREDIT_PRICE_USD ?? 3);
  if (!Number.isFinite(creditPriceUsd) || creditPriceUsd <= 0) {
    throw new Error('CREDIT_PRICE_USD must be a positive number');
  }

  const telemetryIntervalMs = Number(env.TELEMETRY_INTERVAL_MS ?? 1000);
  if (!Number.isFinite(telemetryIntervalMs) || telemetryIntervalMs < 50) {
    throw new Error('TELEMETRY_INTERVAL_MS must be a number >= 50');
  }

  const dataSource = env.DATA_SOURCE ?? 'demo';
  if (!['demo', 'snowflake'].includes(dataSource)) throw new Error("DATA_SOURCE must be 'demo' or 'snowflake'");

  return {
    nodeEnv,
    isProd,
    port,
    dataSource,
    creditPriceUsd,
    jwtSecret,
    jwtSecretGenerated,
    jwtExpiresInSec: Number(env.JWT_EXPIRES_IN_SEC ?? 3600),
    demoPassword,
    telemetryIntervalMs,
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    dataCsv: env.DATA_CSV ?? 'data/raw/pure_insights_monitoring.csv',
  };
}
