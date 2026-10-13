// Demo user store. Passwords are hashed with scrypt (Node built-in) and
// compared in constant time. Replace with a real identity provider in
// production: these accounts exist so evaluators can log in to the demo.

import crypto from 'node:crypto';

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const DEMO_ACCOUNTS = [
  { id: 'u-admin', email: 'admin@pureinsights.demo', name: 'Ada Admin', role: 'admin' },
  { id: 'u-analyst', email: 'analyst@pureinsights.demo', name: 'Ana Analyst', role: 'analyst' },
  { id: 'u-viewer', email: 'viewer@pureinsights.demo', name: 'Vik Viewer', role: 'viewer' },
];

export function createUserStore({ demoPassword }) {
  if (!demoPassword || demoPassword.length < 8) {
    throw new Error('DEMO_PASSWORD must be at least 8 characters');
  }
  const users = DEMO_ACCOUNTS.map((u) => ({ ...u, passwordHash: hashPassword(demoPassword) }));
  const dummyHash = hashPassword(crypto.randomBytes(12).toString('hex'));

  const publicView = ({ passwordHash, ...rest }) => rest;

  return {
    // Always does one scrypt comparison so response time does not reveal
    // whether the email exists.
    authenticate(email, password) {
      const user = users.find((u) => u.email === String(email).trim().toLowerCase());
      const ok = verifyPassword(String(password), user ? user.passwordHash : dummyHash);
      return user && ok ? publicView(user) : null;
    },
    findById(id) {
      const user = users.find((u) => u.id === id);
      return user ? publicView(user) : null;
    },
  };
}
