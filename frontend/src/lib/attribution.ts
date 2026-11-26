/**
 * Marketing attribution capture for public pages (booking, forms, order forms, sites, chat).
 *
 * Kept in sessionStorage, not localStorage: every agency's public pages share this domain,
 * so a long-lived store could credit one business's ad with another business's lead.
 * "First touch" therefore means the first tracked page in this browsing session.
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
  referrer?: string;
  landingPage?: string;
  capturedAt?: string;
}

const KEY_FIRST = 'eril.touch.first';
const KEY_LAST = 'eril.touch.last';
const PARAMS: Array<[keyof Touch, string]> = [
  ['source', 'utm_source'],
  ['medium', 'utm_medium'],
  ['campaign', 'utm_campaign'],
  ['term', 'utm_term'],
  ['content', 'utm_content'],
  ['gclid', 'gclid'],
  ['fbclid', 'fbclid'],
  ['msclkid', 'msclkid'],
];

function read(key: string): Touch | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as Touch) : null;
  } catch {
    return null;
  }
}
function write(key: string, t: Touch) {
  try {
    sessionStorage.setItem(key, JSON.stringify(t));
  } catch {
    /* storage blocked: attribution is best-effort */
  }
}

function fromUrl(href: string | null | undefined): Touch {
  const t: Touch = {};
  if (!href) return t;
  try {
    const u = new URL(href);
    for (const [k, p] of PARAMS) {
      const v = u.searchParams.get(p);
      if (v) (t as Record<string, string>)[k] = v.slice(0, 255);
    }
  } catch {
    /* not a URL */
  }
  return t;
}

const hasCampaign = (t: Touch) => PARAMS.some(([k]) => !!t[k]);
const isExternal = (url: string) => {
  try {
    return new URL(url).origin !== location.origin;
  } catch {
    return false;
  }
};

/**
 * Record where this visit came from. Call once when a public page loads.
 * `hostPage` is the page that embeds us (chat widget passes it explicitly; iframes use document.referrer).
 */
export function captureTouch(hostPage?: string | null) {
  if (typeof window === 'undefined') return;
  const embedded = window.self !== window.top;
  // Inside an iframe the visitor's real landing page is the host page, which is our referrer.
  const page = hostPage || (embedded ? document.referrer : location.href);
  const t: Touch = fromUrl(page);
  if (!embedded && !hostPage && document.referrer && isExternal(document.referrer)) t.referrer = document.referrer.slice(0, 500);
  if (page && /^https?:/.test(page)) t.landingPage = page.slice(0, 500);
  t.capturedAt = new Date().toISOString();

  if (!read(KEY_FIRST)) write(KEY_FIRST, t);
  // The latest touch only moves on a new signal (a campaign link or another site), not on every page view.
  if (hasCampaign(t) || t.referrer || !read(KEY_LAST)) write(KEY_LAST, t);
}

/** What to send with a submission: { first, last }, or undefined when nothing was captured. */
export function getAttribution(): { first: Touch | null; last: Touch | null } | undefined {
  if (typeof window === 'undefined') return undefined;
  const first = read(KEY_FIRST);
  const last = read(KEY_LAST);
  return first || last ? { first, last } : undefined;
}
