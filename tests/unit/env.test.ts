import { describe, expect, it } from 'vitest';
import { envSchema } from '../../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('env schema', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const parsed = envSchema.parse(valid);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.JWT_ACCESS_TTL).toBe('15m');
  });

  it('coerces PORT from string', () => {
    const parsed = envSchema.parse({ ...valid, PORT: '8080' });
    expect(parsed.PORT).toBe(8080);
  });

  it('rejects missing or malformed values', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, DATABASE_URL: 'not-a-url' }).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, JWT_ACCESS_SECRET: 'short' }).success).toBe(false);
  });
});
