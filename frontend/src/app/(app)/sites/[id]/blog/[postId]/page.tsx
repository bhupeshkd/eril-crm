'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Markdown } from '@/lib/markdown';
import { EditorBar, PageLoader, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Post {
  id: string; title: string; slug: string; excerpt: string; body: string; coverImageUrl: string; authorName: string; tags: string[];
  status: 'draft' | 'published'; publishedAt: string | null; seoTitle: string; seoDescription: string; state: 'draft' | 'scheduled' | 'published'; views: number;
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Post editor: Markdown with a live preview, publishing/scheduling, tags and SEO. */
export default function PostEditor() {
  const { id, postId } = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can, me } = useAuth();
  const editable = can('websites:write');
  const [site, setSite] = useState<{ name: string; slug: string; isPublished: boolean; theme: { primaryColor?: string } } | null>(null);
  const [saved, setSaved] = useState<Post | null>(null);
  const [p, setP] = useState<Post | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    Promise.all([api(`/sites/${id}`), api<Post>(`/sites/${id}/posts/${postId}`)])
      .then(([s, post]) => {
        setSite(s);
        const withAuthor = { ...post, authorName: post.authorName || '' };
        setSaved(withAuthor);
        setP(withAuthor);
      })
      .catch((e) => toast(errorText(e), 'error'));
  }, [id, postId, toast]);

  if (!site || !p || !saved) return <PageLoader />;
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const set = (patch: Partial<Post>) => setP({ ...p, ...patch });

  async function save(extra: Partial<Post> = {}, msg = 'Post saved') {
    setBusy(true);
    try {
      const body = { ...p!, ...extra };
      const next = await api<Post>(`/sites/${id}/posts/${postId}`, {
        method: 'PUT',
        body: {
          title: body.title, slug: body.slug, excerpt: body.excerpt, body: body.body, coverImageUrl: body.coverImageUrl, authorName: body.authorName,
          tags: body.tags, status: body.status, publishedAt: body.publishedAt, seoTitle: body.seoTitle, seoDescription: body.seoDescription,
        },
      });
      setSaved(next);
      setP(next);
      toast(msg);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${p!.title}"? This can't be undone.`)) return;
    try {
      await api(`/sites/${id}/posts/${postId}`, { method: 'DELETE' });
      toast('Post deleted');
      router.push(`/sites/${id}/blog`);
    } catch (e) { toast(errorText(e), 'error'); }
  }

  /** Wraps the selection in the textarea with Markdown syntax. */
  function wrap(before: string, after = before, placeholder = 'text') {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    set({ body: next });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + sel.length); });
  }
  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (t && !p.tags.includes(t) && p.tags.length < 10) set({ tags: [...p.tags, t] });
    setTagDraft('');
  };
  const scheduled = p.publishedAt && new Date(p.publishedAt) > new Date();
  const liveUrl = `/s/${site.slug}/blog/${saved.slug}`;

  return (
    <div>
      <EditorBar
        back={{ href: `/sites/${id}/blog`, label: `${site.name} · Blog` }}
        title={<TitleInput label="Post title" value={p.title} disabled={!editable} onChange={(title) => set({ title })} />}
        status={<span className={`badge capitalize ${saved.state === 'published' ? 'bg-emerald-50 text-emerald-700' : saved.state === 'scheduled' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{saved.state}</span>}
        dirty={dirty}
        actions={
          <>
            {saved.state === 'published' && site.isPublished && <a className="btn-secondary" href={liveUrl} target="_blank" rel="noreferrer"><Icon name="external" /> View</a>}
            {editable && saved.status === 'published' && <button className="btn-secondary" disabled={busy} onClick={() => save({ status: 'draft' }, 'Moved back to drafts')}>Unpublish</button>}
            {editable && saved.status === 'draft' && (
              <button className="btn-secondary" disabled={busy} onClick={() => save({ status: 'published' }, scheduled ? 'Post scheduled' : 'Post published')}>{scheduled ? 'Schedule' : 'Publish'}</button>
            )}
            {editable && <button className="btn-primary" disabled={busy || !dirty} onClick={() => save()}>Save</button>}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <section className="card flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2">
            <div className="mr-2 flex gap-1 rounded-lg bg-slate-100 p-0.5" role="tablist">
              {(['write', 'preview'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${view === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{v}</button>
              ))}
            </div>
            {view === 'write' && editable && (
              <>
                {([['H2', () => wrap('\n## ', '\n', 'Heading')], ['B', () => wrap('**')], ['I', () => wrap('*')], ['Link', () => wrap('[', '](https://)', 'link text')], ['Image', () => wrap('![', '](https://)', 'alt text')], ['• List', () => wrap('\n- ', '\n', 'item')], ['Quote', () => wrap('\n> ', '\n', 'quote')], ['Code', () => wrap('`')]] as const).map(([l, fn]) => (
                  <button key={l} type="button" onClick={fn} className="rounded px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">{l}</button>
                ))}
              </>
            )}
          </div>
          {view === 'write' ? (
            <textarea
              ref={bodyRef}
              aria-label="Post body (Markdown)"
              disabled={!editable}
              value={p.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder={'Write your post in Markdown.\n\n## A heading\nSome **bold** text, a [link](https://example.com) and a list:\n- one\n- two'}
              className="min-h-[60vh] flex-1 resize-y border-0 p-5 font-mono text-[13.5px] leading-relaxed outline-none"
            />
          ) : (
            <div className="min-h-[60vh] overflow-auto p-6" style={{ ['--accent' as string]: site.theme.primaryColor || '#2953e0' }}>
              <h1 className="text-3xl font-bold">{p.title}</h1>
              {p.coverImageUrl && /^https:\/\//.test(p.coverImageUrl) && <img src={p.coverImageUrl} alt="" className="mt-5 w-full rounded-xl object-cover" />}
              <Markdown source={p.body || '_Nothing written yet._'} className="mt-4 text-[16px] [&_a]:text-[color:var(--accent)]" />
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold">Publishing</h2>
            <div>
              <label className="label" htmlFor="pe-date">Publish date</label>
              <input id="pe-date" type="datetime-local" className="input" disabled={!editable} value={toLocalInput(p.publishedAt)} onChange={(e) => set({ publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              <p className="mt-1 text-xs text-slate-500">{scheduled ? 'In the future: the post goes live then.' : 'Empty = when you publish.'}</p>
            </div>
            <div>
              <label className="label" htmlFor="pe-author">Author</label>
              <input id="pe-author" maxLength={120} className="input" disabled={!editable} placeholder={me?.name ?? ''} value={p.authorName} onChange={(e) => set({ authorName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="pe-slug">URL</label>
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 pl-2 text-xs text-slate-500">
                /blog/<input id="pe-slug" maxLength={100} disabled={!editable} className="input rounded-l-none border-0 bg-white py-1.5" value={p.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="pe-cover">Cover image</label>
              <input id="pe-cover" type="url" className="input" disabled={!editable} placeholder="https://…" value={p.coverImageUrl} onChange={(e) => set({ coverImageUrl: e.target.value.trim() })} />
            </div>
            <div>
              <span className="label">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t} className="badge bg-brand-50 text-brand-700">#{t}{editable && <button type="button" aria-label={`Remove ${t}`} className="ml-1 opacity-60 hover:opacity-100" onClick={() => set({ tags: p.tags.filter((x) => x !== t) })}>✕</button>}</span>
                ))}
              </div>
              {editable && p.tags.length < 10 && (
                <input aria-label="Add tag" maxLength={40} className="input mt-2 py-1.5" placeholder="Add a tag and press Enter" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} />
              )}
            </div>
          </section>
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold">Summary &amp; SEO</h2>
            <div>
              <label className="label" htmlFor="pe-excerpt">Excerpt</label>
              <textarea id="pe-excerpt" rows={3} maxLength={300} className="input" disabled={!editable} placeholder="Shown on the blog page. Leave empty to use the start of the post." value={p.excerpt} onChange={(e) => set({ excerpt: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="pe-seot">Search title</label>
              <input id="pe-seot" maxLength={200} className="input" disabled={!editable} placeholder={p.title} value={p.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="pe-seod">Search description</label>
              <textarea id="pe-seod" rows={2} maxLength={300} className="input" disabled={!editable} value={p.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
            </div>
          </section>
          {editable && <button className="btn-ghost w-full justify-center text-rose-600" onClick={remove}><Icon name="trash" /> Delete post</button>}
          <p className="text-center text-xs text-slate-400">{saved.views} views</p>
        </aside>
      </div>
    </div>
  );
}
