import { z } from 'zod';
import type { AuthUser } from '../middlewares/authenticate.js';
import type { WorkspaceRole } from '../generated/prisma/client.js';

// Wire protocol for the realtime gateway. Payloads arrive untyped from the
// socket and are validated with zod before use; acks carry typed results.

export const docJoinPayload = z.object({
  documentId: z.string().min(1),
});

export const docLeavePayload = docJoinPayload;

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

export interface ClientToServerEvents {
  'doc:join': (payload: unknown, ack?: (result: JoinAck) => void) => void;
  'doc:leave': (payload: unknown, ack?: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'doc:presence': (payload: { documentId: string; connections: number }) => void;
}

export interface SocketData {
  user: AuthUser;
  /** Role per joined document, captured at join time for fast update checks. */
  docRoles: Map<string, WorkspaceRole>;
}

export const docRoom = (documentId: string): string => `doc:${documentId}`;
