'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { captureTouch, getAttribution } from '@/lib/attribution';

type Config = { enabled: boolean; title: string; greeting: string; askFor: 'none' | 'email' | 'name_email'; color: string; position: 'right' | 'left'; businessName: string };
type Msg = { id: string; from: 'visitor' | 'agent' | 'bot'; agent: string | null; body: string; createdAt: string };
type Session = { sessionId: string; token: string };

const storeKey = (k: string) => `eril-chat:${k}`;
function loadSession(k: string): Session | null {
  try { return JSON.parse(localStorage.getItem(storeKey(k)) || 'null'); } catch { return null; }
}
function saveSession(k: string, s: Session | null) {
  try { s ? localStorage.setItem(storeKey(k), JSON.stringify(s)) : localStorage.removeItem(storeKey(k)); } catch { /* storage blocked: chat still works for this page view */ }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token ? { 'x-chat-token': init.token } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message || 'Something went wrong') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

const tell = (msg: Record<string, unknown>) => window.parent !== window && window.parent.postMessage({ type: 'eril-chat', ...msg }, '*');
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The website chat (bubble + panel) shown inside the iframe that /widget.js adds to a site. */
export default function ChatWidgetPage() {
  const { key } = useParams<{ key: string }>();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // The host page (passed as ?page=) is where the visitor landed; capture its UTM tags.
  useEffect(() => captureTouch(new URLSearchParams(location.search).get('page')), []);

  // Transparent page so only the bubble/panel show on the host site.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    call<Config>(`/public/chat/widgets/${encodeURIComponent(key)}`)
      .then((c) => {
        setCfg(c);
        tell({ side: c.position, state: c.enabled ? 'closed' : 'hidden' });
        if (c.enabled) setSession(loadSession(key));
      })
      .catch(() => tell({ state: 'hidden' }));
  }, [key]);

  const merge = useCallback((incoming: Msg[]) => {
    if (!incoming.length) return;
    setMsgs((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (!fresh.length) return cur;
      if (!openRef.current) setUnread((u) => u + fresh.filter((m) => m.from !== 'visitor').length);
      return [...cur, ...fresh];
    });
  }, []);

  // Poll for replies: often while open, gently while closed (for the unread badge).
  useEffect(() => {
    if (!session) return;
    let stop = false;
    let last: string | undefined;
    const tick = async () => {
      try {
        const r = await call<{ messages: Msg[] }>(`/public/chat/sessions/${session.sessionId}/messages${last ? `?after=${encodeURIComponent(last)}` : ''}`, { token: session.token });
        if (stop) return;
        if (r.messages.length) last = r.messages[r.messages.length - 1].createdAt;
        merge(r.messages);
      } catch (e) {
        if ((e as { status?: number }).status === 401) { saveSession(key, null); setSession(null); setMsgs([]); }
      }
    };
    tick();
    const t = setInterval(tick, open ? 3000 : 15000);
    return () => { stop = true; clearInterval(t); };
  }, [session, open, key, merge]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  function toggle(next: boolean) {
    setOpen(next);
    if (next) setUnread(0);
    tell({ state: next ? 'open' : 'closed' });
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await call<Session & { messages: Msg[] }>(`/public/chat/widgets/${encodeURIComponent(key)}/sessions`, {
        method: 'POST',
        body: { name: form.name || undefined, email: form.email || undefined, pageUrl: new URLSearchParams(location.search).get('page') ?? '', message: draft.trim(), attribution: getAttribution() },
      });
      const s = { sessionId: r.sessionId, token: r.token };
      saveSession(key, s);
      setMsgs(r.messages);
      setSession(s);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !session) return;
    setBusy(true);
    setError('');
    try {
      const m = await call<Msg>(`/public/chat/sessions/${session.sessionId}/messages`, { method: 'POST', body: { body }, token: session.token });
      merge([m]);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg?.enabled) return null;
  const color = cfg.color;
  const side = cfg.position === 'left' ? 'left-0' : 'right-0';
  const needEmail = cfg.askFor !== 'none';
  const needName = cfg.askFor === 'name_email';

  return (
    <div className="fixed inset-0 font-sans text-[14px] text-slate-900">
      {open ? (
        <section aria-label={cfg.title} className="absolute inset-0 flex flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl sm:border sm:border-slate-200">
          <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ background: color }}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{cfg.title}</div>
              {cfg.businessName && <div className="truncate text-xs opacity-80">{cfg.businessName}</div>}
            </div>
            <button onClick={() => toggle(false)} aria-label="Close chat" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" /></svg>
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-4">
            {cfg.greeting && (
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 shadow-sm ring-1 ring-slate-200/70">{cfg.greeting}</div>
            )}
            {msgs.map((m) => {
              const mine = m.from === 'visitor';
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap px-3.5 py-2 [overflow-wrap:anywhere] ${mine ? 'rounded-2xl rounded-br-md text-white' : 'rounded-2xl rounded-bl-md bg-white shadow-sm ring-1 ring-slate-200/70'}`}
                    style={mine ? { background: color } : undefined}
                  >
                    {m.body}
                  </div>
                  <span className="mt-0.5 px-1 text-[11px] text-slate-400">
                    {!mine && (m.from === 'bot' ? 'Assistant · ' : m.agent ? `${m.agent} · ` : '')}
                    {time(m.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>

          {session ? (
            <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 p-2.5">
              <textarea
                aria-label="Message"
                rows={1}
                maxLength={2000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
                placeholder="Type a message…"
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
              />
              <button disabled={busy || !draft.trim()} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40" style={{ background: color }}>
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor"><path d="M3.1 2.6a.75.75 0 0 1 .8-.1l13 6.75a.75.75 0 0 1 0 1.33l-13 6.75A.75.75 0 0 1 2.8 16.5l1.9-6.5-1.9-6.5a.75.75 0 0 1 .3-.9ZM6.1 10.75l-1.3 4.4L14.6 10 4.8 4.85l1.3 4.4H11a.75.75 0 0 1 0 1.5H6.1Z" /></svg>
              </button>
            </form>
          ) : (
            <form onSubmit={start} className="space-y-2 border-t border-slate-200 p-3">
              {needName && <input aria-label="Your name" required maxLength={120} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" />}
              {needEmail && <input aria-label="Your email" required type="email" maxLength={255} placeholder="Your email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" />}
              <textarea aria-label="Message" required rows={2} maxLength={2000} placeholder="How can we help?" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" />
              <button disabled={busy} className="w-full rounded-xl py-2.5 font-semibold text-white disabled:opacity-50" style={{ background: color }}>Start chat</button>
            </form>
          )}
          {error && <p role="alert" className="bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{error}</p>}
        </section>
      ) : (
        <button
          onClick={() => toggle(true)}
          aria-label={`Open chat${unread ? ` (${unread} new)` : ''}`}
          className={`absolute bottom-2 ${side === 'left-0' ? 'left-2' : 'right-2'} grid h-16 w-16 place-items-center rounded-full text-white shadow-lg transition hover:scale-105`}
          style={{ background: color }}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold">{unread}</span>}
        </button>
      )}
    </div>
  );
}
