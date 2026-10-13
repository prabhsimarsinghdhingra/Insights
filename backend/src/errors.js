// Typed HTTP errors. Handlers throw these; the Express error middleware
// turns them into a uniform { error: { code, message, details } } body.

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') => new HttpError(404, 'NOT_FOUND', message);
export const tooManyRequests = (retryAfterSec) =>
  new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many failed login attempts. Try again later.', {
    retry_after_sec: retryAfterSec,
  });
export const conflict = (code, message) => new HttpError(409, code, message);
