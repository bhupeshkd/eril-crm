'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Contact, ContactStatus } from '@/lib/types';
import { Tag, errorText } from './ui';

export function ContactForm({
  contact,
  onSaved,
  onCancel,
}: {
  contact?: Contact | null;
  onSaved: (c: Contact) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    companyName: contact?.company?.name ?? '',
    status: (contact?.status ?? 'lead') as ContactStatus,
    notes: contact?.notes ?? '',
  });
  const [tags, setTags] = useState<string[]>(contact?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const pending = tagInput.trim().toLowerCase();
    const body = {
      ...form,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes || null,
      companyName: form.companyName.trim(),
      companyId: form.companyName.trim() ? undefined : null,
      tags: pending && !tags.includes(pending) ? [...tags, pending] : tags,
    };
    try {
      const saved = contact
        ? await api<Contact>(`/crm/contacts/${contact.id}`, { method: 'PUT', body })
        : await api<Contact>('/crm/contacts', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cf-first">First name *</label>
          <input id="cf-first" required className="input" value={form.firstName} onChange={set('firstName')} />
        </div>
        <div>
          <label className="label" htmlFor="cf-last">Last name</label>
          <input id="cf-last" className="input" value={form.lastName} onChange={set('lastName')} />
        </div>
        <div>
          <label className="label" htmlFor="cf-email">Email</label>
          <input id="cf-email" type="email" className="input" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className="label" htmlFor="cf-phone">Phone</label>
          <input id="cf-phone" className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div>
          <label className="label" htmlFor="cf-company">Company</label>
          <input id="cf-company" className="input" value={form.companyName} onChange={set('companyName')} placeholder="Created if new" />
        </div>
        <div>
          <label className="label" htmlFor="cf-status">Status</label>
          <select id="cf-status" className="input" value={form.status} onChange={set('status')}>
            <option value="lead">Lead</option>
            <option value="customer">Customer</option>
            <option value="churned">Churned</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="cf-tags">Tags</label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5">
          {tags.map((t) => (
            <Tag key={t} onRemove={() => setTags(tags.filter((x) => x !== t))}>{t}</Tag>
          ))}
          <input
            id="cf-tags"
            className="min-w-[8rem] flex-1 border-0 p-1 text-sm focus:outline-none"
            placeholder="Type and press Enter"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                setTags(tags.slice(0, -1));
              }
            }}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="cf-notes">Notes</label>
        <textarea id="cf-notes" rows={3} className="input" value={form.notes} onChange={set('notes')} />
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : contact ? 'Save changes' : 'Create contact'}</button>
      </div>
    </form>
  );
}
