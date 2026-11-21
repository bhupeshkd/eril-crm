import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** Blocks loopback, private, link-local and metadata ranges (SSRF guard for workflow webhooks). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function postWebhook(url: string, payload: unknown, extraHeaders: Record<string, string> = {}, rawBody?: string): Promise<number> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Webhook URL must be http(s)');
  const allowPrivate = process.env.WEBHOOKS_ALLOW_PRIVATE === 'true';
  if (!allowPrivate) {
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Webhook URL resolves to a private address');
  }
  const res = await fetch(parsed, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ERIL-Webhooks/1.0', ...extraHeaders },
    body: rawBody ?? JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  return res.status;
}
