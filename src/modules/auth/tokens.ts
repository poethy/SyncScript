import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { parseDuration } from '../../utils/duration.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export function signAccessToken(user: { id: string; email: string }): {
  token: string;
  expiresInSeconds: number;
} {
  const expiresInSeconds = Math.floor(parseDuration(env.JWT_ACCESS_TTL) / 1000);
  const token = jwt.sign({ email: user.email }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: expiresInSeconds,
  });
  return { token, expiresInSeconds };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof payload === 'string') throw new Error('Malformed access token payload');
  const claims = payload as Record<string, unknown>;
  if (typeof claims['sub'] !== 'string' || typeof claims['email'] !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { sub: claims['sub'], email: claims['email'] };
}

// Refresh tokens are opaque 256-bit secrets, never JWTs: they are persisted
// (hashed) so they can be rotated and revoked. Only an HMAC of the token is
// stored, so a database leak alone cannot be replayed.
export function generateRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_TTL)),
  };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}
