/** Pure helpers for blog posts (no entity imports, so Vitest can load them). Posts are written in Markdown. */

export const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/** "Hello, World! 10 Tips" → "hello-world-10-tips" (accents folded, max 100 chars). */
export function postSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100)
      .replace(/-+$/g, '') || 'post'
  );
}

/** Markdown → readable plain text (for excerpts, reading time, RSS). Images are dropped; links keep their text. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minutes to read at 200 words a minute (at least 1). */
export function readMinutes(md: string): number {
  const words = plainText(md).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** First ~`max` characters of the text, cut at a word boundary. */
export function excerptOf(md: string, max = 200): string {
  const t = plainText(md);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export interface FeedItem {
  title: string;
  url: string;
  excerpt: string;
  publishedAt: Date;
  author?: string;
  tags?: string[];
}

/** RSS 2.0 feed for a blog. */
export function rssXml(feed: { title: string; url: string; description: string; items: FeedItem[] }): string {
  const items = feed.items
    .map(
      (i) =>
        `<item><title>${escapeXml(i.title)}</title><link>${escapeXml(i.url)}</link><guid isPermaLink="true">${escapeXml(i.url)}</guid>` +
        `<pubDate>${i.publishedAt.toUTCString()}</pubDate>` +
        (i.author ? `<author>${escapeXml(i.author)}</author>` : '') +
        (i.tags ?? []).map((t) => `<category>${escapeXml(t)}</category>`).join('') +
        `<description>${escapeXml(i.excerpt)}</description></item>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
    `<title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.url)}</link><description>${escapeXml(feed.description)}</description>` +
    items +
    `</channel></rss>`
  );
}

/** Tags: trimmed, lower-cased, de-duplicated, at most 10 of up to 40 chars. */
export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const v = String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
    if (out.length === 10) break;
  }
  return out;
}

/** Destination links a QR code may point to (no javascript:, data: or other schemes). */
export function isSafeUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && u.length <= 2000;
  } catch {
    return false;
  }
}

/** Adds utm_source/medium/campaign unless the link already sets them. */
export function withUtm(u: string, campaign: string): string {
  const url = new URL(u);
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', 'qr');
  if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'qr');
  if (!url.searchParams.has('utm_campaign') && campaign) url.searchParams.set('utm_campaign', postSlug(campaign));
  return url.toString();
}

/** Coarse device class from a user agent, for scan stats. */
export function deviceOf(ua: string | undefined): 'ios' | 'android' | 'desktop' | 'other' {
  const s = ua ?? '';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Android/i.test(s)) return 'android';
  if (/Windows NT|Macintosh|X11|CrOS/i.test(s)) return 'desktop';
  return 'other';
}
