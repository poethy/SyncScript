import { z } from 'zod';
import type { AuthUser } from '../middlewares/authenticate.js';
import type { WorkspaceRole } from '../generated/prisma/client.js';

// Wire protocol for the realtime gateway. Payloads arrive untyped from the
// socket and are validated with zod before use; acks carry typed results.

export const docJoinPayload = z.object({
  documentId: z.string().min(1),
});

export const docLeavePayload = docJoinPayload;

const binary = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: 'expected binary data',
});

export const docSyncPayload = z.object({
  documentId: z.string().min(1),
  /** Yjs state vector; when present the reply contains only the missing diff. */
  stateVector: binary.optional(),
});

export const docUpdatePayload = z.object({
  documentId: z.string().min(1),
  /** Incremental Yjs update produced by the client. */
  update: binary,
});

export interface JoinAck {
  ok: boolean;
  /** The caller's workspace role; present when ok. */
  role?: WorkspaceRole;
  error?: string;
}

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface SyncAck {
  ok: boolean;
  /** Update bringing the client up to the server state (diffed when a state vector was sent). */
  update?: Uint8Array;
  /** Server state vector so the client can send back its own missing changes. */
  stateVector?: Uint8Array;
  error?: string;
}

export interface ClientToServerEvents {
  'doc:join': (payload: unknown, ack?: (result: JoinAck) => void) => void;
  'doc:leave': (payload: unknown, ack?: (result: Ack) => void) => void;
  'doc:sync': (payload: unknown, ack?: (result: SyncAck) => void) => void;
  'doc:update': (payload: unknown, ack?: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'doc:presence': (payload: { documentId: string; connections: number }) => void;
  'doc:update': (payload: { documentId: string; update: Uint8Array }) => void;
}

export interface SocketData {
  user: AuthUser;
  /** Role per joined document, captured at join time for fast update checks. */
  docRoles: Map<string, WorkspaceRole>;
}

export const docRoom = (documentId: string): string => `doc:${documentId}`;
