import { z } from 'zod';

export const documentParams = z.object({
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
});

export const listDocumentsQuery = z.object({
  includeArchived: z.coerce.boolean().default(false),
});

export const createDocumentBody = z.object({
  title: z.string().min(1).max(255).optional(),
  parentId: z.string().min(1).nullish(),
  icon: z.string().max(64).nullish(),
});

export const updateDocumentBody = z.object({
  title: z.string().min(1).max(255).optional(),
  icon: z.string().max(64).nullable().optional(),
  /** Block/rich-text payload; replaces the stored snapshot and bumps contentVersion. */
  content: z.unknown().optional(),
  /** Move the document; null moves it to the workspace root. */
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isArchived: z.boolean().optional(),
});

const documentFields = {
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number(),
  isArchived: z.boolean(),
  contentVersion: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
};

export const documentReply = z.object(documentFields);

export const documentDetailReply = z.object({
  ...documentFields,
  workspaceId: z.string(),
  content: z.unknown().nullable(),
});

export type DocumentReply = z.infer<typeof documentReply>;

export interface DocumentTreeNode extends DocumentReply {
  children: DocumentTreeNode[];
}

export const documentTreeNode: z.ZodType<DocumentTreeNode> = z.object({
  ...documentFields,
  get children(): z.ZodType<DocumentTreeNode[]> {
    return z.array(documentTreeNode);
  },
});

export const documentTreeReply = z.array(documentTreeNode);

export type DocumentDetailReply = z.infer<typeof documentDetailReply>;
export type CreateDocumentInput = z.infer<typeof createDocumentBody>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentBody>;
