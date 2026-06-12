import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { AppError } from './errorHandler.js';

// Token bucket held in Redis so the limit is enforced across every instance.
// The Lua script makes read-refill-consume atomic — two concurrent requests
// can never both spend the last token. Fractional tokens are kept so refill
// precision is not lost between calls.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed = math.max(0, now_ms - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill_per_sec)

local allowed = 0
if tokens >= cost then
  allowed = 1
  tokens = tokens - cost
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', now_ms)
redis.call('PEXPIRE', key, math.ceil((capacity / refill_per_sec) * 2000))

local retry_ms = 0
if allowed == 0 then
  retry_ms = math.ceil(((cost - tokens) / refill_per_sec) * 1000)
end
return {allowed, tostring(tokens), retry_ms}
`;

export interface RateLimitOptions {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained allowance, tokens per second. */
  refillPerSecond: number;
  /** Bucket identity — e.g. per API key, per user, per IP. */
  keyFor: (request: FastifyRequest) => string;
}

export function rateLimit(options: RateLimitOptions) {
  return async function rateLimitGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    let result: [number, string, number];
    try {
      result = (await redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        `ratelimit:${options.keyFor(request)}`,
        options.capacity,
        options.refillPerSecond,
        Date.now(),
        1,
      )) as [number, string, number];
    } catch (err) {
      // Fail open: an unavailable Redis must not take the public API down
      // with it. The trade-off (briefly unthrottled traffic) is logged.
      logger.warn({ err: (err as Error).message }, 'rate limiter unavailable, failing open');
      return;
    }

    const allowed = result[0];
    const remaining = Math.floor(Number(result[1]));
    const retryMs = result[2];

    void reply.header('X-RateLimit-Limit', options.capacity);
    void reply.header('X-RateLimit-Remaining', Math.max(0, remaining));

    if (allowed !== 1) {
      void reply.header('Retry-After', Math.max(1, Math.ceil(retryMs / 1000)));
      throw new AppError(429, 'Rate limit exceeded', 'RATE_LIMITED');
    }
  };
}
