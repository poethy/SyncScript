import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middlewares/errorHandler.js';
import { evictDocument } from '../delivery/cache.js';
import type { Document, Prisma } from '../../generated/prisma/client.js';
import type {
  CreateDocumentInput,
  DocumentDetailReply,
  DocumentReply,
  DocumentTreeNode,
  UpdateDocumentInput,
} from './schemas.js';

function toReply(doc: Document): DocumentReply {
  return {
    id: doc.id,
    parentId: doc.parentId,
    title: doc.title,
    icon: doc.icon,
    sortOrder: doc.sortOrder,
    isArchived: doc.isArchived,
    contentVersion: doc.contentVersion,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function findInWorkspace(workspaceId: string, documentId: string): Promise<Document> {
  const doc = await prisma.document.findFirst({ where: { id: documentId, workspaceId } });
  if (!doc) {
    throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
  }
  return doc;
}

/**
 * All document ids in the sub-tree rooted at documentId (inclusive), resolved
 * with a recursive CTE so arbitrarily deep trees cost one round-trip. Also
 * used for move-cycle prevention here and by document-scoped API key
 * authorization in the delivery module (where results are cached in Redis).
 */
export async function getSubtreeIds(documentId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Document" WHERE id = ${documentId}
      UNION ALL
      SELECT d.id FROM "Document" d
      JOIN subtree s ON d."parentId" = s.id
    )
    SELECT id FROM subtree
  `;
  return rows.map((row) => row.id);
}

// Prevent cycles when re-parenting: the new parent must exist in the same
// workspace and must not be the document itself or any of its descendants.
async function assertValidMove(
  workspaceId: string,
  documentId: string,
  newParentId: string | null,
): Promise<void> {
  if (newParentId === null) return;

  const parent = await prisma.document.findFirst({
    where: { id: newParentId, workspaceId },
    select: { id: true },
  });
  if (!parent) {
    throw new AppError(404, 'Parent document not found in this workspace', 'PARENT_NOT_FOUND');
  }

  const subtreeIds = await getSubtreeIds(documentId);
  if (subtreeIds.includes(newParentId)) {
    throw new AppError(400, 'Cannot move a document into its own sub-tree', 'CIRCULAR_NESTING');
  }
}

export async function getSubtree(
  workspaceId: string,
  documentId: string,
  includeArchived: boolean,
): Promise<DocumentTreeNode> {
  await findInWorkspace(workspaceId, documentId);
  const ids = await getSubtreeIds(documentId);
  const docs = await prisma.document.findMany({
    where: { id: { in: ids }, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const root = assembleTree(docs, (d) => d.id === documentId).find((n) => n.id === documentId);
  if (!root) {
    // Root exists but is archived and archived docs were excluded.
    throw new AppError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
  }
  return root;
}

export async function createDocument(
  workspaceId: string,
  userId: string,
  input: CreateDocumentInput,
): Promise<DocumentReply> {
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await prisma.document.findFirst({ where: { id: parentId, workspaceId } });
    if (!parent) {
      throw new AppError(404, 'Parent document not found in this workspace', 'PARENT_NOT_FOUND');
    }
  }

  // Append after the current last sibling.
  const last = await prisma.document.aggregate({
    where: { workspaceId, parentId },
    _max: { sortOrder: true },
  });

  const doc = await prisma.document.create({
    data: {
      workspaceId,
      parentId,
      title: input.title ?? 'Untitled',
      icon: input.icon ?? null,
      createdById: userId,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  });
  return toReply(doc);
}

function assembleTree(
  docs: Document[],
  rootPredicate: (doc: Document) => boolean,
): DocumentTreeNode[] {
  const nodes = new Map<string, DocumentTreeNode>(
    docs.map((d) => [d.id, { ...toReply(d), children: [] }]),
  );
  const roots: DocumentTreeNode[] = [];
  for (const doc of docs) {
    const node = nodes.get(doc.id)!;
    const parent = doc.parentId ? nodes.get(doc.parentId) : undefined;
    if (parent && !rootPredicate(doc)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function listDocumentTree(
  workspaceId: string,
  includeArchived: boolean,
): Promise<DocumentTreeNode[]> {
  const docs = await prisma.document.findMany({
    where: { workspaceId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  // Docs whose parent is filtered out (e.g. archived) surface as roots rather
  // than disappearing from the tree.
  return assembleTree(docs, (d) => d.parentId === null);
}

export async function getDocument(
  workspaceId: string,
  documentId: string,
): Promise<DocumentDetailReply> {
  const doc = await findInWorkspace(workspaceId, documentId);
  return { ...toReply(doc), workspaceId: doc.workspaceId, content: doc.content };
}

export async function updateDocument(
  workspaceId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<DocumentDetailReply> {
  const doc = await findInWorkspace(workspaceId, documentId);

  if (input.parentId !== undefined && input.parentId !== doc.parentId) {
    await assertValidMove(workspaceId, documentId, input.parentId);
  }

  const data: Prisma.DocumentUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isArchived !== undefined) data.isArchived = input.isArchived;
  if (input.parentId !== undefined) {
    data.parent =
      input.parentId === null ? { disconnect: true } : { connect: { id: input.parentId } };
  }
  if (input.content !== undefined) {
    data.content = input.content as Prisma.InputJsonValue;
    data.contentVersion = { increment: 1 };
  }

  const updated = await prisma.document.update({ where: { id: documentId }, data });
  await evictDocument(documentId);
  return { ...toReply(updated), workspaceId: updated.workspaceId, content: updated.content };
}

export async function deleteDocument(workspaceId: string, documentId: string): Promise<void> {
  await findInWorkspace(workspaceId, documentId);
  // Capture the sub-tree before the cascade removes it, then evict every
  // affected delivery cache entry.
  const subtreeIds = await getSubtreeIds(documentId);
  await prisma.document.delete({ where: { id: documentId } });
  await Promise.all(subtreeIds.map((id) => evictDocument(id)));
}
