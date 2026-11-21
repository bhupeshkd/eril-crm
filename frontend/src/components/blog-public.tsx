'use client';

import type { SiteTheme } from './site-blocks';
import { API_URL } from '@/lib/api';

export interface BlogSite { name: string; slug: string; theme: SiteTheme; nav: Array<{ title: string; path: string }> }
export interface PostCard { title: string; slug: string; excerpt: string; coverImageUrl: string; authorName: string; tags: string[]; publishedAt: string; readMinutes: number }

export const fmtPostDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/** Page frame for a site's blog: the site's colours/font, its navigation, plus a Blog link and RSS. */
export function BlogFrame({ site, children }: { site: BlogSite; children: React.ReactNode }) {
  const base = `/s/${site.slug}`;
  const accent = site.theme.primaryColor || '#2953e0';
  return (
    <div className="min-h-screen text-slate-900" style={{ backgroundColor: site.theme.background || '#fff', fontFamily: site.theme.font === 'serif' ? 'Georgia, Cambria, serif' : undefined, ['--accent' as string]: accent }}>
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-6 py-4" aria-label="Site">
        <a href={base} className="font-bold">{site.name}</a>
        <ul className="flex flex-wrap items-center gap-4 text-sm">
          {site.nav.map((p) => (
            <li key={p.path}><a href={`${base}${p.path ? `/${p.path}` : ''}`} className="opacity-70 hover:opacity-100">{p.title}</a></li>
          ))}
          <li><a href={`${base}/blog`} className="font-semibold" style={{ color: accent }}>Blog</a></li>
          <li>
            <a href={`${API_URL}/public/sites/${site.slug}/blog/rss.xml`} className="opacity-60 hover:opacity-100" title="RSS feed" aria-label="RSS feed">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor"><path d="M4 15.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM3 9a8 8 0 0 1 8 8H9a6 6 0 0 0-6-6V9Zm0-5a13 13 0 0 1 13 13h-2A11 11 0 0 0 3 6V4Z" /></svg>
            </a>
          </li>
        </ul>
      </nav>
      {children}
    </div>
  );
}
