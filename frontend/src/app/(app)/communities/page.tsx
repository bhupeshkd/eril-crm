'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, Modal, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface CommunityRow {
  id: string;
  name: string;
  description: string;
  joinMode: 'invite' | 'open';
  isActive: boolean;
  members: number;
  activeWeek: number;
  posts: number;
  postsWeek: number;
}

export default function CommunitiesPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [list, setList] = useState<CommunityRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Members community');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CommunityRow[]>('/communities').then(setList).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await api<{ id: string }>('/communities', { method: 'POST', body: { name } });
      router.push(`/communities/${c.id}`);
    } catch (err) {
      toast(errorText(err), 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Communities"
        subtitle="Private discussion spaces for your customers and students"
        actions={can('courses:write') && <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New community</button>}
      />
      {!list ? <PageLoader /> : list.length === 0 ? (
        <EmptyState title="No communities yet">Create a space where members can post, comment and get announcements. Members sign in with a private link; no passwords.</EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const state = !c.isActive ? ['Closed', 'lock', 'bg-slate-100 text-slate-600 ring-slate-500/10'] : c.joinMode === 'open' ? ['Open', 'sites', 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'] : ['Invite only', 'lock', 'bg-violet-50 text-violet-700 ring-violet-600/15'];
            return (
              <Link key={c.id} href={`/communities/${c.id}`} className="card card-hover group flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-semibold text-white shadow-sm shadow-brand-600/20">
                    {c.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{c.name}</h2>
                    <span className={`badge mt-1 ${state[2]}`}><Icon name={state[1]} className="h-3 w-3" />{state[0]}</span>
                  </div>
                </div>
                {c.description && <p className="mt-3 line-clamp-2 text-[13px] text-slate-500">{c.description}</p>}
                <dl className="mt-auto grid grid-cols-2 gap-2 pt-4">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">Members</dt>
                    <dd className="flex items-baseline gap-1.5"><span className="text-lg font-semibold tabular-nums">{c.members}</span><span className="text-[11px] text-emerald-600">{c.activeWeek} active 7d</span></dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">Posts</dt>
                    <dd className="flex items-baseline gap-1.5"><span className="text-lg font-semibold tabular-nums">{c.posts}</span><span className="text-[11px] text-emerald-600">+{c.postsWeek} this week</span></dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
      <Modal open={creating} title="New community" onClose={() => setCreating(false)}>
        <form onSubmit={create} className="space-y-5">
          <div>
            <label className="label" htmlFor="community-name">Name</label>
            <input id="community-name" required className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1.5 text-xs text-slate-500">You can add a description, channels and members next.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create community'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
