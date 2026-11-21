'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner, errorText } from './ui';
import { Icon } from './icons';
import { MentionInput, MentionText, mentionIds, type MentionPick } from './mention-input';

type Mention = { name: string; isMe?: boolean };

export interface Channel {
  id: string;
  name: string;
  description: string;
  staffOnly: boolean;
}
interface Author {
  name: string;
  badge: 'Team' | 'Moderator' | null;
  contactId?: string | null;
  /** Members' level from likes received (1–9); null for the team. */
  level?: number | null;
}
export interface PostFile { id: string; name: string; size: number; mime: string; url: string }
interface Post {
  id: string;
  channelId: string;
  body: string;
  pinned: boolean;
  hidden?: boolean;
  createdAt: string;
  author: Author;
  likeCount: number;
  liked: boolean;
  commentCount: number;
  canDelete: boolean;
  mentions?: Mention[];
  images?: Array<{ id: string; url: string }>;
  files?: PostFile[];
}
interface Comment {
  id: string;
  body: string;
  createdAt: string;
  hidden?: boolean;
  author: Author;
  canDelete: boolean;
  mentions?: Mention[];
}

/** Base path + auth for either the staff API (/communities/:id) or a member's portal (/public/community/:token). */
export interface FeedClient {
  base: string;
  auth: boolean;
  /** Staff and moderators: pin/hide controls, hidden content visible. */
  moderator: boolean;
  /** Can start posts in staff-only channels. */
  canPostStaffOnly: boolean;
}

const MAX_IMAGES = 4;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
const MAX_FILES = 3;
const FILE_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.zip,.txt,.csv,.md';

export const fileSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fileIcon = (name: string) => (name.split('.').pop() ?? '').toUpperCase().slice(0, 4);

/** Attachments under a post: name, size and type; always downloaded. */
function PostFiles({ files }: { files: PostFile[] }) {
  return (
    <ul className="mt-2 space-y-1.5" aria-label="Attachments">
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url} download={f.name} className="flex max-w-md items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-brand-300 hover:bg-brand-50/40">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-600">{fileIcon(f.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-800">{f.name}</span>
              <span className="text-xs text-slate-500">{fileSize(f.size)}</span>
            </span>
            <Icon name="arrowUpRight" className="h-4 w-4 rotate-90 text-slate-400" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "Lv 3" chip next to a member's name. */
export function LevelBadge({ level }: { level?: number | null }) {
  if (!level) return null;
  return <span title={`Level ${level}`} className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">Lv {level}</span>;
}

/** 1 image: shown large. 2-4: a square grid. Click opens the full image. */
function PostImages({ images, author }: { images: Array<{ id: string; url: string }>; author: string }) {
  const one = images.length === 1;
  return (
    <div className={`mt-2 grid gap-1.5 ${one ? '' : 'grid-cols-2'}`}>
      {images.map((im, i) => (
        <a key={im.id} href={im.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md bg-slate-100">
          <img
            src={im.url}
            alt={`Image ${i + 1} of ${images.length} posted by ${author}`}
            loading="lazy"
            className={one ? 'max-h-[28rem] w-full object-contain' : 'aspect-square w-full object-cover'}
          />
        </a>
      ))}
    </div>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function Badge({ badge }: { badge: Author['badge'] }) {
  if (!badge) return null;
  return <span className={`badge ${badge === 'Team' ? 'bg-brand-600 text-white' : 'bg-violet-50 text-violet-700 ring-violet-600/15'}`}>{badge}</span>;
}

function Avatar({ name }: { name: string }) {
  return <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">{(name.trim()[0] ?? '?').toUpperCase()}</span>;
}

export function CommunityFeed({
  client,
  channels,
  channelId,
  contactHref,
  postId,
}: {
  client: FeedClient;
  channels: Channel[];
  channelId: string | null;
  contactHref?: (id: string) => string;
  /** Show just this post (deep link from a mention), with its comments open. */
  postId?: string | null;
}) {
  const call = useCallback(<T,>(path: string, method = 'GET', body?: any) => api<T>(`${client.base}/${path}`, { method, body, auth: client.auth }), [client.base, client.auth]);
  const search = useCallback((q: string) => call<MentionPick[]>(`mention-search?q=${encodeURIComponent(q)}`), [call]);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<MentionPick[]>([]);
  const [uploads, setUploads] = useState<Array<{ id: string; url: string; name: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; size: number }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const postTo = channel ?? channels.find((c) => !c.staffOnly || client.canPostStaffOnly) ?? null;
  const canPost = !!postTo && (!postTo.staffOnly || client.canPostStaffOnly);

  const load = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams();
      if (channelId) q.set('channelId', channelId);
      if (postId) q.set('postId', postId);
      if (before) q.set('before', before);
      const r = await call<{ posts: Post[]; nextBefore: string | null }>(`posts?${q}`);
      setPosts((prev) => (before ? [...(prev ?? []), ...r.posts] : r.posts));
      setNext(r.nextBefore);
    },
    [call, channelId, postId],
  );
  useEffect(() => {
    setPosts(null);
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!postTo) return;
    setBusy(true);
    setError('');
    try {
      const p = await call<Post>('posts', 'POST', { channelId: postTo.id, body: draft, mentions: mentionIds(draft, picked), imageIds: uploads.map((u) => u.id), fileIds: attachments.map((f) => f.id) });
      setDraft('');
      setPicked([]);
      setUploads([]);
      setAttachments([]);
      setPosts((prev) => [p, ...(prev ?? [])]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const room = MAX_IMAGES - uploads.length;
    const list = [...files].slice(0, room);
    if (files.length > room) setError(`You can add up to ${MAX_IMAGES} images to a post.`);
    for (const f of list) {
      if (!ACCEPT.split(',').includes(f.type)) {
        setError(`${f.name}: only JPEG, PNG, GIF or WebP images.`);
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        setError(`${f.name} is over 5 MB.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await call<{ id: string; url: string }>('images', 'POST', fd);
        setUploads((u) => [...u, { ...r, name: f.name }]);
      } catch (e) {
        setError(`${f.name}: ${errorText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function addAttachments(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const room = MAX_FILES - attachments.length;
    if (files.length > room) setError(`You can attach up to ${MAX_FILES} files to a post.`);
    for (const f of [...files].slice(0, room)) {
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} is over 10 MB.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await call<{ id: string; name: string; size: number }>('files', 'POST', fd);
        setAttachments((a) => [...a, { id: r.id, name: r.name, size: r.size }]);
      } catch (e) {
        setError(`${f.name}: ${errorText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const patch = (id: string, p: Partial<Post>) => setPosts((prev) => prev?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? null);

  return (
    <div className="space-y-4">
      {postId ? null : canPost ? (
        <form onSubmit={submit} className="card p-4">
          <label className="sr-only" htmlFor="cf-draft">New post</label>
          <MentionInput multiline id="cf-draft" rows={3} maxLength={5000} placeholder={`Share something in #${postTo!.name}… Type @ to mention someone`} value={draft} onChange={setDraft} picked={picked} onPicked={setPicked} search={search} />
          {(uploads.length > 0 || uploading > 0) && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Images to post">
              {uploads.map((u) => (
                <li key={u.id} className="relative">
                  <img src={u.url} alt={`Attached: ${u.name}`} className="h-20 w-20 rounded-md border border-slate-200 object-cover" />
                  <button type="button" aria-label={`Remove ${u.name}`} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-xs text-white" onClick={() => setUploads(uploads.filter((x) => x.id !== u.id))}>✕</button>
                </li>
              ))}
              {uploading > 0 && <li className="grid h-20 w-20 place-items-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">Uploading…</li>}
            </ul>
          )}
          {attachments.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Files to post">
              {attachments.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-xs">
                  <span className="max-w-[12rem] truncate font-medium">{f.name}</span>
                  <span className="text-slate-400">{fileSize(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} className="grid h-5 w-5 place-items-center rounded text-slate-500 hover:bg-slate-200" onClick={() => setAttachments(attachments.filter((x) => x.id !== f.id))}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-3 text-xs text-slate-400">
              <label className={`cursor-pointer rounded px-2 py-1 text-slate-600 hover:bg-slate-100 ${uploads.length >= MAX_IMAGES ? 'pointer-events-none opacity-40' : ''}`}>
                <Icon name="image" className="h-4 w-4" /> Add photos
                <input type="file" className="sr-only" accept={ACCEPT} multiple disabled={uploads.length >= MAX_IMAGES} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <label className={`cursor-pointer rounded px-2 py-1 text-slate-600 hover:bg-slate-100 ${attachments.length >= MAX_FILES ? 'pointer-events-none opacity-40' : ''}`}>
                <Icon name="file" className="h-4 w-4" /> Attach file
                <input type="file" className="sr-only" accept={FILE_ACCEPT} multiple disabled={attachments.length >= MAX_FILES} onChange={(e) => { addAttachments(e.target.files); e.target.value = ''; }} />
              </label>
              {!channel && `Posting to #${postTo!.name}`}
            </span>
            <button className="btn-primary py-1.5" disabled={busy || uploading > 0 || (!draft.trim() && !uploads.length && !attachments.length)}>{busy ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      ) : channel?.staffOnly ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">Only the team posts in #{channel.name}. You can like and comment.</p>
      ) : null}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {!posts ? <div className="grid h-32 place-items-center"><Spinner /></div> : posts.length === 0 ? (
        <p className="card border-dashed p-10 text-center text-sm text-slate-500">{postId ? 'This post is no longer available.' : `No posts yet${channel ? ` in #${channel.name}` : ''}. Start the conversation!`}</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              channel={channels.find((c) => c.id === p.channelId)}
              showChannel={!channelId}
              client={client}
              call={call}
              contactHref={contactHref}
              onChange={(x) => patch(p.id, x)}
              onRemove={() => setPosts((prev) => prev?.filter((x) => x.id !== p.id) ?? null)}
              search={search}
              startOpen={!!postId}
            />
          ))}
        </ul>
      )}
      {next && <button className="btn-secondary w-full" onClick={() => load(next)}>Load older posts</button>}
    </div>
  );
}

function PostCard({
  post: p,
  channel,
  showChannel,
  client,
  call,
  contactHref,
  onChange,
  onRemove,
  search,
  startOpen,
}: {
  search: (q: string) => Promise<MentionPick[]>;
  startOpen?: boolean;
  post: Post;
  channel?: Channel;
  showChannel: boolean;
  client: FeedClient;
  call: <T>(path: string, method?: string, body?: any) => Promise<T>;
  contactHref?: (id: string) => string;
  onChange: (p: Partial<Post>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(!!startOpen);
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <li className={`card p-4 ${p.hidden ? 'border-dashed opacity-70' : ''} ${p.pinned ? 'border-amber-300' : ''}`}>
      <div className="flex items-start gap-3">
        <Avatar name={p.author.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {p.author.contactId && contactHref ? <a className="font-semibold hover:text-brand-600" href={contactHref(p.author.contactId)}>{p.author.name}</a> : <span className="font-semibold">{p.author.name}</span>}
            <LevelBadge level={p.author.level} />
            <Badge badge={p.author.badge} />
            <span className="text-xs text-slate-400">{when(p.createdAt)}{showChannel && channel ? ` · #${channel.name}` : ''}</span>
            {p.pinned && <span className="badge bg-amber-50 text-amber-700 ring-amber-600/20"><Icon name="pin" className="h-3 w-3" />Pinned</span>}
            {p.hidden && <span className="badge bg-slate-200 text-slate-700">Hidden from members</span>}
          </div>
          {p.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800"><MentionText text={p.body} mentions={p.mentions} /></p>}
          {!!p.images?.length && <PostImages images={p.images} author={p.author.name} />}
          {!!p.files?.length && <PostFiles files={p.files} />}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <button
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-slate-100 ${p.liked ? 'font-semibold text-rose-600' : ''}`}
              aria-pressed={p.liked}
              onClick={() => act(async () => onChange(await call<{ liked: boolean; likeCount: number }>(`posts/${p.id}/like`, 'POST')))}
            >
              <svg aria-hidden viewBox="0 0 24 24" fill={p.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg> {p.likeCount} {p.likeCount === 1 ? 'like' : 'likes'}
            </button>
            <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-slate-100" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="comment" className="h-3.5 w-3.5" /> {p.commentCount} {p.commentCount === 1 ? 'comment' : 'comments'}</button>
            {client.moderator && (
              <>
                <button className="rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => act(async () => onChange(await call(`posts/${p.id}`, 'PUT', { pinned: !p.pinned })))}>{p.pinned ? 'Unpin' : 'Pin'}</button>
                <button className="rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => act(async () => onChange(await call(`posts/${p.id}`, 'PUT', { hidden: !p.hidden })))}>{p.hidden ? 'Unhide' : 'Hide'}</button>
              </>
            )}
            {p.canDelete && (
              <button className="rounded px-1.5 py-0.5 text-rose-600 hover:bg-red-50" onClick={() => confirm('Delete this post?') && act(async () => { await call(`posts/${p.id}`, 'DELETE'); onRemove(); })}>Delete</button>
            )}
          </div>
          {error && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
          {open && <Comments postId={p.id} client={client} call={call} search={search} onCount={(n) => onChange({ commentCount: n })} />}
        </div>
      </div>
    </li>
  );
}

function Comments({
  postId,
  client,
  call,
  search,
  onCount,
}: {
  postId: string;
  client: FeedClient;
  call: <T>(path: string, method?: string, body?: any) => Promise<T>;
  search: (q: string) => Promise<MentionPick[]>;
  onCount: (n: number) => void;
}) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<MentionPick[]>([]);
  const [error, setError] = useState('');
  const visible = (l: Comment[]) => l.filter((c) => !c.hidden).length;
  useEffect(() => {
    call<Comment[]>(`posts/${postId}/comments`).then(setList).catch((e) => setError(errorText(e)));
  }, [call, postId]);
  const update = (l: Comment[]) => {
    setList(l);
    onCount(visible(l));
  };
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {!list ? <div className="grid h-16 place-items-center"><Spinner /></div> : list.map((c) => (
        <div key={c.id} className={`flex gap-2 text-sm ${c.hidden ? 'opacity-60' : ''}`}>
          <Avatar name={c.author.name} />
          <div className="min-w-0 flex-1 rounded-md bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">{c.author.name}</span>
              <LevelBadge level={c.author.level} />
              <Badge badge={c.author.badge} />
              <span className="text-slate-400">{when(c.createdAt)}</span>
              {c.hidden && <span className="badge bg-slate-200 text-slate-700">Hidden</span>}
              <span className="ml-auto flex gap-2">
                {client.moderator && <button className="text-slate-500 hover:underline" onClick={async () => { await call(`comments/${c.id}`, 'PUT', { hidden: !c.hidden }); update(list.map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x))); }}>{c.hidden ? 'Unhide' : 'Hide'}</button>}
                {c.canDelete && <button className="text-rose-600 hover:underline" onClick={async () => { if (!confirm('Delete this comment?')) return; await call(`comments/${c.id}`, 'DELETE'); update(list.filter((x) => x.id !== c.id)); }}>Delete</button>}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-slate-800"><MentionText text={c.body} mentions={c.mentions} /></p>
          </div>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            const c = await call<Comment>(`posts/${postId}/comments`, 'POST', { body: draft, mentions: mentionIds(draft, picked) });
            setDraft('');
            setPicked([]);
            update([...(list ?? []), c]);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <label className="sr-only" htmlFor={`cm-${postId}`}>Write a comment</label>
        <div className="flex-1"><MentionInput id={`cm-${postId}`} className="input py-1.5" maxLength={2000} placeholder="Write a comment… (@ to mention)" value={draft} onChange={setDraft} picked={picked} onPicked={setPicked} search={search} /></div>
        <button className="btn-secondary py-1.5" disabled={!draft.trim()}>Reply</button>
      </form>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/** Channel picker used by both the staff page and the member portal. */
export function ChannelList({ channels, value, onChange }: { channels: Channel[]; value: string | null; onChange: (id: string | null) => void }) {
  const item = (id: string | null, label: string, hint?: string) => (
    <li key={id ?? 'all'}>
      <button onClick={() => onChange(id)} aria-current={value === id ? 'page' : undefined} className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition ${value === id ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-600 hover:bg-white'}`}>
        {label}
        {hint && <span className="ml-auto rounded bg-slate-100 px-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{hint}</span>}
      </button>
    </li>
  );
  return (
    <nav aria-label="Channels">
      <ul className="space-y-0.5">
        {item(null, 'All posts')}
        {channels.map((c) => item(c.id, `# ${c.name}`, c.staffOnly ? 'team' : undefined))}
      </ul>
    </nav>
  );
}

type LeaderRow = { rank: number; name: string; points: number; level: number; isMe: boolean };
type Board = { period: '7d' | '30d' | 'all'; top: LeaderRow[]; me: null | { rank: number | null; points: number; level: number; nextLevelAt: number | null; toNext: number; percent: number } };

/** Points = likes received from others. Shows the top 10 for a period and, for members, their own level and rank. */
export function Leaderboard({ client }: { client: FeedClient }) {
  const [period, setPeriod] = useState<Board['period']>('30d');
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    setBoard(null);
    api<Board>(`${client.base}/leaderboard?period=${period}`, { auth: client.auth }).then(setBoard).catch(() => setBoard({ period, top: [], me: null }));
  }, [client.base, client.auth, period]);
  return (
    <section className="card p-4" aria-label="Leaderboard">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Leaderboard</h2>
        <div className="flex gap-0.5 rounded-md bg-slate-100 p-0.5 text-[11px]" role="tablist">
          {([['7d', '7d'], ['30d', '30d'], ['all', 'All']] as const).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={period === v} aria-label={v === 'all' ? 'All time' : v === '7d' ? 'Last 7 days' : 'Last 30 days'} onClick={() => setPeriod(v)} className={`whitespace-nowrap rounded px-2 py-0.5 font-medium ${period === v ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {board?.me && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-amber-900">Level {board.me.level}</span>
            <span className="text-xs text-amber-800">{board.me.nextLevelAt ? `${board.me.toNext} point${board.me.toNext === 1 ? '' : 's'} to level ${board.me.level + 1}` : 'Top level!'}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-amber-200/70"><div className="h-full rounded-full bg-amber-500" style={{ width: `${board.me.percent}%` }} /></div>
          <p className="mt-1.5 text-[11px] text-amber-800">{board.me.rank ? `You're #${board.me.rank} with ${board.me.points} point${board.me.points === 1 ? '' : 's'} in this period.` : 'Earn points when others like your posts.'}</p>
        </div>
      )}
      {!board ? <div className="grid h-24 place-items-center"><Spinner /></div> : board.top.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No points yet in this period. Points come from likes on posts.</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {board.top.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${r.isMe ? 'bg-brand-50' : ''}`}>
              <span className={`w-5 text-center text-xs font-bold ${r.rank <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>{r.rank}</span>
              <span className="min-w-0 flex-1 truncate">{r.name}{r.isMe && <span className="text-slate-400"> (you)</span>}</span>
              <LevelBadge level={r.level} />
              <span className="w-10 text-right text-xs font-semibold tabular-nums">+{r.points}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
