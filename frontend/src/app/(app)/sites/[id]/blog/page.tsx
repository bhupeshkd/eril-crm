'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EditorBar, EmptyState, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

type PostState = 'draft' | 'scheduled' | 'published';
interface PostRow { id: string; title: string; slug: string; state: PostState; publishedAt: string | null; updatedAt: string; views: number; tags: string[]; readMinutes: number; authorName: string }

const STATE_STYLE: Record<PostState, string> = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
};

/** Sites → a site → Blog: the site's posts. */
export default function SiteBlogPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [site, setSite] = useState<{ name: string; slug: string; isPublished: boolean } | null>(null);
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | PostState>('all');
  const editable = can('websites:write');

  const load = useCallback(() => {
    Promise.all([api(`/sites/${id}`), api<PostRow[]>(`/sites/${id}/posts`)])
      .then(([s, p]) => { setSite(s); setPosts(p); })
      .catch((e) => toast(errorText(e), 'error'));
  }, [id, toast]);
  useEffect(load, [load]);

  async function create() {
    try {
      const p = await api<PostRow>(`/sites/${id}/posts`, { method: 'POST', body: { title: 'Untitled post' } });
      router.push(`/sites/${id}/blog/${p.id}`);
    } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!site || !posts) return <PageLoader />;
  const shown = filter === 'all' ? posts : posts.filter((p) => p.state === filter);
  const count = (s: PostState) => posts.filter((p) => p.state === s).length;

  return (
    <div>
      <EditorBar
        back={{ href: `/sites/${id}`, label: site.name }}
        title={<h1 className="text-lg font-semibold">Blog</h1>}
        actions={
          <>
            {site.isPublished && <a className="btn-secondary" href={`/s/${site.slug}/blog`} target="_blank" rel="noreferrer"><Icon name="external" /> View blog</a>}
            {editable && <button className="btn-primary" onClick={create}><Icon name="plus" /> New post</button>}
          </>
        }
      />
      {!site.isPublished && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">This site isn&apos;t published yet, so its blog isn&apos;t public. Publish the site to share posts.</p>}
      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
        {([['all', 'All', posts.length], ['published', 'Published', count('published')], ['scheduled', 'Scheduled', count('scheduled')], ['draft', 'Drafts', count('draft')]] as const).map(([v, l, n]) => (
          <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${filter === v ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {l} <span className="ml-1 text-slate-400">{n}</span>
          </button>
        ))}
      </div>
      {posts.length === 0 ? (
        <div className="card"><EmptyState title="No posts yet">Write articles, news and guides. Published posts appear at /blog on this site, with tags and an RSS feed.</EmptyState></div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {shown.map((p) => (
            <Link key={p.id} href={`/sites/${id}/blog/${p.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-slate-50/70">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.title}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  /blog/{p.slug} · {p.readMinutes} min read{p.tags.length ? ` · ${p.tags.map((t) => `#${t}`).join(' ')}` : ''}
                </div>
              </div>
              <span className={`badge capitalize ${STATE_STYLE[p.state]}`}>{p.state}</span>
              <span className="w-36 text-right text-xs text-slate-500">
                {p.state === 'draft' ? `Edited ${new Date(p.updatedAt).toLocaleDateString()}` : `${p.state === 'scheduled' ? 'Goes live' : 'Published'} ${new Date(p.publishedAt!).toLocaleDateString()}`}
              </span>
              <span className="w-16 text-right text-xs tabular-nums text-slate-500" title="Views"><Icon name="eye" className="mr-1 inline h-3.5 w-3.5" />{p.views}</span>
            </Link>
          ))}
          {shown.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing here.</p>}
        </div>
      )}
    </div>
  );
}
