'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { renderEmail, type EmailDesign } from '@eril/shared';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

export interface TemplateRow extends EmailDesign {
  id: string;
  name: string;
  updatedAt: string;
}
interface Starter {
  key: string;
  name: string;
  description: string;
  design: EmailDesign;
}

const sampleMerge = (s: string) =>
  s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => ({ 'contact.firstName': 'Alex', 'contact.lastName': 'Sample', 'business.name': 'Your business' })[k] ?? '');

/** Scaled-down, non-interactive thumbnail of a design. */
function Thumb({ design }: { design: EmailDesign }) {
  const html = useMemo(() => renderEmail(design, { merge: sampleMerge }).html, [design]);
  return (
    <div className="pointer-events-none relative h-48 overflow-hidden border-b border-slate-200/80 bg-gradient-to-b from-slate-100 to-slate-50" aria-hidden>
      <iframe title="" sandbox="" srcDoc={html} tabIndex={-1} className="absolute left-0 top-0 origin-top-left" style={{ width: 680, height: 880, transform: 'scale(0.4)' }} />
    </div>
  );
}

export function EmailTemplatesTab() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [list, setList] = useState<TemplateRow[] | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    api<TemplateRow[]>('/email-templates').then(setList).catch((e) => toast(errorText(e), 'error'));
    api<Starter[]>('/email-templates/starters').then(setStarters).catch(() => {});
  }, [toast]);

  async function create(s: Starter) {
    try {
      const t = await api<TemplateRow>('/email-templates', { method: 'POST', body: { name: s.key === 'blank' ? 'Untitled email' : s.name, starter: s.key } });
      router.push(`/email-templates/${t.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-slate-500">Design branded emails once, then reuse them in campaigns and automations.</p>
        {can('campaigns:write') && <button className="btn-primary" onClick={() => setChoosing(true)}><Icon name="plus" className="h-4 w-4" /> New template</button>}
      </div>
      {!list ? <div className="grid h-48 place-items-center"><Spinner /></div> : list.length === 0 ? (
        <EmptyState title="No email templates yet">Design branded emails once, then use them in campaigns and automations. Start from a newsletter, promotion or welcome layout.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((t) => (
            <button key={t.id} onClick={() => router.push(`/email-templates/${t.id}`)} className="card card-hover group overflow-hidden text-left">
              <div className="relative">
                <Thumb design={t} />
                <span className="absolute inset-0 grid place-items-center bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/25 group-hover:opacity-100">
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm"><Icon name="pencil" className="mr-1 inline h-3.5 w-3.5" />Edit design</span>
                </span>
              </div>
              <div className="p-3.5">
                <div className="truncate text-[14px] font-semibold">{t.name}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{t.subject || 'No subject'}</div>
                <div className="mt-1 text-[11px] text-slate-400">Edited {timeAgo(t.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Modal open={choosing} title="Choose a starting point" onClose={() => setChoosing(false)} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {starters.map((s) => (
            <button key={s.key} onClick={() => create(s)} className="card card-hover overflow-hidden text-left">
              <Thumb design={s.design} />
              <div className="p-3.5">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-slate-500">{s.description}</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
