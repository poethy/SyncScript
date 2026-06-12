import { z } from 'zod';

export const deliveryParams = z.object({
  id: z.string().min(1),
});

export const deliveryDocumentReply = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  /** JSON snapshot derived from the CRDT state on each flush. */
  content: z.unknown().nullable(),
  contentVersion: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DeliveryDocumentReply = z.infer<typeof deliveryDocumentReply>;

/** Internal shape carried through the cache; the response schema strips
 * workspaceId before it reaches consumers. */
export type DeliveryDocument = DeliveryDocumentReply & { workspaceId: string };
