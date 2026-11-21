'use client';

import { useEffect, useState } from 'react';
import { api, fmtMoney } from '@/lib/api';
import { BarList, ChartCard, ColumnChart, LineChart } from '@/components/charts';
import { PageHeader, PageLoader, Segmented, StatTile, errorText } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Overview {
  days: number;
  totals: {
    newContacts: number;
    customers: number;
    contacts: number;
    revenue: number;
    wonDeals: number;
    closedDeals: number;
    messagesSent: number;
    messagesReceived: number;
    winRate: number | null;
    showRate: number | null;
  };
  leadsByDay: Array<{ day: string; value: number }>;
  revenueByDay: Array<{ day: string; value: number }>;
  pipeline: Array<{ stage: string; count: number; value: number }>;
  sources: Array<{ source: string; count: number }>;
  appointments: Record<string, number>;
  campaigns: { campaigns: number; sent: number; failed: number };
  workflows: Array<{ name: string; runs: number; succeeded: number; failed: number }>;
  forms: Array<{ name: string; submissions: number }>;
}

const RANGES = [7, 30, 90, 365] as const;
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

export default function ReportingPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api<Overview>(`/reports/overview?days=${days}`).then(setData).catch((e) => setError(errorText(e)));
  }, [days]);

  const filters = (
    <Segmented<string>
      label="Date range"
      value={String(days)}
      onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}
      options={RANGES.map((r) => [String(r), r === 365 ? '12 months' : `${r} days`] as const)}
    />
  );

  if (error) return <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>;

  return (
    <>
      <PageHeader title="Reporting" subtitle="How your marketing and sales are performing" actions={filters} />
      {!data ? <PageLoader /> : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon="contacts" tint="from-brand-500 to-brand-700" label="New contacts" value={data.totals.newContacts.toLocaleString()} hint={`${data.totals.contacts.toLocaleString()} total`} />
            <Stat icon="payments" tint="from-emerald-500 to-teal-500" label="Payments collected" value={fmtMoney(data.totals.revenue)} hint={`last ${days} days`} />
            <Stat icon="trendUp" tint="from-sky-500 to-indigo-500" label="Deal win rate" value={pct(data.totals.winRate)} hint={`${data.totals.wonDeals} won of ${data.totals.closedDeals} closed`} />
            <Stat icon="calendar" tint="from-amber-500 to-orange-500" label="Appointment show rate" value={pct(data.totals.showRate)} hint={`${data.appointments.showed ?? 0} showed · ${data.appointments.noshow ?? 0} no-show`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="New contacts per day" table={{ columns: ['Day', 'Contacts'], rows: data.leadsByDay.map((d) => [d.day, String(d.value)]) }}>
              <ColumnChart ariaLabel="New contacts per day" data={data.leadsByDay.map((d) => ({ label: d.day, value: d.value }))} />
            </ChartCard>
            <ChartCard title="Payments collected per day" table={{ columns: ['Day', 'Collected'], rows: data.revenueByDay.map((d) => [d.day, fmtMoney(d.value)]) }}>
              <LineChart ariaLabel="Payments collected per day" data={data.revenueByDay.map((d) => ({ label: d.day, value: d.value }))} format={(v) => fmtMoney(v)} />
            </ChartCard>
            <ChartCard title="Pipeline value by stage" subtitle="All open and closed deals, current stage" table={{ columns: ['Stage', 'Value'], rows: data.pipeline.map((p) => [`${p.stage} (${p.count})`, fmtMoney(p.value)]) }}>
              <BarList ariaLabel="Pipeline value by stage" data={mergeStages(data.pipeline).map((p) => ({ label: p.stage, value: p.value }))} format={(v) => fmtMoney(v)} />
            </ChartCard>
            <ChartCard title="Lead sources" subtitle={`Contacts created in the last ${days} days`} table={{ columns: ['Source', 'Contacts'], rows: data.sources.map((s) => [s.source, String(s.count)]) }}>
              <BarList ariaLabel="Lead sources" data={data.sources.map((s) => ({ label: s.source, value: s.count }))} />
            </ChartCard>
            <ChartCard title="Top forms" table={{ columns: ['Form', 'Submissions'], rows: data.forms.map((f) => [f.name, String(f.submissions)]) }}>
              <BarList ariaLabel="Form submissions" data={data.forms.map((f) => ({ label: f.name, value: f.submissions }))} />
            </ChartCard>
            <ChartCard title="Automation runs" subtitle="Succeeded runs per workflow" table={{ columns: ['Workflow', 'Succeeded / failed'], rows: data.workflows.map((w) => [w.name, `${w.succeeded} / ${w.failed}`]) }}>
              <BarList ariaLabel="Automation runs" data={data.workflows.map((w) => ({ label: w.name, value: w.succeeded }))} />
            </ChartCard>
          </div>

          <h2 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Engagement</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon="send" tint="from-sky-500 to-cyan-500" label="Messages sent" value={String(data.totals.messagesSent)} hint={`${data.totals.messagesReceived} received`} />
            <Stat icon="marketing" tint="from-fuchsia-500 to-pink-500" label="Campaign deliveries" value={String(data.campaigns.sent)} hint={`${data.campaigns.campaigns} campaigns · ${data.campaigns.failed} failed`} />
            <Stat icon="check" tint="from-emerald-500 to-green-600" label="Customers" value={String(data.totals.customers)} hint={`${data.totals.contacts ? Math.round((data.totals.customers / data.totals.contacts) * 100) : 0}% of contacts`} />
          </div>
        </>
      )}
    </>
  );
}

/** Multiple pipelines can share stage names; combine them for the overview. */
function mergeStages(rows: Overview['pipeline']) {
  const m = new Map<string, { stage: string; value: number; position: number }>();
  rows.forEach((r, i) => {
    const cur = m.get(r.stage) ?? { stage: r.stage, value: 0, position: i };
    cur.value += r.value;
    m.set(r.stage, cur);
  });
  return [...m.values()].sort((a, b) => a.position - b.position);
}

function Stat({ label, value, hint, icon, tint }: { label: string; value: string; hint: string; icon: string; tint: string }) {
  return <StatTile label={label} value={value} hint={hint} tint={tint} icon={<Icon name={icon} className="h-5 w-5" />} />;
}
