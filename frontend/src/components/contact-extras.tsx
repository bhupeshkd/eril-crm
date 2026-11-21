'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact } from '@/lib/types';
import type { Appointment, CustomField, Invoice, Note, Task } from '@/lib/types-ext';
import { StatusBadge, errorText, useToast } from './ui';
import { TaskForm } from './task-form';
import { TaskList } from './task-list';

type Tab = 'notes' | 'tasks' | 'appointments' | 'invoices';

export function ContactExtras({ contact }: { contact: Contact }) {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    api<Note[]>(`/crm/contacts/${contact.id}/notes`).then(setNotes).catch(() => {});
    api<Task[]>(`/crm/tasks?contactId=${contact.id}`).then(setTasks).catch(() => {});
    if (can('appointments:read')) api<Appointment[]>(`/calendars/appointments?contactId=${contact.id}`).then(setAppts).catch(() => {});
    if (can('invoices:read')) api<Invoice[]>('/payments/invoices').then((l) => setInvoices(l.filter((i) => i.contactId === contact.id))).catch(() => {});
  }, [contact.id, can]);
  useEffect(load, [load]);

  const counts: Record<Tab, number> = { notes: notes.length, tasks: tasks.filter((t) => !t.completed).length, appointments: appts.length, invoices: invoices.length };

  return (
    <section className="card">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
          {(Object.keys(counts) as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {t}
              {counts[t] > 0 && <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${tab === t ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'}`}>{counts[t]}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {tab === 'notes' && (
          <>
            {can('contacts:write') && (
              <form
                className="mb-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`/crm/contacts/${contact.id}/notes`, { method: 'POST', body: { body: draft } });
                    setDraft('');
                    load();
                  } catch (err) {
                    toast(errorText(err), 'error');
                  }
                }}
              >
                <textarea aria-label="New note" rows={2} className="input" placeholder="Write a note… (only your team sees notes)" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="mt-2 flex justify-end"><button className="btn-primary h-8" disabled={!draft.trim()}>Add note</button></div>
              </form>
            )}
            {notes.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No notes yet.</p> : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-amber-200/70 border-l-4 border-l-amber-400 bg-amber-50/50 px-3.5 py-3 text-[13px]">
                    <p className="whitespace-pre-wrap text-slate-800">{n.body}</p>
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                      <span>{fmtDate(n.createdAt)}</span>
                      {can('contacts:write') && <button className="hover:text-rose-600" onClick={async () => { await api(`/crm/notes/${n.id}`, { method: 'DELETE' }); load(); }}>Delete</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {tab === 'tasks' && (
          <>
            {can('contacts:write') && <div className="mb-4"><TaskForm contactId={contact.id} onCreated={load} /></div>}
            {tasks.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No tasks.</p> : (
              <TaskList tasks={tasks} onToggle={async (t) => { await api(`/crm/tasks/${t.id}`, { method: 'PUT', body: { completed: !t.completed } }); load(); }} />
            )}
          </>
        )}
        {tab === 'appointments' && (appts.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No appointments.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {appts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <span className="flex-1">{a.calendar?.name ?? a.title}</span>
                <span className="text-slate-500">{fmtDate(a.startAt)}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        ))}
        {tab === 'invoices' && (invoices.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No invoices.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 font-medium">{i.number}</span>
                <span className="tabular-nums">{fmtCurrency(i.total, i.currency)}</span>
                <StatusBadge status={i.status} />
                {i.status !== 'draft' && <a className="text-brand-600 hover:underline" href={`/invoice/${i.publicToken}`} target="_blank" rel="noreferrer">View</a>}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}

/** Custom field values + DND toggle shown in the contact's details card. */
export function ContactCustomFields({ contact, onSaved }: { contact: Contact & { customFields?: Record<string, any>; dnd?: boolean; source?: string }; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [defs, setDefs] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, any>>(contact.customFields ?? {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<CustomField[]>('/crm/custom-fields').then(setDefs).catch(() => {});
  }, []);
  useEffect(() => setValues(contact.customFields ?? {}), [contact.customFields]);

  const editable = can('contacts:write');
  const set = (k: string, v: any) => {
    setValues({ ...values, [k]: v });
    setDirty(true);
  };

  return (
    <div className="space-y-3 border-t border-slate-200 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">Source</span>
        <span className="text-sm">{contact.source ?? 'manual'}</span>
      </div>
      <label className="flex items-center justify-between text-sm">
        <span>
          Do not disturb
          <span className="block text-xs text-slate-500">Excluded from campaigns and automated messages</span>
        </span>
        <input
          type="checkbox"
          disabled={!editable}
          checked={!!contact.dnd}
          onChange={async (e) => {
            await api(`/crm/contacts/${contact.id}`, { method: 'PUT', body: { dnd: e.target.checked } });
            toast(e.target.checked ? 'DND enabled' : 'DND disabled');
            onSaved();
          }}
        />
      </label>
      {defs.length > 0 && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/crm/contacts/${contact.id}`, { method: 'PUT', body: { customFields: values } });
              setDirty(false);
              toast('Custom fields saved');
              onSaved();
            } catch (err) {
              toast(errorText(err), 'error');
            }
          }}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">Custom fields</div>
          {defs.map((d) => (
            <div key={d.id}>
              <label className="mb-0.5 block text-xs text-slate-500" htmlFor={`cfv-${d.key}`}>{d.label}</label>
              {d.type === 'select' ? (
                <select id={`cfv-${d.key}`} disabled={!editable} className="input py-1.5" value={values[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)}>
                  <option value="">—</option>
                  {d.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : d.type === 'checkbox' ? (
                <input id={`cfv-${d.key}`} disabled={!editable} type="checkbox" checked={!!values[d.key]} onChange={(e) => set(d.key, e.target.checked)} />
              ) : d.type === 'textarea' ? (
                <textarea id={`cfv-${d.key}`} disabled={!editable} rows={2} className="input py-1.5" value={values[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
              ) : (
                <input id={`cfv-${d.key}`} disabled={!editable} type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'} className="input py-1.5" value={values[d.key] ?? ''} onChange={(e) => set(d.key, d.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
              )}
            </div>
          ))}
          {dirty && <button className="btn-primary w-full py-1.5">Save fields</button>}
        </form>
      )}
    </div>
  );
}
