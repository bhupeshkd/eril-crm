'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

interface Domain {
  id: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dns: { txt: { name: string; value: string }; cname: { name: string; value: string } };
  cname?: 'ok' | 'missing' | 'other';
}

const STATUS: Record<Domain['status'], string> = {
  verified: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost h-7 shrink-0 px-2 text-xs" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}>
      <Icon name={done ? 'check' : 'copy'} className="h-3.5 w-3.5" />
    </button>
  );
}

function Record({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="grid grid-cols-[52px_1fr] items-center gap-x-2 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs">
      <span className="font-semibold text-slate-500">{type}</span>
      <div className="flex min-w-0 items-center gap-1"><code className="min-w-0 truncate" title={name}>{name}</code><Copy text={name} /></div>
      <span className="text-slate-400">value</span>
      <div className="flex min-w-0 items-center gap-1"><code className="min-w-0 truncate" title={value}>{value}</code><Copy text={value} /></div>
    </div>
  );
}

/** Sites → a site → Domains: connect the customer's own domain (verified by a DNS TXT record). */
export function SiteDomains({ siteId, published, canEdit, onClose }: { siteId: string; published: boolean; canEdit: boolean; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Domain[] | null>(null);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ domains: Domain[] }>(`/sites/${siteId}/domains`).then((r) => setList(r.domains)).catch((e) => toast(errorText(e), 'error'));
  }, [siteId, toast]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    try {
      await api(`/sites/${siteId}/domains`, { method: 'POST', body: { hostname: host } });
      setHost('');
      load();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(null); }
  }
  async function verify(d: Domain) {
    setBusy(d.id);
    try {
      const r = await api<Domain>(`/sites/${siteId}/domains/${d.id}/verify`, { method: 'POST' });
      setList((l) => l?.map((x) => (x.id === d.id ? r : x)) ?? null);
      toast(r.status === 'verified' ? `${d.hostname} is connected` : 'Not verified yet — DNS changes can take a while', r.status === 'verified' ? 'ok' : 'error');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(null); }
  }
  async function remove(d: Domain) {
    if (!confirm(`Disconnect ${d.hostname}? Visitors to it will no longer see this site.`)) return;
    try {
      await api(`/sites/${siteId}/domains/${d.id}`, { method: 'DELETE' });
      load();
    } catch (err) { toast(errorText(err), 'error'); }
  }

  return (
    <Modal open wide title="Custom domains" onClose={onClose}>
      <div className="space-y-4">
        {!published && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Publish the site so connected domains show it.</p>}
        {canEdit && (
          <form onSubmit={add} className="flex gap-2">
            <input aria-label="Domain" className="input" placeholder="www.yourbusiness.com" value={host} onChange={(e) => setHost(e.target.value)} required maxLength={253} />
            <button className="btn-primary shrink-0" disabled={busy === 'add'}><Icon name="plus" /> Add domain</button>
          </form>
        )}
        {!list ? <div className="grid h-24 place-items-center"><Spinner /></div> : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No domains yet. Add one, then create the DNS records we show you at your domain provider.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((d) => (
              <li key={d.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{d.hostname}</a>
                  <span className={`badge capitalize ${STATUS[d.status]}`}>{d.status === 'verified' ? 'connected' : d.status}</span>
                  <span className="ml-auto flex gap-1">
                    {canEdit && d.status !== 'verified' && <button className="btn-secondary h-8 px-3 text-xs" disabled={busy === d.id} onClick={() => verify(d)}>{busy === d.id ? 'Checking…' : 'Verify now'}</button>}
                    {canEdit && <button className="btn-ghost h-8 px-2 text-xs text-rose-600" onClick={() => remove(d)}>Remove</button>}
                  </span>
                </div>
                {d.status === 'verified' ? (
                  <p className="mt-2 text-xs text-slate-500">Connected {d.verifiedAt ? new Date(d.verifiedAt).toLocaleDateString() : ''}. Keep the records below in place.{d.cname === 'other' ? ' Note: the CNAME points somewhere else, so visitors may not reach this site.' : ''}</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-slate-600">At your domain provider, add these records, then press <b>Verify now</b>. We also check automatically every few minutes for 3 days.</p>
                    {d.lastError && <p className="mt-1 text-xs text-amber-700">{d.lastError}</p>}
                  </>
                )}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <Record type="TXT" name={d.dns.txt.name} value={d.dns.txt.value} />
                  <Record type="CNAME" name={d.dns.cname.name} value={d.dns.cname.value} />
                </div>
                <p className="mt-2 text-[11px] text-slate-400">The TXT record proves you own the domain. The CNAME sends visitors here (for a root domain like yourbusiness.com, use your provider&apos;s ALIAS/ANAME record instead). HTTPS is set up automatically once connected.</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
