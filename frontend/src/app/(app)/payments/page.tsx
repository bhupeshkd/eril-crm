'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import type { Invoice, InvoiceItem, Product } from '@/lib/types-ext';
import { EmptyState, Modal, PageHeader, Spinner, StatusBadge, errorText, useToast } from '@/components/ui';
import { CouponsTab, SubscriptionsTab } from '@/components/billing';
import { OrderFormsTab } from '@/components/order-forms';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

interface Summary {
  paid: number;
  paidCount: number;
  outstanding: number;
  outstandingCount: number;
  drafts: number;
  testMode: boolean;
  stripeConfigured: boolean;
}

type PayTab = 'invoices' | 'subscriptions' | 'products' | 'coupons' | 'orders';
type InvFilter = 'all' | 'draft' | 'open' | 'overdue' | 'paid' | 'void';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isOverdue = (i: Invoice) => i.status === 'sent' && !!i.dueDate && i.dueDate.slice(0, 10) < todayKey();
const daysUntil = (date: string) => Math.round((+new Date(`${date.slice(0, 10)}T00:00:00`) - +new Date(`${todayKey()}T00:00:00`)) / 86_400_000);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** Human due line: "Paid Nov 18", "Overdue 3d", "Due today", "Due in 5 days". */
function DueLine({ inv }: { inv: Invoice }) {
  if (inv.status === 'paid') return <span className="text-emerald-700">Paid {inv.paidAt ? shortDate(inv.paidAt) : ''}</span>;
  if (inv.status === 'void') return <span className="text-slate-400">Voided</span>;
  if (!inv.dueDate) return <span className="text-slate-400">No due date</span>;
  const d = daysUntil(inv.dueDate);
  if (inv.status === 'sent' && d < 0) return <span className="font-medium text-rose-600">Overdue {-d}d</span>;
  if (d === 0) return <span className="font-medium text-amber-600">Due today</span>;
  if (d > 0 && d <= 7) return <span className="text-amber-700">Due in {d} day{d === 1 ? '' : 's'}</span>;
  return <span className="text-slate-500">Due {shortDate(inv.dueDate)}</span>;
}

function InvStatus({ inv }: { inv: Invoice }) {
  if (isOverdue(inv)) return <StatusBadge status="overdue" />;
  return <StatusBadge status={inv.status === 'sent' ? 'open' : inv.status} />;
}

export default function PaymentsPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState<PayTab>('invoices');
  // Deep link: /payments?tab=orders (used by order notifications)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'orders') setTab('orders');
  }, []);
  const [subSummary, setSubSummary] = useState<{ mrr: Record<string, number>; active: number; trialing: number; pastDue: number } | null>(null);
  const [refreshKey] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [editInv, setEditInv] = useState<Invoice | 'new' | null>(null);
  const [editProd, setEditProd] = useState<Product | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<InvFilter>('all');

  const load = useCallback(() => {
    api<Summary>('/payments/summary').then(setSummary).catch(() => {});
    api<Invoice[]>('/payments/invoices').then(setInvoices).catch((e) => toast(errorText(e), 'error'));
    api<Product[]>('/payments/products').then(setProducts).catch(() => {});
    api('/payments/subscriptions/summary').then(setSubSummary).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  async function act(inv: Invoice, action: 'send' | 'mark-paid' | 'void') {
    if (action === 'void' && !confirm(`Void ${inv.number}?`)) return;
    try {
      await api(`/payments/invoices/${inv.id}/${action}`, { method: 'POST' });
      toast(action === 'send' ? 'Invoice emailed' : action === 'mark-paid' ? 'Marked as paid' : 'Invoice voided');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const overdue = useMemo(() => (invoices ?? []).filter(isOverdue), [invoices]);
  const overdueTotal = overdue.reduce((t, i) => t + Number(i.total), 0);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (invoices ?? []).filter((i) => {
      if (filter === 'overdue' && !isOverdue(i)) return false;
      if (filter === 'open' && i.status !== 'sent') return false;
      if (!['all', 'overdue', 'open'].includes(filter) && i.status !== filter) return false;
      return !t || i.number.toLowerCase().includes(t) || `${i.contact.firstName} ${i.contact.lastName}`.toLowerCase().includes(t) || (i.contact.email ?? '').toLowerCase().includes(t);
    });
  }, [invoices, q, filter]);

  const mrr = subSummary && Object.keys(subSummary.mrr).length ? Object.entries(subSummary.mrr).map(([cur, v]) => fmtCurrency(v, cur)).join(' + ') : fmtCurrency(0);
  const TABS: Array<[PayTab, string, string, number | null]> = [
    ['invoices', 'Invoices', 'forms', invoices?.length ?? null],
    ['subscriptions', 'Subscriptions', 'automation', subSummary ? subSummary.active + subSummary.trialing : null],
    ['products', 'Products', 'courses', products?.length ?? null],
    ['coupons', 'Coupons', 'sparkles', null],
    ['orders', 'Order forms', 'payments', null],
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Invoices, subscriptions, products and checkout"
        actions={
          can('invoices:write') && (
            <>
              <button className="btn-secondary" onClick={() => setEditProd('new')}><Icon name="plus" className="h-4 w-4" /> Product</button>
              <button className="btn-primary" onClick={() => setEditInv('new')}><Icon name="plus" className="h-4 w-4" /> New invoice</button>
            </>
          )
        }
      />

      {summary?.testMode && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[13px] text-amber-900">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Icon name="alert" className="h-4 w-4" /></span>
          <p>
            <strong>Test mode.</strong> No payment provider is connected, so pay pages offer a test payment button. Set <code className="rounded bg-amber-100 px-1">STRIPE_SECRET_KEY</code> on the API to take real card payments.
          </p>
        </div>
      )}

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Monthly recurring revenue', value: mrr, hint: subSummary ? `${subSummary.active} active · ${subSummary.trialing} in trial${subSummary.pastDue ? ` · ${subSummary.pastDue} past due` : ''}` : '…', icon: 'automation', tint: 'from-brand-500 to-brand-700' },
            { label: 'Collected', value: fmtCurrency(summary.paid), hint: `${summary.paidCount} paid invoice${summary.paidCount === 1 ? '' : 's'}`, icon: 'check', tint: 'from-emerald-500 to-teal-500' },
            { label: 'Outstanding', value: fmtCurrency(summary.outstanding), hint: overdue.length ? `${overdue.length} overdue · ${fmtCurrency(overdueTotal)}` : `${summary.outstandingCount} awaiting payment`, icon: 'payments', tint: overdue.length ? 'from-rose-500 to-orange-500' : 'from-sky-500 to-indigo-500', alert: overdue.length > 0 },
            { label: 'Drafts', value: String(summary.drafts), hint: 'not sent yet', icon: 'note', tint: 'from-slate-400 to-slate-500' },
          ].map((k) => (
            <div key={k.label} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="text-[13px] font-medium text-slate-500">{k.label}</div>
                <span className={`grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${k.tint} text-white shadow-sm`}><Icon name={k.icon} className="h-[18px] w-[18px]" /></span>
              </div>
              <div className="mt-2 truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums">{k.value}</div>
              <div className={`mt-2 text-xs ${k.alert ? 'font-medium text-rose-600' : 'text-slate-500'}`}>{k.hint}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1" role="tablist">
        {TABS.map(([t, l, icon, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon name={icon} className={`h-4 w-4 ${tab === t ? 'text-brand-600' : ''}`} />
            {l}
            {n !== null && n > 0 && <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${tab === t ? 'bg-brand-100 text-brand-700' : 'bg-slate-300/60 text-slate-600'}`}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'orders' ? (
        <OrderFormsTab products={products ?? []} />
      ) : tab === 'subscriptions' ? (
        <SubscriptionsTab products={products ?? []} refreshKey={refreshKey} onChanged={load} />
      ) : tab === 'coupons' ? (
        <CouponsTab />
      ) : tab === 'invoices' ? (
        !invoices ? <div className="grid h-48 place-items-center"><Spinner /></div> : invoices.length === 0 ? <EmptyState title="No invoices yet">Create an invoice and email a secure pay link to your client.</EmptyState> : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" aria-label="Search invoices" placeholder="Search number or client…" className="input h-9 pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Invoice status">
                {([['all', 'All'], ['draft', 'Draft'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']] as const).map(([v, l]) => (
                  <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition ${filter === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                    {l}
                    {v === 'overdue' && overdue.length > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{overdue.length}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 md:table-cell">Issued</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((inv) => {
                    const write = can('invoices:write');
                    return (
                      <tr key={inv.id} className={`group hover:bg-slate-50/80 ${isOverdue(inv) ? 'bg-rose-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <button className="font-semibold tabular-nums text-slate-900 hover:text-brand-700" onClick={() => setEditInv(inv)}>{inv.number}</button>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {(inv as any).source === 'text_to_pay' && <span className="badge bg-sky-50 text-sky-700 ring-sky-600/15" title={`Payment link sent by ${(inv as any).requestChannel === 'sms' ? 'SMS' : 'email'}`}><Icon name="sms" className="h-3 w-3" /> text-to-pay</span>}
                            {inv.subscriptionId && <span className="badge bg-violet-50 text-violet-700 ring-violet-600/15" title="Issued by a subscription"><Icon name="automation" className="h-3 w-3" /> subscription</span>}
                            {(inv as any).orderFormId && <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-600/15" title="Placed through an order form"><Icon name="payments" className="h-3 w-3" /> order</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/contacts/${inv.contactId}`} className="flex items-center gap-2.5 hover:text-brand-700">
                            <ContactAvatar c={inv.contact} size="h-7 w-7 text-[10px]" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{inv.contact.firstName} {inv.contact.lastName}</span>
                              {inv.contact.email && <span className="block truncate text-xs text-slate-500">{inv.contact.email}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3"><InvStatus inv={inv} /></td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-[13px] text-slate-500 md:table-cell">{shortDate(inv.createdAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px]"><DueLine inv={inv} /></td>
                        <td className="px-4 py-3 text-right text-[14px] font-semibold tabular-nums">{fmtCurrency(inv.total, inv.currency)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-1">
                            {write && inv.status === 'draft' && <button className="btn-primary h-8 px-3 text-xs" onClick={() => act(inv, 'send')}><Icon name="send" className="h-3.5 w-3.5" /> Send</button>}
                            {write && inv.status === 'sent' && <button className="btn-secondary h-8 px-3 text-xs" onClick={() => act(inv, 'mark-paid')}><Icon name="check" className="h-3.5 w-3.5" /> Mark paid</button>}
                            {inv.status !== 'draft' && (
                              <a className="btn-ghost h-8 w-8 px-0" title="Open pay page" aria-label={`Open pay page for ${inv.number}`} href={`/invoice/${inv.publicToken}`} target="_blank" rel="noreferrer"><Icon name="external" className="h-4 w-4" /></a>
                            )}
                            {write && inv.status === 'sent' && (
                              <button className="btn-ghost h-8 w-8 px-0" title="Email again" aria-label={`Resend ${inv.number}`} onClick={() => act(inv, 'send')}><Icon name="mail" className="h-4 w-4" /></button>
                            )}
                            {write && ['draft', 'sent'].includes(inv.status) && (
                              <button className="btn-ghost h-8 w-8 px-0 hover:bg-rose-50 hover:text-rose-600" title="Void" aria-label={`Void ${inv.number}`} onClick={() => act(inv, 'void')}><Icon name="close" className="h-4 w-4" /></button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">No invoices match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : !products ? <div className="grid h-48 place-items-center"><Spinner /></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => {
            const recurring = p.interval !== 'one_time';
            return (
              <button key={p.id} className={`card card-hover flex flex-col p-5 text-left ${p.isActive ? '' : 'opacity-60'}`} onClick={() => can('payments:write') && setEditProd(p)}>
                <div className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${recurring ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600'}`}>
                    <Icon name={recurring ? 'automation' : 'payments'} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{p.name}</div>
                    <span className={`badge mt-0.5 ${recurring ? 'bg-violet-50 text-violet-700 ring-violet-600/15' : 'bg-slate-100 text-slate-600 ring-slate-500/10'}`}>{recurring ? (p.interval === 'month' ? 'Monthly' : 'Yearly') : 'One-time'}</span>
                  </div>
                  {!p.isActive && <span className="badge bg-slate-100 text-slate-500 ring-slate-500/10">Archived</span>}
                </div>
                <div className="mt-4 text-[24px] font-semibold tracking-tight tabular-nums">
                  {fmtCurrency(p.price, p.currency)}
                  {recurring && <span className="text-sm font-normal text-slate-500"> / {p.interval}</span>}
                </div>
                {p.description && <p className="mt-1 line-clamp-2 text-[13px] text-slate-500">{p.description}</p>}
              </button>
            );
          })}
          {can('payments:write') && (
            <button className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-sm font-medium text-slate-500 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700" onClick={() => setEditProd('new')}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><Icon name="plus" className="h-4 w-4" /></span>
              Add a product
            </button>
          )}
          {products.length === 0 && !can('payments:write') && <EmptyState title="No products yet">Products are the services you sell.</EmptyState>}
        </div>
      )}

      <Modal open={editInv !== null} title={editInv === 'new' ? 'New invoice' : editInv ? `Invoice ${editInv.number}` : ''} onClose={() => setEditInv(null)} wide>
        {editInv !== null && (
          <InvoiceEditor inv={editInv === 'new' ? null : editInv} products={products ?? []} onDone={(m) => { setEditInv(null); toast(m); load(); }} />
        )}
      </Modal>
      <Modal open={editProd !== null} title={editProd === 'new' ? 'New product' : 'Edit product'} onClose={() => setEditProd(null)}>
        {editProd !== null && <ProductEditor p={editProd === 'new' ? null : editProd} onDone={(m) => { setEditProd(null); toast(m); load(); }} />}
      </Modal>
    </>
  );
}

function ProductEditor({ p, onDone }: { p: Product | null; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', description: p?.description ?? '', price: String(p?.price ?? ''), currency: p?.currency ?? 'USD', interval: p?.interval ?? 'one_time', isActive: p?.isActive ?? true });
  const [error, setError] = useState('');
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const body = { ...f, price: Number(f.price) };
        if (p) await api(`/payments/products/${p.id}`, { method: 'PUT', body });
        else await api('/payments/products', { method: 'POST', body });
        onDone(p ? 'Product saved' : 'Product created');
      } catch (err) { setError(errorText(err)); }
    }}>
      <div><label className="label" htmlFor="p-name">Name *</label><input id="p-name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="label" htmlFor="p-desc">Description</label><textarea id="p-desc" rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="label" htmlFor="p-price">Price *</label><input id="p-price" required type="number" min="0" step="0.01" className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-cur">Currency</label><input id="p-cur" maxLength={3} className="input uppercase" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
        <div><label className="label" htmlFor="p-int">Billing</label>
          <select id="p-int" className="input" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as Product['interval'] })}>
            <option value="one_time">One-time</option><option value="month">Monthly</option><option value="year">Yearly</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-between">
        {p ? <button type="button" className="btn-danger" onClick={async () => { await api(`/payments/products/${p.id}`, { method: 'DELETE' }); onDone('Product deleted'); }}>Delete</button> : <span />}
        <button className="btn-primary">Save</button>
      </div>
    </form>
  );
}

function InvoiceEditor({ inv, products, onDone }: { inv: Invoice | null; products: Product[]; onDone: (m: string) => void }) {
  const locked = !!inv && (inv.status === 'paid' || inv.status === 'void');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState(inv?.contactId ?? '');
  const [items, setItems] = useState<InvoiceItem[]>(inv?.items ?? [{ name: '', quantity: 1, unitPrice: 0 }]);
  const [taxRate, setTaxRate] = useState(String(inv?.taxRate ?? 0));
  const [discount, setDiscount] = useState(String(inv?.discount ?? 0));
  const [currency, setCurrency] = useState(inv?.currency ?? 'USD');
  const [dueDate, setDueDate] = useState(inv?.dueDate ?? '');
  const [notes, setNotes] = useState(inv?.notes ?? '');
  const [couponCode, setCouponCode] = useState('');
  const [couponPreview, setCouponPreview] = useState<{ discount: number; code: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const effectiveDiscount = couponPreview ? Math.min(subtotal, couponPreview.discount) : inv?.couponCode ? inv.discount : Number(discount) || 0;
  const after = Math.max(0, subtotal - effectiveDiscount);
  const tax = Math.round(after * (Number(taxRate) || 0)) / 100;
  const total = after + tax;
  const setItem = (i: number, p: Partial<InvoiceItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save(thenSend: boolean) {
    setError('');
    const body = {
      contactId,
      items: items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
      taxRate: Number(taxRate) || 0,
      discount: Number(discount) || 0,
      currency,
      dueDate: dueDate || null,
      notes,
      couponCode: !inv && couponPreview ? couponPreview.code : undefined,
    };
    try {
      const saved = inv ? await api<Invoice>(`/payments/invoices/${inv.id}`, { method: 'PUT', body }) : await api<Invoice>('/payments/invoices', { method: 'POST', body });
      if (thenSend) await api(`/payments/invoices/${saved.id}/send`, { method: 'POST' });
      onDone(thenSend ? `Invoice ${saved.number} sent` : `Invoice ${saved.number} saved`);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <fieldset disabled={locked} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="i-contact">Bill to *</label>
            <select id="i-contact" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Choose a contact…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` · ${c.email}` : ''}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="i-due">Due date</label><input id="i-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="w-20 py-2 pr-2">Qty</th><th className="w-28 py-2 pr-2">Price</th><th className="w-24 py-2 pr-3 text-right">Amount</th><th className="w-10" /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="py-1.5 pl-3 pr-2">
                  <input aria-label="Item name" required list="product-list" className="input py-1.5" value={it.name} onChange={(e) => {
                    const p = products.find((x) => x.name === e.target.value);
                    setItem(i, p ? { name: p.name, unitPrice: p.price, productId: p.id } : { name: e.target.value, productId: null });
                  }} />
                </td>
                <td className="py-1 pr-2"><input aria-label="Quantity" type="number" min="0.01" step="any" className="input py-1.5" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value as any })} /></td>
                <td className="py-1 pr-2"><input aria-label="Unit price" type="number" min="0" step="0.01" className="input py-1.5" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value as any })} /></td>
                <td className="py-1 pr-3 text-right font-medium tabular-nums">{fmtCurrency((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), currency)}</td>
                <td className="py-1 pr-2 text-right"><button type="button" className="btn-ghost h-8 w-8 px-0 text-slate-400 hover:text-rose-600" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="close" className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2">
          <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800" onClick={() => setItems([...items, { name: '', quantity: 1, unitPrice: 0 }])}><Icon name="plus" className="h-3.5 w-3.5" /> Add line</button>
        </div>
        </div>
        <datalist id="product-list">{products.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <div className="grid gap-3 sm:grid-cols-3">
          {inv?.couponCode ? (
            <div><span className="label">Coupon</span><p className="py-2"><code className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">{inv.couponCode}</code></p></div>
          ) : couponPreview ? (
            <div><span className="label">Coupon</span><p className="flex items-center gap-2 py-2"><code className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">{couponPreview.code}</code><button type="button" className="text-xs text-slate-500 hover:text-rose-600" onClick={() => setCouponPreview(null)}>Remove</button></p></div>
          ) : (
            <div><label className="label" htmlFor="i-disc">Discount</label><input id="i-disc" type="number" min="0" step="0.01" className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          )}
          <div><label className="label" htmlFor="i-tax">Tax %</label><input id="i-tax" type="number" min="0" max="100" step="0.01" className="input" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
          <div><label className="label" htmlFor="i-cur">Currency</label><input id="i-cur" maxLength={3} className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
        </div>
        {!inv && !couponPreview && (
          <div className="flex items-end gap-2">
            <div className="flex-1"><label className="label" htmlFor="i-coupon">Coupon code</label><input id="i-coupon" className="input uppercase" placeholder="Optional" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} /></div>
            <button type="button" className="btn-secondary" disabled={!couponCode.trim()} onClick={async () => {
              setError('');
              try {
                const r = await api(`/payments/coupons/preview?code=${encodeURIComponent(couponCode)}&use=invoices&currency=${currency}&subtotal=${subtotal}`);
                setCouponPreview({ code: r.code, discount: r.discount });
              } catch (err) { setError(errorText(err)); }
            }}>Apply</button>
          </div>
        )}
        <div><label className="label" htmlFor="i-notes">Notes to client</label><textarea id="i-notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </fieldset>
      <dl className="ml-auto w-full max-w-xs space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{fmtCurrency(subtotal, currency)}</dd></div>
        {effectiveDiscount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount{couponPreview || inv?.couponCode ? ` (${couponPreview?.code ?? inv?.couponCode})` : ''}</dt><dd className="tabular-nums">−{fmtCurrency(effectiveDiscount, currency)}</dd></div>}
        <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="tabular-nums">{fmtCurrency(tax, currency)}</dd></div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{fmtCurrency(total, currency)}</dd></div>
      </dl>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
        {inv?.status === 'draft' && <button type="button" className="btn-ghost text-rose-600" onClick={async () => { await api(`/payments/invoices/${inv.id}`, { method: 'DELETE' }); onDone('Draft deleted'); }}>Delete draft</button>}
        {!locked && <button className="btn-secondary">Save {inv ? '' : 'draft'}</button>}
        {!locked && <button type="button" className="btn-primary" onClick={() => save(true)}><Icon name="send" className="h-4 w-4" /> Save & email</button>}
        {locked && <p className="text-sm text-slate-500">This invoice is {inv!.status} and can no longer be edited.</p>}
      </div>
    </form>
  );
}
