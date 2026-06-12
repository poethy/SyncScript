import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { getSubtreeIds } from '../documents/service.js';
import {
  getCachedDocument,
  getCachedSubtreeIds,
  setCachedDocument,
  setCachedSubtreeIds,
} from './cache.js';
import type { ApiKey } from '../../generated/prisma/client.js';
import type { DeliveryDocument } from './schemas.js';

async function resolveScopeSubtree(scopeDocumentId: string): Promise<string[]> {
  const cached = await getCachedSubtreeIds(scopeDocumentId);
  if (cached) return cached;
  const ids = await getSubtreeIds(scopeDocumentId);
  await setCachedSubtreeIds(scopeDocumentId, ids);
  return ids;
}

export async function getDeliveryDocument(
  apiKey: ApiKey,
  documentId: string,
): Promise<DeliveryDocument> {
  // Scope check runs on every request — cache hits must not bypass
  // authorization, only the document fetch itself.
  if (apiKey.scopeDocumentId) {
    const subtree = await resolveScopeSubtree(apiKey.scopeDocumentId);
    if (!subtree.includes(documentId)) {
      throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
    }
  }

  const cached = await getCachedDocument(documentId);
  if (cached) {
    // The cache key is per-document, not per-key: verify workspace ownership
    // against the key before serving.
    if (cached.workspaceId !== apiKey.workspaceId) {
      throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
    }
    return cached;
  }

  const doc = await prisma.document.findFirst({
    where: { id: documentId, workspaceId: apiKey.workspaceId, isArchived: false },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      icon: true,
      content: true,
      contentVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  // 404 covers wrong workspace, archived and missing alike.
  if (!doc) {
    throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
  }

  await setCachedDocument(documentId, doc);
  return doc;
}
