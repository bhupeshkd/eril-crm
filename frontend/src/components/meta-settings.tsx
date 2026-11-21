'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

type Page = { id: string; platform: 'facebook' | 'instagram'; pageId: string; name: string; createdAt: string };
type Setup = { webhookUrl: string; verifyTokenSet: boolean; appSecretSet: boolean; provider: string };

/** Settings → Facebook & Instagram: connect pages so their direct messages land in Conversations. */
export function MetaSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('workspaces:write');
  const [data, setData] = useState<{ pages: Page[]; setup: Setup } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<{ pages: Page[]; setup: Setup }>('/meta/pages').then(setData).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  async function disconnect(p: Page) {
    if (!confirm(`Disconnect ${p.name}? New messages to it will no longer arrive, and you can't reply to its conversations.`)) return;
    try { await api(`/meta/pages/${p.id}`, { method: 'DELETE' }); toast('Disconnected'); load(); } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!data) return <section className="card mb-6 grid h-32 place-items-center"><Spinner /></section>;
  const s = data.setup;
  return (
    <section className="card mb-6" id="meta">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Icon name="comment" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Facebook &amp; Instagram messages</h2>
          <p className="text-[13px] text-slate-500">Messenger and Instagram direct messages arrive in Conversations. You can reply for 24 hours after a person&apos;s last message.</p>
        </div>
        {editable && <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Connect a page</button>}
      </div>
      <div className="space-y-3 p-5">
        {data.pages.length === 0 ? (
          <p className="text-sm text-slate-500">No pages connected yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.pages.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`badge ${p.platform === 'facebook' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>{p.platform === 'facebook' ? 'Messenger' : 'Instagram'}</span>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-slate-500">ID {p.pageId}</div></div>
                {editable && <button className="btn-ghost h-8 px-2 text-xs text-rose-600" onClick={() => disconnect(p)}>Disconnect</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div className="font-medium text-slate-700">Callback URL for your Meta app&apos;s webhooks (Messenger &amp; Instagram, field <code>messages</code>)</div>
          <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-white px-2 py-1.5 ring-1 ring-slate-200">{s.webhookUrl}</code>
          <ul className="mt-2 space-y-0.5">
            <li>{s.verifyTokenSet ? '✓ Verify token set (META_VERIFY_TOKEN)' : '• Set META_VERIFY_TOKEN on the server and enter the same value in Meta.'}</li>
            <li>{s.appSecretSet ? '✓ Requests are signature-checked (META_APP_SECRET)' : '• Development mode: signatures aren’t checked. Set META_APP_SECRET before going live.'}</li>
            <li>{s.provider === 'meta' ? '✓ Replies are sent through Meta' : '• Replies are logged, not sent (set META_PROVIDER=meta to send).'}</li>
          </ul>
        </div>
      </div>
      {adding && <ConnectPage onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast('Page connected'); load(); }} />}
    </section>
  );
}

function ConnectPage({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ platform: 'facebook' as Page['platform'], pageId: '', name: '', accessToken: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api('/meta/pages', { method: 'POST', body: f }); onSaved(); } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Connect a page" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="flex gap-2">
          {(['facebook', 'instagram'] as const).map((p) => (
            <label key={p} className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm ${f.platform === p ? 'border-brand-500 bg-brand-50/60 font-medium' : 'border-slate-200'}`}>
              <input type="radio" className="sr-only" checked={f.platform === p} onChange={() => setF({ ...f, platform: p })} /> {p === 'facebook' ? 'Facebook Page' : 'Instagram account'}
            </label>
          ))}
        </div>
        <div><label className="label" htmlFor="mp-name">Name</label><input id="mp-name" required maxLength={120} className="input" placeholder="Bloom Studio" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="mp-id">{f.platform === 'facebook' ? 'Page ID' : 'Instagram account ID'}</label><input id="mp-id" required inputMode="numeric" className="input" placeholder="104501234567890" value={f.pageId} onChange={(e) => setF({ ...f, pageId: e.target.value.trim() })} /></div>
        <div><label className="label" htmlFor="mp-token">Page access token</label><input id="mp-token" required type="password" autoComplete="off" className="input" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} /><p className="mt-1 text-xs text-slate-500">From your Meta app (Messenger settings). It&apos;s stored on the server and never shown again.</p></div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Connect</button></div>
      </form>
    </Modal>
  );
}
