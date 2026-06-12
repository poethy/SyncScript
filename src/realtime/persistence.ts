import * as Y from 'yjs';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DocSession } from './docSession.js';

// Active edits live in memory and fan out over WebSockets; Postgres sees one
// write per document per quiet period instead of one per keystroke.
const FLUSH_DEBOUNCE_MS = 3_000;
// Upper bound between an edit and its persistence, so a continuous typing
// stream cannot postpone the flush indefinitely (bounds crash-loss).
const FLUSH_MAX_WAIT_MS = 10_000;

export type FlushListener = (documentId: string, contentVersion: number) => void;

interface PendingFlush {
  debounce: NodeJS.Timeout;
  deadline: NodeJS.Timeout;
}

export class DebouncedFlusher {
  private readonly pending = new Map<string, PendingFlush>();
  private readonly listeners: FlushListener[] = [];

  /** Registered listeners run after every successful flush (cache eviction, pub/sub). */
  onFlush(listener: FlushListener): void {
    this.listeners.push(listener);
  }

  /** Call on every incoming update: flush fires FLUSH_DEBOUNCE_MS after the
   * burst ends, or FLUSH_MAX_WAIT_MS after the first unflushed edit,
   * whichever comes first. */
  schedule(session: DocSession): void {
    const existing = this.pending.get(session.documentId);
    if (existing) clearTimeout(existing.debounce);

    this.pending.set(session.documentId, {
      debounce: setTimeout(() => void this.flush(session), FLUSH_DEBOUNCE_MS),
      deadline: existing?.deadline ?? setTimeout(() => void this.flush(session), FLUSH_MAX_WAIT_MS),
    });
  }

  /** Persist now (also used as the session teardown when the last client leaves). */
  async flush(session: DocSession): Promise<void> {
    const timers = this.pending.get(session.documentId);
    if (timers) {
      clearTimeout(timers.debounce);
      clearTimeout(timers.deadline);
      this.pending.delete(session.documentId);
    }
    if (!session.dirty) return;
    session.dirty = false;

    try {
      const updated = await prisma.document.update({
        where: { id: session.documentId },
        data: {
          // Copy into a fresh ArrayBuffer-backed array: Prisma's Bytes input
          // rejects Uint8Array<ArrayBufferLike> coming out of yjs.
          ydocState: new Uint8Array(Y.encodeStateAsUpdate(session.doc)),
          content: deriveSnapshot(session.doc),
          contentVersion: { increment: 1 },
        },
        select: { contentVersion: true },
      });
      logger.info(
        { documentId: session.documentId, contentVersion: updated.contentVersion },
        'document flushed',
      );
      for (const listener of this.listeners) {
        listener(session.documentId, updated.contentVersion);
      }
    } catch (err) {
      // Leave the session dirty so the next schedule/teardown retries.
      session.dirty = true;
      logger.error({ err, documentId: session.documentId }, 'document flush failed');
    }
  }
}

interface TextNode {
  type: 'text';
  delta: unknown[];
}

interface ElementNode {
  type: string;
  attrs: Record<string, string>;
  children: SnapshotNode[];
}

type SnapshotNode = TextNode | ElementNode;

function xmlNodeToJson(node: Y.XmlElement | Y.XmlText | Y.XmlHook): SnapshotNode {
  if (node instanceof Y.XmlText) {
    return { type: 'text', delta: node.toDelta() as unknown[] };
  }
  if (node instanceof Y.XmlElement) {
    return {
      type: node.nodeName,
      attrs: node.getAttributes() as Record<string, string>,
      children: node
        .toArray()
        .map((child) => xmlNodeToJson(child)),
    };
  }
  return { type: 'hook', attrs: {}, children: [] };
}

/**
 * Derive the JSON snapshot served by the Delivery API from the CRDT state.
 * Convention: collaborative rich text lives in the root XmlFragment named
 * "content" (the shape used by y-prosemirror/TipTap bindings). Text nodes are
 * emitted in Delta form so marks/formatting survive the conversion.
 */
export function deriveSnapshot(doc: Y.Doc): Prisma.InputJsonValue {
  const fragment = doc.getXmlFragment('content');
  const blocks = fragment
    .toArray()
    .map((child) => xmlNodeToJson(child));
  return { blocks } as unknown as Prisma.InputJsonValue;
}
