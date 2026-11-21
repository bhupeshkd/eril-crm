'use client';

import { useEffect, useState } from 'react';
import { api, fmtCurrency } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Product } from '@/lib/types-ext';
import { Modal, Segmented, errorText, useToast } from './ui';

interface PayContact {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  dnd?: boolean;
}

const DEFAULT_MSG = 'Hi {{name}}, here is your secure payment link for {{description}} ({{amount}}): {{link}}';

/** "Request payment" button + dialog: creates an invoice and texts/emails the pay link. */
export function TextToPayButton({ contact, channel, onSent, className = 'btn-secondary' }: { contact: PayContact; channel?: 'sms' | 'email'; onSent?: () => void; className?: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('invoices:write') || (!contact.phone && !contact.email)) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Send a payment link by SMS or email">💳 Request payment</button>
      <Modal open={open} title={`Request payment from ${contact.firstName}`} onClose={() => setOpen(false)}>
        {open && <TextToPayForm contact={contact} channel={channel} onDone={() => { setOpen(false); onSent?.(); }} />}
      </Modal>
    </>
  );
}

function TextToPayForm({ contact, channel: initial, onDone }: { contact: PayContact; channel?: 'sms' | 'email'; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'amount' | 'product'>('amount');
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [channel, setChannel] = useState<'sms' | 'email'>(initial ?? (contact.phone ? 'sms' : 'email'));
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Product[]>('/payments/products').then((p) => setProducts(p.filter((x) => x.isActive && x.interval === 'one_time'))).catch(() => {});
  }, []);

  const product = products.find((p) => p.id === productId);
  const total = mode === 'product' ? (product ? product.price * quantity : 0) : Number(amount) || 0;
  const cur = mode === 'product' ? product?.currency ?? 'USD' : currency;
  const desc = mode === 'product' ? (product ? (quantity > 1 ? `${quantity} × ${product.name}` : product.name) : '') : description.trim();
  const preview = (() => {
    let t = (message.trim() || DEFAULT_MSG).replace(/\{\{\s*name\s*\}\}/gi, contact.firstName).replace(/\{\{\s*amount\s*\}\}/gi, fmtCurrency(total, cur)).replace(/\{\{\s*description\s*\}\}/gi, desc || '…');
    if (!/\{\{\s*link\s*\}\}/i.test(t)) t += ' {{link}}';
    return t.replace(/\{\{\s*link\s*\}\}/i, 'https://…/invoice/•••').replace(/\{\{\s*link\s*\}\}/gi, '');
  })();
  const ready = total > 0 && !!desc;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'product' ? { contactId: contact.id, channel, productId, quantity, message } : { contactId: contact.id, channel, amount: Number(amount), description, currency, message };
      const r = await api<{ invoice: { number: string } }>('/payments/text-to-pay', { method: 'POST', body });
      toast(`Payment link sent (${r.invoice.number})`);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (contact.dnd) return <p className="text-sm text-slate-600">{contact.firstName} is on do-not-disturb, so payment links can’t be sent.</p>;

  return (
    <form onSubmit={send} className="space-y-3">
      <Segmented<'amount' | 'product'> label="What to charge" value={mode} onChange={setMode} options={[['amount', 'Custom amount'], ['product', 'Product']]} />
      {mode === 'amount' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_120px_90px]">
          <div><label className="label" htmlFor="tp-desc">What it’s for *</label><input id="tp-desc" required maxLength={200} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Deep clean, 14 Nov" /></div>
          <div><label className="label" htmlFor="tp-amt">Amount *</label><input id="tp-amt" required type="number" min={0.5} step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label" htmlFor="tp-cur">Currency</label><input id="tp-cur" maxLength={3} className="input uppercase" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
          <div>
            <label className="label" htmlFor="tp-prod">Product *</label>
            <select id="tp-prod" required className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtCurrency(p.price, p.currency)}</option>)}
            </select>
            {products.length === 0 && <p className="mt-1 text-xs text-slate-500">No one-time products yet.</p>}
          </div>
          <div><label className="label" htmlFor="tp-qty">Qty</label><input id="tp-qty" type="number" min={1} max={100} className="input" value={quantity} onChange={(e) => setQuantity(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} /></div>
        </div>
      )}
      <fieldset>
        <legend className="label">Send by</legend>
        <div className="flex gap-4 text-sm">
          <label className={`flex items-center gap-2 ${contact.phone ? '' : 'opacity-50'}`}><input type="radio" disabled={!contact.phone} checked={channel === 'sms'} onChange={() => setChannel('sms')} /> SMS {contact.phone && <span className="text-slate-400">{contact.phone}</span>}</label>
          <label className={`flex items-center gap-2 ${contact.email ? '' : 'opacity-50'}`}><input type="radio" disabled={!contact.email} checked={channel === 'email'} onChange={() => setChannel('email')} /> Email {contact.email && <span className="text-slate-400">{contact.email}</span>}</label>
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="tp-msg">Message</label>
        <textarea id="tp-msg" rows={3} maxLength={320} className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="mt-1 text-xs text-slate-500">Use {'{{name}}'}, {'{{amount}}'}, {'{{description}}'}, {'{{link}}'}. The secure link is always included.</p>
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Preview</p>
        <p className="whitespace-pre-wrap">{preview}</p>
        {channel === 'sms' && <p className="mt-1 text-xs text-slate-400">{preview.length} characters{preview.length > 160 ? ` · ${Math.ceil(preview.length / 153)} SMS segments` : ''}</p>}
      </div>
      <p className="text-xs text-slate-500">An invoice is created and marked as sent. When it’s paid, {contact.firstName} gets a receipt by {channel === 'sms' ? 'SMS' : 'email'}.</p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || !ready}>{busy ? 'Sending…' : `Send ${total > 0 ? fmtCurrency(total, cur) : ''} payment link`}</button>
      </div>
    </form>
  );
}
