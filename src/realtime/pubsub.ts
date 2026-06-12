import crypto from 'node:crypto';
import { redisPub, redisSub } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

// Horizontal scaling: when several server instances host sockets for the same
// document, each instance publishes the updates it receives and applies the
// updates published by its peers. Messages carry the origin instance id so an
// instance ignores its own echoes.

const CHANNEL_PREFIX = 'doc:update:';

export const instanceId = crypto.randomUUID();

interface RemoteUpdateMessage {
  origin: string;
  /** Yjs update, base64-encoded for the JSON envelope. */
  update: string;
}

export async function publishDocUpdate(documentId: string, update: Uint8Array): Promise<void> {
  const message: RemoteUpdateMessage = {
    origin: instanceId,
    update: Buffer.from(update).toString('base64'),
  };
  try {
    await redisPub.publish(CHANNEL_PREFIX + documentId, JSON.stringify(message));
  } catch (err) {
    // Redis being down degrades to single-instance behavior, not data loss:
    // updates still reach local sockets and the flusher.
    logger.warn({ err: (err as Error).message, documentId }, 'doc update publish failed');
  }
}

export function subscribeDocUpdates(
  onRemoteUpdate: (documentId: string, update: Uint8Array) => void,
): void {
  redisSub
    .psubscribe(CHANNEL_PREFIX + '*')
    .catch((err: Error) =>
      logger.warn({ err: err.message }, 'doc update subscription unavailable'),
    );

  redisSub.on('pmessage', (_pattern: string, channel: string, raw: string) => {
    try {
      const message = JSON.parse(raw) as RemoteUpdateMessage;
      if (message.origin === instanceId) return;
      const documentId = channel.slice(CHANNEL_PREFIX.length);
      onRemoteUpdate(documentId, new Uint8Array(Buffer.from(message.update, 'base64')));
    } catch (err) {
      logger.warn({ err, channel }, 'malformed doc update message');
    }
  });
}
