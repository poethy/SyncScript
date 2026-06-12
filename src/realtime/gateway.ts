import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import * as Y from 'yjs';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { DocSessionManager } from './docSession.js';
import { DebouncedFlusher } from './persistence.js';
import { publishDocUpdate, subscribeDocUpdates } from './pubsub.js';
import { evictDocument } from '../modules/delivery/cache.js';
import {
  docJoinPayload,
  docLeavePayload,
  docRoom,
  docSyncPayload,
  docUpdatePayload,
  type Ack,
  type ClientToServerEvents,
  type JoinAck,
  type ServerToClientEvents,
  type SocketData,
  type SyncAck,
} from './protocol.js';

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function emitPresence(io: RealtimeServer, documentId: string, leavingSocketId?: string): void {
  const room = io.sockets.adapter.rooms.get(docRoom(documentId));
  let connections = room?.size ?? 0;
  if (leavingSocketId && room?.has(leavingSocketId)) connections -= 1;
  io.to(docRoom(documentId)).emit('doc:presence', { documentId, connections });
}

export function attachRealtimeGateway(httpServer: HttpServer): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer, {
    serveClient: false,
    cors: { origin: true },
    // Yjs updates are binary and small; cap frames well below default limits.
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  const flusher = new DebouncedFlusher();
  // Most document writes originate here, not in REST — every flush evicts the
  // delivery cache so external consumers never read a stale snapshot. The
  // cache is in shared Redis, so one eviction covers all instances.
  flusher.onFlush((documentId) => void evictDocument(documentId));
  // When the last client leaves a document, flush immediately before the
  // session is destroyed — nothing dirty ever waits on an empty room.
  const sessions = new DocSessionManager((session) => flusher.flush(session));

  // Updates from sibling instances: apply to the local session (if one is
  // active) and forward to local sockets. The originating instance owns the
  // flush, so remote updates do not mark the session dirty.
  subscribeDocUpdates((documentId, update) => {
    void (async () => {
      const session = await sessions.get(documentId);
      if (session) {
        try {
          Y.applyUpdate(session.doc, update);
        } catch (err) {
          logger.warn({ err, documentId }, 'rejected malformed remote update');
          return;
        }
      }
      io.to(docRoom(documentId)).emit('doc:update', { documentId, update });
    })();
  });

  // JWT handshake: clients pass their access token as `auth.token` when
  // connecting; unauthenticated sockets never reach the connection handler.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('Missing auth token'));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.user = { id: payload.sub, email: payload.email };
      socket.data.docRoles = new Map();
      next();
    } catch {
      next(new Error('Invalid or expired access token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.user.id }, 'realtime client connected');

    socket.on('doc:join', (raw, ack) => void handleJoin(io, socket, sessions, raw, ack));
    socket.on('doc:leave', (raw, ack) => void handleLeave(io, socket, sessions, raw, ack));
    socket.on('doc:sync', (raw, ack) => void handleSync(socket, sessions, raw, ack));
    socket.on('doc:update', (raw, ack) => void handleUpdate(socket, sessions, flusher, raw, ack));

    // 'disconnecting' (not 'disconnect') so the socket's rooms are still known.
    socket.on('disconnecting', () => {
      for (const documentId of socket.data.docRoles.keys()) {
        emitPresence(io, documentId, socket.id);
        void sessions.release(documentId, socket.id);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'realtime client disconnected');
    });
  });

  return io;
}

async function handleJoin(
  io: RealtimeServer,
  socket: RealtimeSocket,
  sessions: DocSessionManager,
  raw: unknown,
  ack?: (result: JoinAck) => void,
): Promise<void> {
  const parsed = docJoinPayload.safeParse(raw);
  if (!parsed.success) {
    ack?.({ ok: false, error: 'INVALID_PAYLOAD' });
    return;
  }
  const { documentId } = parsed.data;

  try {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { workspaceId: true },
    });
    const membership =
      doc &&
      (await prisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: { workspaceId: doc.workspaceId, userId: socket.data.user.id },
        },
      }));
    // Same shape for "no document" and "no membership" so existence of
    // documents outside the caller's workspaces is not revealed.
    if (!membership) {
      ack?.({ ok: false, error: 'DOCUMENT_NOT_FOUND' });
      return;
    }

    await sessions.acquire(documentId, socket.id);
    socket.data.docRoles.set(documentId, membership.role);
    await socket.join(docRoom(documentId));
    emitPresence(io, documentId);
    ack?.({ ok: true, role: membership.role });
  } catch (err) {
    logger.error({ err, documentId }, 'doc:join failed');
    ack?.({ ok: false, error: 'INTERNAL_ERROR' });
  }
}

async function handleLeave(
  io: RealtimeServer,
  socket: RealtimeSocket,
  sessions: DocSessionManager,
  raw: unknown,
  ack?: (result: Ack) => void,
): Promise<void> {
  const parsed = docLeavePayload.safeParse(raw);
  if (!parsed.success) {
    ack?.({ ok: false, error: 'INVALID_PAYLOAD' });
    return;
  }
  const { documentId } = parsed.data;

  socket.data.docRoles.delete(documentId);
  await socket.leave(docRoom(documentId));
  await sessions.release(documentId, socket.id);
  emitPresence(io, documentId);
  ack?.({ ok: true });
}

/**
 * Yjs sync handshake: the client sends its state vector and receives the
 * diff it is missing plus the server's state vector; it then answers with a
 * doc:update containing whatever the server is missing. A client without
 * local state omits the vector and receives the full document.
 */
async function handleSync(
  socket: RealtimeSocket,
  sessions: DocSessionManager,
  raw: unknown,
  ack?: (result: SyncAck) => void,
): Promise<void> {
  const parsed = docSyncPayload.safeParse(raw);
  if (!parsed.success) {
    ack?.({ ok: false, error: 'INVALID_PAYLOAD' });
    return;
  }
  const { documentId, stateVector } = parsed.data;

  if (!socket.data.docRoles.has(documentId)) {
    ack?.({ ok: false, error: 'NOT_JOINED' });
    return;
  }
  const session = await sessions.get(documentId);
  if (!session) {
    ack?.({ ok: false, error: 'NOT_JOINED' });
    return;
  }

  ack?.({
    ok: true,
    update: Y.encodeStateAsUpdate(session.doc, stateVector),
    stateVector: Y.encodeStateVector(session.doc),
  });
}

async function handleUpdate(
  socket: RealtimeSocket,
  sessions: DocSessionManager,
  flusher: DebouncedFlusher,
  raw: unknown,
  ack?: (result: Ack) => void,
): Promise<void> {
  const parsed = docUpdatePayload.safeParse(raw);
  if (!parsed.success) {
    ack?.({ ok: false, error: 'INVALID_PAYLOAD' });
    return;
  }
  const { documentId, update } = parsed.data;

  const role = socket.data.docRoles.get(documentId);
  if (!role) {
    ack?.({ ok: false, error: 'NOT_JOINED' });
    return;
  }
  if (role === 'VIEWER') {
    ack?.({ ok: false, error: 'FORBIDDEN' });
    return;
  }
  const session = await sessions.get(documentId);
  if (!session) {
    ack?.({ ok: false, error: 'NOT_JOINED' });
    return;
  }

  try {
    Y.applyUpdate(session.doc, update);
  } catch (err) {
    logger.warn({ err, documentId }, 'rejected malformed yjs update');
    ack?.({ ok: false, error: 'MALFORMED_UPDATE' });
    return;
  }

  session.dirty = true;
  flusher.schedule(session);
  socket.to(docRoom(documentId)).emit('doc:update', { documentId, update });
  void publishDocUpdate(documentId, update);
  ack?.({ ok: true });
}
