import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

function createRedisClient(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });
  client.on('error', (err: Error) => {
    logger.warn({ name, err: err.message }, 'redis connection error');
  });
  return client;
}

// General-purpose client: delivery cache, rate limiting, sub-tree lookups.
export const redis = createRedisClient('cache');

// Dedicated connections for pub/sub — a subscribed ioredis connection cannot
// issue regular commands, so fan-out (Yjs updates, cache invalidation across
// instances) gets its own pair.
export const redisPub = createRedisClient('pub');
export const redisSub = createRedisClient('sub');
