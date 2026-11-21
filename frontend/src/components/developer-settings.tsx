'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, errorText, useToast } from './ui';

interface Key { id: string; name: string; keyPrefix: string; role: string; lastUsedAt: string | null; createdAt: string }
interface Hook { id: string; url: string; events: string[]; isActive: boolean; lastStatus: string | null; lastDeliveredAt: string | null; failureCount: number }

/** API keys for the public REST API + outgoing webhook subscriptions. */
export function DeveloperSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const [keys, setKeys] = useState<Key[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyRole, setKeyRole] = useState('workspace_admin');
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>([]);

  const load = useCallback(() => {
    api<Key[]>('/developer/api-keys').then(setKeys).catch(() => {});
    api<Hook[]>('/developer/webhooks').then(setHooks).catch(() => {});
    api<string[]>('/developer/events').then(setEventTypes).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!can('integrations:read')) return null;
  const editable = can('integrations:write');

  return (
    <section className="card p-5">
      <h2 className="-mx-5 -mt-5 mb-3 border-b border-slate-100 px-5 py-4 font-semibold">Developer: API &amp; webhooks</h2>
      <p className="mb-4 text-sm text-slate-500">
        Connect other tools. Call the REST API at <code className="rounded bg-slate-100 px-1">{API_URL}</code> with header <code className="rounded bg-slate-100 px-1">x-api-key</code>; receive events by webhook, signed with HMAC-SHA256.
      </p>

      <h3 className="mb-2 text-sm font-semibold">API keys</h3>
      {editable && (
        <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const k = await api('/developer/api-keys', { method: 'POST', body: { name: keyName, role: keyRole } });
            setSecret({ title: 'Your new API key', value: k.key, note: 'Copy it now — for security it will not be shown again.' });
            setKeyName('');
            load();
          } catch (err) { toast(errorText(err), 'error'); }
        }}>
          <div><label className="label" htmlFor="k-name">Key name</label><input id="k-name" required className="input" placeholder="e.g. Zapier" value={keyName} onChange={(e) => setKeyName(e.target.value)} /></div>
          <div><label className="label" htmlFor="k-role">Access</label>
            <select id="k-role" className="input" value={keyRole} onChange={(e) => setKeyRole(e.target.value)}>
              <option value="workspace_admin">Full (admin)</option><option value="manager">Manager</option><option value="sales_agent">Sales agent</option><option value="marketing_manager">Marketing</option><option value="team_member">Team member</option>
            </select>
          </div>
          <button className="btn-primary">Create key</button>
        </form>
      )}
      {keys.length === 0 ? <p className="mb-4 text-sm text-slate-500">No API keys.</p> : (
        <table className="mb-6 w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="py-2">Name</th><th className="py-2">Key</th><th className="py-2">Access</th><th className="py-2">Last used</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="py-2 font-medium">{k.name}</td>
                <td className="py-2"><code className="text-xs">{k.keyPrefix}…</code></td>
                <td className="py-2 capitalize">{k.role.replace(/_/g, ' ')}</td>
                <td className="py-2 text-slate-500">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'Never'}</td>
                <td className="py-2 text-right">{editable && <button className="btn-ghost px-2 py-1 text-rose-600" onClick={async () => { if (confirm(`Revoke "${k.name}"? Apps using it will stop working.`)) { await api(`/developer/api-keys/${k.id}`, { method: 'DELETE' }); load(); } }}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mb-2 text-sm font-semibold">Webhooks</h3>
      {editable && (
        <form className="mb-3 space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const h = await api('/developer/webhooks', { method: 'POST', body: { url: hookUrl, events: hookEvents } });
            setSecret({ title: 'Webhook signing secret', value: h.secret, note: 'Verify X-Eril-Signature = sha256=HMAC_SHA256(secret, `${X-Eril-Timestamp}.${rawBody}`). Shown once.' });
            setHookUrl('');
            setHookEvents([]);
            load();
          } catch (err) { toast(errorText(err), 'error'); }
        }}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1"><label className="label" htmlFor="h-url">Endpoint URL</label><input id="h-url" type="url" required className="input" placeholder="https://example.com/webhooks/eril" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} /></div>
            <button className="btn-primary">Add webhook</button>
          </div>
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="mb-1 text-xs text-slate-500">Events (none selected = all)</legend>
            {eventTypes.map((t) => (
              <button type="button" key={t} aria-pressed={hookEvents.includes(t)} onClick={() => setHookEvents(hookEvents.includes(t) ? hookEvents.filter((x) => x !== t) : [...hookEvents, t])} className={`badge ${hookEvents.includes(t) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{t}</button>
            ))}
          </fieldset>
        </form>
      )}
      {hooks.length === 0 ? <p className="text-sm text-slate-500">No webhooks.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={`h-2 w-2 rounded-full ${!h.isActive ? 'bg-slate-300' : h.failureCount ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden />
              <code className="min-w-0 flex-1 truncate text-xs">{h.url}</code>
              <span className="text-xs text-slate-500">{h.events.length ? h.events.join(', ') : 'all events'}</span>
              <span className="w-full pl-4 text-xs text-slate-400 sm:w-auto sm:pl-0">{h.isActive ? (h.lastStatus ? `Last: ${h.lastStatus}` : 'No deliveries yet') : 'Disabled'}</span>
              {editable && (
                <span className="flex gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={async () => { try { const r = await api(`/developer/webhooks/${h.id}/test`, { method: 'POST' }); toast(`Test delivered (${r.detail})`); } catch (err) { toast(errorText(err), 'error'); } load(); }}>Send test</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={async () => { await api(`/developer/webhooks/${h.id}`, { method: 'PUT', body: { url: h.url, events: h.events, isActive: !h.isActive } }); load(); }}>{h.isActive ? 'Disable' : 'Enable'}</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm('Delete this webhook?')) { await api(`/developer/webhooks/${h.id}`, { method: 'DELETE' }); load(); } }}>Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!secret} title={secret?.title ?? ''} onClose={() => setSecret(null)}>
        {secret && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input readOnly aria-label={secret.title} className="input font-mono text-xs" value={secret.value} onFocus={(e) => e.target.select()} />
              <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(secret.value); toast('Copied'); }}>Copy</button>
            </div>
            <p className="text-sm text-amber-700">{secret.note}</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={() => setSecret(null)}>Done</button></div>
          </div>
        )}
      </Modal>
    </section>
  );
}
