'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { Contact } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { StatusBadge, Tag, useToast } from './ui';
import { Icon } from './icons';
import { ContactAvatar } from './contact-avatar';
import { CallButton } from './call-button';

/** Slide-over summary of a contact, so the list (and its filters/scroll) stays in place behind it. */
export function ContactDrawer({ contact, onClose, onEdit }: { contact: Contact; onClose: () => void; onEdit?: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const name = `${contact.firstName} ${contact.lastName}`.trim() || 'Unnamed contact';

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const copy = (v: string, what: string) => navigator.clipboard.writeText(v).then(() => toast(`${what} copied`));
  const Row = ({ icon, label, value, href }: { icon: string; label: string; value: string | null | undefined; href?: string }) => (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-[var(--track)]">
      <Icon name={icon} className="h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted">{label}</div>
        {value ? (href ? <a href={href} className="block truncate text-[14px] text-ink hover:underline">{value}</a> : <div className="truncate text-[14px] text-ink">{value}</div>) : <div className="text-[14px] text-muted">—</div>}
      </div>
      {value && <button className="btn-ghost h-8 w-8 px-0" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => copy(value, label)}><Icon name="copy" className="h-3.5 w-3.5" /></button>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[55]" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-black/10" onClick={onClose} />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        className="absolute inset-y-3 right-3 flex w-[min(420px,calc(100vw-24px))] animate-slide-in-right flex-col overflow-hidden rounded-3xl border border-[var(--glass-border)] shadow-pop outline-none"
        style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)' }}
      >
        <div className="flex items-start gap-3 p-5">
          <ContactAvatar c={contact} size="h-14 w-14 text-base" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[20px] font-bold tracking-[-0.02em] text-ink">{name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={contact.status} />
              {contact.company?.name && <span className="text-[13px] text-muted">{contact.company.name}</span>}
            </div>
          </div>
          <button className="btn-ghost h-9 w-9 px-0" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pb-4">
          <Link href={`/contacts/${contact.id}`} className="btn-primary h-9">Open profile <Icon name="chevronRight" className="h-4 w-4" /></Link>
          {can('conversations:write') && <CallButton contact={contact} className="btn-secondary h-9" />}
          {onEdit && can('contacts:write') && <button className="btn-secondary h-9" onClick={onEdit}><Icon name="pencil" className="h-4 w-4" /> Edit</button>}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-5">
          <div>
            <Row icon="mail" label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
            <Row icon="phone" label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
            <Row icon="agency" label="Company" value={contact.company?.name} />
            <Row icon="calendar" label="Added" value={new Date(contact.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} />
          </div>
          {contact.tags.length > 0 && (
            <div className="px-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Tags</div>
              <div className="flex flex-wrap gap-1.5">{contact.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
            </div>
          )}
          {contact.notes && (
            <div className="px-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Notes</div>
              <p className="whitespace-pre-wrap rounded-2xl bg-[var(--track)] p-3 text-[13px] text-ink">{contact.notes}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
