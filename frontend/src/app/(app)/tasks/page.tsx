'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Task } from '@/lib/types-ext';
import { EmptyState, PageHeader, PageLoader, Segmented, errorText, useToast } from '@/components/ui';
import { TaskForm } from '@/components/task-form';
import { TaskList } from '@/components/task-list';

type Filter = 'open' | 'overdue' | 'done' | '';

const EMPTY: Record<Filter, [string, string]> = {
  open: ['No open tasks', "You're all caught up. Add a follow-up above when something comes up."],
  overdue: ['Nothing overdue', 'Every task with a due date is on track.'],
  done: ['No completed tasks yet', 'Tick a task off and it will show up here.'],
  '': ['No tasks yet', 'Add a follow-up above, or from any contact record.'],
};

export default function TasksPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<Filter>('open');
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(() => api<Task[]>(`/crm/tasks${status ? `?status=${status}` : ''}`).then(setTasks).catch((e) => toast(errorText(e), 'error')), [status, toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle(t: Task) {
    // Optimistic: flip locally, then reload so the active filter applies.
    setTasks((list) => list?.map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)) ?? null);
    try {
      await api(`/crm/tasks/${t.id}`, { method: 'PUT', body: { completed: !t.completed } });
      setTimeout(load, 350);
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Tasks" subtitle="Follow-ups for you and your team" />
      {can('contacts:write') && (
        <div className="card mb-5 p-3">
          <TaskForm onCreated={load} />
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented<Filter> label="Filter tasks" value={status} onChange={setStatus} options={[['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Completed'], ['', 'All']]} />
        {tasks && tasks.length > 0 && <span className="text-[13px] tabular-nums text-slate-500">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>}
      </div>
      {!tasks ? <PageLoader /> : tasks.length === 0 ? <EmptyState title={EMPTY[status][0]}>{EMPTY[status][1]}</EmptyState> : <TaskList tasks={tasks} onToggle={toggle} />}
    </div>
  );
}
