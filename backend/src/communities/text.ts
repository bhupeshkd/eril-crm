/** Pure helpers for community content (no entity imports, so Vitest can load them). */

export const POST_MAX = 5000;
export const COMMENT_MAX = 2000;

/**
 * Normalises user text: strips control characters (keeps newlines/tabs), trims each end,
 * collapses runs of blank lines and enforces a length limit. Rendering escapes it; we never store HTML.
 */
export function cleanBody(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** "Rosa Diaz" → "Rosa D."; falls back to "Member". Shown to other members instead of email/full name. */
export function defaultDisplayName(firstName?: string | null, lastName?: string | null): string {
  const f = cleanBody(firstName, 40).split(/\s+/)[0] ?? '';
  const l = cleanBody(lastName, 40);
  if (!f && !l) return 'Member';
  return l ? `${f || l} ${f ? `${l[0].toUpperCase()}.` : ''}`.trim() : f;
}

export function cleanDisplayName(raw: unknown): string {
  return cleanBody(raw, 80).replace(/\s+/g, ' ');
}

export const MAX_MENTIONS = 10;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keeps only the picked members whose "@Display Name" really appears in the text (case-insensitive,
 * not followed by more name characters), so a client can't notify people it didn't visibly mention.
 */
export function resolveMentions(body: string, picked: Array<{ id: string; displayName: string }>, max = MAX_MENTIONS) {
  const found: Array<{ memberId: string; name: string; at: number }> = [];
  for (const m of picked) {
    if (!m.displayName || found.some((x) => x.memberId === m.id)) continue;
    const re = new RegExp(`(^|[^\\w@])@${escapeRe(m.displayName)}(?![\\w])`, 'i');
    const hit = re.exec(body);
    if (hit) found.push({ memberId: m.id, name: m.displayName, at: hit.index });
  }
  // In the order they appear in the text.
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map(({ memberId, name }) => ({ memberId, name }));
}
