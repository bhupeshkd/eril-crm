'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Workflow } from '@/lib/types';
import { TRIGGER_META } from '@/lib/workflow-tree';
import { EmptyState, LiveBadge, PageHeader, PageLoader, Segmented, StatTile, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

type Filter = 'all' | 'live' | 'draft';

export default function WorkflowsPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = () => api<Workflow[]>('/automation/workflows').then(setItems).catch((e) => toast(errorText(e), 'error'));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    try {
      const wf = await api<Workflow>('/automation/workflows', {
        method: 'POST',
        body: { name: 'Untitled workflow', triggerType: 'contact.created', steps: [] },
      });
      router.push(`/workflows/${wf.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function togglePublish(wf: Workflow) {
    try {
      await api(`/automation/workflows/${wf.id}`, { method: 'PUT', body: { isPublished: !wf.isPublished } });
      toast(wf.isPublished ? `"${wf.name}" unpublished` : `"${wf.name}" is live`);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const live = items?.filter((w) => w.isPublished).length ?? 0;
  const runs = items?.reduce((a, w) => a + (w.runCount ?? 0), 0) ?? 0;
  const shown = useMemo(() => (items ?? []).filter((w) => filter === 'all' || (filter === 'live') === w.isPublished), [items, filter]);

  return (
    <>
      <PageHeader
        title="Automation"
        subtitle="Workflows run automatically when their trigger fires"
        actions={can('workflows:write') && <button className="btn-primary" onClick={create}><Icon name="plus" /> New workflow</button>}
      />
      {!items ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState title="No workflows yet">Build one to send welcome emails, tag VIPs, or update contacts automatically.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatTile label="Live workflows" value={`${live} / ${items.length}`} hint="listening for triggers" icon={<Icon name="automation" className="h-5 w-5" />} tint="from-brand-500 to-brand-700" />
            <StatTile label="Total runs" value={runs.toLocaleString()} hint="all time" icon={<Icon name="play" className="h-5 w-5" />} tint="from-emerald-500 to-teal-500" />
            <StatTile label="Steps configured" value={items.reduce((a, w) => a + w.steps.length, 0)} hint="across all workflows" icon={<Icon name="layers" className="h-5 w-5" />} tint="from-amber-500 to-orange-500" />
          </div>
          <Segmented<Filter> label="Status" className="mb-4" value={filter} onChange={setFilter} options={[['all', 'All', items.length], ['live', 'Live', live], ['draft', 'Drafts', items.length - live]]} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((wf) => (
              <div key={wf.id} className="card card-hover group relative flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${wf.isPublished ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white ring-white/10' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                    <Icon name="automation" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/workflows/${wf.id}`} className="block truncate font-semibold text-slate-900 after:absolute after:inset-0 group-hover:text-brand-700">{wf.name}</Link>
                    <p className="mt-0.5 truncate text-[13px] text-slate-500">When {TRIGGER_META[wf.triggerType]?.toLowerCase() ?? wf.triggerType}</p>
                  </div>
                  <LiveBadge on={wf.isPublished} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-center">
                  <div><dt className="text-[11px] text-slate-500">Steps</dt><dd className="font-semibold tabular-nums">{wf.steps.length}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Runs</dt><dd className="font-semibold tabular-nums">{wf.runCount.toLocaleString()}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Updated</dt><dd className="truncate text-[13px] font-medium">{timeAgo(wf.updatedAt)}</dd></div>
                </dl>
                <div className="relative z-10 mt-4 flex gap-2">
                  <Link href={`/workflows/${wf.id}`} className="btn-secondary h-8 flex-1 text-[13px]">Open builder</Link>
                  {can('workflows:write') && (
                    <button className={`${wf.isPublished ? 'btn-ghost' : 'btn-secondary'} h-8 text-[13px]`} onClick={() => togglePublish(wf)}>{wf.isPublished ? 'Unpublish' : 'Publish'}</button>
                  )}
                </div>
              </div>
            ))}
            {shown.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-500">No workflows in this view.</p>}
          </div>
        </>
      )}
    </>
  );
}
