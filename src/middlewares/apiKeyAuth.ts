import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashApiKey } from '../modules/api-keys/service.js';
import { AppError } from './errorHandler.js';
import type { ApiKey } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by apiKeyAuth on delivery routes; null elsewhere. */
    apiKey: ApiKey | null;
  }
}

export async function apiKeyAuth(request: FastifyRequest): Promise<void> {
  const header = request.headers['x-api-key'];
  const secret = Array.isArray(header) ? header[0] : header;
  if (!secret) {
    throw new AppError(401, 'Missing X-API-Key header', 'MISSING_API_KEY');
  }

  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(secret) } });
  // One error shape for unknown, revoked and expired keys: callers learn
  // nothing about why a credential stopped working.
  if (!key || key.revokedAt !== null || (key.expiresAt !== null && key.expiresAt < new Date())) {
    throw new AppError(401, 'Invalid API key', 'INVALID_API_KEY');
  }

  request.apiKey = key;

  // Informational only — never block or fail the request for it.
  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}
