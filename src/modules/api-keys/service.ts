import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import type { ApiKey } from '../../generated/prisma/client.js';
import type { ApiKeyReply, CreateApiKeyInput, CreateApiKeyReply } from './schemas.js';

const KEY_NAMESPACE = 'ss_live_';
const PREFIX_LENGTH = 12;

export function hashApiKey(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function toReply(key: ApiKey): ApiKeyReply {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopeDocumentId: key.scopeDocumentId,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export async function createApiKey(
  workspaceId: string,
  userId: string,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyReply> {
  const scopeDocumentId = input.scopeDocumentId ?? null;
  if (scopeDocumentId) {
    const doc = await prisma.document.findFirst({
      where: { id: scopeDocumentId, workspaceId },
      select: { id: true },
    });
    if (!doc) {
      throw new AppError(404, 'Scope document not found in this workspace', 'DOCUMENT_NOT_FOUND');
    }
  }

  // 192 bits of entropy; only the SHA-256 hash is persisted, so a database
  // leak alone cannot be replayed against the delivery API.
  const secret = KEY_NAMESPACE + crypto.randomBytes(24).toString('base64url');

  const key = await prisma.apiKey.create({
    data: {
      name: input.name,
      keyHash: hashApiKey(secret),
      prefix: secret.slice(0, PREFIX_LENGTH),
      workspaceId,
      scopeDocumentId,
      expiresAt: input.expiresAt ?? null,
      createdById: userId,
    },
  });

  return { key: toReply(key), secret };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyReply[]> {
  const keys = await prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  return keys.map(toReply);
}

export async function revokeApiKey(workspaceId: string, apiKeyId: string): Promise<ApiKeyReply> {
  const key = await prisma.apiKey.findFirst({ where: { id: apiKeyId, workspaceId } });
  if (!key) {
    throw new AppError(404, 'API key not found', 'API_KEY_NOT_FOUND');
  }
  if (key.revokedAt) {
    return toReply(key);
  }
  const revoked = await prisma.apiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
  });
  return toReply(revoked);
}
