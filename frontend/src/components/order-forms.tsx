'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Product } from '@/lib/types-ext';
import { EmptyState, Modal, PageLoader, StatusBadge, errorText, useToast } from './ui';
import { Icon } from './icons';

interface OrderFormRow {
  id: string;
  name: string;
  slug: string;
  headline: string;
  description: string;
  productIds: string[];
  bump: { productId: string; headline: string; description: string } | null;
  upsells: Upsell[];
  upsellsPaid: number;
  downsellsPaid: number;
  upsellRevenue: number;
  collectPhone: boolean;
  allowQuantity: boolean;
  maxQuantity: number;
  allowCoupons: boolean;
  taxRate: number;
  tags: string[];
  buttonLabel: string;
  thankYouMessage: string;
  redirectUrl: string;
  isActive: boolean;
  views: number;
  orders: number;
  paid: number;
  revenue: number;
}

interface Offer {
  productId: string;
  headline: string;
  description: string;
  acceptLabel: string;
  declineLabel: string;
}
interface Upsell extends Offer {
  /** Cheaper fallback shown only when this upsell is declined. */
  downsell?: Offer | null;
}
const NEW_DOWNSELL: Offer = { productId: '', headline: 'Not ready for that? Try this instead', description: '', acceptLabel: 'Yes, I’ll take this instead', declineLabel: 'No thanks' };

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

/** Payments → Order forms: hosted checkout pages with an optional order bump. */
export function OrderFormsTab({ products }: { products: Product[] }) {
  const toast = useToast();
  const { can } = useAuth();
  const [forms, setForms] = useState<OrderFormRow[] | null>(null);
  const [editing, setEditing] = useState<OrderFormRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<OrderFormRow | null>(null);

  const load = useCallback(() => api<OrderFormRow[]>('/payments/order-forms').then(setForms).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const currency = (f: OrderFormRow) => products.find((p) => p.id === f.productIds[0])?.currency ?? 'USD';

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Checkout pages you can link from ads, emails or your site. Each order becomes an invoice paid on the secure pay page.</p>
        {can('payments:write') && <button className="btn-primary" onClick={() => setEditing('new')} disabled={!products.some((p) => p.isActive)} title={products.some((p) => p.isActive) ? '' : 'Create a product first'}><Icon name="plus" /> New order form</button>}
      </div>
      {!forms ? <PageLoader /> : forms.length === 0 ? (
        <EmptyState title="No order forms yet">{products.length ? 'Create one to sell a product with a single link.' : 'Add a product under the “Products” tab first.'}</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {forms.map((f) => (
            <div key={f.id} className="card card-hover p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{f.name}</h3>
                <span className={`badge ${f.isActive ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-600'}`}>{f.isActive ? 'Live' : 'Off'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{f.productIds.length} product{f.productIds.length === 1 ? '' : 's'}{f.bump ? ' · order bump' : ''}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                <div><dt className="text-slate-500">Views</dt><dd className="text-base font-semibold tabular-nums">{f.views}</dd></div>
                <div><dt className="text-slate-500">Orders</dt><dd className="text-base font-semibold tabular-nums">{f.orders}</dd></div>
                <div><dt className="text-slate-500">Paid</dt><dd className="text-base font-semibold tabular-nums">{f.paid}</dd></div>
                <div><dt className="text-slate-500">Conv.</dt><dd className="text-base font-semibold tabular-nums">{pct(f.paid, f.views)}</dd></div>
              </dl>
              <p className="mt-2 text-sm">Revenue <strong className="tabular-nums">{fmtCurrency(f.revenue, currency(f))}</strong></p>
              {f.upsells.length > 0 && (
                <p className="text-xs text-slate-500">
                  {f.upsells.length} upsell{f.upsells.length === 1 ? '' : 's'} · {f.upsellsPaid} accepted ({pct(f.upsellsPaid, f.paid)} of paid orders{f.downsellsPaid ? `, ${f.downsellsPaid} via downsell` : ''}) · {fmtCurrency(f.upsellRevenue, currency(f))}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn-secondary py-1.5" href={`/order/${f.slug}`} target="_blank" rel="noreferrer"><Icon name="external" className="h-3.5 w-3.5" /> Open</a>
                <button className="btn-ghost py-1.5" onClick={() => { navigator.clipboard.writeText(`${location.origin}/order/${f.slug}`); toast('Link copied'); }}>Copy link</button>
                <button className="btn-ghost py-1.5" onClick={() => setViewing(f)}>Orders</button>
                {can('payments:write') && <button className="btn-ghost py-1.5" onClick={() => setEditing(f)}>Edit</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'New order form' : 'Edit order form'} onClose={() => setEditing(null)} wide>
        {editing !== null && <OrderFormEditor form={editing === 'new' ? null : editing} products={products} onDone={(m) => { setEditing(null); toast(m); load(); }} />}
      </Modal>
      <Modal open={!!viewing} title={viewing ? `Orders · ${viewing.name}` : ''} onClose={() => setViewing(null)} wide>
        {viewing && <OrdersList formId={viewing.id} />}
      </Modal>
    </>
  );
}

function OrderFormEditor({ form, products, onDone }: { form: OrderFormRow | null; products: Product[]; onDone: (m: string) => void }) {
  const active = products.filter((p) => p.isActive || form?.productIds.includes(p.id) || form?.bump?.productId === p.id);
  const [f, setF] = useState({
    name: form?.name ?? '',
    headline: form?.headline ?? '',
    description: form?.description ?? '',
    productIds: form?.productIds ?? [],
    collectPhone: form?.collectPhone ?? false,
    allowQuantity: form?.allowQuantity ?? false,
    maxQuantity: form?.maxQuantity ?? 10,
    allowCoupons: form?.allowCoupons ?? true,
    taxRate: form?.taxRate ?? 0,
    tags: (form?.tags ?? []).join(', '),
    buttonLabel: form?.buttonLabel ?? 'Complete order',
    thankYouMessage: form?.thankYouMessage ?? 'Thank you for your order!',
    redirectUrl: form?.redirectUrl ?? '',
    isActive: form?.isActive ?? true,
  });
  const [bumpOn, setBumpOn] = useState(!!form?.bump);
  const [bump, setBump] = useState(form?.bump ?? { productId: '', headline: 'Yes! Add this to my order', description: '' });
  const [upsells, setUpsells] = useState<Upsell[]>(form?.upsells ?? []);
  const setUpsell = (i: number, patch: Partial<Upsell>) => setUpsells(upsells.map((u, k) => (k === i ? { ...u, ...patch } : u)));
  const [error, setError] = useState('');
  const toggle = (id: string) => setF({ ...f, productIds: f.productIds.includes(id) ? f.productIds.filter((x) => x !== id) : [...f.productIds, id] });
  const label = (p: Product) => `${p.name} — ${fmtCurrency(p.price, p.currency)}${p.interval === 'one_time' ? '' : `/${p.interval}`}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const body = { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), bump: bumpOn ? bump : null, upsells };
    try {
      if (form) await api(`/payments/order-forms/${form.id}`, { method: 'PUT', body });
      else await api('/payments/order-forms', { method: 'POST', body });
      onDone(form ? 'Order form saved' : 'Order form created');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="of-name">Internal name *</label><input id="of-name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="of-head">Page headline</label><input id="of-head" className="input" placeholder="Defaults to the name" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="of-desc">Description</label><textarea id="of-desc" rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      </div>
      <fieldset>
        <legend className="label">Products offered (buyer picks one) *</legend>
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {active.map((p) => (
            <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => toggle(p.id)} />{label(p)}</label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Monthly/yearly products charge the first period now and start a subscription once paid. All products must share one currency.</p>
      </fieldset>
      <fieldset className="rounded-md border border-dashed border-amber-400 p-3">
        <legend className="px-1 text-sm font-medium">Order bump</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bumpOn} onChange={(e) => setBumpOn(e.target.checked)} /> Offer a one-click add-on next to the pay button</label>
        {bumpOn && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="of-bp">Add-on product *</label>
              <select id="of-bp" required className="input" value={bump.productId} onChange={(e) => setBump({ ...bump, productId: e.target.value })}>
                <option value="">Choose…</option>
                {active.filter((p) => p.interval === 'one_time').map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="of-bh">Headline *</label><input id="of-bh" required className="input" value={bump.headline} onChange={(e) => setBump({ ...bump, headline: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="of-bd">Pitch</label><input id="of-bd" className="input" value={bump.description} onChange={(e) => setBump({ ...bump, description: e.target.value })} placeholder="One or two sentences on why it’s worth adding" /></div>
          </div>
        )}
      </fieldset>
      <fieldset className="rounded-md border border-brand-200 p-3">
        <legend className="px-1 text-sm font-medium">One-click upsells (after payment)</legend>
        <p className="text-xs text-slate-500">Shown in order once the buyer has paid. Accepting charges the same payment method without re-entering details (Stripe saves the card at checkout; test mode records it). Offers close 30 minutes after payment.</p>
        {upsells.map((u, i) => (
          <div key={i} className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
            <div className="flex items-center justify-between sm:col-span-2">
              <span className="text-sm font-medium">Offer {i + 1}</span>
              <span className="flex gap-1">
                <button type="button" className="btn-ghost px-2 py-0.5 text-xs" disabled={i === 0} aria-label="Move up" onClick={() => { const n = [...upsells]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setUpsells(n); }}>↑</button>
                <button type="button" className="btn-ghost px-2 py-0.5 text-xs text-rose-600" onClick={() => setUpsells(upsells.filter((_, k) => k !== i))}>Remove</button>
              </span>
            </div>
            <div>
              <label className="label" htmlFor={`up-p-${i}`}>Product *</label>
              <select id={`up-p-${i}`} required className="input" value={u.productId} onChange={(e) => setUpsell(i, { productId: e.target.value })}>
                <option value="">Choose…</option>
                {active.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor={`up-h-${i}`}>Headline *</label><input id={`up-h-${i}`} required className="input" value={u.headline} onChange={(e) => setUpsell(i, { headline: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor={`up-d-${i}`}>Pitch</label><textarea id={`up-d-${i}`} rows={2} className="input" value={u.description} onChange={(e) => setUpsell(i, { description: e.target.value })} /></div>
            <div><label className="label" htmlFor={`up-a-${i}`}>Accept button</label><input id={`up-a-${i}`} className="input" value={u.acceptLabel} onChange={(e) => setUpsell(i, { acceptLabel: e.target.value })} /></div>
            <div><label className="label" htmlFor={`up-n-${i}`}>Decline link</label><input id={`up-n-${i}`} className="input" value={u.declineLabel} onChange={(e) => setUpsell(i, { declineLabel: e.target.value })} /></div>
            <div className="sm:col-span-2 rounded-md border border-dashed border-slate-300 bg-white p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!u.downsell} onChange={(e) => setUpsell(i, { downsell: e.target.checked ? { ...NEW_DOWNSELL } : null })} />
                If they decline, offer a downsell (a cheaper option)
              </label>
              {u.downsell && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor={`dn-p-${i}`}>Downsell product *</label>
                    <select id={`dn-p-${i}`} required className="input" value={u.downsell.productId} onChange={(e) => setUpsell(i, { downsell: { ...u.downsell!, productId: e.target.value } })}>
                      <option value="">Choose…</option>
                      {active.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
                    </select>
                  </div>
                  <div><label className="label" htmlFor={`dn-h-${i}`}>Headline *</label><input id={`dn-h-${i}`} required className="input" value={u.downsell.headline} onChange={(e) => setUpsell(i, { downsell: { ...u.downsell!, headline: e.target.value } })} /></div>
                  <div className="sm:col-span-2"><label className="label" htmlFor={`dn-d-${i}`}>Pitch</label><textarea id={`dn-d-${i}`} rows={2} className="input" value={u.downsell.description} onChange={(e) => setUpsell(i, { downsell: { ...u.downsell!, description: e.target.value } })} /></div>
                  <div><label className="label" htmlFor={`dn-a-${i}`}>Accept button</label><input id={`dn-a-${i}`} className="input" value={u.downsell.acceptLabel} onChange={(e) => setUpsell(i, { downsell: { ...u.downsell!, acceptLabel: e.target.value } })} /></div>
                  <div><label className="label" htmlFor={`dn-n-${i}`}>Decline link</label><input id={`dn-n-${i}`} className="input" value={u.downsell.declineLabel} onChange={(e) => setUpsell(i, { downsell: { ...u.downsell!, declineLabel: e.target.value } })} /></div>
                </div>
              )}
            </div>
          </div>
        ))}
        {upsells.length < 3 && (
          <button type="button" className="btn-secondary mt-3 py-1.5 text-sm" onClick={() => setUpsells([...upsells, { productId: '', headline: '', description: '', acceptLabel: 'Yes, add it to my order', declineLabel: 'No thanks' }])}>+ Add upsell</button>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="of-tax">Tax rate (%)</label><input id="of-tax" type="number" min={0} max={100} step="0.01" className="input" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: Number(e.target.value) })} /></div>
        <div><label className="label" htmlFor="of-btn">Button label</label><input id="of-btn" required maxLength={60} className="input" value={f.buttonLabel} onChange={(e) => setF({ ...f, buttonLabel: e.target.value })} /></div>
        <div><label className="label" htmlFor="of-tags">Tag buyers</label><input id="of-tags" className="input" placeholder="e.g. customer, course-buyer" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="of-ty">Thank-you message</label><textarea id="of-ty" rows={2} className="input" value={f.thankYouMessage} onChange={(e) => setF({ ...f, thankYouMessage: e.target.value })} /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="of-url">After payment, send buyers to (optional)</label><input id="of-url" type="url" className="input" placeholder="https://yoursite.com/welcome" value={f.redirectUrl} onChange={(e) => setF({ ...f, redirectUrl: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.collectPhone} onChange={(e) => setF({ ...f, collectPhone: e.target.checked })} /> Ask for phone number</label>
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.allowQuantity} onChange={(e) => setF({ ...f, allowQuantity: e.target.checked })} /> Let buyers choose a quantity</label>
          {f.allowQuantity && (
            <label className="flex items-center gap-1 text-slate-600">up to <input aria-label="Maximum quantity" type="number" min={1} max={100} className="input w-16 py-0.5" value={f.maxQuantity} onChange={(e) => setF({ ...f, maxQuantity: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          )}
        </span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.allowCoupons} onChange={(e) => setF({ ...f, allowCoupons: e.target.checked })} /> Accept coupon codes</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Page is live</label>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-between">
        {form ? <button type="button" className="btn-danger" onClick={async () => { if (confirm('Delete this order form? Existing orders stay as invoices.')) { await api(`/payments/order-forms/${form.id}`, { method: 'DELETE' }); onDone('Order form deleted'); } }}>Delete</button> : <span />}
        <button className="btn-primary" disabled={!f.productIds.length}>{form ? 'Save' : 'Create order form'}</button>
      </div>
    </form>
  );
}

function OrdersList({ formId }: { formId: string }) {
  const [orders, setOrders] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>(`/payments/order-forms/${formId}/orders`).then(setOrders).catch(() => setOrders([]));
  }, [formId]);
  if (!orders) return <PageLoader />;
  if (!orders.length) return <p className="text-sm text-slate-500">No orders yet.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="py-2">Invoice</th><th className="py-2">Buyer</th><th className="py-2">Items</th><th className="py-2 text-right">Total</th><th className="py-2">Status</th><th className="py-2">Placed</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="py-2 font-medium">{o.number}{o.parentInvoiceId && <span className="ml-1 badge bg-brand-50 text-brand-700">{o.upsellKind === 'downsell' ? 'downsell' : 'upsell'} {o.upsellIndex + 1}</span>}</td>
            <td className="py-2"><Link className="hover:text-brand-600" href={`/contacts/${o.contactId}`}>{o.contact?.firstName} {o.contact?.lastName}</Link></td>
            <td className="py-2 text-slate-500">{o.items.map((i: any) => i.name).join(' + ')}</td>
            <td className="py-2 text-right tabular-nums">{fmtCurrency(o.total, o.currency)}</td>
            <td className="py-2"><StatusBadge status={o.status === 'sent' ? 'unpaid' : o.status} /></td>
            <td className="py-2 text-slate-500">{fmtDate(o.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
