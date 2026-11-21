'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

export interface PhoneNumberT {
  id: string; number: string; label: string; forwardTo: string | null; ringSeconds: number; voicemailEnabled: boolean; greeting: string;
  textBackEnabled: boolean; textBackMessage: string; textBackCooldownHours: number;
  recordCalls: boolean; recordingNotice: string; menuEnabled: boolean; menuPrompt: string; menuOptions: MenuOpt[];
}
type MenuOpt = { digit: string; label: string; forwardTo: string };
type Overview = { numbers: PhoneNumberT[]; webhooks: { voice: string; messaging: string; method: string }; signatureRequired: boolean };

/** Settings → Phone: business numbers, call forwarding, voicemail and missed-call text-back. */
export function PhoneSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('workspaces:write');
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<PhoneNumberT | 'new' | null>(null);
  const [testing, setTesting] = useState<PhoneNumberT | null>(null);

  const load = useCallback(() => {
    api<Overview>('/phone/numbers').then(setData).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  if (!data) return <section className="card mb-6 grid h-32 place-items-center"><Spinner /></section>;
  return (
    <section className="card mb-6" id="phone">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name="phone" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Phone &amp; missed-call text-back</h2>
          <p className="text-[13px] text-slate-500">Calls to your business number ring your phone. If nobody answers, the caller can leave a voicemail and automatically gets a text so the lead isn&apos;t lost.</p>
        </div>
        {editable && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add number</button>}
      </div>
      <div className="space-y-3 p-5">
        {data.numbers.length === 0 ? (
          <p className="text-sm text-slate-500">No numbers yet. Buy a number with your phone provider (e.g. Twilio), add it here, and set its incoming-call webhook to the address below.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium tabular-nums">{n.number}{n.label && <span className="ml-2 text-sm font-normal text-slate-500">{n.label}</span>}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span>{n.forwardTo ? `Rings ${n.forwardTo} for ${n.ringSeconds}s` : 'No forwarding — straight to voicemail'}</span>
                    <span>{n.voicemailEnabled ? 'Voicemail on' : 'Voicemail off'}</span>
                    <span className={n.textBackEnabled ? 'text-emerald-700' : ''}>{n.textBackEnabled ? 'Text-back on' : 'Text-back off'}</span>
                    {n.menuEnabled && <span>Menu: {n.menuOptions.map((o) => `${o.digit} ${o.label}`).join(' · ')}</span>}
                    {n.recordCalls && <span className="text-rose-700">Recording calls</span>}
                  </div>
                </div>
                {editable && (
                  <span className="flex gap-1">
                    <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setTesting(n)}><Icon name="play" className="h-3.5 w-3.5" /> Test</button>
                    <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setEditing(n)}>Edit</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div className="font-medium text-slate-700">Incoming-call webhook ({data.webhooks.method})</div>
          <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-white px-2 py-1.5 ring-1 ring-slate-200">{data.webhooks.voice}</code>
          <div className="mt-2 font-medium text-slate-700">Incoming-message webhook (SMS and WhatsApp, {data.webhooks.method})</div>
          <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-white px-2 py-1.5 ring-1 ring-slate-200">{data.webhooks.messaging}</code>
          <p className="mt-1.5">Customer replies then land in Conversations. Replies of STOP turn messages off for that contact; START turns them back on.</p>
          <p className="mt-1.5">{data.signatureRequired ? 'Requests are checked against your provider signature (TWILIO_AUTH_TOKEN).' : 'Development mode: webhook signatures are not checked. Set TWILIO_AUTH_TOKEN before going live.'}</p>
        </div>
      </div>
      {editing && <NumberEditor n={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); load(); }} />}
      {testing && <TestCall n={testing} onClose={() => setTesting(null)} />}
    </section>
  );
}

function NumberEditor({ n, onClose, onSaved }: { n: PhoneNumberT | null; onClose: () => void; onSaved: (m: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    number: n?.number ?? '', label: n?.label ?? '', forwardTo: n?.forwardTo ?? '', ringSeconds: n?.ringSeconds ?? 20, voicemailEnabled: n?.voicemailEnabled ?? true,
    greeting: n?.greeting ?? 'Sorry, we cannot take your call right now. Please leave a message after the tone.', textBackEnabled: n?.textBackEnabled ?? true,
    textBackMessage: n?.textBackMessage ?? 'Hi {{first_name}}, sorry we missed your call! This is {{business}} — how can we help?', textBackCooldownHours: n?.textBackCooldownHours ?? 24,
    recordCalls: n?.recordCalls ?? false, recordingNotice: n?.recordingNotice ?? 'This call may be recorded.',
    menuEnabled: n?.menuEnabled ?? false, menuPrompt: n?.menuPrompt ?? '', menuOptions: n?.menuOptions ?? ([] as MenuOpt[]),
  });
  const setOpt = (i: number, patch: Partial<MenuOpt>) => setF({ ...f, menuOptions: f.menuOptions.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const nextDigit = () => String([1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => !f.menuOptions.some((o) => o.digit === String(d))) ?? 9);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { number, ...rest } = f;
      const body = { ...rest, forwardTo: f.forwardTo.trim() || null };
      await api(n ? `/phone/numbers/${n.id}` : '/phone/numbers', { method: n ? 'PUT' : 'POST', body: n ? body : { number, ...body } });
      onSaved(n ? 'Number saved' : 'Number added');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!n || !confirm(`Remove ${n.number}? Its call history stays.`)) return;
    try { await api(`/phone/numbers/${n.id}`, { method: 'DELETE' }); onSaved('Number removed'); } catch (err) { toast(errorText(err), 'error'); }
  }
  return (
    <Modal open wide title={n ? `Edit ${n.number}` : 'Add a business number'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="pn-num">Business number</label><input id="pn-num" required={!n} disabled={!!n} className="input" placeholder="+14155550100" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
          <div><label className="label" htmlFor="pn-label">Label</label><input id="pn-label" maxLength={80} className="input" placeholder="Main line" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
          <div><label className="label" htmlFor="pn-fwd">Ring this phone</label><input id="pn-fwd" className="input" placeholder="+14155550199 (your mobile)" value={f.forwardTo} onChange={(e) => setF({ ...f, forwardTo: e.target.value })} /></div>
          <div><label className="label" htmlFor="pn-ring">Ring for (seconds)</label><input id="pn-ring" type="number" min={5} max={60} className="input" value={f.ringSeconds} onChange={(e) => setF({ ...f, ringSeconds: Number(e.target.value) })} /></div>
        </div>
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.voicemailEnabled} onChange={(e) => setF({ ...f, voicemailEnabled: e.target.checked })} /> Voicemail</label>
          <textarea aria-label="Voicemail greeting" rows={2} maxLength={500} className="input" value={f.greeting} onChange={(e) => setF({ ...f, greeting: e.target.value })} />
        </fieldset>
        <fieldset className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.textBackEnabled} onChange={(e) => setF({ ...f, textBackEnabled: e.target.checked })} /> Text back missed callers</label>
          <textarea aria-label="Text-back message" rows={2} maxLength={480} className="input" value={f.textBackMessage} onChange={(e) => setF({ ...f, textBackMessage: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Use <code>{'{{first_name}}'}</code> and <code>{'{{business}}'}</code>. Don&apos;t text the same caller again within
            <input aria-label="Cooldown hours" type="number" min={0} max={720} className="input w-20 py-1" value={f.textBackCooldownHours} onChange={(e) => setF({ ...f, textBackCooldownHours: Number(e.target.value) })} /> hours.
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.menuEnabled} onChange={(e) => setF({ ...f, menuEnabled: e.target.checked, menuOptions: e.target.checked && !f.menuOptions.length ? [{ digit: '1', label: 'Sales', forwardTo: f.forwardTo }] : f.menuOptions })} /> Phone menu (&ldquo;For Sales, press 1&rdquo;)</label>
          {f.menuEnabled && (
            <div className="space-y-2">
              <input aria-label="Menu greeting" maxLength={300} className="input" placeholder="Thanks for calling. (Options are read out after this.)" value={f.menuPrompt} onChange={(e) => setF({ ...f, menuPrompt: e.target.value })} />
              {f.menuOptions.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select aria-label="Key" className="input w-16 py-1" value={o.digit} onChange={(e) => setOpt(i, { digit: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <option key={d}>{d}</option>)}</select>
                  <input aria-label="Option name" maxLength={40} className="input py-1" placeholder="Sales" value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
                  <input aria-label="Ring" className="input py-1" placeholder="+14155550101" value={o.forwardTo} onChange={(e) => setOpt(i, { forwardTo: e.target.value })} />
                  <button type="button" className="btn-ghost px-2" aria-label="Remove option" onClick={() => setF({ ...f, menuOptions: f.menuOptions.filter((_, k) => k !== i) })}>✕</button>
                </div>
              ))}
              {f.menuOptions.length < 9 && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setF({ ...f, menuOptions: [...f.menuOptions, { digit: nextDigit(), label: '', forwardTo: '' }] })}>+ option</button>}
              <p className="text-xs text-slate-500">If the caller presses nothing, the call rings the phone above. A wrong key gets one more try.</p>
            </div>
          )}
        </fieldset>
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.recordCalls} onChange={(e) => setF({ ...f, recordCalls: e.target.checked })} /> Record answered calls</label>
          {f.recordCalls && <input aria-label="Recording notice" maxLength={200} className="input" value={f.recordingNotice} onChange={(e) => setF({ ...f, recordingNotice: e.target.value })} />}
          {f.recordCalls && <p className="text-xs text-slate-500">Played to callers before connecting. Many places require telling people a call is recorded.</p>}
        </fieldset>
        <div className="flex items-center justify-between">
          <div>{n && <button type="button" className="btn-ghost text-sm text-rose-600" onClick={remove}>Remove number</button>}</div>
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{n ? 'Save' : 'Add number'}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function TestCall({ n, onClose }: { n: PhoneNumberT; onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [outcome, setOutcome] = useState<'missed' | 'voicemail' | 'answered'>('missed');
  const [result, setResult] = useState<{ status: string; textedBack: boolean } | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    try { setResult(await api(`/phone/numbers/${n.id}/simulate`, { method: 'POST', body: { from, outcome } })); } catch (err) { toast(errorText(err), 'error'); }
  }
  return (
    <Modal open title={`Test a call to ${n.number}`} onClose={onClose}>
      <form onSubmit={run} className="space-y-3">
        <p className="text-sm text-slate-600">Runs the whole call flow without a real call (development only). A missed call sends the text-back to the caller number below.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="tc-from">Caller number</label><input id="tc-from" required className="input" placeholder="+14155550123" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="tc-out">What happens</label><select id="tc-out" className="input" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}><option value="missed">Nobody answers</option><option value="voicemail">Caller leaves voicemail</option><option value="answered">Call answered</option></select></div>
        </div>
        {result && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">Logged as <b>{result.status}</b>{result.textedBack ? ' · text-back sent' : result.status !== 'answered' ? ' · no text sent (off, cooldown, do-not-disturb or no number)' : ''}.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary">Run test call</button></div>
      </form>
    </Modal>
  );
}
