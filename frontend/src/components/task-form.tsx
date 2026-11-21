'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { errorText, useToast } from './ui';
import { Icon } from './icons';

export function TaskForm({ contactId, onCreated }: { contactId?: string; onCreated: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await api('/crm/tasks', { method: 'POST', body: { title, contactId, dueAt: due ? new Date(due).toISOString() : undefined } });
          setTitle('');
          setDue('');
          onCreated();
        } catch (err) {
          toast(errorText(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="relative min-w-[12rem] flex-1">
        <Icon name="plus" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input aria-label="New task" className="input h-9 pl-9" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <input aria-label="Due" type="datetime-local" className="input h-9 w-auto text-slate-600" value={due} onChange={(e) => setDue(e.target.value)} />
      <button className="btn-primary" disabled={!title.trim() || busy}>Add task</button>
    </form>
  );
}
