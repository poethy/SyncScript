import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { getSubtreeIds } from '../documents/service.js';
import type { ApiKey } from '../../generated/prisma/client.js';
import type { DeliveryDocumentReply } from './schemas.js';

export async function getDeliveryDocument(
  apiKey: ApiKey,
  documentId: string,
): Promise<DeliveryDocumentReply> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, workspaceId: apiKey.workspaceId, isArchived: false },
    select: {
      id: true,
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

  // Sub-tree-scoped keys can only read the scope document and its descendants.
  if (apiKey.scopeDocumentId) {
    const subtree = await getSubtreeIds(apiKey.scopeDocumentId);
    if (!subtree.includes(documentId)) {
      throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
    }
  }

  return doc;
}
