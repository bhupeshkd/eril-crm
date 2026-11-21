'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner, errorText } from '@/components/ui';
import { PublicLoading } from '@/components/public-shell';
import { BlogFrame, fmtPostDate, type BlogSite, type PostCard } from '@/components/blog-public';

interface List { site: BlogSite; posts: PostCard[]; tags: Array<{ tag: string; count: number }>; tag: string | null; page: number; pages: number; total: number }

/** Public blog index: /s/<site>/blog (?tag=…&page=…) */
export default function BlogIndex() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState<{ tag: string; page: number } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setQuery({ tag: p.get('tag') ?? '', page: Math.max(1, Number(p.get('page')) || 1) });
  }, []);

  useEffect(() => {
    if (!query) return;
    const q = new URLSearchParams();
    if (query.tag) q.set('tag', query.tag);
    if (query.page > 1) q.set('page', String(query.page));
    api<List>(`/public/sites/${slug}/blog${q.size ? `?${q}` : ''}`, { auth: false })
      .then((d) => { setData(d); document.title = `${d.tag ? `#${d.tag} · ` : ''}Blog · ${d.site.name}`; })
      .catch((e) => setError(errorText(e)));
  }, [slug, query]);

  if (error) return <PublicLoading error={error} />;
  if (!data) return <main className="grid min-h-screen place-items-center"><Spinner className="h-7 w-7" /></main>;
  const accent = data.site.theme.primaryColor || '#2953e0';
  const href = (tag: string | null, page = 1) => {
    const q = new URLSearchParams();
    if (tag) q.set('tag', tag);
    if (page > 1) q.set('page', String(page));
    return `/s/${slug}/blog${q.size ? `?${q}` : ''}`;
  };

  return (
    <BlogFrame site={data.site}>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-4xl font-bold tracking-tight">{data.tag ? <>Posts tagged <span style={{ color: accent }}>#{data.tag}</span></> : 'Blog'}</h1>
        {data.tags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <a href={href(null)} className={`rounded-full border px-3 py-1 ${!data.tag ? 'text-white' : 'border-black/10'}`} style={!data.tag ? { background: accent, borderColor: accent } : undefined}>All</a>
            {data.tags.map((t) => (
              <a key={t.tag} href={href(t.tag)} className={`rounded-full border px-3 py-1 ${data.tag === t.tag ? 'text-white' : 'border-black/10'}`} style={data.tag === t.tag ? { background: accent, borderColor: accent } : undefined}>
                {t.tag} <span className="opacity-60">{t.count}</span>
              </a>
            ))}
          </div>
        )}
        {data.posts.length === 0 ? (
          <p className="mt-12 text-center opacity-60">No posts yet. Check back soon.</p>
        ) : (
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {data.posts.map((p) => (
              <article key={p.slug} className="group flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-white/60 transition hover:shadow-lg">
                <a href={`/s/${slug}/blog/${p.slug}`} className="block aspect-[16/9] overflow-hidden bg-black/5">
                  {p.coverImageUrl ? <img src={p.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" /> : <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${accent}22, ${accent}55)` }} />}
                </a>
                <div className="flex flex-1 flex-col p-5">
                  <div className="text-xs opacity-60">{fmtPostDate(p.publishedAt)} · {p.readMinutes} min read</div>
                  <h2 className="mt-1.5 text-lg font-semibold leading-snug"><a href={`/s/${slug}/blog/${p.slug}`} className="hover:underline">{p.title}</a></h2>
                  <p className="mt-2 flex-1 text-sm opacity-75">{p.excerpt}</p>
                  {p.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5 text-xs">{p.tags.slice(0, 3).map((t) => <a key={t} href={href(t)} className="rounded-full bg-black/5 px-2 py-0.5">#{t}</a>)}</div>}
                </div>
              </article>
            ))}
          </div>
        )}
        {data.pages > 1 && (
          <nav className="mt-12 flex items-center justify-center gap-4 text-sm" aria-label="Pages">
            {data.page > 1 ? <a href={href(data.tag, data.page - 1)} className="font-medium">← Newer</a> : <span className="opacity-30">← Newer</span>}
            <span className="opacity-60">Page {data.page} of {data.pages}</span>
            {data.page < data.pages ? <a href={href(data.tag, data.page + 1)} className="font-medium">Older →</a> : <span className="opacity-30">Older →</span>}
          </nav>
        )}
      </main>
    </BlogFrame>
  );
}
