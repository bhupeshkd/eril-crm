/**
 * Fetching a URL a user typed in, without letting it reach the server's own network (SSRF):
 * https only, every resolved address must be public, redirects re-checked (max 3), 10s timeout, size cap.
 * `allowPrivate` exists for local tests only.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (isIP(v) === 6) return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  return true; // not an IP at all: treat as unsafe
}

/** Normalises a calendar link: webcal:// becomes https://. Returns null when it can't be used. */
export function normalizeFeedUrl(input: string, allowPrivate = false): URL | null {
  let s = String(input ?? '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return null;
  return u;
}

export async function assertPublicHost(host: string) {
  const h = host.replace(/^\[|\]$/g, '');
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address points to a private network');
}

export async function safeFetchText(input: string, opts: { allowPrivate?: boolean; maxBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  let url = normalizeFeedUrl(input, opts.allowPrivate);
  if (!url) throw new Error('Use an https:// (or webcal://) calendar link');
  for (let hop = 0; hop < 4; hop++) {
    if (!opts.allowPrivate) await assertPublicHost(url.hostname);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { Accept: 'text/calendar, text/plain;q=0.8' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = normalizeFeedUrl(new URL(res.headers.get('location')!, url).toString(), opts.allowPrivate);
      if (!next) throw new Error('The calendar link redirects somewhere unsafe');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`The calendar link answered ${res.status}`);
    if (Number(res.headers.get('content-length') || 0) > maxBytes) throw new Error('That calendar is too large');
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); throw new Error('That calendar is too large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Too many redirects');
}
