'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, Modal, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

type Account = { id: string; platform: 'facebook' | 'instagram'; name: string };
type Target = { pageId: string; platform: 'facebook' | 'instagram'; name: string; status: 'pending' | 'published' | 'failed'; error: string | null; publishedAt: string | null };
type PostT = { id: string; body: string; link: string | null; imageUrl: string | null; targets: Target[]; status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed'; scheduledAt: string | null; publishedAt: string | null; updatedAt: string };

const STATUS: Record<PostT['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-sky-50 text-sky-700',
  publishing: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
};
const PLATFORM = { facebook: 'bg-blue-50 text-blue-700', instagram: 'bg-pink-50 text-pink-700' };
const dayKey = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

/** Social planner: compose, schedule and track posts to connected Facebook Pages and Instagram accounts. */
export default function SocialPage() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('campaigns:write');
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [posts, setPosts] = useState<PostT[] | null>(null);
  const [editing, setEditing] = useState<PostT | 'new' | null>(null);

  const load = useCallback(() => {
    Promise.all([api<Account[]>('/social/accounts'), api<PostT[]>('/social/posts')])
      .then(([a, p]) => { setAccounts(a); setPosts(p); })
      .catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);
  // Refresh while something is waiting to go out.
  useEffect(() => {
    if (!posts?.some((p) => p.status === 'scheduled' || p.status === 'publishing')) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [posts, load]);

  async function remove(p: PostT) {
    if (!confirm(p.status === 'published' || p.status === 'partial' ? 'Remove this post from the planner? It stays on Facebook/Instagram.' : 'Delete this post?')) return;
    try { await api(`/social/posts/${p.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(errorText(e), 'error'); }
  }
  async function publishNow(p: PostT) {
    try { const r = await api<PostT>(`/social/posts/${p.id}/publish`, { method: 'POST' }); toast(r.status === 'published' ? 'Published' : `Finished: ${r.status}`, r.status === 'published' ? 'ok' : 'error'); load(); } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!accounts || !posts) return <PageLoader />;
  const drafts = posts.filter((p) => p.status === 'draft');
  const upcoming = posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
  const past = posts.filter((p) => ['published', 'partial', 'failed'].includes(p.status)).reverse();
  const groups = (list: PostT[]) => list.reduce<Record<string, PostT[]>>((acc, p) => { const k = dayKey(p.scheduledAt ?? p.updatedAt); (acc[k] ??= []).push(p); return acc; }, {});

  const Card = ({ p }: { p: PostT }) => (
    <div className="card flex gap-4 p-4">
      {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><Icon name="file" className="h-6 w-6" /></div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`badge capitalize ${STATUS[p.status]}`}>{p.status === 'partial' ? 'partly published' : p.status}</span>
          {p.scheduledAt && p.status === 'scheduled' && <span className="text-xs text-slate-500">{new Date(p.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          {p.targets.map((t) => (
            <span key={t.pageId} className={`badge ${PLATFORM[t.platform]}`} title={t.error ?? undefined}>
              {t.name}{t.status === 'published' ? ' ✓' : t.status === 'failed' ? ' ✕' : ''}
            </span>
          ))}
        </div>
        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-slate-800">{p.body || <span className="text-slate-400">(image only)</span>}</p>
        {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand-700 hover:underline">{p.link}</a>}
        {p.targets.filter((t) => t.status === 'failed' && t.error).map((t) => <p key={t.pageId} className="mt-1 text-xs text-rose-600">{t.name}: {t.error}</p>)}
      </div>
      {editable && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {(p.status === 'draft' || p.status === 'scheduled') && <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setEditing(p)}>Edit</button>}
          {(p.status === 'draft' || p.status === 'scheduled') && <button className="btn-ghost h-8 px-2 text-xs" onClick={() => publishNow(p)}><Icon name="send" className="h-3.5 w-3.5" /> Post now</button>}
          {p.status !== 'publishing' && <button className="btn-ghost h-8 px-2 text-xs text-rose-600" onClick={() => remove(p)}>Delete</button>}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Social planner" subtitle="Plan posts for your Facebook Pages and Instagram accounts" actions={editable && accounts.length > 0 && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> New post</button>} />
      {accounts.length === 0 ? (
        <div className="card"><EmptyState title="Connect a page first">Connect a Facebook Page or Instagram account in <Link href="/settings#meta" className="text-brand-700 underline">Settings → Facebook &amp; Instagram</Link> to start posting.</EmptyState></div>
      ) : posts.length === 0 ? (
        <div className="card"><EmptyState title="Nothing planned yet">Write a post, pick where it goes and when — it publishes automatically.</EmptyState></div>
      ) : (
        <div className="space-y-8">
          {drafts.length > 0 && <section><h2 className="mb-2 text-sm font-semibold text-slate-500">Drafts</h2><div className="space-y-2">{drafts.map((p) => <Card key={p.id} p={p} />)}</div></section>}
          {upcoming.length > 0 && <section><h2 className="mb-2 text-sm font-semibold text-slate-500">Scheduled</h2>{Object.entries(groups(upcoming)).map(([day, list]) => <div key={day} className="mb-4"><div className="mb-1.5 text-xs font-medium text-slate-400">{day}</div><div className="space-y-2">{list.map((p) => <Card key={p.id} p={p} />)}</div></div>)}</section>}
          {past.length > 0 && <section><h2 className="mb-2 text-sm font-semibold text-slate-500">Published</h2><div className="space-y-2">{past.map((p) => <Card key={p.id} p={p} />)}</div></section>}
        </div>
      )}
      {editing && <Composer accounts={accounts} post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); load(); }} />}
    </div>
  );
}

function Composer({ accounts, post, onClose, onSaved }: { accounts: Account[]; post: PostT | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ body: post?.body ?? '', link: post?.link ?? '', imageUrl: post?.imageUrl ?? '', pageIds: post?.targets.map((t) => t.pageId) ?? accounts.map((a) => a.id), when: toLocalInput(post?.scheduledAt ?? null) });
  const [busy, setBusy] = useState(false);
  const chosen = accounts.filter((a) => f.pageIds.includes(a.id));
  const igChosen = chosen.some((a) => a.platform === 'instagram');
  const toggle = (id: string) => setF({ ...f, pageIds: f.pageIds.includes(id) ? f.pageIds.filter((x) => x !== id) : [...f.pageIds, id] });

  async function save(mode: 'draft' | 'schedule' | 'now') {
    setBusy(true);
    try {
      const body = {
        body: f.body, link: f.link.trim() || null, imageUrl: f.imageUrl.trim() || null, pageIds: f.pageIds,
        ...(mode === 'now' ? { publishNow: true } : { scheduledAt: mode === 'schedule' && f.when ? new Date(f.when).toISOString() : null }),
      };
      const r = await api<PostT>(post ? `/social/posts/${post.id}` : '/social/posts', { method: post ? 'PUT' : 'POST', body });
      onSaved(mode === 'now' ? (r.status === 'published' ? 'Published' : `Finished: ${r.status}`) : mode === 'schedule' ? 'Post scheduled' : 'Draft saved');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open wide title={post ? 'Edit post' : 'New post'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="label">Post to</span>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${f.pageIds.includes(a.id) ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200'}`}>
                <input type="checkbox" checked={f.pageIds.includes(a.id)} onChange={() => toggle(a.id)} />
                <span className={`badge ${PLATFORM[a.platform]}`}>{a.platform === 'facebook' ? 'Facebook' : 'Instagram'}</span> {a.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="sp-body">Text</label>
          <textarea id="sp-body" rows={5} className="input" placeholder="What's new?" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <p className={`mt-1 text-right text-xs ${igChosen && f.body.length > 2200 ? 'text-rose-600' : 'text-slate-400'}`}>{f.body.length.toLocaleString()}{igChosen ? ' / 2,200 for Instagram' : ''}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="sp-img">Image link {igChosen && <span className="text-rose-600">(required for Instagram)</span>}</label><input id="sp-img" type="url" className="input" placeholder="https://…/photo.jpg" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} /></div>
          <div><label className="label" htmlFor="sp-link">Link</label><input id="sp-link" type="url" className="input" placeholder="https://yourbusiness.com/offer" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></div>
        </div>
        {f.imageUrl && /^https:\/\//.test(f.imageUrl) && <img src={f.imageUrl} alt="Preview" className="max-h-48 rounded-lg border border-slate-200 object-contain" />}
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-4">
          <div><label className="label" htmlFor="sp-when">Schedule for</label><input id="sp-when" type="datetime-local" className="input" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => save('draft')}>Save draft</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => save('now')}><Icon name="send" className="h-4 w-4" /> Post now</button>
            <button type="button" className="btn-primary" disabled={busy || !f.when} onClick={() => save('schedule')}><Icon name="clock" className="h-4 w-4" /> Schedule</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
