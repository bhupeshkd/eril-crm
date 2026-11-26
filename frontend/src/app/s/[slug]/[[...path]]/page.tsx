'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { captureTouch } from '@/lib/attribution';
import { Spinner, errorText } from '@/components/ui';
import { PublicLoading } from '@/components/public-shell';
import { Embeds, PageView, SitePage, SiteTheme } from '@/components/site-blocks';

interface PublicSite {
  name: string;
  kind: 'website' | 'funnel';
  theme: SiteTheme;
  pages: SitePage[];
  embeds: Embeds;
  hasBlog?: boolean;
}

export default function PublicSitePage() {
  const params = useParams<{ slug: string; path?: string[] }>();
  const slug = params.slug;
  const path = (params.path ?? []).join('/');
  const [site, setSite] = useState<PublicSite | null>(null);
  const [error, setError] = useState('');

  useEffect(() => captureTouch(), []);

  useEffect(() => {
    api<PublicSite>(`/public/sites/${slug}`, { auth: false }).then(setSite).catch((e) => setError(errorText(e)));
  }, [slug]);

  const index = site ? site.pages.findIndex((p) => p.path === path) : -1;
  const page = site && index >= 0 ? site.pages[index] : null;

  useEffect(() => {
    if (!page) return;
    document.title = `${page.title} · ${site!.name}`;
    api(`/public/sites/${slug}/view`, { method: 'POST', auth: false, body: { path } }).catch(() => {});
  }, [page, site, slug, path]);

  if (error) return <PublicLoading error={error} />;
  if (!site) return <main className="grid min-h-screen place-items-center"><Spinner className="h-7 w-7" /></main>;
  if (!page) return <PublicLoading error="This page doesn't exist. Check the address, or go back to the home page." />;

  const nextPath = site.kind === 'funnel' && index < site.pages.length - 1 ? site.pages[index + 1].path : null;
  const base = `/s/${slug}`;

  return (
    <div className="min-h-screen" style={{ backgroundColor: site.theme.background || '#fff' }}>
      {site.kind === 'website' && (site.pages.length > 1 || site.hasBlog) && (
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-6 py-4" aria-label="Site">
          <a href={base} className="font-bold">{site.name}</a>
          <ul className="flex flex-wrap gap-4 text-sm">
            {site.pages.map((p) => (
              <li key={p.id}>
                <a href={`${base}${p.path ? `/${p.path}` : ''}`} aria-current={p.path === path ? 'page' : undefined} className={p.path === path ? 'font-semibold' : 'opacity-70 hover:opacity-100'}>{p.title}</a>
              </li>
            ))}
            {site.hasBlog && <li><a href={`${base}/blog`} className="opacity-70 hover:opacity-100">Blog</a></li>}
          </ul>
        </nav>
      )}
      <main>
        <PageView page={page} theme={site.theme} embeds={site.embeds} base={base} nextPath={nextPath} />
      </main>
    </div>
  );
}
