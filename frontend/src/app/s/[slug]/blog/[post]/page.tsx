'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner, errorText } from '@/components/ui';
import { PublicLoading } from '@/components/public-shell';
import { Markdown } from '@/lib/markdown';
import { BlogFrame, fmtPostDate, type BlogSite, type PostCard } from '@/components/blog-public';

interface Data {
  site: BlogSite;
  post: PostCard & { body: string; seoTitle: string; seoDescription: string };
  older: { title: string; slug: string } | null;
  newer: { title: string; slug: string } | null;
}

/** Public blog post: /s/<site>/blog/<post> */
export default function BlogPostPage() {
  const { slug, post } = useParams<{ slug: string; post: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Data>(`/public/sites/${slug}/blog/${encodeURIComponent(post)}`, { auth: false })
      .then((d) => {
        setData(d);
        document.title = `${d.post.seoTitle} · ${d.site.name}`;
        let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
        meta.content = d.post.seoDescription;
        api(`/public/sites/${slug}/blog/${encodeURIComponent(post)}/view`, { method: 'POST', auth: false }).catch(() => {});
      })
      .catch((e) => setError(errorText(e)));
  }, [slug, post]);

  if (error) return <PublicLoading error={error} />;
  if (!data) return <main className="grid min-h-screen place-items-center"><Spinner className="h-7 w-7" /></main>;
  const p = data.post;
  const accent = data.site.theme.primaryColor || '#2953e0';

  return (
    <BlogFrame site={data.site}>
      <main className="px-6 py-12">
        <article className="mx-auto max-w-2xl">
          <a href={`/s/${slug}/blog`} className="text-sm font-medium" style={{ color: accent }}>← All posts</a>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight">{p.title}</h1>
          <div className="mt-3 text-sm opacity-60">
            {p.authorName && <>{p.authorName} · </>}{fmtPostDate(p.publishedAt)} · {p.readMinutes} min read
          </div>
          {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="mt-8 w-full rounded-2xl object-cover" />}
          <Markdown source={p.body} className="mt-6 text-[17px] [&_a]:text-[color:var(--accent)]" />
          {p.tags.length > 0 && (
            <div className="mt-10 flex flex-wrap gap-2 border-t border-black/10 pt-6 text-sm">
              {p.tags.map((t) => <a key={t} href={`/s/${slug}/blog?tag=${encodeURIComponent(t)}`} className="rounded-full bg-black/5 px-3 py-1">#{t}</a>)}
            </div>
          )}
          {(data.older || data.newer) && (
            <nav className="mt-10 grid gap-4 sm:grid-cols-2" aria-label="More posts">
              {data.newer ? (
                <a href={`/s/${slug}/blog/${data.newer.slug}`} className="rounded-xl border border-black/10 p-4 hover:shadow-md">
                  <div className="text-xs opacity-60">← Newer</div><div className="mt-1 font-medium">{data.newer.title}</div>
                </a>
              ) : <span />}
              {data.older && (
                <a href={`/s/${slug}/blog/${data.older.slug}`} className="rounded-xl border border-black/10 p-4 text-right hover:shadow-md">
                  <div className="text-xs opacity-60">Older →</div><div className="mt-1 font-medium">{data.older.title}</div>
                </a>
              )}
            </nav>
          )}
        </article>
      </main>
    </BlogFrame>
  );
}
