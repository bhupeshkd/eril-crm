'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, LiveBadge, Modal, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface SiteRow {
  id: string;
  name: string;
  slug: string;
  kind: 'website' | 'funnel';
  isPublished: boolean;
  pages: Array<{ id: string; title: string; path: string }>;
  stats: Record<string, number>;
  updatedAt: string;
  publicUrl: string;
}

const TEMPLATES = [
  { id: 'lead-funnel', name: 'Lead funnel', desc: 'Opt-in → book a call → thank you. Buttons step through the funnel.', icon: 'pipeline' },
  { id: 'agency-website', name: 'Agency website', desc: 'Home with services, reviews and CTA, plus a contact page with a form.', icon: 'sites' },
  { id: 'blank', name: 'Blank', desc: 'Start from a single empty page.', icon: 'file' },
];

/** Miniature browser-window preview used as each site card's cover. */
function SiteThumb({ kind, published }: { kind: SiteRow['kind']; published: boolean }) {
  return (
    <div className={`relative h-32 overflow-hidden border-b border-slate-200/80 ${kind === 'funnel' ? 'bg-gradient-to-br from-brand-50 via-brand-50 to-white' : 'bg-gradient-to-br from-sky-50 via-indigo-50 to-white'}`}>
      <div className="absolute inset-x-5 top-4 bottom-0 rounded-t-lg border border-b-0 border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-300" /><span className="h-1.5 w-1.5 rounded-full bg-amber-300" /><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
        </div>
        <div className="space-y-1.5 p-3">
          <div className={`h-2 w-1/2 rounded ${published ? 'bg-brand-300' : 'bg-slate-200'}`} />
          <div className="h-1.5 w-3/4 rounded bg-slate-100" />
          <div className="h-1.5 w-2/3 rounded bg-slate-100" />
          <div className={`mt-2 h-3 w-16 rounded ${published ? 'bg-brand-500' : 'bg-slate-300'}`} />
        </div>
      </div>
    </div>
  );
}

export default function SitesPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('lead-funnel');

  useEffect(() => {
    api<SiteRow[]>('/sites').then(setSites).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);

  return (
    <>
      <PageHeader
        title="Sites & Funnels"
        subtitle="Build landing pages, funnels and websites with forms, booking and reviews built in"
        actions={can('websites:write') && <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New site</button>}
      />
      {!sites ? <PageLoader /> : sites.length === 0 ? (
        <EmptyState title="No sites yet">Start from a funnel or website template.</EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => {
            const views = Object.values(s.stats ?? {}).reduce((a, b) => a + b, 0);
            return (
              <div key={s.id} className="card card-hover group relative flex flex-col overflow-hidden">
                <SiteThumb kind={s.kind} published={s.isPublished} />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/sites/${s.id}`} className="truncate font-semibold text-slate-900 after:absolute after:inset-0 group-hover:text-brand-700">{s.name}</Link>
                    <LiveBadge on={s.isPublished} onLabel="Published" />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">/s/{s.slug}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-500">
                    <span className="flex items-center gap-1.5 capitalize"><Icon name={s.kind === 'funnel' ? 'pipeline' : 'sites'} className="h-3.5 w-3.5" />{s.kind}</span>
                    <span className="flex items-center gap-1.5"><Icon name="file" className="h-3.5 w-3.5" />{s.pages.length} page{s.pages.length === 1 ? '' : 's'}</span>
                    <span className="flex items-center gap-1.5"><Icon name="eye" className="h-3.5 w-3.5" />{views.toLocaleString()} views</span>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-xs text-slate-400">Updated {timeAgo(s.updatedAt)}</span>
                    {s.isPublished && (
                      <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="btn-ghost relative z-10 h-8 px-2.5 text-[13px]"><Icon name="external" className="h-3.5 w-3.5" /> View live</a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Modal open={creating} title="New site" onClose={() => setCreating(false)}>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const s = await api<SiteRow>('/sites', { method: 'POST', body: { name, template } });
              router.push(`/sites/${s.id}`);
            } catch (err) {
              toast(errorText(err), 'error');
              setBusy(false);
            }
          }}
        >
          <div>
            <label className="label" htmlFor="site-name">Name</label>
            <input id="site-name" required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Free audit funnel" />
          </div>
          <fieldset>
            <legend className="label">Template</legend>
            <div className="grid gap-2">
              {TEMPLATES.map((t) => (
                <label key={t.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${template === t.id ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <input type="radio" name="tpl" className="sr-only" checked={template === t.id} onChange={() => setTemplate(t.id)} />
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${template === t.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon name={t.icon} className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="font-medium text-slate-900">{t.name}</span><span className="block text-[13px] text-slate-500">{t.desc}</span></span>
                  {template === t.id && <Icon name="check" className="mt-0.5 h-4 w-4 text-brand-600" strokeWidth={2.5} />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create site'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
