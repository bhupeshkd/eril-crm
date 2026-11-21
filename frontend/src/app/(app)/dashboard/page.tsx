'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmtMoney, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Activity } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ChartCard, ColumnChart, LineChart } from '@/components/charts';

interface Stats {
  totalRevenue: number;
  wonDeals: number;
  openPipelineValue: number;
  openDeals: number;
  activeLeads: number;
  customers: number;
  totalContacts: number;
  activeWorkflows: number;
  unreadMessages: number;
  invoiceRevenue: number;
  upcomingAppointments: number;
  openTasks: number;
  recentActivity: Activity[];
}

interface Overview {
  totals: { newContacts: number; revenue: number; winRate: number | null };
  leadsByDay: Array<{ day: string; value: number }>;
  revenueByDay: Array<{ day: string; value: number }>;
  pipeline: Array<{ stage: string; count: number; value: number }>;
}

/** Activity type prefix → icon + tint. */
const ACTIVITY: Record<string, { icon: string; tint: string }> = {
  contact: { icon: 'contacts', tint: 'bg-sky-50 text-sky-600' },
  opportunity: { icon: 'pipeline', tint: 'bg-violet-50 text-violet-600' },
  message: { icon: 'inbox', tint: 'bg-indigo-50 text-indigo-600' },
  email: { icon: 'inbox', tint: 'bg-indigo-50 text-indigo-600' },
  appointment: { icon: 'calendar', tint: 'bg-teal-50 text-teal-600' },
  form: { icon: 'forms', tint: 'bg-amber-50 text-amber-600' },
  invoice: { icon: 'payments', tint: 'bg-emerald-50 text-emerald-600' },
  order: { icon: 'payments', tint: 'bg-emerald-50 text-emerald-600' },
  subscription: { icon: 'payments', tint: 'bg-emerald-50 text-emerald-600' },
  task: { icon: 'tasks', tint: 'bg-slate-100 text-slate-600' },
  note: { icon: 'note', tint: 'bg-slate-100 text-slate-600' },
  campaign: { icon: 'marketing', tint: 'bg-rose-50 text-rose-600' },
  course: { icon: 'courses', tint: 'bg-fuchsia-50 text-fuchsia-600' },
  community: { icon: 'communities', tint: 'bg-fuchsia-50 text-fuchsia-600' },
  review: { icon: 'reputation', tint: 'bg-amber-50 text-amber-600' },
  workflow: { icon: 'automation', tint: 'bg-orange-50 text-orange-600' },
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function DashboardPage() {
  const { me, can } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Stats>('/dashboard/stats').then(setStats).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (can('analytics:read')) api<Overview>('/reports/overview?days=30').then(setOverview).catch(() => {});
  }, [can]);

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!stats) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const first = me?.name.split(/\s+/)[0] ?? '';
  const kpis = [
    { label: 'Payments collected', value: fmtMoney(stats.invoiceRevenue), hint: 'from paid invoices', href: '/payments', icon: 'payments', tint: 'from-emerald-500 to-teal-500' },
    { label: 'Open pipeline', value: fmtMoney(stats.openPipelineValue), hint: `${stats.openDeals} open deal${stats.openDeals === 1 ? '' : 's'}`, href: '/pipeline', icon: 'pipeline', tint: 'from-brand-500 to-brand-700' },
    { label: 'Won deals', value: fmtMoney(stats.totalRevenue), hint: `${stats.wonDeals} won`, href: '/pipeline', icon: 'trendUp', tint: 'from-sky-500 to-indigo-500' },
    { label: 'Active leads', value: stats.activeLeads.toLocaleString(), hint: `${stats.customers} customers · ${stats.totalContacts} contacts`, href: '/contacts?status=lead', icon: 'contacts', tint: 'from-amber-500 to-orange-500' },
  ];
  const minis = [
    { label: 'Unread messages', value: stats.unreadMessages, href: '/inbox', icon: 'inbox', alert: stats.unreadMessages > 0 },
    { label: 'Upcoming appointments', value: stats.upcomingAppointments, href: '/calendars', icon: 'calendar' },
    { label: 'Open tasks', value: stats.openTasks, href: '/tasks', icon: 'tasks', alert: stats.openTasks > 0 },
    { label: 'Live automations', value: stats.activeWorkflows, href: '/workflows', icon: 'automation' },
  ];
  const actions = [
    { label: 'Add contact', href: '/contacts', icon: 'contacts', perm: 'contacts:write' },
    { label: 'New campaign', href: '/campaigns', icon: 'marketing', perm: 'campaigns:write' },
    { label: 'Create invoice', href: '/payments', icon: 'payments', perm: 'invoices:write' },
    { label: 'Book appointment', href: '/calendars', icon: 'calendar', perm: 'appointments:write' },
  ].filter((a) => can(a.perm));
  const pipeMax = Math.max(1, ...(overview?.pipeline ?? []).map((p) => p.value));

  return (
    <>
      {/* Hero */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-600">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">
            {greeting()}{first ? `, ${first}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here’s what’s happening across your business today.</p>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a, i) => (
              <Link key={a.label} href={a.href} className={i === 0 ? 'btn-primary' : 'btn-secondary'}>
                <Icon name={i === 0 ? 'plus' : a.icon} className="h-4 w-4" />
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="card card-hover group relative overflow-hidden p-5">
            <div className="flex items-start justify-between">
              <div className="text-[13px] font-medium text-slate-500">{k.label}</div>
              <span className={`grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${k.tint} text-white shadow-sm`}>
                <Icon name={k.icon} className="h-[18px] w-[18px]" />
              </span>
            </div>
            <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{k.value}</div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>{k.hint}</span>
              <Icon name="arrowUpRight" className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-brand-500" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {minis.map((m) => (
          <Link key={m.label} href={m.href} className="card card-hover flex items-center gap-3 px-4 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500">
              <Icon name={m.icon} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-600">{m.label}</span>
            <span className={`text-lg font-semibold tabular-nums ${m.alert ? 'text-brand-600' : 'text-slate-900'}`}>{m.value}</span>
          </Link>
        ))}
      </div>

      {/* Charts */}
      {overview && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title="Revenue"
              subtitle={`${fmtMoney(overview.totals.revenue)} in the last 30 days`}
              table={{ columns: ['Day', 'Revenue'], rows: overview.revenueByDay.map((d) => [shortDay(d.day), fmtMoney(d.value)]) }}
            >
              <LineChart ariaLabel="Revenue per day, last 30 days" data={overview.revenueByDay.map((d) => ({ label: d.day, value: d.value }))} format={fmtMoney} height={220} />
            </ChartCard>
          </div>
          <ChartCard
            title="New leads"
            subtitle={`${overview.totals.newContacts} new contacts · 30 days`}
            table={{ columns: ['Day', 'Leads'], rows: overview.leadsByDay.map((d) => [shortDay(d.day), String(d.value)]) }}
          >
            <ColumnChart ariaLabel="New leads per day, last 30 days" data={overview.leadsByDay.map((d) => ({ label: d.day, value: d.value }))} height={220} />
          </ChartCard>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Activity */}
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updated just now</span>
          </div>
          {stats.recentActivity.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No activity yet. Add a contact to get started.</p>
          ) : (
            <ol className="relative px-5 py-2">
              {stats.recentActivity.map((a, i) => {
                const meta = ACTIVITY[a.type.split('.')[0]] ?? { icon: 'dot', tint: 'bg-slate-100 text-slate-500' };
                return (
                  <li key={a.id} className="relative flex items-start gap-3 py-2.5">
                    {i < stats.recentActivity.length - 1 && <span aria-hidden className="absolute left-[15px] top-10 h-[calc(100%-1.5rem)] w-px bg-slate-100" />}
                    <span aria-hidden className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-white ${meta.tint}`}>
                      <Icon name={meta.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 pt-1.5 text-[13.5px] leading-snug text-slate-700">{a.description}</span>
                    <time className="whitespace-nowrap pt-1.5 text-xs text-slate-400" dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Pipeline */}
        <section className="card">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-[15px] font-semibold">Pipeline</h2>
            <Link href="/pipeline" className="text-xs font-medium text-brand-600 hover:text-brand-700">View board →</Link>
          </div>
          {!overview ? (
            <div className="p-5 text-sm text-slate-500">{can('analytics:read') ? <Spinner /> : 'Pipeline insights need reporting access.'}</div>
          ) : overview.pipeline.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No open deals yet.</p>
          ) : (
            <ul className="space-y-4 p-5">
              {overview.pipeline.map((p) => (
                <li key={p.stage}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate font-medium text-slate-700">{p.stage}</span>
                    <span className="tabular-nums text-slate-500">
                      <span className="font-semibold text-slate-900">{fmtMoney(p.value)}</span> · {p.count}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700" style={{ width: `${Math.max(3, (p.value / pipeMax) * 100)}%` }} />
                  </div>
                </li>
              ))}
              {overview.totals.winRate !== null && (
                <li className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[13px]">
                  <span className="text-slate-600">Win rate (30 days)</span>
                  <span className="font-semibold tabular-nums">{overview.totals.winRate}%</span>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
