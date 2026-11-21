'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import type { Invoice, Product } from '@/lib/types-ext';
import { EmptyState, Modal, PageLoader, StatusBadge, errorText, useToast } from './ui';
import { Icon } from './icons';

export interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  amount: number;
  currency: string | null;
  duration: 'once' | 'forever' | 'repeating';
  durationCycles: number | null;
  appliesTo: 'all' | 'invoices' | 'subscriptions';
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  price: number;
  quantity: number;
  currency: string;
  interval: 'month' | 'year';
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  contactId: string;
  contact: Contact;
  nextBillingAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  cyclesBilled: number;
  couponCyclesRemaining: number | null;
  createdAt: string;
  invoices?: Invoice[];
  coupon?: { code: string; type: 'percent' | 'fixed'; amount: number; duration: string } | null;
}

export const couponLabel = (c: Pick<Coupon, 'type' | 'amount' | 'currency'>) => (c.type === 'percent' ? `${c.amount}% off` : `${fmtCurrency(c.amount, c.currency ?? 'USD')} off`);
const durationLabel = (c: Pick<Coupon, 'duration' | 'durationCycles'>) =>
  c.duration === 'forever' ? 'every payment' : c.duration === 'once' ? 'first payment' : `first ${c.durationCycles} payments`;
const STATUS_TEXT: Record<Subscription['status'], string> = { trialing: 'trial', active: 'active', past_due: 'past due', canceled: 'canceled' };

// ---------------- Subscriptions ----------------
export function SubscriptionsTab({ products, refreshKey, onChanged }: { products: Product[]; refreshKey: number; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [filter, setFilter] = useState<'' | Subscription['status']>('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Subscription[]>(`/payments/subscriptions${filter ? `?status=${filter}` : ''}`).then(setSubs).catch((e) => toast(errorText(e), 'error'));
  }, [filter, toast]);
  useEffect(load, [load, refreshKey]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1" role="group" aria-label="Filter by status">
          {([['', 'All'], ['active', 'Active'], ['trialing', 'Trial'], ['past_due', 'Past due'], ['canceled', 'Canceled']] as const).map(([v, l]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)} className={`rounded-md px-3 py-1 text-xs font-medium transition ${filter === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
          ))}
        </div>
        {can('payments:write') && <button className="btn-primary ml-auto" onClick={() => setCreating(true)}><Icon name="plus" /> New subscription</button>}
      </div>
      {!subs ? <PageLoader /> : subs.length === 0 ? (
        <EmptyState title="No subscriptions">Bill clients monthly or yearly. Each cycle issues an invoice and emails the pay link automatically; overdue invoices get one reminder and the subscription is marked past due until paid.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Next invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subs.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(s.id)}>
                  <td className="px-4 py-3 font-medium">{s.contact.firstName} {s.contact.lastName}</td>
                  <td className="px-4 py-3">{s.name}{s.quantity > 1 ? ` × ${s.quantity}` : ''}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtCurrency(s.price * s.quantity, s.currency)}<span className="text-slate-400"> /{s.interval === 'month' ? 'mo' : 'yr'}</span></td>
                  <td className="px-4 py-3">
                    <StatusBadge status={STATUS_TEXT[s.status]} />
                    {s.cancelAtPeriodEnd && s.status !== 'canceled' && <span className="ml-1 text-xs text-amber-700">cancels at period end</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{s.status === 'canceled' || s.cancelAtPeriodEnd ? '—' : s.nextBillingAt ? fmtDate(s.nextBillingAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={creating} title="New subscription" onClose={() => setCreating(false)} wide>
        {creating && <NewSubscription products={products} onDone={() => { setCreating(false); toast('Subscription created'); load(); onChanged(); }} />}
      </Modal>
      <Modal open={!!openId} title="Subscription" onClose={() => setOpenId(null)} wide>
        {openId && <SubscriptionDetail id={openId} onChanged={() => { load(); onChanged(); }} />}
      </Modal>
    </>
  );
}

function NewSubscription({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const recurring = products.filter((p) => p.interval !== 'one_time' && p.isActive);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [productId, setProductId] = useState(recurring[0]?.id ?? '');
  const [custom, setCustom] = useState({ name: '', price: '', interval: 'month' as 'month' | 'year', currency: 'USD' });
  const [quantity, setQuantity] = useState(1);
  const [trialDays, setTrialDays] = useState(0);
  const [couponCode, setCouponCode] = useState('');
  const [couponInfo, setCouponInfo] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);

  const p = recurring.find((x) => x.id === productId);
  const price = p ? p.price : Number(custom.price) || 0;
  const currency = p ? p.currency : custom.currency;
  const interval = p ? (p.interval as 'month' | 'year') : custom.interval;

  async function checkCoupon() {
    setCouponInfo('');
    if (!couponCode.trim()) return;
    try {
      const r = await api(`/payments/coupons/preview?code=${encodeURIComponent(couponCode)}&use=subscriptions&currency=${currency}&subtotal=${price * quantity}`);
      setCouponInfo(`✓ ${r.code}: ${fmtCurrency(r.discount, currency)} off the ${durationLabel({ duration: r.duration, durationCycles: r.durationCycles })}`);
    } catch (e) {
      setCouponInfo(`✕ ${errorText(e)}`);
    }
  }

  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError('');
      try {
        await api('/payments/subscriptions', {
          method: 'POST',
          body: {
            contactId,
            ...(p ? { productId: p.id } : { name: custom.name, price: Number(custom.price), interval: custom.interval, currency: custom.currency }),
            quantity,
            trialDays: trialDays || undefined,
            couponCode: couponCode.trim() || undefined,
          },
        });
        onDone();
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    }}>
      <div>
        <label className="label" htmlFor="ns-c">Customer *</label>
        <select id="ns-c" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose a contact…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ns-p">Plan</label>
        <select id="ns-p" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {recurring.map((x) => <option key={x.id} value={x.id}>{x.name} — {fmtCurrency(x.price, x.currency)}/{x.interval}</option>)}
          <option value="">Custom plan…</option>
        </select>
        {recurring.length === 0 && <p className="mt-1 text-xs text-slate-500">Tip: add monthly or yearly products in the Products tab to reuse them here.</p>}
      </div>
      {!p && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="label" htmlFor="ns-n">Plan name *</label><input id="ns-n" required className="input" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="ns-pr">Price *</label><input id="ns-pr" required type="number" min="0" step="0.01" className="input" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></div>
          <div><label className="label" htmlFor="ns-i">Every</label><select id="ns-i" className="input" value={custom.interval} onChange={(e) => setCustom({ ...custom, interval: e.target.value as 'month' | 'year' })}><option value="month">Month</option><option value="year">Year</option></select></div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="ns-q">Quantity</label><input id="ns-q" type="number" min={1} max={1000} className="input" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} /></div>
        <div><label className="label" htmlFor="ns-t">Free trial (days)</label><input id="ns-t" type="number" min={0} max={365} className="input" value={trialDays} onChange={(e) => setTrialDays(Math.max(0, Number(e.target.value)))} /></div>
        <div>
          <label className="label" htmlFor="ns-cp">Coupon</label>
          <input id="ns-cp" className="input uppercase" value={couponCode} onChange={(e) => { setCouponCode(e.target.value); setCouponInfo(''); }} onBlur={checkCoupon} placeholder="Optional" />
        </div>
      </div>
      {couponInfo && <p className={`text-sm ${couponInfo.startsWith('✓') ? 'text-emerald-700' : 'text-rose-600'}`} role="status">{couponInfo}</p>}
      <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        {fmtCurrency(price * quantity, currency)} every {interval}
        {trialDays > 0 ? `, starting after a ${trialDays}-day free trial` : ', first invoice is issued and emailed now'}.
      </p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create subscription'}</button></div>
    </form>
  );
}

function SubscriptionDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [s, setS] = useState<Subscription | null>(null);
  const load = useCallback(() => api<Subscription>(`/payments/subscriptions/${id}`).then(setS).catch((e) => toast(errorText(e), 'error')), [id, toast]);
  useEffect(() => {
    load();
  }, [load]);
  if (!s) return <PageLoader />;

  const act = async (path: string, body: object, msg: string) => {
    try {
      await api(`/payments/subscriptions/${id}/${path}`, { method: 'POST', body });
      toast(msg);
      await load();
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const editable = can('payments:write');

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{s.name}{s.quantity > 1 ? ` × ${s.quantity}` : ''}</div>
          <div className="text-slate-500">
            <Link href={`/contacts/${s.contactId}`} className="hover:text-brand-600">{s.contact.firstName} {s.contact.lastName}</Link> · {fmtCurrency(s.price * s.quantity, s.currency)} per {s.interval}
          </div>
        </div>
        <StatusBadge status={STATUS_TEXT[s.status]} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70"><dt className="text-xs text-slate-500">Current period ends</dt><dd className="font-medium">{s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd) : '—'}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70"><dt className="text-xs text-slate-500">Next invoice</dt><dd className="font-medium">{s.status === 'canceled' || s.cancelAtPeriodEnd ? 'None' : s.nextBillingAt ? fmtDate(s.nextBillingAt) : '—'}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70"><dt className="text-xs text-slate-500">Coupon</dt><dd className="font-medium">{s.coupon ? `${s.coupon.code} (${couponLabel({ ...s.coupon, currency: s.currency })}${s.couponCyclesRemaining !== null ? `, ${s.couponCyclesRemaining} left` : ', forever'})` : 'None'}</dd></div>
      </dl>
      {s.cancelAtPeriodEnd && s.status !== 'canceled' && <p className="rounded-md bg-amber-50 p-3 text-amber-800">Scheduled to cancel when the current period ends. No further invoices will be issued.</p>}
      {s.status === 'past_due' && <p className="rounded-md bg-red-50 p-3 text-red-700">The latest invoice is overdue. A reminder was emailed; the subscription returns to active once it's paid.</p>}

      <h3 className="font-semibold">Invoices</h3>
      {!s.invoices?.length ? <p className="text-slate-500">No invoices yet{s.status === 'trialing' ? ' — the first is issued when the trial ends' : ''}.</p> : (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {s.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium">{i.number}</span>
              <span className="text-slate-500">{fmtDate(i.createdAt)}</span>
              {i.couponCode && <span className="badge bg-violet-100 text-violet-700">{i.couponCode}</span>}
              <span className="ml-auto tabular-nums">{fmtCurrency(i.total, i.currency)}</span>
              <StatusBadge status={i.status} />
              {i.status !== 'draft' && <a className="text-brand-600 hover:underline" href={`/invoice/${i.publicToken}`} target="_blank" rel="noreferrer">View</a>}
            </li>
          ))}
        </ul>
      )}
      {editable && s.status !== 'canceled' && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          {s.cancelAtPeriodEnd ? (
            <button className="btn-secondary" onClick={() => act('resume', {}, 'Subscription will continue')}>Don't cancel</button>
          ) : s.status !== 'trialing' ? (
            <button className="btn-secondary" onClick={() => act('cancel', { atPeriodEnd: true }, 'Will cancel at period end')}>Cancel at period end</button>
          ) : null}
          <button className="btn-danger" onClick={() => { if (confirm('Cancel immediately? No further invoices will be issued.')) act('cancel', { atPeriodEnd: false }, 'Subscription canceled'); }}>Cancel now</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Coupons ----------------
export function CouponsTab() {
  const toast = useToast();
  const { can } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api<Coupon[]>('/payments/coupons').then(setCoupons).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  const editable = can('payments:write');

  return (
    <>
      {editable && <div className="mb-4 flex justify-end"><button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New coupon</button></div>}
      {!coupons ? <PageLoader /> : coupons.length === 0 ? (
        <EmptyState title="No coupons yet">Create discount codes for invoices and subscriptions. Customers can also enter a code on the invoice pay page.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr><th className="px-4 py-3 font-medium">Code</th><th className="px-4 py-3 font-medium">Discount</th><th className="px-4 py-3 font-medium">Applies to</th><th className="px-4 py-3 font-medium">Used</th><th className="px-4 py-3 font-medium">Expires</th><th className="px-4 py-3 font-medium">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coupons.map((c) => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                const exhausted = c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions;
                const state = !c.isActive ? 'off' : expired ? 'expired' : exhausted ? 'used up' : 'active';
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3"><code className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{c.code}</code></td>
                    <td className="px-4 py-3">{couponLabel(c)} <span className="text-slate-400">· {durationLabel(c)}</span></td>
                    <td className="px-4 py-3 capitalize">{c.appliesTo === 'all' ? 'Everything' : c.appliesTo}</td>
                    <td className="px-4 py-3 tabular-nums">{c.redemptions}{c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ''}</td>
                    <td className="px-4 py-3 text-slate-500">{c.expiresAt ? fmtDate(c.expiresAt) : 'Never'}</td>
                    <td className="px-4 py-3"><span className={`badge ${state === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-600'}`}>{state}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {editable && (
                        <>
                          <button className="btn-ghost px-2 py-1" onClick={async () => { await api(`/payments/coupons/${c.id}`, { method: 'PUT', body: { isActive: !c.isActive } }); load(); }}>{c.isActive ? 'Disable' : 'Enable'}</button>
                          <button className="btn-ghost px-2 py-1 text-rose-600" onClick={async () => { if (confirm(`Delete ${c.code}? Invoices that used it keep their discount.`)) { await api(`/payments/coupons/${c.id}`, { method: 'DELETE' }); load(); } }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={creating} title="New coupon" onClose={() => setCreating(false)}>
        {creating && <NewCoupon onDone={() => { setCreating(false); toast('Coupon created'); load(); }} />}
      </Modal>
    </>
  );
}

function NewCoupon({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    code: '',
    type: 'percent' as 'percent' | 'fixed',
    amount: '',
    currency: 'USD',
    duration: 'once' as Coupon['duration'],
    durationCycles: 3,
    appliesTo: 'all' as Coupon['appliesTo'],
    maxRedemptions: '',
    expiresAt: '',
  });
  const [error, setError] = useState('');
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setError('');
      try {
        await api('/payments/coupons', {
          method: 'POST',
          body: {
            code: f.code.trim(),
            type: f.type,
            amount: Number(f.amount),
            currency: f.type === 'fixed' ? f.currency : undefined,
            duration: f.duration,
            durationCycles: f.duration === 'repeating' ? f.durationCycles : undefined,
            appliesTo: f.appliesTo,
            maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : undefined,
            expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59`).toISOString() : undefined,
          },
        });
        onDone();
      } catch (err) {
        setError(errorText(err));
      }
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1"><label className="label" htmlFor="cp-code">Code *</label><input id="cp-code" required className="input font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="SPRING20" /></div>
        <div><label className="label" htmlFor="cp-type">Type</label><select id="cp-type" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'percent' | 'fixed' })}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></div>
        <div><label className="label" htmlFor="cp-amt">{f.type === 'percent' ? 'Percent off *' : `Amount off (${f.currency}) *`}</label><input id="cp-amt" required type="number" min="0.01" max={f.type === 'percent' ? 100 : undefined} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
      </div>
      {f.type === 'fixed' && <div className="w-32"><label className="label" htmlFor="cp-cur">Currency</label><input id="cp-cur" maxLength={3} className="input uppercase" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="cp-app">Can be used on</label><select id="cp-app" className="input" value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value as Coupon['appliesTo'] })}><option value="all">Invoices and subscriptions</option><option value="invoices">Invoices only</option><option value="subscriptions">Subscriptions only</option></select></div>
        <div><label className="label" htmlFor="cp-dur">On subscriptions, discount</label><select id="cp-dur" className="input" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value as Coupon['duration'] })}><option value="once">First payment only</option><option value="repeating">First N payments</option><option value="forever">Every payment</option></select></div>
      </div>
      {f.duration === 'repeating' && <div className="w-40"><label className="label" htmlFor="cp-n">Number of payments</label><input id="cp-n" type="number" min={1} max={120} className="input" value={f.durationCycles} onChange={(e) => setF({ ...f, durationCycles: Number(e.target.value) })} /></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="cp-max">Usage limit</label><input id="cp-max" type="number" min={1} className="input" placeholder="Unlimited" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} /></div>
        <div><label className="label" htmlFor="cp-exp">Expires on</label><input id="cp-exp" type="date" className="input" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary">Create coupon</button></div>
    </form>
  );
}
