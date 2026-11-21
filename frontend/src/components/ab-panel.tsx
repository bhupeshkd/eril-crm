'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AbTest, Campaign } from '@/lib/types-ext';
import { PageLoader, errorText, useToast } from './ui';

type Variant = 'A' | 'B';
interface VariantRow {
  variant: Variant;
  sent: number;
  tracked: number;
  opened: number;
  clicked: number;
  openRate: number | null;
  clickRate: number | null;
}
interface Report {
  ab: (AbTest & { subjectA: string; decideAt: string | null; winner: Variant | null }) | null;
  variants: VariantRow[];
}

/** Side-by-side results of an A/B subject test, with "pick winner now" while it runs. */
export function AbPanel({ c, onChanged }: { c: Campaign; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Report>(`/campaigns/${c.id}/report`).then(setR).catch(() => {}), [c.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (!r) return <PageLoader />;
  if (!r.ab) return null;
  const ab = r.ab;
  const testing = c.status === 'testing';
  const metricKey = ab.metric === 'opens' ? 'openRate' : 'clickRate';
  const row = (v: Variant) => r.variants.find((x) => x.variant === v);
  const leader = (() => {
    const a = row('A')?.[metricKey] ?? 0;
    const b = row('B')?.[metricKey] ?? 0;
    return a === b ? null : a > b ? 'A' : 'B';
  })();

  async function finish(variant?: Variant) {
    const what = variant ? `variant ${variant}` : 'the current leader';
    if (!confirm(`End the test and send ${what} to everyone who hasn’t received this campaign yet?`)) return;
    setBusy(true);
    try {
      await api(`/campaigns/${c.id}/ab/winner`, { method: 'POST', body: variant ? { variant } : {} });
      toast('Sending the winner');
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const card = (v: Variant) => {
    const x = row(v);
    const won = ab.winner === v;
    const leading = testing && leader === v;
    return (
      <div key={v} className={`rounded-md border p-3 ${won ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
        <div className="mb-1 flex items-center gap-2">
          <span className="badge bg-slate-800 text-white">{v}</span>
          {won && <span className="badge bg-emerald-600 text-white">Winner</span>}
          {leading && <span className="badge bg-amber-50 text-amber-700 ring-amber-600/20">Leading</span>}
        </div>
        <p className="mb-2 text-sm font-medium">“{v === 'A' ? ab.subjectA : ab.subjectB}”</p>
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          <div><dt className="text-slate-500">Sent</dt><dd className="text-base font-semibold tabular-nums">{x?.sent ?? 0}</dd></div>
          <div><dt className="text-slate-500">Opened</dt><dd className={`text-base font-semibold tabular-nums ${ab.metric === 'opens' ? 'text-brand-700' : ''}`}>{x?.openRate != null ? `${x.openRate}%` : '—'}</dd></div>
          <div><dt className="text-slate-500">Clicked</dt><dd className={`text-base font-semibold tabular-nums ${ab.metric === 'clicks' ? 'text-brand-700' : ''}`}>{x?.clickRate != null ? `${x.clickRate}%` : '—'}</dd></div>
        </dl>
        {testing && can('campaigns:send') && ab.testPercent < 100 && (
          <button type="button" className="btn-secondary mt-3 w-full py-1 text-xs" disabled={busy} onClick={() => finish(v)}>Send {v} to the rest now</button>
        )}
      </div>
    );
  };

  return (
    <section aria-label="A/B subject test" className="space-y-2">
      <h3 className="text-sm font-semibold">A/B subject test</h3>
      <p className="text-xs text-slate-500">
        {ab.testPercent}% of the audience tested · winner by {ab.metric === 'opens' ? 'open rate' : 'click rate'}
        {testing && ab.decideAt && ` · picked automatically ${fmtDate(ab.decideAt)}`}
        {!testing && ab.winner && ' · winner sent to everyone else'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">{card('A')}{card('B')}</div>
      {testing && can('campaigns:send') && (
        <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => finish()}>
          End test now{leader ? ` (send ${leader})` : ' (tie keeps A)'}
        </button>
      )}
    </section>
  );
}
