'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { FormT } from '@/lib/types-ext';
import { EmptyState, LiveBadge, PageHeader, PageLoader, Segmented, StatTile, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

type Kind = 'all' | 'form' | 'survey';

export default function FormsPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [forms, setForms] = useState<FormT[] | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    api<FormT[]>('/forms').then(setForms).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);

  async function create(k: 'form' | 'survey') {
    try {
      const f = await api<FormT>('/forms', { method: 'POST', body: { name: k === 'survey' ? 'Untitled survey' : 'Untitled form', kind: k } });
      router.push(`/forms/${f.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (forms ?? []).filter((f) => (kind === 'all' || f.kind === kind) && (!t || f.name.toLowerCase().includes(t)));
  }, [forms, kind, q]);
  const totals = useMemo(
    () => ({
      live: (forms ?? []).filter((f) => f.isActive).length,
      subs: (forms ?? []).reduce((a, f) => a + (f.submissionCount ?? 0), 0),
      surveys: (forms ?? []).filter((f) => f.kind === 'survey').length,
    }),
    [forms],
  );

  return (
    <>
      <PageHeader
        title="Forms & Surveys"
        subtitle="Capture leads from your website — submissions create contacts and can trigger workflows"
        actions={can('forms:write') && (
          <>
            <button className="btn-secondary" onClick={() => create('survey')}><Icon name="layers" /> New survey</button>
            <button className="btn-primary" onClick={() => create('form')}><Icon name="plus" /> New form</button>
          </>
        )}
      />
      {!forms ? <PageLoader /> : forms.length === 0 ? (
        <EmptyState title="No forms yet">Create a form and embed it on your site or share its link.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatTile label="Total submissions" value={totals.subs.toLocaleString()} hint="all time" icon={<Icon name="forms" className="h-5 w-5" />} tint="from-brand-500 to-brand-700" />
            <StatTile label="Live forms" value={`${totals.live} / ${forms.length}`} hint="accepting responses" icon={<Icon name="check" className="h-5 w-5" />} tint="from-emerald-500 to-teal-500" />
            <StatTile label="Surveys" value={totals.surveys} hint="multi-step" icon={<Icon name="layers" className="h-5 w-5" />} tint="from-sky-500 to-indigo-500" />
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" aria-label="Search forms" placeholder="Search forms…" className="input h-9 pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented<Kind> label="Type" className="sm:ml-auto" value={kind} onChange={setKind} options={[['all', 'All'], ['form', 'Forms'], ['survey', 'Surveys']]} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Submissions</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Updated</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((f) => (
                  <tr key={f.id} className="group hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Link href={`/forms/${f.id}`} className="flex items-center gap-3">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${f.kind === 'survey' ? 'bg-sky-50 text-sky-600 ring-sky-200/70' : 'bg-brand-50 text-brand-600 ring-brand-200/70'}`}>
                          <Icon name={f.kind === 'survey' ? 'layers' : 'forms'} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900 group-hover:text-brand-700">{f.name}</span>
                          <span className="block text-xs capitalize text-slate-500">{f.kind}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">{f.submissionCount.toLocaleString()}</td>
                    <td className="px-4 py-3"><LiveBadge on={f.isActive} offLabel="Off" /></td>
                    <td className="px-4 py-3 text-slate-500">{timeAgo(f.updatedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <a href={`/f/${f.slug}`} target="_blank" rel="noreferrer" className="btn-ghost h-8 px-2.5 text-[13px]" title="Open public form"><Icon name="external" className="h-3.5 w-3.5" /> Open</a>
                      <Link href={`/forms/${f.id}`} className="btn-ghost h-8 px-2.5 text-[13px]"><Icon name="pencil" className="h-3.5 w-3.5" /> Edit</Link>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No forms match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
