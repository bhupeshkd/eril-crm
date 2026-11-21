'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface CallRow {
  id: string; status: 'answered' | 'missed' | 'voicemail'; direction: 'inbound' | 'outbound'; menuChoice: string | null; from: string; to: { number: string; label: string };
  contact: { id: string; name: string } | null; durationSec: number; recordingUrl: string | null; recordingDurationSec: number | null; textedBack: boolean; createdAt: string;
}
const STYLE: Record<CallRow['status'], string> = {
  answered: 'bg-emerald-50 text-emerald-700',
  missed: 'bg-rose-50 text-rose-700',
  voicemail: 'bg-violet-50 text-violet-700',
};
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/** Call log: answered, missed and voicemail calls to the workspace's numbers. */
export default function CallsPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<'' | CallRow['status']>('');
  const [rows, setRows] = useState<CallRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    api<CallRow[]>(`/phone/calls${filter ? `?status=${filter}` : ''}`).then(setRows).catch((e) => toast(errorText(e), 'error'));
  }, [filter, toast]);
  return (
    <div>
      <PageHeader title="Calls" subtitle="Calls to your business numbers, with voicemails and missed-call texts" actions={<Link href="/settings#phone" className="btn-secondary"><Icon name="settings" /> Phone settings</Link>} />
      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
        {([['', 'All'], ['missed', 'Missed'], ['voicemail', 'Voicemail'], ['answered', 'Answered']] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${filter === v ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>
      {!rows ? <PageLoader /> : rows.length === 0 ? (
        <div className="card"><EmptyState title="No calls yet">Connect a business number in Settings → Phone. Answered, missed and voicemail calls show up here.</EmptyState></div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {rows.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className={`grid h-9 w-9 place-items-center rounded-full ${STYLE[c.status]}`} title={c.direction === 'outbound' ? 'Outgoing' : 'Incoming'}><Icon name={c.direction === 'outbound' ? 'arrowUpRight' : 'phone'} className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.contact ? <Link href={`/contacts/${c.contact.id}`} className="hover:text-brand-700">{c.contact.name}</Link> : c.from}</div>
                <div className="text-xs text-slate-500">{c.direction === 'outbound' ? `You called from ${c.to.label || c.to.number}` : `${c.contact && c.contact.name !== c.from ? `${c.from} · ` : ''}to ${c.to.label || c.to.number}`}{c.menuChoice ? ` · chose ${c.menuChoice}` : ''} · {new Date(c.createdAt).toLocaleString()}</div>
              </div>
              <span className={`badge capitalize ${STYLE[c.status]}`}>{c.status}</span>
              {c.status === 'answered' && <span className="w-16 text-right text-xs tabular-nums text-slate-500">{dur(c.durationSec)}</span>}
              {c.recordingUrl && <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="btn-ghost h-8 px-2 text-xs"><Icon name="play" className="h-3.5 w-3.5" /> {c.status === 'voicemail' ? 'Voicemail' : 'Recording'}{c.recordingDurationSec ? ` (${dur(c.recordingDurationSec)})` : ''}</a>}
              {c.textedBack && <span className="badge bg-emerald-50 text-emerald-700"><Icon name="sms" className="h-3 w-3" /> Texted back</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
