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

          <AttributionReport days={days} />
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

interface AttrRow { leads: number; customers: number; revenue: number; conversionRate: number }
interface Attribution {
  model: 'first' | 'last';
  totals: { leads: number; tracked: number; customers: number; revenue: number };
  channels: Array<AttrRow & { channel: string }>;
  campaigns: Array<AttrRow & { campaign: string; source: string; channel: string }>;
}

/** Leads, customers and revenue by marketing channel and campaign (UTM tags, ad click IDs, referrers). */
function AttributionReport({ days }: { days: number }) {
  const [model, setModel] = useState<'first' | 'last'>('first');
  const [a, setA] = useState<Attribution | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setA(null);
    api<Attribution>(`/reports/attribution?days=${days}&model=${model}`).then(setA).catch((e) => setError(errorText(e)));
  }, [days, model]);

  const max = Math.max(1, ...(a?.channels.map((c) => c.leads) ?? [1]));
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Marketing attribution</h2>
          <p className="text-[13px] text-slate-500">Where new contacts came from, and what they went on to spend.</p>
        </div>
        <Segmented<'first' | 'last'> label="Attribution model" value={model} onChange={setModel} options={[['first', 'First touch'], ['last', 'Latest touch']]} />
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
      ) : !a ? (
        <PageLoader />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">Channel</th>
                  <th className="px-4 py-2.5 text-right">Leads</th>
                  <th className="px-4 py-2.5 text-right">Customers</th>
                  <th className="px-4 py-2.5 text-right">Conversion</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {a.channels.map((c) => (
                  <tr key={c.channel} className={c.channel === 'Not tracked' ? 'text-slate-500' : ''}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{c.channel}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.leads / max) * 100}%` }} /></span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.leads}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.customers}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.conversionRate}%</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtMoney(c.revenue)}</td>
                  </tr>
                ))}
                {a.channels.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No new contacts in this period.</td></tr>}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              {a.totals.tracked} of {a.totals.leads} new contacts had tracking data. Contacts added by hand or imported show as “Not tracked”.
              Revenue is everything they’ve paid since, credited to their {model === 'first' ? 'first' : 'latest'} touch.
            </p>
          </div>
          <div className="card overflow-x-auto">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold">Top campaigns</h3>
              <p className="text-xs text-slate-500">By utm_campaign</p>
            </div>
            {a.campaigns.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No campaign-tagged leads yet. Add <code className="rounded bg-slate-100 px-1 text-xs">?utm_source=…&amp;utm_campaign=…</code> to the links in your ads and emails.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  {a.campaigns.map((c) => (
                    <tr key={`${c.source}|${c.campaign}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{c.campaign}</span>
                        <span className="block text-xs text-slate-500">{c.channel}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500 tabular-nums">{c.leads} lead{c.leads === 1 ? '' : 's'} · {c.customers} won</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtMoney(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
