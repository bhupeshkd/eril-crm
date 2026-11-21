import { NextResponse, type NextRequest } from 'next/server';

/**
 * Custom domains: requests for a verified customer domain (e.g. www.theirshop.com) are served that site's pages.
 * The app's own hosts (APP_HOSTS, plus localhost) pass straight through, so the staff app never appears on customer domains.
 */
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const APP_HOSTS = (process.env.APP_HOSTS || 'localhost,127.0.0.1').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
/** Public pages that work on any domain as they are (forms, booking, invoices, orders, chat widget, blog/site paths). */
const PASS = ['/f/', '/book/', '/invoice/', '/order/', '/w/', '/review/', '/unsubscribe'];

const cache = new Map<string, { slug: string | null; at: number }>();
const TTL = 60_000;

async function siteFor(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.slug;
  let slug: string | null = null;
  try {
    const r = await fetch(`${API}/public/domains/resolve?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
    slug = r.ok ? ((await r.json()) as { slug: string }).slug : null;
  } catch {
    slug = hit?.slug ?? null; // API briefly unavailable: keep serving what we knew
  }
  if (cache.size > 5000) cache.clear();
  cache.set(host, { slug, at: Date.now() });
  return slug;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!host || APP_HOSTS.includes(host) || host.endsWith('.localhost')) return NextResponse.next();
  const slug = await siteFor(host);
  if (!slug) {
    return new NextResponse('This domain is not connected to a site yet.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const path = req.nextUrl.pathname;
  if (path.startsWith(`/s/${slug}`) || PASS.some((p) => path.startsWith(p))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/s/${slug}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|widget.js).*)'],
};
