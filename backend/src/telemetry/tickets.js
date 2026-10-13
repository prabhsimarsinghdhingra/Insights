// Short-lived, single-use tickets for the WebSocket handshake.
//
// Browsers cannot set an Authorization header on a WebSocket, and putting
// the long-lived JWT in the URL leaks it into logs. Instead the client calls
// POST /api/auth/ws-ticket (authenticated normally), receives a ticket that
// is valid for ~30 seconds and can be redeemed exactly once, and opens
// /ws/alerts?ticket=...

import crypto from 'node:crypto';

export function createTicketStore({ ttlMs = 30_000, now = () => Date.now(), maxOutstanding = 5000 } = {}) {
  const tickets = new Map(); // ticket -> { user, expiresAt }

  const sweep = () => {
    const t = now();
    for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
  };

  return {
    ttlSec: Math.round(ttlMs / 1000),
    issue(user) {
      sweep();
      if (tickets.size >= maxOutstanding) throw new Error('too many outstanding tickets');
      const ticket = crypto.randomBytes(32).toString('base64url');
      tickets.set(ticket, { user, expiresAt: now() + ttlMs });
      return ticket;
    },
    // Returns the user, or null if the ticket is unknown, expired or already used.
    redeem(ticket) {
      if (typeof ticket !== 'string') return null;
      const entry = tickets.get(ticket);
      if (!entry) return null;
      tickets.delete(ticket);
      return entry.expiresAt > now() ? entry.user : null;
    },
    size: () => tickets.size,
  };
}
