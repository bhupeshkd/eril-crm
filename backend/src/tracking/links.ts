import { createHmac, timingSafeEqual } from 'crypto';

/** Pure helpers for email open/click tracking (unit-tested in links.spec.ts). */

const unescapeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function signLink(secret: string, token: string, url: string) {
  return createHmac('sha256', secret).update(`click:${token}:${url}`).digest('base64url').slice(0, 22);
}

export function verifyLink(secret: string, token: string, url: string, sig: string) {
  const expected = Buffer.from(signLink(secret, token, url));
  const given = Buffer.from(String(sig ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Rewrites http(s) hrefs to go through the click endpoint. Unsubscribe links are left
 * direct so link scanners can't trigger them and recipients always reach them.
 */
export function rewriteLinks(html: string, wrap: (url: string) => string, skip: (url: string) => boolean = () => false) {
  const urls: string[] = [];
  const out = html.replace(/href="(https?:\/\/[^"]+)"/gi, (m, raw: string) => {
    const url = unescapeAttr(raw);
    if (skip(url)) return m;
    urls.push(url);
    return `href="${escapeAttr(wrap(url))}"`;
  });
  return { html: out, urls };
}

/** Adds an invisible 1×1 image just before </body> (or at the end). */
export function injectPixel(html: string, pixelUrl: string) {
  const img = `<img src="${escapeAttr(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img;
}

/** Only redirect to http(s) URLs (defence in depth on top of the signature). */
export function isRedirectable(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Mail-security scanners and prefetchers that fetch links/images automatically. */
export function isLikelyBot(userAgent: string | undefined) {
  if (!userAgent) return true;
  return /(bot|crawler|spider|preview|scanner|barracuda|mimecast|proofpoint|safelinks|urldefense|python-requests|curl\/|wget|headless)/i.test(userAgent);
}
