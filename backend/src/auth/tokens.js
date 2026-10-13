// JWT signing and verification (HS256 only; the algorithm is pinned on
// verify so a forged "alg" header cannot downgrade the check).

import jwt from 'jsonwebtoken';

export function createTokenService({ secret, expiresInSec = 3600, issuer = 'pure-insights' }) {
  if (!secret || secret.length < 16) throw new Error('JWT secret must be at least 16 characters');
  return {
    expiresInSec,
    sign(claims) {
      return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: expiresInSec, issuer });
    },
    verify(token) {
      return jwt.verify(token, secret, { algorithms: ['HS256'], issuer });
    },
  };
}
