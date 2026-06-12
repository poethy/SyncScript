import { describe, expect, it } from 'vitest';
import { parseDuration } from '../../src/utils/duration.js';

describe('parseDuration', () => {
  it('parses each supported unit', () => {
    expect(parseDuration('1500ms')).toBe(1500);
    expect(parseDuration('45s')).toBe(45_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('30d')).toBe(2_592_000_000);
  });

  it('rejects malformed input', () => {
    expect(() => parseDuration('15')).toThrow();
    expect(() => parseDuration('m15')).toThrow();
    expect(() => parseDuration('15 m')).toThrow();
    expect(() => parseDuration('-5m')).toThrow();
    expect(() => parseDuration('5w')).toThrow();
  });
});
