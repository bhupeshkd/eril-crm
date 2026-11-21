'use client';

import Link from 'next/link';
import type { Task } from '@/lib/types-ext';
import { Icon } from './icons';

function dueLabel(d: Date) {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function TaskList({ tasks, onToggle }: { tasks: Task[]; onToggle: (t: Task) => void }) {
  return (
    <ul className="card divide-y divide-slate-100 overflow-hidden">
      {tasks.map((t) => {
        const due = t.dueAt ? new Date(t.dueAt) : null;
        const overdue = !t.completed && due && due < new Date();
        return (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-slate-50/70">
            <button
              type="button"
              role="checkbox"
              aria-checked={t.completed}
              onClick={() => onToggle(t)}
              aria-label={`Mark "${t.title}" ${t.completed ? 'not done' : 'done'}`}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition focus-visible:shadow-glow ${t.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-brand-500 hover:text-brand-400'}`}
            >
              <Icon name="check" className="h-3 w-3" strokeWidth={3} />
            </button>
            <div className="min-w-0 flex-1">
              <p className={`truncate ${t.completed ? 'text-slate-400 line-through' : 'font-medium text-slate-800'}`}>{t.title}</p>
              {t.contact && (
                <Link href={`/contacts/${t.contact.id}`} className="text-xs text-slate-500 hover:text-brand-600">
                  {t.contact.firstName} {t.contact.lastName}
                </Link>
              )}
            </div>
            {due && (
              <span className={`badge shrink-0 ${t.completed ? 'bg-slate-50 text-slate-400' : overdue ? 'bg-rose-50 text-rose-700 ring-rose-600/15' : 'bg-slate-100 text-slate-600'}`}>
                <Icon name="clock" className="h-3 w-3" />
                {overdue ? 'Overdue · ' : ''}
                {dueLabel(due)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
