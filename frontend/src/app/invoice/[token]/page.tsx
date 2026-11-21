'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, fmtCurrency } from '@/lib/api';
import { StatusBadge, errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';
import type { InvoiceItem } from '@/lib/types-ext';

interface PublicInvoice {
  number: string;
  status: 'sent' | 'paid' | 'void';
  currency: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  dueDate: string | null;
  notes: string;
  paidAt: string | null;
  billedTo: string;
  testMode: boolean;
  couponCode: string | null;
  canApplyCoupon: boolean;
  thankYou: { message: string; redirectUrl: string | null } | null;
  offer: Offer | null;
  addOns?: Array<{ name: string; total: number; currency: string; status: string; payUrl: string | null }>;
}

interface Offer {
  index: number;
  kind: 'upsell' | 'downsell';
  total: number;
  headline: string;
  description: string;
  acceptLabel: string;
  declineLabel: string;
  product: { name: string; description: string; price: number; currency: string; interval: 'one_time' | 'month' | 'year' };
  taxRate: number;
}

/** One-click post-purchase offer, shown on the paid order before the thank-you. */
function OfferCard({ offer, busy, onAnswer }: { offer: Offer; busy: boolean; onAnswer: (accept: boolean) => void }) {
  const p = offer.product;
  const money = (n: number) => fmtCurrency(n, p.currency);
  const tax = Math.round(p.price * offer.taxRate) / 100;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-b from-brand-50 to-white p-6 text-center ring-4 ring-brand-500/10" aria-labelledby="offer-h">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 shadow-sm ring-1 ring-brand-200">
        {offer.kind === 'downsell' ? 'Before you go · A lighter option' : <><Icon name="check" className="h-3 w-3" strokeWidth={3} /> Order paid · Special offer{offer.total > 1 ? ` ${offer.index + 1} of ${offer.total}` : ''}</>}
      </p>
      <h2 id="offer-h" className="mt-3 text-2xl font-semibold tracking-tight">{offer.headline}</h2>
      {offer.description && <p className="mx-auto mt-2 max-w-md whitespace-pre-wrap text-sm text-slate-600">{offer.description}</p>}
      <div className="mx-auto mt-5 max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-slate-700">{p.name}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {money(p.price)}<span className="text-base font-normal text-slate-500">{p.interval === 'one_time' ? '' : `/${p.interval}`}</span>
        </p>
        {tax > 0 && <p className="text-xs text-slate-500">+ {money(tax)} tax</p>}
        {p.interval !== 'one_time' && <p className="mt-1 text-xs text-slate-500">Renews every {p.interval} until you cancel.</p>}
      </div>
      <button className="btn-primary mt-5 h-12 w-full text-base" disabled={busy} onClick={() => onAnswer(true)}>{busy ? 'Adding…' : offer.acceptLabel}</button>
      <p className="mt-1 text-xs text-slate-500">Charged to the payment method you just used — no need to re-enter details.</p>
      <button className="mt-3 text-sm text-slate-500 underline hover:text-slate-700" disabled={busy} onClick={() => onAnswer(false)}>{offer.declineLabel}</button>
    </section>
  );
}

export default function InvoicePage() {
  return (
    <Suspense fallback={<PublicLoading />}>
      <InvoiceView />
    </Suspense>
  );
}

function InvoiceView() {
  const { token } = useParams<{ token: string }>();
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  // Arriving from an order form in test mode: open the payment step straight away.
  const autoPay = params.get('pay') === '1';
  const [inv, setInv] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTest, setConfirmTest] = useState(autoPay);
  const [coupon, setCoupon] = useState('');
  const [couponError, setCouponError] = useState('');

  async function testPay() {
    setBusy(true);
    try {
      await api(`/public/invoices/${token}/test-pay`, { method: 'POST', auth: false });
      setConfirmTest(false);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(() => api<PublicInvoice>(`/public/invoices/${token}`, { auth: false }).then(setInv).catch((e) => setError(errorText(e))), [token]);

  useEffect(() => {
    // Returning from Stripe Checkout: verify the session server-side first.
    if (sessionId) {
      api(`/public/invoices/${token}/confirm`, { method: 'POST', auth: false, body: { sessionId } }).finally(load);
    } else load();
  }, [token, sessionId, load]);

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const res = await api(`/public/invoices/${token}/checkout`, { method: 'POST', auth: false });
      if (res.mode === 'stripe') {
        location.href = res.url;
        return;
      }
      setConfirmTest(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Order-form purchases: send the buyer on to the seller's page after a short pause.
  useEffect(() => {
    const url = inv?.thankYou?.redirectUrl;
    if (!url || !/^https?:\/\//i.test(url)) return;
    const t = setTimeout(() => (location.href = url), 4000);
    return () => clearTimeout(t);
  }, [inv?.thankYou?.redirectUrl]);

  async function answer(accept: boolean) {
    if (!inv?.offer) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ status: string; payUrl?: string }>(`/public/order-forms/upsell/${token}`, { method: 'POST', auth: false, body: { index: inv.offer.index, kind: inv.offer.kind, accept } });
      if (r.status === 'requires_payment' && r.payUrl) {
        location.href = r.payUrl;
        return;
      }
      await load();
    } catch (err) {
      setError(errorText(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!inv) return <PublicLoading error={error} brand={{ kind: 'invoice', key: token }} />;
  const money = (n: number) => fmtCurrency(n, inv.currency);

  return (
    <PublicShell brand={{ kind: 'invoice', key: token }}>
      <article className="card mx-auto max-w-2xl overflow-hidden shadow-pop">
        <header className="relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-6 text-white sm:px-8 sm:py-7">
          <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-200">Invoice</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{inv.number}</h1>
            </div>
            <span className="rounded-md bg-white shadow-sm"><StatusBadge status={inv.status === 'sent' ? 'open' : inv.status} /></span>
          </div>
          <div className="relative mt-6 flex flex-wrap items-end justify-between gap-4">
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><dt className="text-[11px] uppercase tracking-wide text-brand-200">Billed to</dt><dd className="font-medium">{inv.billedTo}</dd></div>
              {inv.dueDate && <div><dt className="text-[11px] uppercase tracking-wide text-brand-200">Due</dt><dd className="font-medium">{inv.dueDate}</dd></div>}
            </dl>
            <div className="sm:text-right">
              <p className="text-[11px] uppercase tracking-wide text-brand-200">Amount {inv.status === 'paid' ? 'paid' : 'due'}</p>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">{money(inv.total)}</p>
            </div>
          </div>
        </header>
        <div className="p-5 sm:p-8">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="pb-2.5 font-medium">Item</th><th className="hidden pb-2.5 text-right font-medium sm:table-cell">Qty</th><th className="hidden pb-2.5 text-right font-medium sm:table-cell">Price</th><th className="pb-2.5 text-right font-medium">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.items.map((i, k) => (
              <tr key={k}>
                <td className="py-3 pr-3 font-medium text-slate-800">
                  {i.name}
                  <span className="mt-0.5 block text-xs font-normal text-slate-500 sm:hidden">{i.quantity} × {money(i.unitPrice)}</span>
                </td>
                <td className="hidden py-3 text-right tabular-nums text-slate-600 sm:table-cell">{i.quantity}</td>
                <td className="hidden py-3 pl-3 text-right tabular-nums text-slate-600 sm:table-cell">{money(i.unitPrice)}</td>
                <td className="whitespace-nowrap py-3 pl-3 text-right font-medium tabular-nums">{money(i.quantity * i.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-[17rem] space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(inv.subtotal)}</dd></div>
          {inv.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount{inv.couponCode ? ` (${inv.couponCode})` : ''}</dt><dd className="tabular-nums">−{money(inv.discount)}</dd></div>}
          {inv.tax > 0 && <div className="flex justify-between"><dt className="text-slate-500">Tax ({inv.taxRate}%)</dt><dd className="tabular-nums">{money(inv.tax)}</dd></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(inv.total)}</dd></div>
        </dl>
        {inv.canApplyCoupon && (
          <form
            className="ml-auto mt-3 flex w-full max-w-[17rem] gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setCouponError('');
              try {
                await api(`/public/invoices/${token}/coupon`, { method: 'POST', auth: false, body: { code: coupon } });
                setCoupon('');
                await load();
              } catch (err) {
                setCouponError(errorText(err));
              }
            }}
          >
            <input aria-label="Coupon code" className="input h-9 uppercase" placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
            <button className="btn-secondary" disabled={!coupon.trim()}>Apply</button>
          </form>
        )}
        {couponError && <p role="alert" className="mt-1 text-right text-sm text-rose-600">{couponError}</p>}
        {inv.notes && <p className="mt-6 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">{inv.notes}</p>}
        <div className="mt-8">
          {inv.status === 'paid' && inv.offer ? (
            <OfferCard offer={inv.offer} busy={busy} onAnswer={answer} />
          ) : inv.status === 'paid' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center text-emerald-900" role="status">
              <SuccessMark />
              <p className="text-lg font-semibold">Paid{inv.paidAt ? ` on ${new Date(inv.paidAt).toLocaleDateString()}` : ''} — thank you!</p>
              {inv.thankYou?.message && <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-800">{inv.thankYou.message}</p>}
              {!!inv.addOns?.length && (
                <ul className="mx-auto mt-4 max-w-sm space-y-1.5 rounded-xl bg-white p-3 text-left text-sm shadow-sm ring-1 ring-emerald-100">
                  <li className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800/70">Also added to your order</li>
                  {inv.addOns.map((a, k) => (
                    <li key={k} className="flex justify-between gap-2 text-slate-700">
                      <span>{a.name}</span>
                      <span className="tabular-nums">{a.status === 'paid' ? <span className="inline-flex items-center gap-1">{fmtCurrency(a.total, a.currency)}<Icon name="check" className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} /></span> : a.payUrl ? <a className="font-medium text-brand-600 underline" href={a.payUrl}>Complete payment</a> : a.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              {inv.thankYou?.redirectUrl && <a className="btn-primary mt-4" href={inv.thankYou.redirectUrl} rel="noopener">Continue <Icon name="chevronRight" className="h-4 w-4" /></a>}
            </div>
          ) : inv.status === 'void' ? (
            <p className="rounded-xl bg-slate-100 p-4 text-center text-slate-600">This invoice has been cancelled.</p>
          ) : confirmTest ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alertdialog" aria-label="Test payment">
              <p className="flex items-start gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>No payment provider is connected, so this is a <strong>test payment</strong>. No card will be charged; the invoice will simply be marked as paid.</span></p>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary flex-1" disabled={busy} onClick={testPay}>{busy ? 'Recording…' : 'Record test payment'}</button>
                <button className="btn-secondary" onClick={() => setConfirmTest(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn-primary h-12 w-full text-base" disabled={busy} onClick={pay}><Icon name="lock" className="h-4 w-4" />{busy ? 'Redirecting…' : `Pay ${money(inv.total)}`}</button>
              <p className="mt-2 text-center text-xs text-slate-400">{inv.testMode ? <span className="text-amber-700">Test mode — no real card will be charged.</span> : 'Secure checkout'}</p>
            </>
          )}
          {error && <p role="alert" className="mt-3 text-center text-sm text-rose-600">{error}</p>}
        </div>
        </div>
      </article>
    </PublicShell>
  );
}
