'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

type Widget = { publicKey: string; enabled: boolean; title: string; greeting: string; askFor: 'none' | 'email' | 'name_email'; color: string; position: 'right' | 'left' };

/** Settings → Website chat: the chat bubble for the business's own site; chats land in Conversations. */
export function ChatWidgetSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const [saved, setSaved] = useState<Widget | null>(null);
  const [w, setW] = useState<Widget | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const editable = can('conversations:write');

  useEffect(() => {
    api<Widget>('/chat-widget').then((x) => { setSaved(x); setW(x); }).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);

  if (!w || !saved) return <section className="card mb-6 grid h-32 place-items-center"><Spinner /></section>;
  const dirty = JSON.stringify(w) !== JSON.stringify(saved);
  const colorOk = !w.color || /^#[0-9a-f]{6}$/i.test(w.color);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const embed = `<script src="${origin}/widget.js" data-key="${w.publicKey}" async></script>`;

  async function save(patch?: Partial<Widget>) {
    setBusy(true);
    try {
      const body = { ...w!, ...patch };
      const next = await api<Widget>('/chat-widget', { method: 'PUT', body: { enabled: body.enabled, title: body.title, greeting: body.greeting, askFor: body.askFor, color: body.color, position: body.position } });
      setSaved(next);
      setW(next);
      toast(patch?.enabled !== undefined ? (next.enabled ? 'Website chat is on' : 'Website chat is off') : 'Chat settings saved');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(embed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Copy failed — select the code and copy it manually', 'error');
    }
  }

  return (
    <section className="card mb-6" id="chat">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><Icon name="comment" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Website chat</h2>
          <p className="text-[13px] text-slate-500">A chat bubble for your website. Visitors become contacts and their messages arrive in Conversations{saved.enabled ? '' : ' once it’s on'}.</p>
        </div>
        {editable && (
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="peer sr-only" checked={saved.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} />
            <span className="relative h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-brand-600 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
            {saved.enabled ? 'On' : 'Off'}
          </label>
        )}
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_260px]">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cw-title">Title</label>
              <input id="cw-title" maxLength={60} className="input" value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cw-ask">Before chatting, ask for</label>
              <select id="cw-ask" className="input" value={w.askFor} onChange={(e) => setW({ ...w, askFor: e.target.value as Widget['askFor'] })}>
                <option value="email">Email</option>
                <option value="name_email">Name and email</option>
                <option value="none">Nothing (anonymous)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="cw-greet">Greeting</label>
            <input id="cw-greet" maxLength={300} className="input" value={w.greeting} onChange={(e) => setW({ ...w, greeting: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cw-color">Colour</label>
              <div className="flex items-center gap-2">
                <input aria-label="Pick colour" type="color" className="h-9 w-12 cursor-pointer rounded border border-slate-200" value={w.color || '#5847d7'} onChange={(e) => setW({ ...w, color: e.target.value })} />
                <input id="cw-color" className="input" placeholder="Brand colour" value={w.color} onChange={(e) => setW({ ...w, color: e.target.value.trim() })} />
              </div>
              <p className={`mt-1 text-xs ${colorOk ? 'text-slate-500' : 'text-rose-600'}`}>{colorOk ? 'Empty uses your brand colour.' : 'Use a hex colour like #0ea5e9.'}</p>
            </div>
            <div>
              <span className="label">Position</span>
              <div className="flex gap-2">
                {(['left', 'right'] as const).map((p) => (
                  <label key={p} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize ${w.position === p ? 'border-brand-500 bg-brand-50/60 font-medium' : 'border-slate-200'}`}>
                    <input type="radio" className="sr-only" checked={w.position === p} onChange={() => setW({ ...w, position: p })} /> Bottom {p}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div>
            <span className="label">Embed code</span>
            <div className="flex items-start gap-2">
              <code className="block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2.5 text-xs text-slate-100">{embed}</code>
              <button type="button" className="btn-secondary h-9 shrink-0 px-3 text-xs" onClick={copy}><Icon name={copied ? 'check' : 'copy'} className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Paste it before <code>&lt;/body&gt;</code> on every page of your site. Chats show up under Conversations → Chat; the AI assistant can answer them too.</p>
          </div>
          {editable && dirty && (
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setW(saved)}>Discard</button>
              <button type="button" className="btn-primary" disabled={busy || !colorOk || !w.title.trim()} onClick={() => save()}>Save</button>
            </div>
          )}
        </fieldset>

        {/* Live preview */}
        <div aria-hidden className="relative h-[300px] overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100">
          <div className="absolute inset-x-4 top-4 space-y-2 opacity-60"><div className="h-2.5 w-2/3 rounded bg-slate-300" /><div className="h-2 w-1/2 rounded bg-slate-200" /><div className="h-2 w-3/5 rounded bg-slate-200" /></div>
          <div className={`absolute bottom-16 w-[200px] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200 ${w.position === 'left' ? 'left-3' : 'right-3'}`}>
            <div className="px-3 py-2 text-xs font-semibold text-white" style={{ background: colorOk && w.color ? w.color : 'rgb(var(--brand-600))' }}>{w.title || 'Chat with us'}</div>
            <div className="bg-slate-50 p-2"><div className="rounded-lg rounded-bl-sm bg-white px-2 py-1.5 text-[11px] shadow-sm ring-1 ring-slate-200/70">{w.greeting || '…'}</div></div>
          </div>
          <div className={`absolute bottom-3 grid h-11 w-11 place-items-center rounded-full text-white shadow-lg ${w.position === 'left' ? 'left-3' : 'right-3'}`} style={{ background: colorOk && w.color ? w.color : 'rgb(var(--brand-600))' }}>
            <Icon name="comment" className="h-5 w-5" />
          </div>
        </div>
      </div>
    </section>
  );
}
