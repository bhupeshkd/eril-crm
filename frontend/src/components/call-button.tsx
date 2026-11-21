'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal, errorText, useToast } from './ui';
import { Icon } from './icons';

const AGENT_KEY = 'eril.agentPhone';

/** Click-to-call: rings your phone, then connects you to the contact from the business number. */
export function CallButton({ contact, className = 'btn-secondary' }: { contact: { id: string; firstName: string; phone?: string | null; dnd?: boolean }; className?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState(() => {
    try { return localStorage.getItem(AGENT_KEY) ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  if (!contact.phone) return null;

  async function call(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      try { if (agent.trim()) localStorage.setItem(AGENT_KEY, agent.trim()); } catch { /* storage blocked */ }
      const r = await api<{ ringing: string; to: string; status: string }>('/phone/calls/outbound', { method: 'POST', body: { contactId: contact.id, ...(agent.trim() ? { agentPhone: agent.trim() } : {}) } });
      toast(`Calling ${r.ringing} — answer it to be connected to ${contact.firstName}`);
      setOpen(false);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={className} disabled={contact.dnd} title={contact.dnd ? 'Contact is on do-not-disturb' : undefined} onClick={() => setOpen(true)}>
        <Icon name="phone" className="h-4 w-4" /> Call
      </button>
      {open && (
        <Modal open title={`Call ${contact.firstName || contact.phone}`} onClose={() => setOpen(false)}>
          <form onSubmit={call} className="space-y-3">
            <p className="text-sm text-slate-600">We&apos;ll ring your phone first. When you answer, you&apos;re connected to <b>{contact.phone}</b>, and they see your business number.</p>
            <div>
              <label className="label" htmlFor="cb-agent">Your phone</label>
              <input id="cb-agent" className="input" placeholder="Leave empty to use the number's forward-to phone" value={agent} onChange={(e) => setAgent(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}><Icon name="phone" className="h-4 w-4" /> Call now</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
