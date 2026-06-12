import * as Y from 'yjs';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/**
 * In-memory collaborative session for one document: the authoritative Y.Doc
 * plus the set of connected sockets. Edits live here between database flushes.
 */
export class DocSession {
  readonly doc = new Y.Doc();
  /** True when the doc has updates not yet flushed to Postgres. */
  dirty = false;
  private readonly connections = new Set<string>();

  constructor(readonly documentId: string) {}

  addConnection(socketId: string): void {
    this.connections.add(socketId);
  }

  removeConnection(socketId: string): boolean {
    this.connections.delete(socketId);
    return this.connections.size === 0;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  destroy(): void {
    this.doc.destroy();
  }
}

export type SessionTeardown = (session: DocSession) => Promise<void>;

/**
 * Owns the lifecycle of active document sessions. Sessions are created on the
 * first join (hydrating the Y.Doc from the persisted binary state) and torn
 * down when the last client leaves, after the teardown hook (flush) runs.
 */
export class DocSessionManager {
  private readonly sessions = new Map<string, Promise<DocSession>>();

  constructor(private readonly onLastDisconnect: SessionTeardown) {}

  /**
   * The promise is cached before awaiting so concurrent joiners share one
   * hydration instead of racing to create duplicate sessions.
   */
  async acquire(documentId: string, socketId: string): Promise<DocSession> {
    let pending = this.sessions.get(documentId);
    if (!pending) {
      pending = this.hydrate(documentId);
      this.sessions.set(documentId, pending);
    }
    const session = await pending;
    session.addConnection(socketId);
    return session;
  }

  async get(documentId: string): Promise<DocSession | undefined> {
    return this.sessions.get(documentId);
  }

  async release(documentId: string, socketId: string): Promise<void> {
    const pending = this.sessions.get(documentId);
    if (!pending) return;
    const session = await pending;
    if (!session.removeConnection(socketId)) return;

    this.sessions.delete(documentId);
    try {
      await this.onLastDisconnect(session);
    } catch (err) {
      logger.error({ err, documentId }, 'session teardown failed');
    } finally {
      session.destroy();
    }
  }

  private async hydrate(documentId: string): Promise<DocSession> {
    const session = new DocSession(documentId);
    const row = await prisma.document.findUnique({
      where: { id: documentId },
      select: { ydocState: true },
    });
    if (row?.ydocState && row.ydocState.length > 0) {
      Y.applyUpdate(session.doc, new Uint8Array(row.ydocState));
    }
    logger.info({ documentId }, 'document session hydrated');
    return session;
  }
}
