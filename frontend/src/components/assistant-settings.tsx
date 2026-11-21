'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CalendarT } from '@/lib/types-ext';
import { Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

interface Settings {
  enabled: boolean;
  channels: Array<'email' | 'sms' | 'chat' | 'whatsapp' | 'facebook' | 'instagram'>;
  businessInfo: string;
  instructions: string;
  maxReplies: number;
  handoffMessage: string;
  calendarId: string | null;
  aiEnabled: boolean;
  simulated: boolean;
  stats: { botReplies: number; pausedConversations: number };
}
interface Decision { action: 'reply' | 'handoff'; message: string; reason: string }

const PLACEHOLDER = `What we do: residential window and gutter cleaning in Springfield.
Hours: Mon–Fri 8am–5pm, Sat 9am–1pm.
Prices: windows from $45, gutters from $80. Free quotes.
Booking: customers can book online (link below) or reply with a preferred day.
Policies: 24h cancellation; we're insured; pay by card or bank transfer after the job.`;

export function AssistantSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('workspaces:write');
  const [s, setS] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [calendars, setCalendars] = useState<CalendarT[]>([]);
  const [saving, setSaving] = useState(false);
  const [tryMsg, setTryMsg] = useState('What are your opening hours?');
  const [tryBusy, setTryBusy] = useState(false);
  const [result, setResult] = useState<Decision | null>(null);

  useEffect(() => {
    api<Settings>('/ai/assistant').then((x) => { setS(x); setDraft(x); }).catch((e) => toast(errorText(e), 'error'));
    api<CalendarT[]>('/calendars').then(setCalendars).catch(() => {});
  }, [toast]);

  if (!s || !draft) return <section className="card mb-6 grid h-24 place-items-center"><Spinner /></section>;
  const dirty = JSON.stringify(pick(s)) !== JSON.stringify(pick(draft));
  const set = (p: Partial<Settings>) => setDraft({ ...draft, ...p });
  const toggleChannel = (c: 'email' | 'sms' | 'chat' | 'whatsapp' | 'facebook' | 'instagram') => set({ channels: draft.channels.includes(c) ? draft.channels.filter((x) => x !== c) : [...draft.channels, c] });

  async function save(override?: Partial<Settings>) {
    setSaving(true);
    try {
      const next = await api<Settings>('/ai/assistant', { method: 'PUT', body: pick({ ...draft!, ...override }) });
      setS(next);
      setDraft(next);
      toast(override?.enabled !== undefined ? (next.enabled ? 'AI assistant is on' : 'AI assistant is off') : 'Assistant settings saved');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function tryIt(e: React.FormEvent) {
    e.preventDefault();
    if (dirty) return toast('Save your changes first, then try it', 'error');
    setTryBusy(true);
    setResult(null);
    try {
      setResult(await api<Decision>('/ai/assistant/preview', { method: 'POST', body: { message: tryMsg, channel: draft!.channels[0] ?? 'sms' } }));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setTryBusy(false);
    }
  }

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm"><Icon name="sparkles" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            AI assistant
            <span className={`badge ${s.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-600'}`}>{s.enabled ? 'On' : 'Off'}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Answers incoming SMS and email from what you tell it, and hands the conversation to your team when it can’t help.</p>
        </div>
        {editable && (
          <button className={s.enabled ? 'btn-secondary' : 'btn-primary'} disabled={saving || (!s.enabled && !s.aiEnabled)} onClick={() => save({ enabled: !s.enabled })}>
            {s.enabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      {!s.aiEnabled && (
        <p className="flex items-start gap-2 border-b border-amber-200/70 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>AI isn’t configured on the server yet. Set <code className="rounded bg-white/70 px-1">ANTHROPIC_API_KEY</code> on the API to use the assistant. You can still prepare its settings.</span>
        </p>
      )}
      {s.simulated && (
        <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-500">Simulated AI (development mode): replies are canned, not written by Claude.</p>
      )}

      <fieldset disabled={!editable} className="grid gap-5 p-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="as-info">What the assistant knows</label>
            <textarea id="as-info" rows={7} maxLength={8000} className="input font-[inherit]" placeholder={PLACEHOLDER} value={draft.businessInfo} onChange={(e) => set({ businessInfo: e.target.value })} />
            <p className="mt-1.5 text-xs text-slate-500">Services, hours, prices, policies and common questions. It only answers from this — anything else goes to your team.</p>
          </div>
          <div>
            <label className="label" htmlFor="as-rules">Tone and rules (optional)</label>
            <textarea id="as-rules" rows={2} maxLength={2000} className="input" placeholder="e.g. Friendly and casual. Never offer discounts. Sign off as “The Sparkle team”." value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="as-handoff">Message sent when it hands off (optional)</label>
            <input id="as-handoff" maxLength={500} className="input" value={draft.handoffMessage} onChange={(e) => set({ handoffMessage: e.target.value })} />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <span className="label">Answer messages on</span>
            <div className="flex gap-2">
              {(['sms', 'whatsapp', 'facebook', 'instagram', 'email', 'chat'] as const).map((c) => (
                <label key={c} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${draft.channels.includes(c) ? 'border-brand-500 bg-brand-50/60 font-medium' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={draft.channels.includes(c)} onChange={() => toggleChannel(c)} />
                  <Icon name={c === 'sms' ? 'sms' : c === 'email' ? 'mail' : 'comment'} className="h-4 w-4 text-slate-500" />
                  {c === 'sms' ? 'SMS' : c === 'chat' ? 'Web chat' : c === 'whatsapp' ? 'WhatsApp' : c === 'facebook' ? 'Messenger' : c === 'instagram' ? 'Instagram' : 'Email'}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="as-max">Replies before handing off</label>
            <select id="as-max" className="input" value={draft.maxReplies} onChange={(e) => set({ maxReplies: Number(e.target.value) })}>
              {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n} per conversation</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="as-cal">Booking link it can share</label>
            <select id="as-cal" className="input" value={draft.calendarId ?? ''} onChange={(e) => set({ calendarId: e.target.value || null })}>
              <option value="">None</option>
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200/70">
            <p className="mb-1 font-medium text-slate-700">How it behaves</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Hands off when asked for a person, or for complaints, refunds and anything it can’t answer — and creates a task for your team.</li>
              <li>Stops in a conversation as soon as a teammate replies there. Resume it from the inbox.</li>
              <li>Never messages do-not-disturb contacts.</li>
            </ul>
            <p className="mt-2 text-slate-500">So far: {s.stats.botReplies} AI replies · {s.stats.pausedConversations} conversations with a person.</p>
          </div>
        </div>
      </fieldset>

      {editable && (
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {dirty && <button className="btn-ghost" onClick={() => setDraft(s)}>Discard</button>}
          <button className="btn-primary" disabled={!dirty || saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}

      <form onSubmit={tryIt} className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
        <label className="label" htmlFor="as-try">Try it — what would it say to…</label>
        <div className="flex flex-wrap gap-2">
          <input id="as-try" className="input min-w-[14rem] flex-1" maxLength={2000} value={tryMsg} onChange={(e) => setTryMsg(e.target.value)} />
          <button className="btn-secondary" disabled={tryBusy || !tryMsg.trim() || !s.aiEnabled}><Icon name="sparkles" /> {tryBusy ? 'Thinking…' : 'Preview reply'}</button>
        </div>
        {result && (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${result.action === 'reply' ? 'border-violet-200 bg-white' : 'border-amber-200 bg-amber-50'}`} role="status">
            {result.action === 'reply' ? (
              <>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-600"><Icon name="sparkles" className="h-3 w-3" /> Would reply</p>
                <p className="whitespace-pre-wrap text-slate-800">{result.message}</p>
              </>
            ) : (
              <p className="text-amber-900"><span className="font-semibold">Would hand off to your team:</span> {result.reason}</p>
            )}
            <p className="mt-2 text-xs text-slate-400">Preview only — nothing was sent.</p>
          </div>
        )}
      </form>
    </section>
  );
}

function pick(x: Settings) {
  return { enabled: x.enabled, channels: x.channels, businessInfo: x.businessInfo, instructions: x.instructions, maxReplies: x.maxReplies, handoffMessage: x.handoffMessage, calendarId: x.calendarId };
}
