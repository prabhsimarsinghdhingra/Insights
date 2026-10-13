// Express wiring: security headers, CORS, JSON parsing, JWT authentication,
// RBAC authorization and error formatting. All business logic lives in the
// handlers and the repository; this file only adapts them to Express.

import express from 'express';
import cors from 'cors';
import { HttpError, unauthorized, forbidden, notFound } from '../errors.js';
import { can } from '../auth/rbac.js';

export function createApp({ routes, tokens, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use(cors({ origin: config.corsOrigin, methods: ['GET', 'POST', 'PATCH'], maxAge: 600 }));
  app.use(express.json({ limit: '10kb' }));

  const authenticate = (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized());
    try {
      const claims = tokens.verify(token);
      req.user = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
      return next();
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
  };

  const authorize = (permission) => (req, _res, next) =>
    permission === null || can(req.user.role, permission)
      ? next()
      : next(forbidden(`Requires permission: ${permission}`));

  const adapt = (handler) => async (req, res, next) => {
    try {
      const out = await handler({
        query: req.query,
        params: req.params,
        body: req.body,
        user: req.user,
        ip: req.ip,
      });
      res.status(out.status ?? 200).json(out.body);
    } catch (err) {
      next(err);
    }
  };

  for (const route of routes) {
    const chain = route.auth === false ? [] : [authenticate, authorize(route.permission ?? null)];
    app[route.method.toLowerCase()](route.path, ...chain, adapt(route.handler));
  }

  app.use((_req, _res, next) => next(notFound('Route not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    }
    logger.error('Unhandled error:', err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  return app;
}
