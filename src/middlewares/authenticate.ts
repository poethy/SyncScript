import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { AppError } from './errorHandler.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authenticate preHandler; null on unauthenticated routes. */
    user: AuthUser | null;
  }
}

export function authenticate(request: FastifyRequest): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Missing bearer token', 'UNAUTHORIZED');
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    request.user = { id: payload.sub, email: payload.email };
  } catch {
    throw new AppError(401, 'Invalid or expired access token', 'UNAUTHORIZED');
  }
}
