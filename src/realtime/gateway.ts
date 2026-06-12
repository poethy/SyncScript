import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { logger } from '../lib/logger.js';

// Realtime gateway skeleton. Phase 3 (see ROADMAP.md) adds:
//  - JWT handshake middleware
//  - per-document rooms with RBAC checks on join
//  - Yjs sync protocol (sync step 1/2 + incremental updates as binary events)
//  - debounced persistence flusher and Redis pub/sub fan-out
export function attachRealtimeGateway(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    serveClient: false,
    cors: { origin: true },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'realtime client connected');
    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'realtime client disconnected');
    });
  });

  return io;
}
