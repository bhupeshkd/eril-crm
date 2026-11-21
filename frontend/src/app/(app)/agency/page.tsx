'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtMoney, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, Modal, PageHeader, PageLoader, StatTile, Tabs, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandingTab } from '@/components/branding-tab';
import { SaasTab } from '@/components/saas-tab';

const HUES = ['from-brand-500 to-brand-700', 'from-sky-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500', 'from-rose-500 to-pink-500'];
const hueOf = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

interface Org { id: string; name: string; plan: string; subAccounts: number }
interface SubAccount {
  id: string;
  name: string;
  createdAt: string;
  myRole: string | null;
  metrics: { contacts: number; newLeads30d: number; openPipeline: number; revenue30d: number; unread: number; upcomingAppointments: number; lastActivityAt: string | null };
}
interface SnapshotRow { id: string; name: string; summary: Record<string, number>; sourceWorkspaceId: string | null; createdAt: string }

export default function AgencyPage() {
  const toast = useToast();
  const { me, switchWorkspace } = useAuth();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState('');
  const [tab, setTab] = useState<'accounts' | 'snapshots' | 'saas' | 'branding'>('accounts');
  const [subs, setSubs] = useState<SubAccount[] | null>(null);
  const [snaps, setSnaps] = useState<SnapshotRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [applying, setApplying] = useState<SnapshotRow | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api<Org[]>('/agency/organizations')
      .then((o) => {
        setOrgs(o);
        setOrgId((cur) => {
          if (cur) return cur;
          const current = me?.currentOrganizationId;
          return current && o.some((x) => x.id === current) ? current : o[0]?.id ?? '';
        });
      })
      .catch((e) => toast(errorText(e), 'error'));
  }, [toast, me]);

  const load = useCallback(() => {
    if (!orgId) return;
    api<SubAccount[]>(`/agency/${orgId}/sub-accounts`).then(setSubs).catch((e) => toast(errorText(e), 'error'));
    api<SnapshotRow[]>(`/agency/${orgId}/snapshots`).then(setSnaps).catch(() => {});
  }, [orgId, toast]);
  useEffect(load, [load]);

  async function open(s: SubAccount) {
    try {
      if (!s.myRole) await api(`/agency/${orgId}/sub-accounts/${s.id}/join`, { method: 'POST' });
      await switchWorkspace(s.id);
      location.href = '/dashboard';
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  if (!orgs) return <PageLoader />;
  if (orgs.length === 0) {
    return (
      <>
        <PageHeader title="Agency" />
        <EmptyState title="No agency access">The agency console is available to organization owners and agency admins.</EmptyState>
      </>
    );
  }

  const totals = (subs ?? []).reduce(
    (t, s) => ({ contacts: t.contacts + s.metrics.contacts, leads: t.leads + s.metrics.newLeads30d, pipeline: t.pipeline + s.metrics.openPipeline, revenue: t.revenue + s.metrics.revenue30d }),
    { contacts: 0, leads: 0, pipeline: 0, revenue: 0 },
  );
  const visible = (subs ?? []).filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Agency"
        subtitle="All client sub-accounts at a glance — create, snapshot and jump into any account"
        actions={
          <>
            {orgs.length > 1 && (
              <select aria-label="Organization" className="input w-auto" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button className="btn-secondary" onClick={() => setSnapping(true)}><Icon name="copy" /> Save snapshot</button>
            <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New sub-account</button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sub-accounts" value={subs?.length ?? '…'} hint="client workspaces" icon={<Icon name="agency" className="h-5 w-5" />} tint="from-brand-500 to-brand-700" />
        <StatTile label="Contacts (all accounts)" value={totals.contacts.toLocaleString()} hint={`${totals.leads} new in 30 days`} icon={<Icon name="contacts" className="h-5 w-5" />} tint="from-sky-500 to-indigo-500" />
        <StatTile label="Open pipeline" value={fmtMoney(totals.pipeline)} hint="across all accounts" icon={<Icon name="pipeline" className="h-5 w-5" />} tint="from-amber-500 to-orange-500" />
        <StatTile label="Collected (30 days)" value={fmtMoney(totals.revenue)} hint="paid invoices and orders" icon={<Icon name="payments" className="h-5 w-5" />} tint="from-emerald-500 to-teal-500" />
      </div>

      <Tabs value={tab} onChange={setTab} options={[['accounts', 'Sub-accounts', subs?.length], ['snapshots', 'Snapshots', snaps.length], ['saas', 'SaaS plans'], ['branding', 'Branding']]} />

      {tab === 'branding' ? (
        <BrandingTab orgId={orgId} />
      ) : tab === 'saas' ? (
        <SaasTab orgId={orgId} />
      ) : tab === 'accounts' ? (
        !subs ? <PageLoader /> : (
          <>
            {subs.length > 6 && (
              <div className="relative mb-4 w-full sm:w-72">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" aria-label="Search sub-accounts" placeholder="Search sub-accounts…" className="input h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            )}
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Sub-account</th>
                    <th className="px-4 py-2.5 text-right">Contacts</th>
                    <th className="px-4 py-2.5 text-right">New leads 30d</th>
                    <th className="px-4 py-2.5 text-right">Open pipeline</th>
                    <th className="px-4 py-2.5 text-right">Collected 30d</th>
                    <th className="px-4 py-2.5 text-right">Unread</th>
                    <th className="px-4 py-2.5">Last activity</th>
                    <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((s) => {
                    const current = s.id === me?.currentWorkspaceId;
                    return (
                      <tr key={s.id} className={`group ${current ? 'bg-brand-50/40' : 'hover:bg-slate-50/70'}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${hueOf(s.name)} text-[13px] font-semibold text-white`}>{s.name.trim().slice(0, 2).toUpperCase()}</span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-medium text-slate-900">{s.name}{current && <span className="badge bg-brand-100 text-brand-700 ring-brand-600/15">Current</span>}</div>
                              <div className="text-xs text-slate-400">Created {fmtDate(s.createdAt)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.metrics.contacts.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.metrics.newLeads30d ? <span className="font-medium text-emerald-600">+{s.metrics.newLeads30d}</span> : <span className="text-slate-400">0</span>}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(s.metrics.openPipeline)}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(s.metrics.revenue30d)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.metrics.unread ? <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{s.metrics.unread}</span> : <span className="text-slate-400">0</span>}</td>
                        <td className="px-4 py-3 text-slate-500">{s.metrics.lastActivityAt ? timeAgo(s.metrics.lastActivityAt) : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button className="btn-ghost h-8 w-8 px-0 text-slate-400 opacity-0 focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Rename ${s.name}`} title="Rename" onClick={async () => {
                            const name = prompt('Rename sub-account', s.name)?.trim();
                            if (name && name !== s.name) { await api(`/agency/${orgId}/sub-accounts/${s.id}`, { method: 'PUT', body: { name } }); load(); }
                          }}><Icon name="pencil" className="h-3.5 w-3.5" /></button>
                          {!current && <button className="btn-secondary h-8 text-[13px]" onClick={() => open(s)}>Open <Icon name="chevronRight" className="h-3.5 w-3.5" /></button>}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">No sub-accounts match “{search}”.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : snaps.length === 0 ? (
        <EmptyState title="No snapshots yet">A snapshot saves an account's pipelines, workflows, forms, calendars, custom fields, sites and courses so you can launch new clients with the same setup in one click. Contacts and conversations are never copied.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snaps.map((sn) => (
            <li key={sn.id} className="card card-hover flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm"><Icon name="layers" className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{sn.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-400">Saved {fmtDate(sn.createdAt)}{sn.sourceWorkspaceId ? ` from ${subs?.find((s) => s.id === sn.sourceWorkspaceId)?.name ?? 'a sub-account'}` : ''}</p>
                </div>
              </div>
              <ul className="mt-4 flex flex-wrap gap-1.5 text-xs">
                {Object.entries(sn.summary).filter(([, n]) => n > 0).map(([k, n]) => <li key={k} className="badge bg-slate-100 text-slate-600"><span className="font-semibold text-slate-800">{n}</span> {k.replace(/([A-Z])/g, ' $1').toLowerCase()}</li>)}
              </ul>
              <div className="mt-auto flex gap-2 pt-4">
                <button className="btn-secondary h-8 flex-1 text-[13px]" onClick={() => setApplying(sn)}>Apply to account…</button>
                <button className="btn-ghost h-8 w-8 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete snapshot ${sn.name}`} title="Delete snapshot" onClick={async () => { if (confirm(`Delete snapshot "${sn.name}"?`)) { await api(`/agency/${orgId}/snapshots/${sn.id}`, { method: 'DELETE' }); load(); } }}><Icon name="trash" className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating} title="New sub-account" onClose={() => setCreating(false)}>
        {creating && (
          <NewSubAccount orgId={orgId} snapshots={snaps} onDone={(name) => { setCreating(false); toast(`"${name}" created`); load(); }} />
        )}
      </Modal>
      <Modal open={snapping} title="Save snapshot" onClose={() => setSnapping(false)}>
        {snapping && subs && (
          <NewSnapshot orgId={orgId} subs={subs} defaultSource={me?.currentWorkspaceId ?? ''} onDone={() => { setSnapping(false); setTab('snapshots'); toast('Snapshot saved'); load(); }} />
        )}
      </Modal>
      <Modal open={!!applying} title={`Apply “${applying?.name ?? ''}”`} onClose={() => setApplying(null)}>
        {applying && subs && (
          <ApplySnapshot orgId={orgId} snapshot={applying} subs={subs} onDone={(msg) => { setApplying(null); toast(msg); load(); }} />
        )}
      </Modal>
    </>
  );
}

function NewSubAccount({ orgId, snapshots, onDone }: { orgId: string; snapshots: SnapshotRow[]; onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await api(`/agency/${orgId}/sub-accounts`, { method: 'POST', body: { name, snapshotId: snapshotId || undefined } });
        onDone(name);
      } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }}>
      <div>
        <label className="label" htmlFor="sa-name">Client / business name *</label>
        <input id="sa-name" required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Joe’s Plumbing" />
      </div>
      <div>
        <label className="label" htmlFor="sa-snap">Start from snapshot</label>
        <select id="sa-snap" className="input" value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}>
          <option value="">Blank account</option>
          {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Imported workflows and sites start unpublished so nothing goes live until you're ready.</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create sub-account'}</button></div>
    </form>
  );
}

function NewSnapshot({ orgId, subs, defaultSource, onDone }: { orgId: string; subs: SubAccount[]; defaultSource: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState(subs.some((s) => s.id === defaultSource) ? defaultSource : subs[0]?.id ?? '');
  const [error, setError] = useState('');
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(`/agency/${orgId}/snapshots`, { method: 'POST', body: { name, sourceWorkspaceId: source } });
        onDone();
      } catch (err) { setError(errorText(err)); }
    }}>
      <div>
        <label className="label" htmlFor="sn-name">Snapshot name *</label>
        <input id="sn-name" required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home services starter" />
      </div>
      <div>
        <label className="label" htmlFor="sn-src">Copy setup from</label>
        <select id="sn-src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Includes pipelines, workflows, forms, calendars, custom fields, sites and courses. Never contacts, messages or payments.</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary">Save snapshot</button></div>
    </form>
  );
}

function ApplySnapshot({ orgId, snapshot, subs, onDone }: { orgId: string; snapshot: SnapshotRow; subs: SubAccount[]; onDone: (msg: string) => void }) {
  const [target, setTarget] = useState(subs.find((s) => s.id !== snapshot.sourceWorkspaceId)?.id ?? '');
  const [error, setError] = useState('');
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const r = await api(`/agency/${orgId}/snapshots/${snapshot.id}/apply`, { method: 'POST', body: { workspaceId: target } });
        const n = Object.values(r.imported as Record<string, number>).reduce((a, b) => a + b, 0);
        onDone(`Imported ${n} items into ${subs.find((s) => s.id === target)?.name}`);
      } catch (err) { setError(errorText(err)); }
    }}>
      <div>
        <label className="label" htmlFor="ap-t">Into sub-account</label>
        <select id="ap-t" required className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p className="rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">Items are added alongside what the account already has (nothing is overwritten). Custom fields with the same key are skipped.</p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={!target}>Apply snapshot</button></div>
    </form>
  );
}
