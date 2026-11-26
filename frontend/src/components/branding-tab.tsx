'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { BrandMark, DEFAULT_BRANDING, palette, type Branding } from '@/lib/branding';
import { Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

const SWATCHES = ['#5847d7', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#0f172a'];

/** Agency → Branding: app name, logo and colour shown to every sub-account and on customer pages. */
export function BrandingTab({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [saved, setSaved] = useState<Branding | null>(null);
  const [b, setB] = useState<Branding>(DEFAULT_BRANDING);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSaved(null);
    api<Branding>(`/agency/${orgId}/branding`).then((x) => { setSaved(x); setB(x); }).catch((e) => toast(errorText(e), 'error'));
  }, [orgId, toast]);

  // Scope the chosen colour to the preview box only: the brand scale is CSS variables, so they cascade.
  const previewVars = useMemo(() => {
    if (!/^#[0-9a-f]{6}$/i.test(b.primaryColor)) return {};
    return Object.fromEntries(Object.entries(palette(b.primaryColor)).map(([k, v]) => [`--brand-${k}`, v])) as React.CSSProperties;
  }, [b.primaryColor]);

  if (!saved) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  const dirty = JSON.stringify(saved) !== JSON.stringify(b);
  const colourOk = /^#[0-9a-f]{6}$/i.test(b.primaryColor);
  const logoOk = !b.logoUrl || /^https:\/\/\S+$/.test(b.logoUrl);

  async function save() {
    setBusy(true);
    try {
      const next = await api<Branding>(`/agency/${orgId}/branding`, { method: 'PUT', body: b });
      setSaved(next);
      setB(next);
      window.dispatchEvent(new Event('eril:branding-changed'));
      toast('Branding saved');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <section className="card">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">White-label branding</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Your name, logo and colour replace ERIL’s in the app for every sub-account in this organization, and on customer pages like booking, invoices and forms.</p>
        </div>
        <div className="space-y-5 p-5">
          <div>
            <label className="label" htmlFor="br-name">App name</label>
            <input id="br-name" maxLength={40} className="input" placeholder="ERIL" value={b.appName} onChange={(e) => setB({ ...b, appName: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="br-logo">Logo URL</label>
            <div className="flex items-center gap-3">
              <BrandMark b={{ ...b, logoUrl: logoOk ? b.logoUrl : '' }} size="h-10 w-10 rounded-xl text-base" />
              <input id="br-logo" type="url" maxLength={500} className="input" placeholder="https://example.com/logo.png" value={b.logoUrl} onChange={(e) => setB({ ...b, logoUrl: e.target.value.trim() })} />
            </div>
            <p className={`mt-1.5 text-xs ${logoOk ? 'text-slate-500' : 'text-rose-600'}`}>{logoOk ? 'A square image works best (at least 64×64). Leave empty to use your initial.' : 'Use an https:// link.'}</p>
          </div>
          <div>
            <span className="label">Brand colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  aria-pressed={b.primaryColor.toLowerCase() === c}
                  onClick={() => setB({ ...b, primaryColor: c })}
                  className={`h-8 w-8 rounded-full ring-offset-2 transition hover:scale-110 ${b.primaryColor.toLowerCase() === c ? 'ring-2 ring-slate-900' : 'ring-1 ring-black/10'}`}
                  style={{ background: c }}
                />
              ))}
              <span className="mx-1 h-6 w-px bg-slate-200" />
              <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full ring-1 ring-black/10" title="Pick any colour" style={{ background: colourOk ? b.primaryColor : '#fff' }}>
                <input type="color" aria-label="Custom colour" className="absolute inset-0 cursor-pointer opacity-0" value={colourOk ? b.primaryColor : '#5847d7'} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} />
              </label>
              <input aria-label="Colour hex code" maxLength={7} className={`input h-9 w-28 font-mono text-[13px] ${colourOk ? '' : 'border-rose-300'}`} value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value.trim() })} />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={b.hidePoweredBy} onChange={(e) => setB({ ...b, hidePoweredBy: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-900">Hide “Powered by” on customer pages</span>
              <span className="block text-[13px] text-slate-500">When off, the footer shows “Powered by {b.appName || 'ERIL'}”.</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-ghost" disabled={!dirty || busy} onClick={() => setB(saved)}>Discard</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setB({ ...DEFAULT_BRANDING })}>Reset to ERIL</button>
          <button className="btn-primary" disabled={!dirty || busy || !colourOk || !logoOk} onClick={save}>{busy ? 'Saving…' : 'Save branding'}</button>
        </div>
      </section>

      <aside className="space-y-3" aria-label="Preview">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preview</p>
        <div className="card overflow-hidden" style={previewVars}>
          <div className="flex">
            <div className="w-40 shrink-0 space-y-1 border-r border-slate-200/80 bg-slate-50 p-3">
              <div className="mb-3 flex items-center gap-2">
                <BrandMark b={{ ...b, appName: b.appName || 'ERIL', logoUrl: logoOk ? b.logoUrl : '' }} size="h-6 w-6 rounded-md text-[11px]" />
                <span className="truncate text-[13px] font-semibold">{b.appName || 'ERIL'}</span>
              </div>
              {['Dashboard', 'Contacts', 'Inbox'].map((l, i) => (
                <div key={l} className={`flex items-center gap-2 rounded-md px-2 py-1 text-[12px] ${i === 1 ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200/80' : 'text-slate-500'}`}>
                  <span className={`h-2.5 w-2.5 rounded-sm ${i === 1 ? 'bg-brand-600' : 'bg-slate-300'}`} />
                  {l}
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Contacts</span>
                <span className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white shadow-sm">+ New</span>
              </div>
              <div className="flex gap-1 rounded-md bg-slate-100 p-0.5 text-[10px]">
                <span className="rounded bg-white px-1.5 py-0.5 font-medium shadow-sm">All</span>
                <span className="px-1.5 py-0.5 text-slate-500">Leads</span>
              </div>
              <span className="badge bg-brand-50 text-brand-700 ring-brand-600/15">vip</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 rounded-full bg-brand-500" /></div>
            </div>
          </div>
        </div>
        <div className="card overflow-hidden" style={previewVars}>
          <div className="bg-gradient-to-b from-brand-100/70 to-white px-4 pb-3 pt-4">
            <div className="mx-auto max-w-[220px] rounded-lg bg-white p-3 text-center shadow-sm ring-1 ring-slate-200/70">
              <p className="text-[12px] font-semibold">Book a call</p>
              <div className="mt-2 rounded-md bg-brand-600 py-1 text-[11px] font-medium text-white">Confirm booking</div>
            </div>
            {!b.hidePoweredBy ? (
              <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-slate-400">
                Powered by <BrandMark b={{ ...b, appName: b.appName || 'ERIL', logoUrl: logoOk ? b.logoUrl : '' }} size="h-3.5 w-3.5 rounded text-[8px]" /> <span className="font-medium text-slate-500">{b.appName || 'ERIL'}</span>
              </p>
            ) : (
              <p className="mt-2 text-center text-[10px] text-slate-300">No footer</p>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500"><Icon name="sites" className="mr-1 inline h-3 w-3" />Customer pages: booking, invoices, forms, reviews, courses, communities</p>
        </div>
      </aside>
    </div>
    <AppDomainsCard orgId={orgId} appName={saved.appName} />
    </div>
  );
}

type AppDomain = {
  id: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  lastError: string | null;
  dns: { txt: { name: string; value: string }; cname: { name: string; value: string } };
};

function CopyValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-left font-mono text-[12px] text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
      title="Copy"
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copied'), () => {})}
    >
      <span className="truncate">{value}</span>
    </button>
  );
}

/** Agency → Branding → App domain: staff sign in at the agency's own address, e.g. app.theiragency.com. */
function AppDomainsCard({ orgId, appName }: { orgId: string; appName: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<AppDomain[] | null>(null);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<{ domains: AppDomain[] }>(`/agency/${orgId}/app-domains`).then((x) => setRows(x.domains)).catch((e) => toast(errorText(e), 'error'));
  }, [orgId, toast]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    try {
      const d = await api<AppDomain>(`/agency/${orgId}/app-domains`, { method: 'POST', body: { hostname: host } });
      setRows((r) => [...(r ?? []), d]);
      setHost('');
      toast('Domain added. Add the DNS records, then verify.');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function verify(d: AppDomain) {
    setBusy(d.id);
    try {
      const next = await api<AppDomain>(`/agency/${orgId}/app-domains/${d.id}/verify`, { method: 'POST' });
      setRows((r) => (r ?? []).map((x) => (x.id === d.id ? next : x)));
      toast(next.status === 'verified' ? `${next.hostname} is connected` : next.lastError || 'Not verified yet', next.status === 'verified' ? undefined : 'error');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: AppDomain) {
    if (!confirm(`Disconnect ${d.hostname}? Staff will need to sign in at the main address again.`)) return;
    setBusy(d.id);
    try {
      await api(`/agency/${orgId}/app-domains/${d.id}`, { method: 'DELETE' });
      setRows((r) => (r ?? []).filter((x) => x.id !== d.id));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="app-domain-title">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 id="app-domain-title" className="font-semibold">App domain</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Let your team and clients sign in to {appName} at your own address, such as app.youragency.com. The login page shows your branding and invitation links use this domain.
        </p>
      </div>
      <div className="space-y-4 p-5">
        {rows === null ? (
          <div className="grid h-20 place-items-center"><Spinner /></div>
        ) : (
          rows.map((d) => (
            <div key={d.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{d.hostname}</span>
                <span className={`badge ${d.status === 'verified' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : d.status === 'failed' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-amber-50 text-amber-700 ring-amber-600/20'}`}>
                  {d.status === 'verified' ? 'Connected' : d.status === 'failed' ? 'Check failed' : 'Waiting for DNS'}
                </span>
                <span className="flex-1" />
                {d.status === 'verified' ? (
                  <a className="btn-ghost h-8 text-[13px]" href={`https://${d.hostname}/login`} target="_blank" rel="noreferrer">Open</a>
                ) : (
                  <button className="btn-secondary h-8 text-[13px]" disabled={busy === d.id} onClick={() => verify(d)}>{busy === d.id ? 'Checking…' : 'Verify'}</button>
                )}
                <button className="btn-ghost h-8 text-[13px] text-rose-600" disabled={busy === d.id} onClick={() => remove(d)}>Remove</button>
              </div>
              {d.status !== 'verified' && (
                <>
                  {d.lastError && <p className="mt-2 text-[13px] text-rose-600">{d.lastError}</p>}
                  <p className="mt-3 text-[13px] text-slate-500">Add these records where you manage DNS for this domain, then press Verify. DNS changes can take a few minutes to show up.</p>
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 text-[13px]">
                    <div className="hidden grid-cols-[70px_1fr_1fr] gap-3 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
                      <span>Type</span><span>Name</span><span>Value</span>
                    </div>
                    {([['TXT', d.dns.txt], ['CNAME', d.dns.cname]] as const).map(([type, r]) => (
                      <div key={type} className="grid gap-1.5 border-t border-slate-100 px-3 py-2 first:border-t-0 sm:grid-cols-[70px_1fr_1fr] sm:items-center sm:gap-3">
                        <span className="font-medium text-slate-700">{type}</span>
                        <CopyValue value={r.name} />
                        <CopyValue value={r.value} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))
        )}
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="app-domain" className="sr-only">Domain</label>
          <input id="app-domain" className="input" placeholder="app.youragency.com" maxLength={253} value={host} onChange={(e) => setHost(e.target.value.trim())} />
          <button className="btn-primary shrink-0" disabled={!host || busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add domain'}</button>
        </form>
      </div>
    </section>
  );
}
