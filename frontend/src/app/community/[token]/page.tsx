'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { ChannelList, CommunityFeed, Leaderboard, type Channel } from '@/components/community-feed';
import { Spinner, errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PoweredBy, PublicLoading } from '@/components/public-shell';
import { usePublicBranding } from '@/lib/branding';

interface Portal {
  community: { name: string; description: string; members: number; digestFrequency: 'off' | 'daily' | 'weekly' };
  channels: Channel[];
  me: {
    id: string;
    displayName: string;
    role: 'member' | 'moderator';
    digest: 'community' | 'off' | 'daily' | 'weekly';
    mentionEmails: boolean;
    unreadMentions: number;
  };
}
interface MentionRow {
  id: string;
  postId: string;
  inComment: boolean;
  excerpt: string;
  createdAt: string;
  unread: boolean;
  author: { name: string; badge: 'Team' | 'Moderator' | null };
}

export default function CommunityPortalPage() {
  return (
    <Suspense fallback={<PublicLoading />}>
      <CommunityPortal />
    </Suspense>
  );
}

function CommunityPortal() {
  const { token } = useParams<{ token: string }>();
  const brand = usePublicBranding('community', token);
  const params = useSearchParams();
  // Opened from an email footer ("change or stop emails") or a mention email (?post=).
  const fromEmail = params.get('digest') === 'settings';
  const [postId, setPostId] = useState<string | null>(params.get('post'));
  const [view, setView] = useState<'feed' | 'mentions'>('feed');
  const [saved, setSaved] = useState('');
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    api<Portal>(`/public/community/${token}`, { auth: false })
      .then((d) => {
        setData(d);
        setName(d.me.displayName);
      })
      .catch((e) => setError(errorText(e)));
  }, [token]);

  const client = useMemo(
    () => ({ base: `/public/community/${token}`, auth: false, moderator: data?.me.role === 'moderator', canPostStaffOnly: data?.me.role === 'moderator' }),
    [token, data?.me.role],
  );

  const saveMe = useCallback(
    async (patch: Partial<Portal['me']>, msg: string) => {
      if (!data) return;
      try {
        await api(`/public/community/${token}/me`, { method: 'PUT', auth: false, body: patch });
        setData({ ...data, me: { ...data.me, ...patch } });
        setSaved(msg);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [data, token],
  );

  // Keep the address bar in step with the single-post view so it can be shared with yourself / reloaded.
  const openPost = (id: string | null) => {
    setPostId(id);
    setView('feed');
    history.replaceState(null, '', id ? `?post=${id}` : location.pathname);
  };

  if (!data) return <PublicLoading error={error} brand={{ kind: 'community', key: token }} />;

  return (
    <main className="min-h-screen bg-[#f6f7f9]">
      <header className="relative overflow-hidden border-b border-slate-200/80 bg-white">
        <div aria-hidden className="absolute inset-x-0 top-0 h-full bg-gradient-to-r from-brand-50 via-brand-50/60 to-white" />
        <div className="relative mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-semibold text-white shadow-md shadow-brand-600/25">{data.community.name.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">{data.community.name}</h1>
              <p className="flex items-center gap-1.5 truncate text-sm text-slate-500"><Icon name="communities" className="h-3.5 w-3.5 shrink-0" />{data.community.members} member{data.community.members === 1 ? '' : 's'}{data.community.description ? ` · ${data.community.description}` : ''}</p>
            </div>
          </div>
          <div className="text-sm">
            {editingName ? (
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const r = await api<{ displayName: string }>(`/public/community/${token}/me`, { method: 'PUT', auth: false, body: { displayName: name } });
                    setData({ ...data, me: { ...data.me, displayName: r.displayName } });
                    setEditingName(false);
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              >
                <label className="sr-only" htmlFor="me-name">Display name</label>
                <input id="me-name" className="input h-9" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn-primary">Save</button>
              </form>
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 text-slate-600 shadow-sm ring-1 ring-slate-200">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">{data.me.displayName.trim().charAt(0).toUpperCase()}</span>
                <strong className="font-medium text-slate-800">{data.me.displayName}</strong>
                {data.me.role === 'moderator' && <span className="badge bg-violet-50 text-violet-700 ring-violet-600/15">Moderator</span>}
                <button className="text-slate-400 hover:text-brand-600" aria-label="Change display name" title="Change name" onClick={() => setEditingName(true)}><Icon name="pencil" className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto mt-4 max-w-5xl px-4">
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl px-4 py-2.5 text-sm ${fromEmail ? 'border border-brand-300 bg-brand-50 ring-4 ring-brand-500/10' : 'card'}`}>
          <Icon name="bell" className="h-4 w-4 text-slate-400" />
          {data.community.digestFrequency !== 'off' && (
            <span className="flex items-center gap-2">
              <label htmlFor="me-digest" className="font-medium text-slate-700">Email digest</label>
              <select
                id="me-digest"
                className="input h-8 w-auto py-0 text-[13px]"
                autoFocus={fromEmail}
                value={data.me.digest}
                onChange={(e) => {
                  const digest = e.target.value as Portal['me']['digest'];
                  saveMe({ digest }, digest === 'off' ? 'Digest emails stopped.' : 'Saved.');
                }}
              >
                <option value="community">Community default ({data.community.digestFrequency})</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="off">Off — don’t email me</option>
              </select>
            </span>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={data.me.mentionEmails} onChange={(e) => saveMe({ mentionEmails: e.target.checked }, e.target.checked ? 'Mention emails on.' : 'Mention emails off.')} />
            Email me when someone @mentions me
          </label>
          {saved && <span role="status" className="ml-auto flex items-center gap-1 text-emerald-700"><Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />{saved}</span>}
        </div>
      </div>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          <button
            onClick={() => setView('mentions')}
            aria-current={view === 'mentions' ? 'page' : undefined}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition ${view === 'mentions' ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-600 hover:bg-white'}`}
          >
            <span className="flex items-center gap-2"><span className="font-semibold text-slate-400">@</span> Mentions</span>
            {data.me.unreadMentions > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{data.me.unreadMentions}</span>}
          </button>
          <ChannelList
            channels={data.channels}
            value={view === 'feed' && !postId ? channelId : '__none__'}
            onChange={(id) => {
              setChannelId(id);
              openPost(null);
            }}
          />
          <div className="mt-4 hidden md:block"><Leaderboard client={client} /></div>
        </div>
        <div className="min-w-0">
          {view === 'mentions' ? (
            <Mentions token={token} onOpen={openPost} onRead={() => setData({ ...data, me: { ...data.me, unreadMentions: 0 } })} />
          ) : (
            <>
              {postId && <button className="btn-ghost -ml-2 mb-3 h-8 px-2 text-[13px]" onClick={() => openPost(null)}><Icon name="arrowLeft" className="h-4 w-4" /> All posts</button>}
              {!postId && channelId && data.channels.find((c) => c.id === channelId)?.description && <p className="mb-3 text-sm text-slate-500">{data.channels.find((c) => c.id === channelId)!.description}</p>}
              <CommunityFeed client={client} channels={data.channels} channelId={postId ? null : channelId} postId={postId} />
            </>
          )}
        </div>
      </div>
      <div className="pb-8">
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400"><Icon name="lock" className="h-3.5 w-3.5" />This is your personal link — please don’t share it.</p>
        <PoweredBy b={brand} />
      </div>
    </main>
  );
}

function Mentions({ token, onOpen, onRead }: { token: string; onOpen: (postId: string) => void; onRead: () => void }) {
  const [rows, setRows] = useState<MentionRow[] | null>(null);
  useEffect(() => {
    api<MentionRow[]>(`/public/community/${token}/mentions`, { auth: false })
      .then((r) => {
        setRows(r);
        if (r.some((x) => x.unread)) api(`/public/community/${token}/mentions/read`, { method: 'POST', auth: false }).then(onRead).catch(() => {});
      })
      .catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (!rows) return <div className="grid h-32 place-items-center"><Spinner /></div>;
  if (!rows.length) return <p className="card border-dashed p-10 text-center text-sm text-slate-500">No mentions yet. When someone types @ and your name, it shows up here.</p>;
  return (
    <ul className="card divide-y divide-slate-100 overflow-hidden">
      {rows.map((r) => (
        <li key={r.id}>
          <button className={`flex w-full gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 ${r.unread ? 'bg-brand-50/40' : ''}`} onClick={() => onOpen(r.postId)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">{r.author.name.trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">
                <strong className="font-medium">{r.author.name}</strong>{r.author.badge && <span className="badge ml-1 bg-slate-100 text-slate-600">{r.author.badge}</span>} <span className="text-slate-500">mentioned you {r.inComment ? 'in a comment' : 'in a post'}</span>
                {r.unread && <span className="badge ml-2 bg-brand-600 text-white ring-0">New</span>}
              </span>
              <span className="mt-0.5 block truncate text-sm text-slate-600">{r.excerpt}</span>
              <span className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
