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
/** Soft avatar colours, matching the rest of the glass design. */
const HUES = ['bg-[#5B9EE1]', 'bg-[#8FB65A]', 'bg-[#E0936F]', 'bg-[#C5A94F]', 'bg-[#9C88D6]', 'bg-[#5FB3A3]', 'bg-[#D5788F]', 'bg-[#7A8C9C]'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const fullName = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.email || c.phone || 'Unknown';
const initials = (c: Contact) => (`${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || (c.email ?? '?')[0].toUpperCase());

/** Per-channel label, icon and pastel chip. */
const CHANNELS: Record<string, { label: string; long: string; icon: string; chip: string }> = {
  email: { label: 'Email', long: 'Email', icon: 'mail', chip: 'bg-[#CBE1F6] text-[#1E4569]' },
  sms: { label: 'SMS', long: 'SMS', icon: 'sms', chip: 'bg-[#D4E7B5] text-[#33461A]' },
  whatsapp: { label: 'WhatsApp', long: 'WhatsApp', icon: 'comment', chip: 'bg-[#CBE8E2] text-[#1F4E45]' },
  facebook: { label: 'Messenger', long: 'Facebook Messenger', icon: 'comment', chip: 'bg-[#DDD5F3] text-[#3C2F66]' },
  instagram: { label: 'Instagram', long: 'Instagram direct', icon: 'comment', chip: 'bg-[#F3D2DA] text-[#6A2537]' },
  chat: { label: 'Web chat', long: 'Website visitor', icon: 'comment', chip: 'bg-[#F1E7C4] text-[#5C4D1C]' },
};
const ch = (c: string) => CHANNELS[c] ?? CHANNELS.sms;

function Avatar({ c, size = 'md' }: { c: Contact; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-16 w-16 text-lg' : size === 'sm' ? 'h-9 w-9 text-[11px]' : 'h-11 w-11 text-xs';
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
const FILTERS: Array<readonly [Filter, string]> = [['all', 'All'], ['unread', 'Unread'], ['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['facebook', 'Messenger'], ['instagram', 'Instagram'], ['chat', 'Chat']];

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
  const tc = thread ? ch(thread.channel) : null;

  return (
    // Three floating glass panels: list · thread · contact.
    <div className="-mb-4 flex h-[calc(100dvh-88px)] min-h-[480px] gap-3 lg:gap-4">
      {/* ---- Conversation list ---- */}
      <section className={`card w-full shrink-0 flex-col overflow-hidden md:w-[340px] ${activeId ? 'hidden md:flex' : 'flex'}`} aria-label="Conversations">
        <div className="px-4 pb-3 pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Conversations</h1>
            {can('conversations:write') && (
              <div className="flex gap-1">
                <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setLogInbound(true)} title="Log a message you received elsewhere">Log incoming</button>
                <button className="btn-primary h-8 w-8 px-0" onClick={() => setComposeNew(true)} aria-label="New message" title="New message">
                  <Icon name="plus" className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input type="search" aria-label="Search conversations" placeholder="Search people or messages…" className="input h-10 rounded-full pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter conversations">
            {FILTERS.map(([v, l]) => (
              <button
                key={v}
                role="tab"
                aria-selected={filter === v}
                onClick={() => setFilter(v)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] transition ${filter === v ? 'bg-[var(--pill)] font-semibold text-ink shadow-[0_1px_2px_rgba(24,26,24,0.08)]' : 'font-medium text-muted hover:bg-[var(--track)] hover:text-ink'}`}
              >
                {l}
                {v === 'unread' && unreadTotal > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-[color:var(--accent-ink)] num">{unreadTotal}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-4 h-px bg-[var(--glass-line)]" />
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {!shown ? (
            <li className="grid place-items-center p-8"><Spinner /></li>
          ) : shown.length === 0 ? (
            <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted">
              <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}><Icon name="inboxEmpty" className="h-5 w-5 text-ink" /></span>
              {filter === 'unread' ? 'You’re all caught up.' : search ? 'No conversations match your search.' : 'No conversations yet.'}
            </li>
          ) : (
            shown.map((c) => {
              const active = c.id === activeId;
              const unread = c.unreadCount > 0;
              const info = ch(c.channel);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    aria-current={active}
                    className={`flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition ${active ? 'bg-[var(--pill)] shadow-[0_1px_3px_rgba(24,26,24,0.08)]' : 'hover:bg-[var(--track)]'}`}
                  >
                    <span className="relative">
                      <Avatar c={c.contact} />
                      <span className={`absolute -bottom-0.5 -right-0.5 grid h-[19px] w-[19px] place-items-center rounded-full ring-2 ring-[var(--pill)] ${info.chip}`} title={info.label}>
                        <Icon name={info.icon} className="h-2.5 w-2.5" strokeWidth={2.5} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`flex-1 truncate text-[14px] text-ink ${unread ? 'font-bold' : 'font-medium'}`}>{fullName(c.contact)}</span>
                        <span className={`shrink-0 text-[11px] num ${unread ? 'font-semibold text-ink' : 'text-muted'}`}>{shortAgo(c.lastMessageAt)}</span>
                      </span>
                      {c.channel === 'email' && c.subject && <span className={`block truncate text-[12.5px] ${unread ? 'font-semibold text-ink' : 'text-muted'}`}>{c.subject}</span>}
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`flex-1 truncate text-[12.5px] ${unread ? 'text-ink' : 'text-muted'}`}>{c.lastMessagePreview || 'No messages yet'}</span>
                        {unread && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-[color:var(--accent-ink)] num">{c.unreadCount}</span>}
                        {active && !unread && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
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
      <section className={`card min-w-0 flex-1 flex-col overflow-hidden ${activeId ? 'flex' : 'hidden md:flex'}`} aria-label="Message history">
        {!thread || !tc ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'color-mix(in srgb, var(--accent) 32%, transparent)' }}>
                <Icon name="inbox" className="h-6 w-6 text-ink" />
              </span>
              <p className="text-[16px] font-semibold text-ink">Select a conversation</p>
              <p className="mt-1 text-sm text-muted">Email, SMS, WhatsApp, Messenger, Instagram and web chat, in one place.</p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-[var(--glass-line)] px-4 py-3 md:px-5">
              <button className="btn-ghost h-9 w-9 px-0 md:hidden" onClick={() => { setActiveId(null); setThread(null); }} aria-label="Back to list">
                <Icon name="arrowLeft" />
              </button>
              <Avatar c={thread.contact} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/contacts/${thread.contactId}`} className="truncate text-[16px] font-semibold text-ink hover:underline">{fullName(thread.contact)}</Link>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tc.chip}`}>
                    <Icon name={tc.icon} className="h-3 w-3" strokeWidth={2.25} />
                    {tc.label}
                  </span>
                </div>
                <div className="truncate text-[12px] text-muted">
                  {thread.channel === 'email' ? thread.contact.email : thread.channel === 'sms' || thread.channel === 'whatsapp' ? thread.contact.phone : tc.long}
                  {thread.subject && thread.channel === 'email' ? ` · ${thread.subject}` : ''}
                </div>
              </div>
              {botChannels.includes(thread.channel) && !thread.botPaused && (
                <span className="hidden items-center gap-1 rounded-full bg-[#DDD5F3] px-2.5 py-1 text-[11px] font-semibold text-[#3C2F66] sm:inline-flex" title={`AI replies here so far: ${thread.botReplyCount ?? 0}`}>
                  <Icon name="sparkles" className="h-3 w-3" /> AI on
                  {can('conversations:write') && (
                    <button className="ml-0.5 rounded-full px-1.5 hover:bg-white/60" onClick={() => setBotPaused(true)}>Pause</button>
                  )}
                </span>
              )}
              <TextToPayButton contact={thread.contact} channel={thread.channel === 'sms' ? 'sms' : 'email'} className="btn-secondary hidden h-9 px-3 text-xs sm:inline-flex" onSent={() => loadThread(thread.id).catch(() => {})} />
              <button className={`btn-ghost hidden h-9 w-9 px-0 xl:inline-flex ${details ? 'bg-[var(--track)] text-ink' : ''}`} onClick={() => setDetails(!details)} aria-pressed={details} aria-label="Contact details" title="Contact details">
                <Icon name="panelRight" />
              </button>
            </header>

            {botChannels.includes(thread.channel) && thread.botPaused && (
              <div className="tint-peach mx-3 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2 text-[13px] text-ink">
                <Icon name="sparkles" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">AI assistant paused here</span>
                  {thread.botHandoffReason ? ` — ${thread.botHandoffReason}` : ''}
                </span>
                {can('conversations:write') && (
                  <button className="btn-secondary h-7 px-3 text-xs" onClick={() => setBotPaused(false)}>Resume AI</button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-8">
              {groups.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet. Say hello below.</p>}
              {groups.map((g) => (
                <Fragment key={g.day}>
                  <div className="my-4 flex justify-center">
                    <span className="rounded-full bg-[var(--chip)] px-3 py-1 text-[11px] font-semibold text-muted">{dayLabel(g.items[0].m.createdAt)}</span>
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
              <form onSubmit={send} className="px-3 pb-3 md:px-5 md:pb-4">
                <div className="rounded-[20px] border border-[var(--glass-border)] bg-[var(--field)] shadow-[0_6px_20px_-14px_rgba(24,26,24,0.35)] transition focus-within:shadow-[0_0_0_4px_var(--accent-ring)]">
                  {thread.channel === 'email' && showSubject && (
                    <input aria-label="Subject" className="w-full border-b border-[var(--glass-line)] bg-transparent px-4 py-2.5 text-sm text-ink outline-none placeholder:text-muted" placeholder={`Subject (default: ${thread.subject || 'none'})`} value={subject} onChange={(e) => setSubject(e.target.value)} />
                  )}
                  <textarea
                    ref={textarea}
                    aria-label="Reply"
                    rows={2}
                    className="block max-h-[200px] w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-muted"
                    placeholder={`Write a${thread.channel === 'email' ? 'n email' : thread.channel === 'chat' ? ' chat reply' : thread.channel === 'whatsapp' ? ' WhatsApp reply' : thread.channel === 'facebook' ? ' Messenger reply' : thread.channel === 'instagram' ? 'n Instagram reply' : 'n SMS'} to ${thread.contact.firstName || 'this contact'}…`}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                    {thread.channel === 'email' && (
                      <button type="button" className={`btn-ghost h-8 px-3 text-xs ${showSubject ? 'bg-[var(--track)] text-ink' : ''}`} onClick={() => setShowSubject(!showSubject)}>
                        {showSubject ? 'Hide subject' : 'Change subject'}
                      </button>
                    )}
                    {aiEnabled && (
                      <AiButton
                        label="Suggest reply"
                        className="h-8 py-0 text-xs"
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
                      {smsLen > 0 && <span className={`text-[11px] num ${smsLen > 160 ? 'font-semibold text-[#B4502F]' : 'text-muted'}`}>{smsLen} chars{smsLen > 160 ? ` · ${Math.ceil(smsLen / 153)} SMS` : ''}</span>}
                      <span className="hidden items-center gap-1 text-[11px] text-muted sm:flex"><kbd className="kbd">Ctrl</kbd><kbd className="kbd">↵</kbd> to send</span>
                      <button className="btn-primary h-9 px-4" disabled={sending || !body.trim()}>
                        {sending ? <Spinner className="h-4 w-4" /> : <Icon name="send" className="h-4 w-4" />}
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

      <Modal open={!!designHtml} title="Designed email" onClose={() => setDesignHtml(null)} wide>
        {designHtml && <iframe title="Designed email" sandbox="" srcDoc={designHtml} className="h-[70vh] w-full rounded-2xl border border-[var(--glass-line)] bg-white" />}
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
  const corner = out ? `rounded-br-lg ${first ? '' : 'rounded-tr-lg'}` : `rounded-bl-lg ${first ? '' : 'rounded-tl-lg'}`;
  // Outbound uses the accent (it follows the person's theme); the AI assistant is lavender; inbound is frosted.
  const look: React.CSSProperties = failed
    ? {}
    : out && m.sentByBot
      ? { background: 'linear-gradient(135deg, #9C88D6, #C084FC)', color: '#fff' }
      : out
        ? { background: 'var(--accent-fill)', color: 'var(--accent-ink)' }
        : { background: 'var(--glass-strong)' };
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} ${first ? 'mt-3' : 'mt-1'}`}>
      <div className={`flex min-w-0 max-w-[85%] flex-col md:max-w-[65%] ${out ? 'items-end' : 'items-start'}`}>
        <div
          className={`min-w-0 max-w-full rounded-[20px] px-4 py-2.5 text-[14px] leading-relaxed ${corner} ${
            failed ? 'border border-[#F3D2DA] bg-[#FBECEF] text-[#6A2537]' : out ? 'shadow-[0_6px_16px_-12px_rgba(24,26,24,0.45)]' : 'border border-[var(--glass-border)] text-ink shadow-[0_6px_16px_-14px_rgba(24,26,24,0.4)]'
          }`}
          style={look}
        >
          {m.sentByBot && (
            <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide opacity-80">
              <Icon name="sparkles" className="h-3 w-3" /> AI assistant
            </p>
          )}
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
          {m.hasHtml && (
            <button className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${out && !failed ? 'bg-black/10 hover:bg-black/15' : 'bg-[var(--track)] text-ink hover:bg-[var(--chip)]'}`} onClick={onDesign}>
              <Icon name="eye" className="h-3.5 w-3.5" /> View designed email
            </button>
          )}
        </div>
        {last && (
          <div className={`mt-1 flex items-center gap-1.5 px-1.5 text-[11px] ${failed ? 'font-medium text-[#B4502F]' : 'text-muted'}`}>
            <span className="num">{clock(m.createdAt)}</span>
            {out && !failed && (
              <>
                <span aria-hidden>·</span>
                {m.clickedAt ? (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-ink"><Icon name="pointer" className="h-3 w-3" /> Clicked</span>
                ) : m.openedAt ? (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-ink"><Icon name="eye" className="h-3 w-3" /> Opened</span>
                ) : (
                  <span className="inline-flex items-center gap-0.5"><Icon name={m.status === 'delivered' ? 'checkCheck' : 'check'} className="h-3 w-3" /> {m.status === 'delivered' ? 'Delivered' : m.status === 'sent' ? 'Sent' : m.status}</span>
                )}
              </>
            )}
            {failed && (
              <span className="inline-flex items-center gap-1"><Icon name="alert" className="h-3 w-3" /> Not delivered{m.error ? `: ${m.error}` : ''}</span>
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
      <div className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-[var(--track)]">
        <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <div className="min-w-0">
          <div className="text-[11px] text-muted">{label}</div>
          <div className="break-words text-[13.5px] text-ink">{value}</div>
        </div>
      </div>
    ) : null;
  return (
    <aside className="card hidden w-[300px] shrink-0 flex-col overflow-y-auto xl:flex" aria-label="Contact details">
      <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
        <Avatar c={c} size="lg" />
        <div className="mt-3 text-[17px] font-semibold tracking-[-0.01em] text-ink">{fullName(c)}</div>
        {c.company?.name && <div className="text-[12px] text-muted">{c.company.name}</div>}
        <div className="mt-2"><StatusBadge status={c.status} /></div>
        <div className="mt-4 flex w-full gap-2">
          <Link href={`/contacts/${c.id}`} className="btn-secondary h-9 flex-1 text-xs">
            <Icon name="external" className="h-3.5 w-3.5" /> Open contact
          </Link>
          <TextToPayButton contact={c} channel={conversation.channel === 'sms' ? 'sms' : 'email'} className="btn-secondary h-9 flex-1 px-2 text-xs" onSent={onSent} />
        </div>
      </div>
      <div className="space-y-4 px-3 pb-5">
        <div className="grid grid-cols-2 gap-2 px-2">
          <div className="tint-sky rounded-2xl px-3 py-2.5">
            <div className="text-[11px] text-muted">Sent</div>
            <div className="text-[22px] font-bold leading-tight text-ink num">{sent}</div>
          </div>
          <div className="tint-sage rounded-2xl px-3 py-2.5">
            <div className="text-[11px] text-muted">Received</div>
            <div className="text-[22px] font-bold leading-tight text-ink num">{received}</div>
          </div>
        </div>
        <div>
          {row('mail', 'Email', c.email)}
          {row('phone', 'Phone', c.phone)}
          {row('calendar', 'Contact since', new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}
        </div>
        {c.tags.length > 0 && (
          <div className="px-2">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Tags</div>
            <div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <span key={t} className="chip px-2.5 text-ink">{t}</span>)}</div>
          </div>
        )}
        {c.notes && (
          <div className="px-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Notes</div>
            <p className="whitespace-pre-wrap rounded-2xl bg-[var(--track)] p-3 text-[13px] text-ink">{c.notes}</p>
          </div>
        )}
        <div className="px-2 text-[11px] text-muted">Last message {timeAgo(conversation.lastMessageAt)}</div>
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
          {(['email', 'sms'] as const).map((chn) => {
            const missing = !!picked && (chn === 'email' ? !picked.email : !picked.phone);
            const on = channel === chn;
            return (
              <label key={chn} className={`flex cursor-pointer items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-sm transition ${on ? 'border-[var(--ink)] bg-[var(--pill)] shadow-[0_0_0_3px_var(--accent-ring)]' : 'border-[var(--glass-line)] hover:bg-[var(--track)]'} ${missing ? 'opacity-50' : ''}`}>
                <input type="radio" name="nm-ch" className="sr-only" checked={on} onChange={() => setChannel(chn)} />
                <span className={`grid h-7 w-7 place-items-center rounded-full ${ch(chn).chip}`}><Icon name={chn === 'email' ? 'mail' : 'sms'} className="h-3.5 w-3.5" /></span>
                <span className="font-medium text-ink">{chn === 'email' ? 'Email' : 'SMS'}</span>
                {picked && <span className="ml-auto truncate text-xs text-muted">{chn === 'email' ? picked.email ?? 'no email' : picked.phone ?? 'no phone'}</span>}
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
        {channel === 'sms' && body.length > 0 && <p className="mt-1 text-right text-[11px] text-muted num">{body.length} chars{body.length > 160 ? ` · ${Math.ceil(body.length / 153)} SMS` : ''}</p>}
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
