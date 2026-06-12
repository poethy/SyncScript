const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const DURATION_PATTERN = /^\d+(ms|s|m|h|d)$/;

/** Parse a duration like "15m", "30d" or "1500ms" into milliseconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${input}" (expected e.g. "15m", "30d")`);
  }
  return Number(match[1]) * UNIT_MS[match[2] as string]!;
}
