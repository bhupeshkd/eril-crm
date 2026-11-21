'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Conversation, Message, Paged } from '@/lib/types';
import { Modal, Spinner, StatusBadge, errorText, useToast } from '@/components/ui';
import { AiButton, useAiEnabled } from '@/lib/ai';
import { TextToPayButton } from '@/components/text-to-pay';
import { Icon } from '@/components/icons';

export default function InboxPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inbox />
    </Suspense>
  );
}

// ---- small helpers ---------------------------------------------------------------
const HUES = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const fullName = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.email || c.phone || 'Unknown';
const initials = (c: Contact) => (`${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || (c.email ?? '?')[0].toUpperCase());

function Avatar({ c, size = 'md' }: { c: Contact; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-10 w-10 text-xs';
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${cls} ${hue(fullName(c))}`}>{initials(c)}</span>;
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Short relative time for the list ("5m", "3h", "Mon", "Nov 4"). */
const shortAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  if (mins < 60 * 24 * 6) return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

type Filter = 'all' | 'unread' | 'email' | 'sms' | 'whatsapp' | 'facebook' | 'instagram' | 'chat';

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(params.get('c'));
  const [thread, setThread] = useState<Conversation | null>(null);
  const [subject, setSubject] = useState('');
  const [showSubject, setShowSubject] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [composeNew, setComposeNew] = useState(false);
  const [logInbound, setLogInbound] = useState(false);
  const [details, setDetails] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const aiEnabled = useAiEnabled();
  const [designHtml, setDesignHtml] = useState<string | null>(null);
  // Which channels the workspace's AI assistant answers (empty when it's off).
  const [botChannels, setBotChannels] = useState<string[]>([]);
  useEffect(() => {
    api<{ enabled: boolean; aiEnabled: boolean; channels: string[] }>('/ai/assistant')
      .then((s) => setBotChannels(s.enabled && s.aiEnabled ? s.channels : []))
      .catch(() => setBotChannels([]));
  }, []);
  async function setBotPaused(paused: boolean) {
    if (!thread) return;
    try {
      await api(`/inbox/conversations/${thread.id}/bot`, { method: 'PUT', body: { paused } });
      toast(paused ? 'AI assistant paused for this conversation' : 'AI assistant will answer new messages here');
      await loadThread(thread.id);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }
  const channel = filter !== 'all' && filter !== 'unread' ? filter : '';

  useEffect(() => {
    const onLive = (e: Event) => {
      const type = (e as CustomEvent).detail?.type;
      if (type === 'message.received') {
        loadList();
        if (activeId) loadThread(activeId).catch(() => {});
      }
    };
    window.addEventListener('eril:live', onLive);
    return () => window.removeEventListener('eril:live', onLive);
  });

  const loadList = useCallback(async () => {
    const q = new URLSearchParams();
    if (channel) q.set('channel', channel);
    if (search.trim()) q.set('search', search.trim());
    try {
      setList(await api<Conversation[]>(`/inbox/conversations?${q}`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [channel, search, toast]);

  const loadThread = useCallback(async (id: string) => {
    const t = await api<Conversation>(`/inbox/conversations/${id}`);
    setThread(t);
    if (t.unreadCount > 0) {
      await api(`/inbox/conversations/${id}/read`, { method: 'PUT' });
      setList((l) => l?.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)) ?? l);
      window.dispatchEvent(new Event('eril:unread-changed'));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    const t = setInterval(() => {
      loadList();
      if (activeId) loadThread(activeId).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [loadList, loadThread, activeId]);

  useEffect(() => {
    if (!activeId) return;
    setSubject('');
    setShowSubject(false);
    loadThread(activeId).catch((e) => toast(errorText(e), 'error'));
    router.replace(`/inbox?c=${activeId}`, { scroll: false });
  }, [activeId, loadThread, router, toast]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [thread?.id, thread?.messages?.length]);

  // Grow the reply box with its content (up to a limit).
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!thread || !body.trim()) return;
    setSending(true);
    try {
      const msg = await api('/inbox/messages', {
        method: 'POST',
        body: { conversationId: thread.id, body, subject: subject || undefined },
      });
      if (msg.status === 'failed') toast(`Delivery failed: ${msg.error}`, 'error');
      setBody('');
      await loadThread(thread.id);
      loadList();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSending(false);
    }
  }

  const shown = useMemo(() => (filter === 'unread' ? list?.filter((c) => c.unreadCount > 0) : list) ?? null, [list, filter]);
  const unreadTotal = list?.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0) ?? 0;

  // Group messages by day; consecutive messages from the same side within 5 minutes form a run.
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Array<{ m: Message; first: boolean; last: boolean }> }> = [];
    const msgs = thread?.messages ?? [];
    msgs.forEach((m, i) => {
      const day = new Date(m.createdAt).toDateString();
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      const prev = msgs[i - 1];
      const next = msgs[i + 1];
      const near = (a?: Message, b?: Message) => !!a && !!b && a.direction === b.direction && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString() && Math.abs(+new Date(a.createdAt) - +new Date(b.createdAt)) < 5 * 60_000;
      out[out.length - 1].items.push({ m, first: !near(prev, m), last: !near(m, next) });
    });
    return out;
  }, [thread?.messages]);

  const smsLen = thread?.channel === 'sms' ? body.length : 0;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] flex-col md:-mx-8 md:-my-8">
      <div className="flex min-h-0 flex-1 overflow-hidden border-slate-200/70 bg-white">
        {/* ---- Conversation list ---- */}
        <section className={`flex w-full shrink-0 flex-col border-r border-slate-200/70 md:w-[340px] ${activeId ? 'hidden md:flex' : 'flex'}`} aria-label="Conversations">
          <div className="border-b border-slate-100 px-4 pb-3 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold tracking-tight">Conversations</h1>
              {can('conversations:write') && (
                <div className="flex gap-1">
                  <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setLogInbound(true)} title="Log a message you received elsewhere">Log incoming</button>
                  <button className="btn-primary h-8 w-8 px-0" onClick={() => setComposeNew(true)} aria-label="New message" title="New message">
                    <Icon name="plus" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" aria-label="Search conversations" placeholder="Search people or messages…" className="input h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="mt-3 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Filter conversations">
              {([['all', 'All'], ['unread', 'Unread'], ['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['facebook', 'Messenger'], ['instagram', 'Instagram'], ['chat', 'Chat']] as const).map(([v, l]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={filter === v}
                  onClick={() => setFilter(v)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${filter === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {l}
                  {v === 'unread' && unreadTotal > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{unreadTotal}</span>}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
            {!shown ? (
              <li className="grid place-items-center p-8"><Spinner /></li>
            ) : shown.length === 0 ? (
              <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-slate-500">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name="inboxEmpty" className="h-5 w-5" /></span>
                {filter === 'unread' ? 'You’re all caught up.' : search ? 'No conversations match your search.' : 'No conversations yet.'}
              </li>
            ) : (
              shown.map((c) => {
                const active = c.id === activeId;
                const unread = c.unreadCount > 0;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setActiveId(c.id)}
                      aria-current={active}
                      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-brand-50 ring-1 ring-inset ring-brand-200/70' : 'hover:bg-slate-50'}`}
                    >
                      <span className="relative">
                        <Avatar c={c.contact} />
                        <span className={`absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full ring-2 ring-white ${c.channel === 'email' ? 'bg-sky-100 text-sky-600' : c.channel === 'whatsapp' ? 'bg-green-100 text-green-700' : c.channel === 'facebook' ? 'bg-blue-100 text-blue-700' : c.channel === 'instagram' ? 'bg-pink-100 text-pink-700' : c.channel === 'chat' ? 'bg-violet-100 text-violet-600' : 'bg-emerald-100 text-emerald-600'}`}>
                          <Icon name={c.channel === 'email' ? 'mail' : c.channel === 'sms' ? 'sms' : 'comment'} className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`flex-1 truncate text-[13.5px] ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{fullName(c.contact)}</span>
                          <span className={`shrink-0 text-[11px] ${unread ? 'font-semibold text-brand-600' : 'text-slate-400'}`}>{shortAgo(c.lastMessageAt)}</span>
                        </span>
                        {c.channel === 'email' && c.subject && <span className={`block truncate text-[12.5px] ${unread ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{c.subject}</span>}
                        <span className="flex items-center gap-2">
                          <span className={`flex-1 truncate text-[12.5px] ${unread ? 'text-slate-700' : 'text-slate-500'}`}>{c.lastMessagePreview || 'No messages yet'}</span>
                          {unread && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">{c.unreadCount}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {/* ---- Thread ---- */}
        <section className={`min-w-0 flex-1 flex-col bg-[#f8f9fb] ${activeId ? 'flex' : 'hidden md:flex'}`} aria-label="Message history">
          {!thread ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 ring-1 ring-inset ring-brand-200/60">
                  <Icon name="inbox" className="h-6 w-6" />
                </span>
                <p className="font-semibold text-slate-800">Select a conversation</p>
                <p className="mt-1 text-sm text-slate-500">Email and SMS with every contact, in one place.</p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-slate-200/70 bg-white/90 px-4 py-3 backdrop-blur">
                <button className="btn-ghost h-9 w-9 px-0 md:hidden" onClick={() => { setActiveId(null); setThread(null); }} aria-label="Back to list">
                  <Icon name="arrowLeft" />
                </button>
                <Avatar c={thread.contact} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/contacts/${thread.contactId}`} className="truncate text-[15px] font-semibold hover:text-brand-600">{fullName(thread.contact)}</Link>
                    <span className={`badge ${thread.channel === 'email' ? 'bg-sky-50 text-sky-700 ring-sky-600/15' : thread.channel === 'whatsapp' ? 'bg-green-50 text-green-700 ring-green-600/15' : thread.channel === 'facebook' ? 'bg-blue-50 text-blue-700 ring-blue-600/15' : thread.channel === 'instagram' ? 'bg-pink-50 text-pink-700 ring-pink-600/15' : thread.channel === 'chat' ? 'bg-violet-50 text-violet-700 ring-violet-600/15' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'}`}>
                      <Icon name={thread.channel === 'email' ? 'mail' : thread.channel === 'sms' ? 'sms' : 'comment'} className="h-3 w-3" strokeWidth={2.25} />
                      {thread.channel === 'email' ? 'Email' : thread.channel === 'chat' ? 'Web chat' : thread.channel === 'whatsapp' ? 'WhatsApp' : thread.channel === 'facebook' ? 'Messenger' : thread.channel === 'instagram' ? 'Instagram' : 'SMS'}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {thread.channel === 'email' ? thread.contact.email : thread.channel === 'chat' ? 'Website visitor' : thread.channel === 'facebook' ? 'Facebook Messenger' : thread.channel === 'instagram' ? 'Instagram direct' : thread.contact.phone}
                    {thread.subject && thread.channel === 'email' ? ` · ${thread.subject}` : ''}
                  </div>
                </div>
                {botChannels.includes(thread.channel) && !thread.botPaused && (
                  <span className="badge hidden bg-violet-50 text-violet-700 ring-violet-600/15 sm:inline-flex" title={`AI replies here so far: ${thread.botReplyCount ?? 0}`}>
                    <Icon name="sparkles" className="h-3 w-3" /> AI on
                    {can('conversations:write') && (
                      <button className="ml-1 rounded px-1 font-semibold hover:bg-violet-100" onClick={() => setBotPaused(true)}>Pause</button>
                    )}
                  </span>
                )}
                <TextToPayButton contact={thread.contact} channel={thread.channel === 'sms' ? 'sms' : 'email'} className="btn-secondary hidden h-8 px-2.5 text-xs sm:inline-flex" onSent={() => loadThread(thread.id).catch(() => {})} />
                <button className={`btn-ghost hidden h-8 w-8 px-0 xl:inline-flex ${details ? 'bg-slate-100 text-slate-900' : ''}`} onClick={() => setDetails(!details)} aria-pressed={details} aria-label="Contact details" title="Contact details">
                  <Icon name="panelRight" />
                </button>
              </header>

              {botChannels.includes(thread.channel) && thread.botPaused && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200/70 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
                  <Icon name="sparkles" className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">AI assistant paused here</span>
                    {thread.botHandoffReason ? ` — ${thread.botHandoffReason}` : ''}
                  </span>
                  {can('conversations:write') && (
                    <button className="btn-ghost h-7 px-2 text-xs text-amber-900 hover:bg-amber-100" onClick={() => setBotPaused(false)}>Resume AI</button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 md:px-8">
                {groups.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No messages yet. Say hello below.</p>}
                {groups.map((g) => (
                  <Fragment key={g.day}>
                    <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                      <span className="h-px flex-1 bg-slate-200/80" />
                      {dayLabel(g.items[0].m.createdAt)}
                      <span className="h-px flex-1 bg-slate-200/80" />
                    </div>
                    {g.items.map(({ m, first, last }) => (
                      <Bubble key={m.id} m={m} first={first} last={last} onDesign={async () => {
                        try { setDesignHtml((await api<{ html: string }>(`/inbox/messages/${m.id}/html`)).html); } catch (e) { toast(errorText(e), 'error'); }
                      }} />
                    ))}
                  </Fragment>
                ))}
                <div ref={bottom} />
              </div>

              {can('conversations:write') && (
                <form onSubmit={send} className="border-t border-slate-200/70 bg-white px-4 py-3 md:px-6">
                  <div className="rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10">
                    {thread.channel === 'email' && showSubject && (
                      <input aria-label="Subject" className="w-full border-b border-slate-100 bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-400" placeholder={`Subject (default: ${thread.subject || 'none'})`} value={subject} onChange={(e) => setSubject(e.target.value)} />
                    )}
                    <textarea
                      ref={textarea}
                      aria-label="Reply"
                      rows={2}
                      className="block max-h-[200px] w-full resize-none bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-slate-400"
                      placeholder={`Write a${thread.channel === 'email' ? 'n email' : thread.channel === 'chat' ? ' chat reply' : thread.channel === 'whatsapp' ? ' WhatsApp reply' : thread.channel === 'facebook' ? ' Messenger reply' : thread.channel === 'instagram' ? 'n Instagram reply' : 'n SMS'} to ${thread.contact.firstName || 'this contact'}…`}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
                      {thread.channel === 'email' && (
                        <button type="button" className={`btn-ghost h-7 px-2 text-xs ${showSubject ? 'text-brand-700' : ''}`} onClick={() => setShowSubject(!showSubject)}>
                          {showSubject ? 'Hide subject' : 'Change subject'}
                        </button>
                      )}
                      {aiEnabled && (
                        <AiButton
                          label="Suggest reply"
                          className="h-7 py-0 text-xs"
                          onClick={async () => {
                            try {
                              const r = await api<{ body: string }>('/ai/suggest-reply', { method: 'POST', body: { conversationId: thread.id } });
                              setBody(r.body);
                            } catch (err) {
                              toast(errorText(err), 'error');
                            }
                          }}
                        />
                      )}
                      <span className="ml-auto flex items-center gap-3">
                        {smsLen > 0 && <span className={`text-[11px] tabular-nums ${smsLen > 160 ? 'text-amber-600' : 'text-slate-400'}`}>{smsLen} chars{smsLen > 160 ? ` · ${Math.ceil(smsLen / 153)} SMS` : ''}</span>}
                        <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:flex"><kbd className="kbd">Ctrl</kbd><kbd className="kbd">↵</kbd> to send</span>
                        <button className="btn-primary h-8 px-3" disabled={sending || !body.trim()}>
                          {sending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : <Icon name="send" className="h-4 w-4" />}
                          Send
                        </button>
                      </span>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </section>

        {/* ---- Contact details ---- */}
        {thread && details && <ContactPanel c={thread.contact} conversation={thread} onSent={() => loadThread(thread.id).catch(() => {})} />}
      </div>

      <Modal open={!!designHtml} title="Designed email" onClose={() => setDesignHtml(null)} wide>
        {designHtml && <iframe title="Designed email" sandbox="" srcDoc={designHtml} className="h-[70vh] w-full rounded-lg border border-slate-200" />}
      </Modal>
      <Modal open={composeNew || logInbound} title={logInbound ? 'Log incoming message' : 'New message'} onClose={() => { setComposeNew(false); setLogInbound(false); }}>
        {(composeNew || logInbound) && (
          <NewMessage
            inbound={logInbound}
            onDone={(conversationId) => {
              setComposeNew(false);
              setLogInbound(false);
              loadList();
              if (conversationId) setActiveId(conversationId);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/** One message. Runs of consecutive messages share a single timestamp line and tighter corners. */
function Bubble({ m, first, last, onDesign }: { m: Message; first: boolean; last: boolean; onDesign: () => void }) {
  const out = m.direction === 'outbound';
  const failed = m.status === 'failed';
  const corner = out ? `rounded-br-md ${first ? '' : 'rounded-tr-md'}` : `rounded-bl-md ${first ? '' : 'rounded-tl-md'}`;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} ${first ? 'mt-3' : 'mt-1'}`}>
      <div className={`flex min-w-0 max-w-[85%] flex-col md:max-w-[65%] ${out ? 'items-end' : 'items-start'}`}>
        <div
          className={`min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${corner} ${
            failed
              ? 'border border-rose-200 bg-rose-50 text-rose-900'
              : out && m.sentByBot
                ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm shadow-violet-700/20'
                : out
                ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-sm shadow-brand-700/20'
                : 'border border-slate-200/80 bg-white text-slate-800 shadow-sm'
          }`}
        >
          {m.sentByBot && (
            <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/75">
              <Icon name="sparkles" className="h-3 w-3" /> AI assistant
            </p>
          )}
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
          {m.hasHtml && (
            <button className={`mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${out && !failed ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} onClick={onDesign}>
              <Icon name="eye" className="h-3.5 w-3.5" /> View designed email
            </button>
          )}
        </div>
        {last && (
          <div className={`mt-1 flex items-center gap-1.5 px-1 text-[11px] ${failed ? 'text-rose-600' : 'text-slate-400'}`}>
            <span>{clock(m.createdAt)}</span>
            {out && !failed && (
              <>
                <span aria-hidden>·</span>
                {m.clickedAt ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-violet-600"><Icon name="pointer" className="h-3 w-3" /> Clicked</span>
                ) : m.openedAt ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-brand-600"><Icon name="eye" className="h-3 w-3" /> Opened</span>
                ) : (
                  <span className="inline-flex items-center gap-0.5"><Icon name={m.status === 'delivered' ? 'checkCheck' : 'check'} className="h-3 w-3" /> {m.status === 'delivered' ? 'Delivered' : m.status === 'sent' ? 'Sent' : m.status}</span>
                )}
              </>
            )}
            {failed && (
              <span className="inline-flex items-center gap-1 font-medium"><Icon name="alert" className="h-3 w-3" /> Not delivered{m.error ? `: ${m.error}` : ''}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactPanel({ c, conversation, onSent }: { c: Contact; conversation: Conversation; onSent: () => void }) {
  const msgs = conversation.messages ?? [];
  const sent = msgs.filter((m) => m.direction === 'outbound').length;
  const received = msgs.length - sent;
  const row = (icon: string, label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex items-start gap-3 py-2">
        <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="break-words text-[13px] text-slate-800">{value}</div>
        </div>
      </div>
    ) : null;
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l border-slate-200/70 bg-white xl:flex" aria-label="Contact details">
      <div className="flex flex-col items-center border-b border-slate-100 px-5 py-6 text-center">
        <Avatar c={c} size="lg" />
        <div className="mt-3 text-[15px] font-semibold">{fullName(c)}</div>
        {c.company?.name && <div className="text-xs text-slate-500">{c.company.name}</div>}
        <div className="mt-2"><StatusBadge status={c.status} /></div>
        <div className="mt-4 flex w-full gap-2">
          <Link href={`/contacts/${c.id}`} className="btn-secondary h-8 flex-1 text-xs">
            <Icon name="external" className="h-3.5 w-3.5" /> Open contact
          </Link>
          <TextToPayButton contact={c} channel={conversation.channel === 'sms' ? 'sms' : 'email'} className="btn-secondary h-8 flex-1 px-2 text-xs" onSent={onSent} />
        </div>
      </div>
      <div className="divide-y divide-slate-100 px-5">
        <div className="py-2">
          {row('mail', 'Email', c.email)}
          {row('phone', 'Phone', c.phone)}
          {row('calendar', 'Contact since', new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}
        </div>
        {c.tags.length > 0 && (
          <div className="py-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">Tags</div>
            <div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700 ring-brand-600/15">{t}</span>)}</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 py-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-500">Sent</div>
            <div className="text-lg font-semibold tabular-nums">{sent}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-500">Received</div>
            <div className="text-lg font-semibold tabular-nums">{received}</div>
          </div>
        </div>
        {c.notes && (
          <div className="py-4">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Notes</div>
            <p className="whitespace-pre-wrap text-[13px] text-slate-700">{c.notes}</p>
          </div>
        )}
        <div className="py-4 text-[11px] text-slate-400">Last message {timeAgo(conversation.lastMessageAt)}</div>
      </div>
    </aside>
  );
}

function NewMessage({ inbound, onDone }: { inbound: boolean; onDone: (conversationId?: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);
  const picked = contacts.find((c) => c.id === contactId);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          const msg = await api(inbound ? '/inbox/inbound' : '/inbox/messages', {
            method: 'POST',
            body: { contactId, channel, subject: subject || undefined, body },
          });
          if (msg.status === 'failed') throw new Error(msg.error || 'Delivery failed');
          onDone(msg.conversationId);
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="nm-contact">{inbound ? 'From' : 'To'}</label>
        <select id="nm-contact" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose a contact…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} {c.email ? `· ${c.email}` : ''}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="label">Channel</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['email', 'sms'] as const).map((ch) => {
            const missing = !!picked && (ch === 'email' ? !picked.email : !picked.phone);
            return (
              <label key={ch} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${channel === ch ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'} ${missing ? 'opacity-50' : ''}`}>
                <input type="radio" name="nm-ch" className="sr-only" checked={channel === ch} onChange={() => setChannel(ch)} />
                <Icon name={ch === 'email' ? 'mail' : 'sms'} className={`h-4 w-4 ${channel === ch ? 'text-brand-600' : 'text-slate-400'}`} />
                <span className="font-medium">{ch === 'email' ? 'Email' : 'SMS'}</span>
                {picked && <span className="ml-auto truncate text-xs text-slate-400">{ch === 'email' ? picked.email ?? 'no email' : picked.phone ?? 'no phone'}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      {channel === 'email' && (
        <div>
          <label className="label" htmlFor="nm-subject">Subject</label>
          <input id="nm-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="nm-body">Message</label>
        <textarea id="nm-body" required rows={5} className="input" value={body} onChange={(e) => setBody(e.target.value)} />
        {channel === 'sms' && body.length > 0 && <p className="mt-1 text-right text-[11px] text-slate-400">{body.length} chars{body.length > 160 ? ` · ${Math.ceil(body.length / 153)} SMS` : ''}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>
          <Icon name={inbound ? 'plus' : 'send'} className="h-4 w-4" />
          {inbound ? 'Log message' : 'Send'}
        </button>
      </div>
    </form>
  );
}
