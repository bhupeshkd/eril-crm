import { NextResponse, type NextRequest } from 'next/server';

/**
 * Custom domains: requests for a verified customer domain (e.g. www.theirshop.com) are served that site's pages.
 * The app's own hosts (APP_HOSTS, plus localhost) pass straight through, so the staff app never appears on customer domains.
 * An agency's verified app domain (e.g. app.theiragency.com) also passes through: it serves the staff app under their brand.
 */
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const APP_HOSTS = (process.env.APP_HOSTS || 'localhost,127.0.0.1').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
/** Public pages that work on any domain as they are (forms, booking, invoices, orders, chat widget, blog/site paths). */
const PASS = ['/f/', '/book/', '/invoice/', '/order/', '/w/', '/review/', '/unsubscribe'];

type Target = { kind: 'app' } | { kind: 'site'; slug: string } | null;
const cache = new Map<string, { target: Target; at: number }>();
const TTL = 60_000;

async function targetFor(host: string): Promise<Target> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.target;
  let target: Target = null;
  try {
    const r = await fetch(`${API}/public/domains/resolve?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
    if (r.ok) {
      const d = (await r.json()) as { kind?: string; slug?: string };
      target = d.kind === 'app' ? { kind: 'app' } : d.slug ? { kind: 'site', slug: d.slug } : null;
    }
  } catch {
    target = hit?.target ?? null; // API briefly unavailable: keep serving what we knew
  }
  if (cache.size > 5000) cache.clear();
  cache.set(host, { target, at: Date.now() });
  return target;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!host || APP_HOSTS.includes(host) || host.endsWith('.localhost')) return NextResponse.next();
  const target = await targetFor(host);
  if (target?.kind === 'app') return NextResponse.next();
  if (!target) {
    return new NextResponse('This domain is not connected to a site yet.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const slug = target.slug;
  const path = req.nextUrl.pathname;
  if (path.startsWith(`/s/${slug}`) || PASS.some((p) => path.startsWith(p))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/s/${slug}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|widget.js).*)'],
};
