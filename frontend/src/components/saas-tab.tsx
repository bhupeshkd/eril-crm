'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { EmptyState, Modal, Spinner, StatTile, errorText, useToast } from './ui';
import { Icon } from './icons';

type Feature = { key: string; label: string };
type Plan = {
  id: string; name: string; description: string; price: number; interval: 'month' | 'year'; trialDays: number;
  features: string[]; limits: { contacts: number | null; users: number | null }; included: { emails: number; sms: number }; isActive: boolean;
};
type Settings = { billingWorkspaceId: string | null; currency: string; emailPrice: number; smsPrice: number; graceDays: number };
type Account = {
  planId: string; planName: string; status: string; price: number; interval: string; nextBillingAt: string | null; trialEndsAt: string | null;
  usage: { emails: number; sms: number; contacts: number }; included: { emails: number; sms: number }; limits: { contacts: number | null; users: number | null };
};
type Row = { workspaceId: string; name: string; isBilling: boolean; account: Account | null };
type Overview = { settings: Settings; plans: Plan[]; workspaces: Row[]; features: Feature[]; mrr: number; currency: string };

export const SAAS_STATUS_STYLE: Record<string, string> = {
  trialing: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  past_due: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  suspended: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  canceled: 'bg-slate-100 text-slate-600 ring-slate-500/15',
};
function SaasBadge({ status }: { status: string }) {
  return <span className={`badge ring-1 ring-inset ${SAAS_STATUS_STYLE[status] ?? SAAS_STATUS_STYLE.canceled}`}>{status.replace('_', ' ')}</span>;
}

const limitText = (n: number | null | undefined) => (n === null || n === undefined ? '∞' : n.toLocaleString());

/** Agency → SaaS: sell plans to sub-accounts, bill them from the agency's own workspace, and resell usage. */
export function SaasTab({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Row | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(() => {
    api<Overview>(`/agency/${orgId}/saas`).then(setData).catch((e) => toast(errorText(e), 'error'));
  }, [orgId, toast]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (!data) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  const { settings, plans, workspaces, features } = data;
  const money = (n: number) => fmtCurrency(n, data.currency);
  const onPlan = workspaces.filter((w) => w.account && w.account.status !== 'canceled');
  const owing = workspaces.filter((w) => w.account && ['past_due', 'suspended'].includes(w.account.status));
  const billingName = workspaces.find((w) => w.workspaceId === settings.billingWorkspaceId)?.name;

  async function end(row: Row, mode: 'cancel' | 'remove') {
    const msg = mode === 'cancel'
      ? `Cancel ${row.name}'s plan? Billing stops now and the account becomes read-only.`
      : `Take ${row.name} off SaaS billing? Billing stops and all plan restrictions are lifted.`;
    if (!confirm(msg)) return;
    try {
      await api(`/agency/${orgId}/saas/accounts/${row.workspaceId}?mode=${mode}`, { method: 'DELETE' });
      toast(mode === 'cancel' ? 'Plan canceled' : 'Removed from SaaS billing');
      load();
    } catch (e) { toast(errorText(e), 'error'); }
  }

  async function billUsage() {
    try {
      const r = await api<{ period: string; billed: number }>(`/agency/${orgId}/saas/usage/bill`, { method: 'POST', body: {} });
      toast(r.billed ? `Sent ${r.billed} usage invoice${r.billed === 1 ? '' : 's'} for ${r.period}` : `Nothing new to bill for ${r.period}`);
    } catch (e) { toast(errorText(e), 'error'); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Monthly recurring revenue" value={money(data.mrr)} hint="paying plans (yearly ÷ 12)" icon={<Icon name="trendUp" className="h-5 w-5" />} tint="from-emerald-500 to-teal-500" />
        <StatTile label="Clients on plans" value={onPlan.length} hint={`${onPlan.filter((w) => w.account?.status === 'trialing').length} in trial`} icon={<Icon name="users" className="h-5 w-5" />} tint="from-brand-500 to-brand-700" />
        <StatTile label="Needs payment" value={owing.length} hint={`${owing.filter((w) => w.account?.status === 'suspended').length} suspended (read-only)`} icon={<Icon name="alert" className="h-5 w-5" />} tint="from-amber-500 to-orange-500" />
      </div>

      {/* Billing setup */}
      <section className="card flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="payments" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Client billing</div>
          <p className="text-[13px] text-slate-500">
            {settings.billingWorkspaceId
              ? <>Invoices come from <b className="text-slate-700">{billingName ?? 'your workspace'}</b> in {settings.currency}. Overage: {money(settings.emailPrice)}/email, {money(settings.smsPrice)}/SMS. Unpaid accounts go read-only after {settings.graceDays} days.</>
              : 'Pick the workspace that sends invoices to your clients to start selling plans.'}
          </p>
        </div>
        <div className="flex gap-2">
          {settings.billingWorkspaceId && <button className="btn-secondary" onClick={billUsage} title="Bill last month's overage now (also runs automatically)"><Icon name="send" /> Bill usage</button>}
          <button className={settings.billingWorkspaceId ? 'btn-secondary' : 'btn-primary'} onClick={() => setSettingsOpen(true)}><Icon name="settings" /> {settings.billingWorkspaceId ? 'Settings' : 'Set up billing'}</button>
        </div>
      </section>

      {/* Plans */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Plans</h2>
          <button className="btn-primary" disabled={!settings.billingWorkspaceId} onClick={() => setEditing('new')}><Icon name="plus" /> New plan</button>
        </div>
        {plans.length === 0 ? (
          <div className="card"><EmptyState title="No plans yet">Create plans with the features, limits and message allowances each tier includes.</EmptyState></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className={`card card-hover flex flex-col p-5 ${p.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name} {!p.isActive && <span className="badge ml-1 bg-slate-100 text-slate-500">archived</span>}</div>
                    <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{money(p.price)}<span className="text-sm font-normal text-slate-400">/{p.interval}</span></div>
                  </div>
                  <button className="btn-ghost h-8 px-2" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Icon name="pencil" /></button>
                </div>
                {p.trialDays > 0 && <div className="mt-1 text-xs font-medium text-sky-700">{p.trialDays}-day free trial</div>}
                <div className="mt-3 flex flex-wrap gap-1">
                  {features.map((f) => (
                    <span key={f.key} className={`badge ${p.features.includes(f.key) ? 'bg-brand-50 text-brand-700' : 'bg-slate-50 text-slate-400 line-through'}`}>{f.label}</span>
                  ))}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
                  <div><dt className="text-slate-400">Contacts</dt><dd className="font-medium tabular-nums">{limitText(p.limits.contacts)}</dd></div>
                  <div><dt className="text-slate-400">Users</dt><dd className="font-medium tabular-nums">{limitText(p.limits.users)}</dd></div>
                  <div><dt className="text-slate-400">Emails / mo</dt><dd className="font-medium tabular-nums">{p.included.emails.toLocaleString()}</dd></div>
                  <div><dt className="text-slate-400">SMS / mo</dt><dd className="font-medium tabular-nums">{p.included.sms.toLocaleString()}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Clients */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Clients</h2>
          <p className="text-[13px] text-slate-500">Usage is for this month. Messages beyond a plan&apos;s allowance are billed at the start of next month.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5">Sub-account</th><th className="px-4 py-2.5">Plan</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Usage</th><th className="px-4 py-2.5">Next bill</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workspaces.map((w) => {
                const a = w.account;
                return (
                  <tr key={w.workspaceId} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium">{w.name}{w.isBilling && <span className="badge ml-2 bg-brand-50 text-brand-700">billing</span>}</td>
                    <td className="px-4 py-3">{a ? <>{a.planName} <span className="text-slate-400">· {money(a.price)}/{a.interval}</span></> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3">{a ? <SaasBadge status={a.status} /> : <span className="text-slate-400">Not on a plan</span>}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-600">
                      {a ? (
                        <div className="space-y-0.5">
                          <div className={a.usage.emails > a.included.emails ? 'text-amber-700' : ''}>{a.usage.emails.toLocaleString()} / {a.included.emails.toLocaleString()} emails</div>
                          <div className={a.usage.sms > a.included.sms ? 'text-amber-700' : ''}>{a.usage.sms.toLocaleString()} / {a.included.sms.toLocaleString()} SMS</div>
                          <div>{a.usage.contacts.toLocaleString()} / {limitText(a.limits.contacts)} contacts</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{a?.status === 'canceled' ? '—' : a?.trialEndsAt ? <>Trial ends {fmtDate(a.trialEndsAt)}</> : a?.nextBillingAt ? fmtDate(a.nextBillingAt) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {!w.isBilling && (
                        <div className="flex justify-end gap-1">
                          <button className="btn-secondary h-8 px-3 text-xs" disabled={!plans.some((p) => p.isActive)} onClick={() => setAssigning(w)}>{a ? 'Change plan' : 'Add to plan'}</button>
                          {a && a.status !== 'canceled' && <button className="btn-ghost h-8 px-2 text-xs text-rose-600" onClick={() => end(w, 'cancel')}>Cancel</button>}
                          {a && <button className="btn-ghost h-8 px-2 text-xs" onClick={() => end(w, 'remove')} title="Stop billing and lift plan restrictions">Remove</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {settingsOpen && <SettingsModal orgId={orgId} data={data} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); toast('Billing settings saved'); load(); }} />}
      {editing && <PlanModal orgId={orgId} plan={editing === 'new' ? null : editing} features={features} currency={data.currency} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); load(); }} />}
      {assigning && <AssignModal orgId={orgId} row={assigning} plans={plans.filter((p) => p.isActive)} money={money} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); toast('Plan updated'); load(); }} />}
    </div>
  );
}

function SettingsModal({ orgId, data, onClose, onSaved }: { orgId: string; data: Overview; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const s = data.settings;
  const [f, setF] = useState({ billingWorkspaceId: s.billingWorkspaceId ?? '', currency: s.currency, emailPrice: String(s.emailPrice), smsPrice: String(s.smsPrice), graceDays: String(s.graceDays) });
  const [busy, setBusy] = useState(false);
  const locked = data.workspaces.some((w) => w.account);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/agency/${orgId}/saas/settings`, {
        method: 'PUT',
        body: { ...(f.billingWorkspaceId ? { billingWorkspaceId: f.billingWorkspaceId } : {}), currency: f.currency, emailPrice: Number(f.emailPrice), smsPrice: Number(f.smsPrice), graceDays: Number(f.graceDays) },
      });
      onSaved();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Client billing" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="sb-ws">Billing workspace</label>
          <select id="sb-ws" className="input" required disabled={locked} value={f.billingWorkspaceId} onChange={(e) => setF({ ...f, billingWorkspaceId: e.target.value })}>
            <option value="">Choose…</option>
            {data.workspaces.filter((w) => !w.account).map((w) => <option key={w.workspaceId} value={w.workspaceId}>{w.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">{locked ? "Can't change while clients are on plans." : 'Your own workspace: each client becomes a contact there, with its subscription and invoices.'}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="sb-cur">Currency</label><input id="sb-cur" className="input uppercase" maxLength={3} disabled={data.plans.length > 0} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
          <div><label className="label" htmlFor="sb-grace">Grace period (days)</label><input id="sb-grace" type="number" min={0} max={90} className="input" value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} /></div>
          <div><label className="label" htmlFor="sb-email">Price per extra email</label><input id="sb-email" type="number" min={0} step="0.0001" className="input" value={f.emailPrice} onChange={(e) => setF({ ...f, emailPrice: e.target.value })} /></div>
          <div><label className="label" htmlFor="sb-sms">Price per extra SMS</label><input id="sb-sms" type="number" min={0} step="0.0001" className="input" value={f.smsPrice} onChange={(e) => setF({ ...f, smsPrice: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function PlanModal({ orgId, plan, features, currency, onClose, onSaved }: { orgId: string; plan: Plan | null; features: Feature[]; currency: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: plan?.name ?? '', description: plan?.description ?? '', price: plan ? String(plan.price) : '', interval: plan?.interval ?? 'month', trialDays: String(plan?.trialDays ?? 14),
    features: plan?.features ?? features.map((x) => x.key), contacts: plan?.limits.contacts?.toString() ?? '', users: plan?.limits.users?.toString() ?? '',
    emails: String(plan?.included.emails ?? 1000), sms: String(plan?.included.sms ?? 100),
  });
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setF({ ...f, features: f.features.includes(k) ? f.features.filter((x) => x !== k) : [...f.features, k] });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: f.name, description: f.description, price: Number(f.price), interval: f.interval, trialDays: Number(f.trialDays) || 0, features: f.features,
      limits: { contacts: f.contacts === '' ? null : Number(f.contacts), users: f.users === '' ? null : Number(f.users) },
      included: { emails: Number(f.emails) || 0, sms: Number(f.sms) || 0 },
    };
    try {
      await api(plan ? `/agency/${orgId}/saas/plans/${plan.id}` : `/agency/${orgId}/saas/plans`, { method: plan ? 'PUT' : 'POST', body });
      onSaved(plan ? 'Plan saved' : 'Plan created');
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  async function setActive(isActive: boolean) {
    try {
      await api(`/agency/${orgId}/saas/plans/${plan!.id}`, { method: 'PUT', body: { isActive } });
      onSaved(isActive ? 'Plan restored' : 'Plan archived');
    } catch (err) { toast(errorText(err), 'error'); }
  }
  return (
    <Modal open wide title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px]">
          <div><label className="label" htmlFor="pl-name">Name</label><input id="pl-name" required maxLength={120} className="input" placeholder="Starter" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-price">Price ({currency})</label><input id="pl-price" required type="number" min={0} step="0.01" className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-int">Billed</label><select id="pl-int" className="input" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as 'month' | 'year' })}><option value="month">Monthly</option><option value="year">Yearly</option></select></div>
        </div>
        <div><label className="label" htmlFor="pl-desc">Description</label><input id="pl-desc" maxLength={1000} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div>
          <span className="label">Features</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {features.map((x) => (
              <label key={x.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${f.features.includes(x.key) ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200'}`}>
                <input type="checkbox" checked={f.features.includes(x.key)} onChange={() => toggle(x.key)} /> {x.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Contacts, conversations, opportunities and tasks are always included.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div><label className="label" htmlFor="pl-trial">Trial days</label><input id="pl-trial" type="number" min={0} max={365} className="input" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-c">Max contacts</label><input id="pl-c" type="number" min={0} className="input" placeholder="Unlimited" value={f.contacts} onChange={(e) => setF({ ...f, contacts: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-u">Max users</label><input id="pl-u" type="number" min={0} className="input" placeholder="Unlimited" value={f.users} onChange={(e) => setF({ ...f, users: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-e">Emails / mo</label><input id="pl-e" type="number" min={0} className="input" value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} /></div>
          <div><label className="label" htmlFor="pl-s">SMS / mo</label><input id="pl-s" type="number" min={0} className="input" value={f.sms} onChange={(e) => setF({ ...f, sms: e.target.value })} /></div>
        </div>
        {plan && <p className="text-xs text-slate-500">Price changes apply to clients added or moved to this plan from now on.</p>}
        <div className="flex items-center justify-between gap-2">
          <div>{plan && <button type="button" className="btn-ghost text-sm" onClick={() => setActive(!plan.isActive)}>{plan.isActive ? 'Archive plan' : 'Restore plan'}</button>}</div>
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{plan ? 'Save' : 'Create plan'}</button></div>
        </div>
      </form>
    </Modal>
  );
}

function AssignModal({ orgId, row, plans, money, onClose, onSaved }: { orgId: string; row: Row; plans: Plan[]; money: (n: number) => string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ planId: plans.find((p) => p.id !== row.account?.planId)?.id ?? plans[0]?.id ?? '', billingEmail: '', billingName: row.name, skipTrial: false });
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === f.planId);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/agency/${orgId}/saas/accounts`, { method: 'POST', body: { workspaceId: row.workspaceId, ...f } });
      onSaved();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title={`${row.account ? 'Change plan' : 'Add to plan'}: ${row.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="as-plan">Plan</label>
          <select id="as-plan" className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)}/{p.interval}{p.id === row.account?.planId ? ' (current)' : ''}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="as-name">Billing name</label><input id="as-name" maxLength={120} className="input" value={f.billingName} onChange={(e) => setF({ ...f, billingName: e.target.value })} /></div>
          <div><label className="label" htmlFor="as-email">Billing email</label><input id="as-email" type="email" required className="input" placeholder="owner@client.com" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} /></div>
        </div>
        {row.account ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">The current subscription ends now and the new plan starts billing today (no trial).</p>
        ) : plan && plan.trialDays > 0 ? (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.skipTrial} onChange={(e) => setF({ ...f, skipTrial: e.target.checked })} /> Skip the {plan.trialDays}-day trial and bill today</label>
        ) : null}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !f.planId}>Save</button></div>
      </form>
    </Modal>
  );
}
