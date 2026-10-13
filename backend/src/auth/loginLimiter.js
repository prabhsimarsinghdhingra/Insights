// In-memory brute-force guard for the login endpoint: after `max` failures
// for a key (ip + email) within `windowMs`, further attempts are refused
// until the window expires. A successful login clears the counter.

export function createLoginLimiter({ max = 5, windowMs = 15 * 60_000, now = () => Date.now() } = {}) {
  const attempts = new Map(); // key -> { count, firstAt }

  const live = (key) => {
    const entry = attempts.get(key);
    if (entry && now() - entry.firstAt >= windowMs) {
      attempts.delete(key);
      return null;
    }
    return entry ?? null;
  };

  return {
    check(key) {
      const entry = live(key);
      if (entry && entry.count >= max) {
        return { allowed: false, retryAfterSec: Math.ceil((entry.firstAt + windowMs - now()) / 1000) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
    fail(key) {
      const entry = live(key);
      if (entry) entry.count += 1;
      else attempts.set(key, { count: 1, firstAt: now() });
    },
    success(key) {
      attempts.delete(key);
    },
  };
}
