import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../../src/utils/slug.js';

describe('slugify', () => {
  it('lowercases and replaces separators with hyphens', () => {
    expect(slugify('My Team Workspace')).toBe('my-team-workspace');
    expect(slugify('  spaced   out  ')).toBe('spaced-out');
  });

  it('strips diacritics', () => {
    expect(slugify('Équipe Café')).toBe('equipe-cafe');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('workspace');
    expect(slugify('')).toBe('workspace');
  });

  it('caps length at 48 characters without a trailing hyphen', () => {
    const slug = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('appends a 6-char hex suffix', () => {
    expect(uniqueSlug('My Team')).toMatch(/^my-team-[0-9a-f]{6}$/);
  });

  it('produces different values on each call', () => {
    expect(uniqueSlug('x')).not.toBe(uniqueSlug('x'));
  });
});
