'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Conversation, Workflow } from '@/lib/types';
import { ContactForm } from '@/components/contact-form';
import { ContactCustomFields, ContactExtras } from '@/components/contact-extras';
import { AiButton, useAiEnabled } from '@/lib/ai';
import { TextToPayButton } from '@/components/text-to-pay';
import { CallButton } from '@/components/call-button';
import { Modal, Spinner, StatusBadge, Tag, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [contact, setContact] = useState<Contact | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState<'email' | 'sms' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setContact(await api<Contact>(`/crm/contacts/${id}`));
      const convs = await api<Conversation[]>('/inbox/conversations');
      setConversations(convs.filter((c) => c.contactId === id));
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    if (can('workflows:read')) api<Workflow[]>('/automation/workflows').then(setWorkflows).catch(() => {});
  }, [load, can]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!contact) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  async function runWorkflow(wf: Workflow) {
    try {
      const run = await api(`/automation/workflows/${wf.id}/trigger`, { method: 'POST', body: { contactId: id } });
      toast(`"${wf.name}" ${run.status}`, run.status === 'failed' ? 'error' : 'ok');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.email || 'Unnamed contact';
  const dnd = (contact as any).dnd as boolean | undefined;
  const source = (contact as any).source as string | undefined;
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast(`${what} copied`)).catch(() => {});
  const canMessage = can('conversations:write');

  return (
    <>
      <Link href="/contacts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900">
        <Icon name="arrowLeft" className="h-4 w-4" /> Contacts
      </Link>

      {/* Profile header */}
      <section className="card relative mt-3 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-brand-500/90 via-violet-500/80 to-fuchsia-500/70" />
        <div className="flex flex-wrap items-end gap-4 px-6 pb-5">
          <div className="-mt-10 rounded-full bg-white p-1 shadow-card">
            <ContactAvatar c={contact} size="h-20 w-20 text-2xl" />
          </div>
          <div className="min-w-0 flex-1 pt-3">
            <h1 className="truncate text-[24px] font-semibold leading-tight tracking-tight">{name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
              <StatusBadge status={contact.status} />
              {dnd && <span className="badge bg-rose-50 text-rose-700 ring-rose-600/15">Do not disturb</span>}
              {contact.company && <span className="inline-flex items-center gap-1"><Icon name="agency" className="h-3.5 w-3.5" /> {contact.company.name}</span>}
              <span className="inline-flex items-center gap-1"><Icon name="calendar" className="h-3.5 w-3.5" /> Added {fmtDate(contact.createdAt)}</span>
              {source && <span className="inline-flex items-center gap-1 capitalize"><Icon name="sparkles" className="h-3.5 w-3.5" /> via {source.replace(/_/g, ' ')}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canMessage && contact.email && (
              <button className="btn-secondary" onClick={() => setComposing('email')}><Icon name="mail" className="h-4 w-4" /> Email</button>
            )}
            {canMessage && contact.phone && (
              <button className="btn-secondary" onClick={() => setComposing('sms')}><Icon name="sms" className="h-4 w-4" /> SMS</button>
            )}
            {canMessage && <CallButton contact={contact} />}
            <TextToPayButton contact={contact} onSent={load} />
            {canMessage && (contact.email || contact.phone) && (
              <button
                className="btn-secondary"
                title="Ask for a review"
                onClick={async () => {
                  try {
                    await api('/reputation/requests', { method: 'POST', body: { contactId: contact.id } });
                    toast('Review request sent');
                    load();
                  } catch (e) {
                    toast(errorText(e), 'error');
                  }
                }}
              >
                <Icon name="reputation" className="h-4 w-4" /> Request review
              </button>
            )}
            {can('contacts:write') && <button className="btn-primary" onClick={() => setEditing(true)}><Icon name="pencil" className="h-4 w-4" /> Edit</button>}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* About */}
        <div className="space-y-6">
          <section className="card">
            <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-semibold">About</h2>
            <div className="divide-y divide-slate-100 px-5">
              <InfoRow icon="mail" label="Email" value={contact.email} onCopy={contact.email ? () => copy(contact.email!, 'Email') : undefined} href={contact.email ? `mailto:${contact.email}` : undefined} />
              <InfoRow icon="phone" label="Phone" value={contact.phone} onCopy={contact.phone ? () => copy(contact.phone!, 'Phone') : undefined} href={contact.phone ? `tel:${contact.phone}` : undefined} />
              <InfoRow icon="agency" label="Company" value={contact.company?.name} />
              <div className="py-3">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Tags</div>
                <div className="flex flex-wrap gap-1.5">{contact.tags.length ? contact.tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-[13px] text-slate-400">No tags</span>}</div>
              </div>
              <div className="py-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Notes</div>
                <p className="whitespace-pre-wrap text-[13px] text-slate-700">{contact.notes || <span className="text-slate-400">—</span>}</p>
              </div>
            </div>
            <div className="border-t border-slate-100 px-5 py-4 text-sm">
              <ContactCustomFields contact={contact} onSaved={load} />
            </div>
          </section>

          {can('workflows:execute') && workflows.length > 0 && (
            <section className="card">
              <h2 className="border-b border-slate-100 px-5 py-3.5 text-[15px] font-semibold">Run an automation</h2>
              <ul className="p-2">
                {workflows.map((w) => (
                  <li key={w.id}>
                    <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50" onClick={() => runWorkflow(w)}>
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-50 text-orange-600"><Icon name="automation" className="h-4 w-4" /></span>
                      <span className="flex-1 truncate">{w.name}</span>
                      <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {can('contacts:delete') && (
            <section className="rounded-xl border border-rose-200/70 bg-rose-50/40 px-5 py-4">
              <h2 className="text-[13px] font-semibold text-rose-800">Delete contact</h2>
              <p className="mt-0.5 text-xs text-rose-700/80">Removes this contact and their history from the workspace.</p>
              <button
                className="btn-danger mt-3 h-8 text-xs"
                onClick={async () => {
                  if (!confirm('Delete this contact?')) return;
                  await api(`/crm/contacts/${id}`, { method: 'DELETE' });
                  toast('Contact deleted');
                  router.push('/contacts');
                }}
              >
                Delete contact
              </button>
            </section>
          )}
        </div>

        {/* Activity */}
        <div className="min-w-0 space-y-6">
          <AiSummary contactId={contact.id} />
          <ContactExtras contact={contact} />
          <section className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Conversations</h2>
              {canMessage && (contact.email || contact.phone) && (
                <button className="btn-ghost h-8 text-xs" onClick={() => setComposing(contact.email ? 'email' : 'sms')}><Icon name="plus" className="h-3.5 w-3.5" /> New message</button>
              )}
            </div>
            {conversations.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No messages yet.</p>
            ) : (
              <ul className="p-2">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${c.channel === 'email' ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        <Icon name={c.channel === 'email' ? 'mail' : 'sms'} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-800">{c.subject || (c.channel === 'sms' ? 'SMS conversation' : 'Email')}</span>
                        <span className="block truncate text-xs text-slate-500">{c.lastMessagePreview}</span>
                      </span>
                      {c.unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span>}
                      <span className="whitespace-nowrap text-xs text-slate-400">{fmtDate(c.lastMessageAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Modal open={editing} title="Edit contact" onClose={() => setEditing(false)} wide>
        <ContactForm contact={contact} onCancel={() => setEditing(false)} onSaved={(c) => { setContact(c); setEditing(false); toast('Contact updated'); }} />
      </Modal>
      <Modal open={!!composing} title={composing === 'sms' ? 'Send SMS' : 'Send email'} onClose={() => setComposing(null)}>
        {composing && (
          <Composer
            contactId={contact.id}
            channel={composing}
            onSent={() => {
              setComposing(null);
              toast('Message sent');
              load();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function InfoRow({ icon, label, value, href, onCopy }: { icon: string; label: string; value?: string | null; href?: string; onCopy?: () => void }) {
  return (
    <div className="group flex items-start gap-3 py-3">
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        {value ? (
          href ? <a href={href} className="block break-words text-[13px] text-slate-800 hover:text-brand-700">{value}</a> : <div className="break-words text-[13px] text-slate-800">{value}</div>
        ) : (
          <div className="text-[13px] text-slate-400">—</div>
        )}
      </div>
      {onCopy && (
        <button type="button" className="btn-ghost h-7 px-2 text-[11px] opacity-0 transition focus:opacity-100 group-hover:opacity-100" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          Copy
        </button>
      )}
    </div>
  );
}

function AiSummary({ contactId }: { contactId: string }) {
  const enabled = useAiEnabled();
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  if (!enabled) return null;
  return (
    <section className="card border-violet-200/70 bg-gradient-to-br from-violet-50/70 to-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">AI summary</h2>
        <AiButton
          label={summary ? 'Refresh' : 'Summarize this contact'}
          className="py-1 text-xs"
          onClick={async () => {
            setError('');
            try {
              setSummary((await api<{ summary: string }>('/ai/summarize-contact', { method: 'POST', body: { contactId } })).summary);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      </div>
      {summary && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{summary}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
      <p className="mt-2 text-xs text-slate-400">Generated by AI from notes, deals, appointments and messages — check before relying on it.</p>
    </section>
  );
}

function Composer({ contactId, channel, onSent }: { contactId: string; channel: 'email' | 'sms'; onSent: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState('');
  const aiEnabled = useAiEnabled();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const msg = await api('/inbox/messages', { method: 'POST', body: { contactId, channel, subject: subject || undefined, body } });
          if (msg.status === 'failed') throw new Error(msg.error || 'Delivery failed');
          onSent();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {aiEnabled && (
        <div className="flex gap-2 rounded-md bg-violet-50 p-2">
          <input aria-label="What should the message say?" className="input flex-1 py-1.5" placeholder="e.g. Follow up on the proposal and offer a call" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <AiButton
            label="Draft"
            className="py-1.5"
            onClick={async () => {
              setError('');
              try {
                const d = await api<{ subject: string; body: string }>('/ai/draft', { method: 'POST', body: { channel, goal: goal || 'A friendly check-in', contactId } });
                if (d.subject) setSubject(d.subject);
                setBody(d.body);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          />
        </div>
      )}
      {channel === 'email' && (
        <div>
          <label className="label" htmlFor="cmp-subject">Subject</label>
          <input id="cmp-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="cmp-body">Message</label>
        <textarea id="cmp-body" required rows={5} className="input" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}
