'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BarList } from './charts';
import { PageLoader } from './ui';

interface Report {
  sent: number;
  tracked: number;
  opened: number;
  clicked: number;
  totalOpens: number;
  totalClicks: number;
  openRate: number | null;
  clickRate: number | null;
  links: Array<{ url: string; clicks: number; uniqueClicks: number }>;
}

const short = (u: string) => {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/$/, '') + (x.search ? '…' : '');
  } catch {
    return u;
  }
};

/** Engagement report for a sent email campaign. */
export function CampaignReport({ campaignId }: { campaignId: string }) {
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<Report>(`/campaigns/${campaignId}/report`).then((x) => alive && setR(x)).catch(() => {});
    load();
    const t = setInterval(load, 15000); // opens/clicks keep arriving after sending
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [campaignId]);

  if (!r) return <PageLoader />;
  if (!r.tracked) {
    return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Open and click tracking applies to emails sent with a designed template while tracking is on (Settings → Email tracking).</p>;
  }
  const stat = (label: string, value: string, hint: string) => (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-slate-500">{hint}</dd>
    </div>
  );
  return (
    <section className="space-y-3" aria-label="Engagement">
      <dl className="grid gap-3 sm:grid-cols-3">
        {stat('Delivered', String(r.sent), `${r.tracked} tracked`)}
        {stat('Opened', r.openRate === null ? '—' : `${r.openRate}%`, `${r.opened} people · ${r.totalOpens} opens`)}
        {stat('Clicked', r.clickRate === null ? '—' : `${r.clickRate}%`, `${r.clicked} people · ${r.totalClicks} clicks`)}
      </dl>
      {r.links.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Top links</h3>
          <BarList ariaLabel="Clicks per link" data={r.links.map((l) => ({ label: short(l.url), value: l.clicks }))} />
        </div>
      )}
      <p className="text-xs text-slate-400">Opens are estimates: some mail apps (e.g. Apple Mail Privacy Protection) load images automatically, and others block them. Clicks from security scanners are excluded.</p>
    </section>
  );
}
