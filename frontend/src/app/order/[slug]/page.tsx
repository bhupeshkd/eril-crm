'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtCurrency } from '@/lib/api';
import { getAttribution } from '@/lib/attribution';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell } from '@/components/public-shell';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <legend className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
      {children}
    </legend>
  );
}

interface PubProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: 'one_time' | 'month' | 'year';
}
interface PubForm {
  name: string;
  headline: string;
  description: string;
  products: PubProduct[];
  bump: (PubProduct & { headline: string }) | null;
  collectPhone: boolean;
  allowQuantity: boolean;
  maxQuantity: number;
  allowCoupons: boolean;
  taxRate: number;
  buttonLabel: string;
  currency: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const per = (p: PubProduct) => (p.interval === 'month' ? '/month' : p.interval === 'year' ? '/year' : '');

export default function OrderFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PubForm | null>(null);
  const [loadError, setLoadError] = useState('');
  const [productId, setProductId] = useState('');
  const [bump, setBump] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '' });
  const [code, setCode] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PubForm>(`/public/order-forms/${slug}`, { auth: false })
      .then((f) => {
        setForm(f);
        setProductId(f.products[0]?.id ?? '');
      })
      .catch((e) => setLoadError(errorText(e)));
  }, [slug]);

  const product = form?.products.find((p) => p.id === productId);
  const totals = useMemo(() => {
    if (!form || !product) return null;
    const subtotal = round2(product.price * quantity + (bump && form.bump ? form.bump.price : 0));
    const discount = Math.min(coupon?.discount ?? 0, subtotal);
    const tax = round2(((subtotal - discount) * form.taxRate) / 100);
    return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
  }, [form, product, bump, coupon, quantity]);

  // A coupon's value depends on the basket, so re-check it whenever the basket changes.
  useEffect(() => {
    if (!coupon || !form) return;
    api<{ code: string; discount: number }>(`/public/order-forms/${slug}/coupon`, { method: 'POST', auth: false, body: { code: coupon.code, productId, bump, quantity } })
      .then((c) => setCoupon({ code: c.code, discount: c.discount }))
      .catch((e) => {
        setCoupon(null);
        setCouponError(errorText(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, bump, quantity]);

  if (!form) return <PublicLoading error={loadError} brand={{ kind: 'order', key: slug }} />;
  const money = (n: number) => fmtCurrency(n, form.currency);

  async function applyCoupon() {
    setCouponError('');
    try {
      const c = await api<{ code: string; discount: number }>(`/public/order-forms/${slug}/coupon`, { method: 'POST', auth: false, body: { code, productId, bump, quantity } });
      setCoupon({ code: c.code, discount: c.discount });
      setCode('');
    } catch (e) {
      setCouponError(errorText(e));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const order = await api<{ token: string }>(`/public/order-forms/${slug}/order`, {
        method: 'POST',
        auth: false,
        body: { name: buyer.name, email: buyer.email, phone: form!.collectPhone ? buyer.phone || undefined : undefined, productId, quantity, bump, couponCode: coupon?.code, attribution: getAttribution() },
      });
      const pay = await api<{ mode: 'stripe' | 'test'; url?: string }>(`/public/invoices/${order.token}/checkout`, { method: 'POST', auth: false });
      location.href = pay.mode === 'stripe' && pay.url ? pay.url : `/invoice/${order.token}?pay=1`;
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <PublicShell wide brand={{ kind: 'order', key: slug }}>
      <form onSubmit={submit} className="card mx-auto grid overflow-hidden shadow-pop md:grid-cols-[1fr_330px]">
        <section className="space-y-8 p-6 md:p-8">
          <header>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{form.headline}</h1>
            {form.description && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600">{form.description}</p>}
          </header>

          <fieldset>
            <Step n={1}>Choose your option</Step>
            <div className="space-y-2">
              {form.products.map((p) => (
                <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${productId === p.id ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <input type="radio" name="product" className="mt-1" checked={productId === p.id} onChange={() => setProductId(p.id)} />
                  <span className="flex-1">
                    <span className="flex justify-between gap-2 font-medium"><span>{p.name}</span><span className="text-[15px] font-semibold tabular-nums">{money(p.price)}<span className="text-xs font-normal text-slate-500">{per(p)}</span></span></span>
                    {p.description && <span className="block text-sm text-slate-500">{p.description}</span>}
                    {p.interval !== 'one_time' && <span className="block text-xs text-slate-500">Billed {p.interval === 'month' ? 'monthly' : 'yearly'} until you cancel. Today you pay the first {p.interval}.</span>}
                  </span>
                </label>
              ))}
            </div>
            {form.allowQuantity && (
              <div className="mt-3 flex items-center gap-3">
                <span className="text-sm font-medium" id="qty-label">Quantity</span>
                <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" role="group" aria-labelledby="qty-label">
                  <button type="button" className="px-3 py-1.5 text-lg leading-none hover:bg-slate-50 disabled:opacity-40" aria-label="One fewer" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                  <input
                    aria-label="Quantity"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={form.maxQuantity}
                    className="w-14 border-x border-slate-200 py-1.5 text-center tabular-nums outline-none"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.min(form.maxQuantity, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                  />
                  <button type="button" className="px-3 py-1.5 text-lg leading-none hover:bg-slate-50 disabled:opacity-40" aria-label="One more" disabled={quantity >= form.maxQuantity} onClick={() => setQuantity((q) => Math.min(form.maxQuantity, q + 1))}>+</button>
                </div>
                <span className="text-xs text-slate-500">up to {form.maxQuantity}</span>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <Step n={2}>Your details</Step>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="o-name">Full name *</label><input id="o-name" required autoComplete="name" className="input" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></div>
              <div><label className="label" htmlFor="o-email">Email *</label><input id="o-email" required type="email" autoComplete="email" className="input" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></div>
            </div>
            {form.collectPhone && <div><label className="label" htmlFor="o-phone">Phone</label><input id="o-phone" type="tel" autoComplete="tel" className="input" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></div>}
          </fieldset>

          {form.bump && (
            <label className={`block cursor-pointer rounded-xl border-2 border-dashed p-4 transition ${bump ? 'border-amber-500 bg-amber-50' : 'border-amber-300 bg-amber-50/50 hover:bg-amber-50'}`}>
              <span className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={bump} onChange={(e) => setBump(e.target.checked)} />
                <span>
                  <span className="block font-semibold text-amber-900">{form.bump.headline}</span>
                  {form.bump.description && <span className="mt-1 block text-sm text-amber-900/80">{form.bump.description}</span>}
                  <span className="mt-1 block text-sm font-medium tabular-nums">{form.bump.name} — {money(form.bump.price)}</span>
                </span>
              </span>
            </label>
          )}
        </section>

        <aside className="border-t border-slate-100 bg-slate-50/70 p-6 md:border-l md:border-t-0 md:p-7">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order summary</h2>
          {product && totals && (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2"><dt>{product.name}{quantity > 1 && <span className="text-slate-500"> × {quantity}</span>}</dt><dd className="tabular-nums">{money(round2(product.price * quantity))}</dd></div>
              {bump && form.bump && <div className="flex justify-between gap-2"><dt>{form.bump.name}</dt><dd className="tabular-nums">{money(form.bump.price)}</dd></div>}
              {totals.discount > 0 && <div className="flex justify-between gap-2 text-emerald-700"><dt>Coupon {coupon?.code} <button type="button" className="text-xs underline" onClick={() => setCoupon(null)}>remove</button></dt><dd className="tabular-nums">−{money(totals.discount)}</dd></div>}
              {totals.tax > 0 && <div className="flex justify-between gap-2 text-slate-500"><dt>Tax ({form.taxRate}%)</dt><dd className="tabular-nums">{money(totals.tax)}</dd></div>}
              <div className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-3"><dt className="font-semibold">Due today</dt><dd className="text-2xl font-semibold tracking-tight tabular-nums">{money(totals.total)}</dd></div>
              {product.interval !== 'one_time' && <p className="text-xs text-slate-500">Then {money(round2(product.price * quantity))}{per(product)}{quantity > 1 ? ` for ${quantity}` : ''} plus tax.</p>}
            </dl>
          )}
          {form.allowCoupons && !coupon && (
            <div className="mt-4">
              <div className="flex gap-2">
                <input aria-label="Coupon code" className="input h-9 uppercase" placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value)} />
                <button type="button" className="btn-secondary" disabled={!code.trim()} onClick={applyCoupon}>Apply</button>
              </div>
              {couponError && <p role="alert" className="mt-1 text-sm text-rose-600">{couponError}</p>}
            </div>
          )}
          <button className="btn-primary mt-6 h-12 w-full text-base" disabled={busy || !productId}>{busy ? 'Processing…' : form.buttonLabel}</button>
          {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400"><Icon name="lock" className="h-3.5 w-3.5" /> Secure checkout</p>
        </aside>
      </form>
    </PublicShell>
  );
}
