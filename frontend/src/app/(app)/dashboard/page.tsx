'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Spinner, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Overview {
  currency: string;
  target: number | null;
  won: { thisMonth: number; lastMonth: number; deals: number; changePct: number | null; targetPct: number | null };
  pipeline: { value: number; deals: number; weighted: number };
  winRate: { won: number; closed: number; pct: number | null };
  months: Array<{ month: string; won: number }>;
  stages: Array<{ id: string; name: string; deals: number; value: number }>;
  nextBestMove: { id: string; title: string; value: number; closeDate: string | null; stage: string; probability: number; contact: string; company: string | null } | null;
  today: Array<{ id: string; title: string; dueAt: string; contact: string; contactId: string | null }>;
  counts: { overdue: number; tasksToday: number; appointmentsToday: number };
  leaderboard: Array<{ id: string; name: string; deals: number; won: number; sharePct: number }>;
}

const money = (n: number, currency: string, compact = false) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0, ...(compact ? { notation: 'compact' as const } : {}) }).format(n);
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const AVATARS = ['bg-[#5B9EE1]', 'bg-[#8FB65A]', 'bg-[#E0936F]', 'bg-[#C5A94F]'];

/** Overview: a calm bento of this month's results, the pipeline, and what to do today. */
export default function OverviewPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);

  const load = useCallback(() => {
    api<Overview>('/dashboard/overview').then(setData).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function complete(id: string) {
    setData((d) => (d ? { ...d, today: d.today.filter((t) => t.id !== id) } : d));
    try {
      await api(`/crm/tasks/${id}`, { method: 'PUT', body: { completed: true } });
      toast('Task done');
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  }

  if (error) return <div className="card p-6 text-sm text-rose-600">{error}</div>;
  if (!data || !me) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const c = data.currency;
  const current = me.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const activitiesToday = data.counts.tasksToday + data.counts.appointmentsToday;

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1 pt-2">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink md:text-[32px]">
            {greeting()}, {me.name.split(/\s+/)[0]}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {current?.workspaceName} · {date} · <span className={data.counts.overdue ? 'font-medium text-[#B4502F]' : ''}>{data.counts.overdue} overdue</span>, {activitiesToday} {activitiesToday === 1 ? 'activity' : 'activities'} today
          </p>
        </div>
        <div className="flex gap-2">
          {can('analytics:read') && <Link href="/reporting" className="btn-secondary h-10"><Icon name="reporting" className="h-4 w-4" /> Reports</Link>}
          {can('opportunities:write') && <Link href="/pipeline?new=1" className="btn-primary h-10"><Icon name="plus" className="h-4 w-4" /> New deal</Link>}
        </div>
      </div>

      {/* Row 1: KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tint="tint-sky" label="Won this month" value={money(data.won.thisMonth, c)}>
          {data.target ? (
            <>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-[#181a18]" style={{ width: `${Math.min(100, data.won.targetPct ?? 0)}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-muted num">
                {data.won.targetPct}% of target{data.won.changePct !== null && <> · <Trend pct={data.won.changePct} /> vs last month</>}
                {can('workspaces:write') && <button className="ml-1 underline-offset-2 hover:underline" onClick={() => setTargetOpen(true)}>Edit</button>}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-muted">
              {data.won.deals} deal{data.won.deals === 1 ? '' : 's'}{data.won.changePct !== null && <> · <Trend pct={data.won.changePct} /> vs last month</>}
              {can('workspaces:write') && <> · <button className="font-medium text-ink underline-offset-2 hover:underline" onClick={() => setTargetOpen(true)}>Set a target</button></>}
            </p>
          )}
        </Kpi>
        <Kpi tint="tint-sage" label="Open pipeline" value={money(data.pipeline.value, c)}>
          <p className="mt-3 text-[12px] text-muted num">{data.pipeline.deals} open deal{data.pipeline.deals === 1 ? '' : 's'}</p>
        </Kpi>
        <Kpi tint="tint-peach" label="Weighted forecast" value={money(data.pipeline.weighted, c)}>
          <p className="mt-3 text-[12px] text-muted">by stage probability</p>
        </Kpi>
        <Kpi tint="tint-neutral" label="Win rate" value={data.winRate.pct === null ? '—' : `${data.winRate.pct}%`}>
          <p className="mt-3 text-[12px] text-muted num">{data.winRate.closed ? `${data.winRate.won} of ${data.winRate.closed} closed deals won` : 'No closed deals yet'}</p>
        </Kpi>
      </div>

      {/* Row 2: revenue + stages */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="card p-5 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Revenue won</h2>
              <p className="text-[12px] text-muted">Last 12 months{data.target ? ' against the monthly target' : ''}</p>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5B9EE1]" /> Won</span>
              {data.target && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#181a18]/50" /> Target</span>}
            </div>
          </div>
          <RevenueChart months={data.months} target={data.target} currency={c} />
        </section>
        <section className="card p-5 lg:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Pipeline by stage</h2>
              <p className="text-[12px] text-muted">Value in each stage</p>
            </div>
            <Link href="/pipeline" className="flex items-center gap-0.5 text-[13px] font-medium text-ink hover:underline">Board <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
          </div>
          <StageBars stages={data.stages} currency={c} />
        </section>
      </div>

      {/* Row 3: today */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="flex flex-col rounded-[22px] border border-[var(--glass-border)] p-5 tint-sage lg:col-span-4" style={{ backdropFilter: 'blur(20px)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/70">◎ Next best move</div>
          {data.nextBestMove ? (
            <>
              <div className="mt-3 text-[20px] font-bold leading-snug text-ink">{data.nextBestMove.title}</div>
              <div className="mt-1 text-[13px] text-ink/70">
                {[data.nextBestMove.company || data.nextBestMove.contact, data.nextBestMove.stage, data.nextBestMove.closeDate ? `closes ${new Date(data.nextBestMove.closeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-ink num">{money(data.nextBestMove.value, c)}</div>
              <div className="text-[12px] text-ink/70 num">{data.nextBestMove.probability}% likely to close</div>
              <div className="flex-1" />
              <Link href={`/pipeline?deal=${data.nextBestMove.id}`} className="btn-primary mt-5 h-11 w-full">Open deal <Icon name="chevronRight" className="h-4 w-4" /></Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink/70">No open deals right now. Add one to see what to focus on.</p>
          )}
        </section>

        <section className="card p-5 lg:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Today</h2>
              <p className="text-[12px] text-muted num">{data.today.length} to do</p>
            </div>
            <Link href="/tasks" className="flex items-center gap-0.5 text-[13px] font-medium text-ink hover:underline">Agenda <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
          </div>
          {data.today.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">Nothing due today. 🎉</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {data.today.map((t) => {
                const overdue = new Date(t.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
                return (
                  <li key={t.id} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-[var(--track)]">
                    <input type="checkbox" aria-label={`Mark "${t.title}" done`} className="mt-0.5" onChange={() => complete(t.id)} disabled={!can('contacts:write')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">{t.title}</div>
                      <div className={`truncate text-[12px] num ${overdue ? 'text-[#B4502F]' : 'text-muted'}`}>
                        {overdue ? `Overdue · ${new Date(t.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {t.contact ? ` · ${t.contact}` : ''}
                      </div>
                    </div>
                    <Icon name="tasks" className="mt-0.5 h-4 w-4 text-muted" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-5 lg:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Leaderboard</h2>
              <p className="text-[12px] text-muted">Won this month</p>
            </div>
            <Link href="/settings" className="flex items-center gap-0.5 text-[13px] font-medium text-ink hover:underline">Team <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
          </div>
          {data.leaderboard.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">No deals won yet this month. Wins are credited to the contact&apos;s owner.</p>
          ) : (
            <ol className="mt-3 space-y-1">
              {data.leaderboard.map((l, i) => (
                <li key={l.id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                  <span className="w-4 text-center text-[13px] font-semibold text-muted num">{i + 1}</span>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${AVATARS[i % AVATARS.length]}`}>{initials(l.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{l.name}</div>
                    <div className="text-[12px] text-muted num">{l.sharePct}% of team · {l.deals} deal{l.deals === 1 ? '' : 's'}</div>
                  </div>
                  <span className="text-[14px] font-semibold text-ink num">{money(l.won, c)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {targetOpen && <TargetModal current={data.target} currency={c} onClose={() => setTargetOpen(false)} onSaved={() => { setTargetOpen(false); load(); }} />}
    </div>
  );
}

function Kpi({ tint, label, value, children }: { tint: string; label: string; value: string; children?: React.ReactNode }) {
  return (
    <section className={`rounded-[22px] border border-[var(--glass-border)] p-5 ${tint}`} style={{ backdropFilter: 'blur(20px)' }}>
      <div className="text-[13px] font-medium text-ink/75">{label}</div>
      <div className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-ink num md:text-[34px]">{value}</div>
      {children}
    </section>
  );
}

function Trend({ pct }: { pct: number }) {
  return <span className={pct >= 0 ? 'font-medium text-[#3F7A12]' : 'font-medium text-[#B4502F]'}>{pct >= 0 ? '↗' : '↘'} {pct >= 0 ? '+' : ''}{pct}%</span>;
}

/** 12 rounded columns in full-height tracks; dashed target line; the current month in lime. */
function RevenueChart({ months, target, currency }: { months: Overview['months']; target: number | null; currency: string }) {
  const max = Math.max(1, target ?? 0, ...months.map((m) => m.won)) * 1.1;
  const label = (k: string) => new Date(`${k}-15T00:00:00Z`).toLocaleDateString(undefined, { month: 'short' });
  return (
    <div className="relative mt-5 h-56">
      {target !== null && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-[#181a18]/40" style={{ bottom: `calc(${(target / max) * 100}% * (192 / 224) + 32px)` }}>
          <span className="absolute -top-5 right-0 rounded-full bg-[var(--pill)] px-2 text-[11px] text-muted num">{new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact' }).format(target)}</span>
        </div>
      )}
      <div className="grid h-full grid-cols-12 gap-1.5 sm:gap-2.5" role="img" aria-label="Revenue won per month for the last 12 months">
        {months.map((m, i) => {
          const isNow = i === months.length - 1;
          return (
            <div key={m.month} className="flex h-full flex-col items-center gap-2" title={`${label(m.month)}: ${new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(m.won)}`}>
              <div className="relative flex h-48 w-full items-end overflow-hidden rounded-xl" style={{ background: 'var(--track)' }}>
                <div className={`w-full rounded-t-xl transition-all ${isNow ? 'bg-[#A3D929]' : 'bg-[#5B9EE1]'}`} style={{ height: `${(m.won / max) * 100}%`, minHeight: m.won ? 6 : 0 }} />
              </div>
              <span className={`text-[11px] ${isNow ? 'font-bold text-ink' : 'text-muted'}`}>{label(m.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageBars({ stages, currency }: { stages: Overview['stages']; currency: string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  if (!stages.length) return <p className="mt-6 text-center text-sm text-muted">No pipeline yet.</p>;
  return (
    <ul className="mt-4 space-y-4">
      {stages.map((s, i) => {
        const won = /won/i.test(s.name);
        const color = won ? '#B6E633' : i === 0 ? '#D8C380' : '#5B9EE1';
        return (
          <li key={s.id}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate font-medium text-ink">{s.name} <span className="font-normal text-muted num">· {s.deals}</span></span>
              <span className="font-semibold text-ink num">{new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(s.value)}</span>
            </div>
            <div className="progress-track"><div className="h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: color, minWidth: s.value ? 8 : 0 }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

function TargetModal({ current, currency, onClose, onSaved }: { current: number | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(current ? String(current) : '');
  const [busy, setBusy] = useState(false);
  async function save(value: number | null) {
    setBusy(true);
    try {
      await api('/dashboard/target', { method: 'PUT', body: { monthlyTarget: value } });
      toast(value === null ? 'Target removed' : 'Target saved');
      onSaved();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Monthly revenue target" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(v.trim() ? Number(v) : null); }} className="space-y-4">
        <div>
          <label className="label" htmlFor="tg-v">Target per month ({currency})</label>
          <input id="tg-v" type="number" min={0} step="1" className="input" placeholder="50000" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-muted">Shown on the Overview: progress this month and a line on the revenue chart.</p>
        </div>
        <div className="flex justify-between gap-2">
          {current !== null ? <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(null)}>Remove target</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}
