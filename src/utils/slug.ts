import crypto from 'node:crypto';

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    // strip combining diacritical marks left over from NFKD decomposition
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'workspace';
}

/** Slug plus a random suffix so the globally unique constraint never collides. */
export function uniqueSlug(input: string): string {
  return `${slugify(input)}-${crypto.randomBytes(3).toString('hex')}`;
}
