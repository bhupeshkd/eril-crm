'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmtCurrency, fmtDate } from '@/lib/api';
import { Icon } from './icons';

export type SaasStatus =
  | { saas: false }
  | {
      saas: true;
      plan: { name: string; features: Array<{ key: string; label: string }>; limits: { contacts: number | null; users: number | null }; included: { emails: number; sms: number } };
      status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
      price: number | null; currency: string | null; interval: string | null;
      trialEndsAt: string | null; nextBillingAt: string | null;
      usage: { emails: number; sms: number; contacts: number; users: number };
      payUrl: string | null; amountDue: number | null;
    };

/** The current workspace's SaaS plan (refreshes when the workspace changes and every few minutes). */
export function useSaasStatus(workspaceId?: string | null) {
  const [s, setS] = useState<SaasStatus | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    const load = () => api<SaasStatus>('/saas/status').then((x) => alive && setS(x)).catch(() => alive && setS(null));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [workspaceId]);
  return s;
}

/** Shown above the page for client accounts that are in trial, owe money, or are locked. */
// Mirrors backend saas/rules.ts: which plan feature a permission's area belongs to.
const PERMISSION_FEATURE: Record<string, string> = {
  calendars: 'calendars', appointments: 'calendars', campaigns: 'marketing', workflows: 'automation', forms: 'forms',
  websites: 'sites', funnels: 'sites', payments: 'payments', invoices: 'payments', courses: 'memberships', analytics: 'reporting', ai: 'ai',
};

/** Whether the workspace's plan includes the feature behind a permission (always true outside SaaS plans). */
export function planAllows(s: SaasStatus | null, perm: string) {
  if (!s?.saas) return true;
  const f = PERMISSION_FEATURE[perm.split(':')[0]];
  return !f || s.plan.features.some((x) => x.key === f);
}

export function PlanBanner({ status: s }: { status: SaasStatus | null }) {
  const [hidden, setHidden] = useState(false);
  if (!s?.saas || s.status === 'active' || hidden) return null;
  const due = s.amountDue !== null && s.currency ? fmtCurrency(s.amountDue, s.currency) : null;
  const pay = s.payUrl && (
    <a href={s.payUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/90 px-3 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white">
      Pay {due ?? 'now'} <Icon name="arrowUpRight" className="h-3.5 w-3.5" />
    </a>
  );
  const styles = {
    trialing: 'border-sky-200 bg-sky-50 text-sky-900',
    past_due: 'border-amber-200 bg-amber-50 text-amber-900',
    suspended: 'border-rose-200 bg-rose-600 text-white',
    canceled: 'border-slate-300 bg-slate-700 text-white',
  }[s.status];
  const text = {
    trialing: <>You&apos;re on a free trial of <b>{s.plan.name}</b>{s.trialEndsAt ? <> until {fmtDate(s.trialEndsAt)}</> : null}.</>,
    past_due: <>A payment for your <b>{s.plan.name}</b> plan is overdue. Pay it to avoid your account becoming read-only.</>,
    suspended: <>Your account is read-only because {due ? `${due} is` : 'an invoice is'} overdue. Pay to restore full access.</>,
    canceled: <>Your plan has been canceled, so this account is read-only. Contact your agency to reactivate it.</>,
  }[s.status];
  return (
    <div role="status" className={`mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm animate-fade-in ${styles}`}>
      <Icon name={s.status === 'trialing' ? 'sparkles' : s.status === 'past_due' ? 'clock' : 'lock'} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {pay}
      <Link href="/settings#plan" className="text-xs font-medium underline-offset-2 hover:underline">Plan details</Link>
      {s.status === 'trialing' && <button onClick={() => setHidden(true)} className="opacity-60 hover:opacity-100" aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>}
    </div>
  );
}

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = cap !== null && used > cap;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs"><span className="text-slate-500">{label}</span><span className={`font-medium tabular-nums ${over ? 'text-amber-700' : ''}`}>{used.toLocaleString()} / {cap === null ? '∞' : cap.toLocaleString()}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${over ? 'bg-amber-500' : pct > 85 ? 'bg-amber-400' : 'bg-brand-500'}`} style={{ width: `${cap === null ? 0 : Math.max(pct, used ? 3 : 0)}%` }} /></div>
    </div>
  );
}

/** Settings → Plan: what the client's plan includes and how much of it they've used this month. */
export function PlanUsageCard({ workspaceId }: { workspaceId?: string | null }) {
  const s = useSaasStatus(workspaceId);
  if (!s) return null;
  if (!s.saas) return null; // not a SaaS client: no plan limits to show
  const money = (n: number | null) => (n === null || !s.currency ? '—' : fmtCurrency(n, s.currency));
  return (
    <section id="plan" className="card mb-6 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold">{s.plan.name} plan</h2>
          <p className="text-[13px] text-slate-500">
            {money(s.price)}/{s.interval} · {s.status === 'trialing' && s.trialEndsAt ? `trial ends ${fmtDate(s.trialEndsAt)}` : s.nextBillingAt && s.status !== 'canceled' ? `next bill ${fmtDate(s.nextBillingAt)}` : s.status.replace('_', ' ')}
          </p>
        </div>
        {s.payUrl && <a href={s.payUrl} target="_blank" rel="noreferrer" className="btn-primary">Pay {money(s.amountDue)}</a>}
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="space-y-3">
          <Meter label="Contacts" used={s.usage.contacts} cap={s.plan.limits.contacts} />
          <Meter label="Users" used={s.usage.users} cap={s.plan.limits.users} />
          <Meter label="Emails this month" used={s.usage.emails} cap={s.plan.included.emails} />
          <Meter label="SMS this month" used={s.usage.sms} cap={s.plan.included.sms} />
          <p className="text-xs text-slate-400">Messages beyond your allowance are billed next month.</p>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-slate-500">Included</div>
          <div className="flex flex-wrap gap-1.5">
            {['Contacts & CRM', 'Conversations', 'Opportunities', ...s.plan.features.map((f) => f.label)].map((l) => (
              <span key={l} className="badge bg-brand-50 text-brand-700"><Icon name="check" className="h-3 w-3" /> {l}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
