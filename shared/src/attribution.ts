/**
 * Marketing attribution: where a contact came from. Public pages capture UTM tags, ad click IDs,
 * the referring site and the landing page; we keep the first and the latest "touch" per contact.
 */
export interface Touch {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  /** Referring page (another site), if any. */
  referrer?: string;
  /** First page the visitor landed on. */
  landingPage?: string;
  capturedAt?: string;
}

export interface Attribution {
  first?: Touch | null;
  last?: Touch | null;
}

const TEXT_KEYS = ['source', 'medium', 'campaign', 'term', 'content', 'gclid', 'fbclid', 'msclkid'] as const;
const URL_KEYS = ['referrer', 'landingPage'] as const;

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

function cleanUrl(v: unknown): string {
  const s = cleanText(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 500) : '';
  } catch {
    return '';
  }
}

/** Keep only known fields with sane lengths; returns null when nothing useful is left. */
export function cleanTouch(raw: unknown): Touch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t: Touch = {};
  for (const k of TEXT_KEYS) {
    const v = cleanText(r[k], k.endsWith('clid') ? 255 : 120);
    if (v) t[k] = k === 'source' || k === 'medium' ? v.toLowerCase() : v;
  }
  for (const k of URL_KEYS) {
    const v = cleanUrl(r[k]);
    if (v) t[k] = v;
  }
  if (!Object.keys(t).length) return null;
  const when = typeof r.capturedAt === 'string' ? new Date(r.capturedAt) : null;
  t.capturedAt = when && !isNaN(+when) && +when <= Date.now() + 60_000 ? when.toISOString() : new Date().toISOString();
  return t;
}

export function cleanAttribution(raw: unknown): { first: Touch | null; last: Touch | null } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const first = cleanTouch(r.first);
  const last = cleanTouch(r.last);
  return { first: first ?? last, last: last ?? first };
}

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|search\.brave)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|twitter|x|t|tiktok|youtube|pinterest|reddit|threads)\.(com|co|in|me)$/i;

function host(url?: string) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A readable channel name for reports, e.g. "Google Ads", "Email", "Organic search", "Referral: blog.example.com". */
export function channelOf(t?: Touch | null): string {
  if (!t) return 'Not tracked';
  if (t.gclid) return 'Google Ads';
  if (t.fbclid && /^(cpc|paid|ppc|paid_social)$/.test(t.medium ?? '')) return 'Meta Ads';
  if (t.msclkid) return 'Microsoft Ads';
  const medium = t.medium ?? '';
  const source = t.source ?? '';
  if (/^(cpc|ppc|paid|paidsearch|paid_search|display|cpm|paid_social|paidsocial)$/.test(medium)) return `Paid: ${source || 'unknown'}`;
  if (/^e-?mail$|newsletter/.test(medium)) return 'Email';
  if (medium === 'social' || /^(social|organic_social)$/.test(medium)) return `Social: ${source || 'unknown'}`;
  if (source) return `Campaign: ${source}`;
  if (t.fbclid) return 'Organic social';
  const h = host(t.referrer);
  if (!h) return 'Direct';
  if (SEARCH.test(h)) return 'Organic search';
  if (SOCIAL.test(h)) return 'Organic social';
  return `Referral: ${h}`;
}
