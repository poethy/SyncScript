import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import type { DeliveryDocument } from './schemas.js';

// The cache lives in Redis, shared by every instance — one eviction is
// visible everywhere, so invalidation needs no extra pub/sub hop. Every
// operation fails open: a Redis outage degrades to direct Postgres reads.

const docKey = (documentId: string): string => `delivery:doc:${documentId}`;
const subtreeKey = (documentId: string): string => `delivery:subtree:${documentId}`;

// Safety net only — eviction on flush/update/delete is the primary mechanism.
const DOC_TTL_SECONDS = 3600;
// Sub-tree membership changes on document moves, which are not tracked back
// to every scope ancestor; this TTL bounds that staleness window.
const SUBTREE_TTL_SECONDS = 60;

type CachedDocument = Omit<DeliveryDocument, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

export async function getCachedDocument(documentId: string): Promise<DeliveryDocument | null> {
  try {
    const raw = await redis.get(docKey(documentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDocument;
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, documentId }, 'delivery cache read failed');
    return null;
  }
}

export async function setCachedDocument(documentId: string, doc: DeliveryDocument): Promise<void> {
  try {
    await redis.set(docKey(documentId), JSON.stringify(doc), 'EX', DOC_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err: (err as Error).message, documentId }, 'delivery cache write failed');
  }
}

export async function evictDocument(documentId: string): Promise<void> {
  try {
    await redis.del(docKey(documentId));
  } catch (err) {
    logger.warn({ err: (err as Error).message, documentId }, 'delivery cache eviction failed');
  }
}

export async function getCachedSubtreeIds(scopeDocumentId: string): Promise<string[] | null> {
  try {
    const raw = await redis.get(subtreeKey(scopeDocumentId));
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch (err) {
    logger.warn({ err: (err as Error).message, scopeDocumentId }, 'subtree cache read failed');
    return null;
  }
}

export async function setCachedSubtreeIds(scopeDocumentId: string, ids: string[]): Promise<void> {
  try {
    await redis.set(subtreeKey(scopeDocumentId), JSON.stringify(ids), 'EX', SUBTREE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err: (err as Error).message, scopeDocumentId }, 'subtree cache write failed');
  }
}
