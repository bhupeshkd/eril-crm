import { randomBytes } from 'crypto';

/** URL-safe slug with a random suffix so public links are unique and not guessable by name. */
export function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'item'}-${randomBytes(3).toString('hex')}`;
}

export function publicToken(): string {
  return randomBytes(24).toString('base64url');
}
