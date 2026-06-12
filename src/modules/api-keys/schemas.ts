import { z } from 'zod';

export const apiKeyParams = z.object({
  workspaceId: z.string().min(1),
  apiKeyId: z.string().min(1),
});

export const createApiKeyBody = z.object({
  name: z.string().min(1).max(100),
  /** Restrict the key to a document sub-tree; omit for workspace-wide read access. */
  scopeDocumentId: z.string().min(1).nullish(),
  expiresAt: z.coerce.date().nullish(),
});

export const apiKeyReply = z.object({
  id: z.string(),
  name: z.string(),
  /** First characters of the key for dashboard identification; never the key itself. */
  prefix: z.string(),
  scopeDocumentId: z.string().nullable(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const apiKeyListReply = z.array(apiKeyReply);

export const createApiKeyReply = z.object({
  key: apiKeyReply,
  /** The full secret — returned exactly once at creation, never stored. */
  secret: z.string(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeyBody>;
export type ApiKeyReply = z.infer<typeof apiKeyReply>;
export type CreateApiKeyReply = z.infer<typeof createApiKeyReply>;
