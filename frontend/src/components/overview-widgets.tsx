'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SHORTCUT_PAGES, readableOn, type Widget, type WidgetType } from '@eril/shared';
import { api, timeAgo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fill } from '@/lib/appearance';
import { NAV_GROUPS } from '@/lib/nav';
import type { Activity } from '@/lib/types';
import type { Appointment } from '@/lib/types-ext';
import { Icon } from './icons';

export interface Overview {
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

/** The widget library: name, what it shows, and how it is added by default. */
export const WIDGET_META: Record<WidgetType, { name: string; desc: string; icon: string; size: Widget['size']; tint: Widget['tint'] }> = {
  won: { name: 'Won this month', desc: 'Revenue closed this month, progress to target', icon: 'trendUp', size: 's', tint: 'sky' },
  pipeline: { name: 'Open pipeline', desc: 'Value and number of open deals', icon: 'pipeline', size: 's', tint: 'sage' },
  forecast: { name: 'Weighted forecast', desc: 'Open value × stage probability', icon: 'sparkles', size: 's', tint: 'peach' },
  winrate: { name: 'Win rate', desc: 'Share of closed deals that were won', icon: 'checkCheck', size: 's', tint: 'neutral' },
  revenue: { name: 'Revenue won', desc: 'Last 12 months, with your target line', icon: 'reporting', size: 'xl', tint: 'none' },
  stages: { name: 'Pipeline by stage', desc: 'Value sitting in each stage', icon: 'layers', size: 'm', tint: 'none' },
  nextBest: { name: 'Next best move', desc: 'The open deal most worth your time', icon: 'pointer', size: 'm', tint: 'sage' },
  today: { name: 'Today', desc: 'Tasks due today and overdue', icon: 'tasks', size: 'm', tint: 'none' },
  leaderboard: { name: 'Leaderboard', desc: 'Who won the most this month', icon: 'users', size: 'm', tint: 'none' },
  activity: { name: 'Recent activity', desc: 'The latest things that happened', icon: 'clock', size: 'm', tint: 'none' },
  appointments: { name: 'Upcoming appointments', desc: 'Your next bookings', icon: 'calendar', size: 'm', tint: 'none' },
  note: { name: 'Sticky note', desc: 'Your own notes, goals or reminders', icon: 'note', size: 'm', tint: 'lime' },
  shortcuts: { name: 'Shortcuts', desc: 'Quick links to the pages you use most', icon: 'arrowUpRight', size: 'm', tint: 'none' },
};

/** Grid spans: phone 1 col, tablet 6, desktop 12. */
export const SPAN: Record<Widget['size'], string> = {
  s: 'md:col-span-3 lg:col-span-3',
  m: 'md:col-span-3 lg:col-span-4',
  l: 'md:col-span-6 lg:col-span-6',
  xl: 'md:col-span-6 lg:col-span-8',
  full: 'md:col-span-6 lg:col-span-12',
};

/** Background + readable text for a widget's colour choice. */
export function widgetSurface(w: Widget): { className: string; style: React.CSSProperties } {
  const frosted = { backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', borderRadius: 'var(--radius)' } as React.CSSProperties;
  if (w.tint === 'custom' && w.style) {
    const light = readableOn(w.style.from) === '#ffffff';
    return {
      className: 'border border-[var(--glass-border)]',
      style: {
        ...frosted,
        background: fill(w.style.from, w.style.to, w.style.angle),
        ...(light ? ({ '--ink': '#ffffff', '--muted': 'rgba(255,255,255,0.78)', '--track': 'rgba(255,255,255,0.18)', '--pill': 'rgba(255,255,255,0.18)', '--chip': 'rgba(255,255,255,0.2)', '--glass-line': 'rgba(255,255,255,0.16)', color: '#fff' } as React.CSSProperties) : { '--ink': '#181a18', '--muted': 'rgba(24,26,24,0.68)', color: '#181a18' } as React.CSSProperties),
      },
    };
  }
  if (w.tint === 'lime') return { className: 'border border-[var(--glass-border)]', style: { ...frosted, background: 'color-mix(in srgb, var(--accent) 32%, var(--glass))' } };
  if (w.tint !== 'none') return { className: `border border-[var(--glass-border)] tint-${w.tint}`, style: frosted };
  return { className: 'card', style: {} };
}

export const money = (n: number, currency: string, compact = false) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0, ...(compact ? { notation: 'compact' as const } : {}) }).format(n);
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const AVATARS = ['bg-[#5B9EE1]', 'bg-[#8FB65A]', 'bg-[#E0936F]', 'bg-[#C5A94F]'];

function Head({ title, sub, link }: { title: string; sub?: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
        {sub && <p className="text-[12px] text-muted">{sub}</p>}
      </div>
      {link && <Link href={link.href} className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-ink hover:underline">{link.label} <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>}
    </div>
  );
}

function Trend({ pct }: { pct: number }) {
  return <span className="font-medium text-ink">{pct >= 0 ? '↗' : '↘'} {pct >= 0 ? '+' : ''}{pct}%</span>;
}

function Kpi({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-ink num md:text-[34px]">{value}</div>
      {children}
    </>
  );
}

/** 12 rounded columns in full-height tracks; dashed target line; the current month in the accent. */
function RevenueChart({ months, target, currency }: { months: Overview['months']; target: number | null; currency: string }) {
  const max = Math.max(1, target ?? 0, ...months.map((m) => m.won)) * 1.1;
  const label = (k: string) => new Date(`${k}-15T00:00:00Z`).toLocaleDateString(undefined, { month: 'short' });
  return (
    <div className="relative mt-5 h-56">
      {target !== null && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-[var(--ink)] opacity-40" style={{ bottom: `calc(${(target / max) * 100}% * (192 / 224) + 32px)` }}>
          <span className="absolute -top-5 right-0 rounded-full bg-[var(--pill)] px-2 text-[11px] text-muted num">{money(target, currency, true)}</span>
        </div>
      )}
      <div className="grid h-full grid-cols-12 gap-1.5 sm:gap-2.5" role="img" aria-label="Revenue won per month for the last 12 months">
        {months.map((m, i) => {
          const isNow = i === months.length - 1;
          return (
            <div key={m.month} className="flex h-full flex-col items-center gap-2" title={`${label(m.month)}: ${money(m.won, currency)}`}>
              <div className="relative flex h-48 w-full items-end overflow-hidden rounded-xl" style={{ background: 'var(--track)' }}>
                <div className="w-full rounded-t-xl transition-all" style={{ height: `${(m.won / max) * 100}%`, minHeight: m.won ? 6 : 0, background: isNow ? 'var(--accent-fill)' : 'var(--bar)' }} />
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
      {stages.map((s, i) => (
        <li key={s.id}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="truncate font-medium text-ink">{s.name} <span className="font-normal text-muted num">· {s.deals}</span></span>
            <span className="font-semibold text-ink num">{money(s.value, currency)}</span>
          </div>
          <div className="progress-track">
            <div className="h-full rounded-full" style={{ width: `${(s.value / max) * 100}%`, background: /won/i.test(s.name) ? 'var(--accent-fill)' : i === 0 ? '#D8C380' : 'var(--bar)', minWidth: s.value ? 8 : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const PAGE = new Map(NAV_GROUPS.flatMap((g) => g.items).map((n) => [n.href, n] as const).concat([['/settings', { href: '/settings', label: 'Settings', icon: 'settings', perm: '' }]]));

/** Pages a Shortcuts widget can link to, with labels/icons. */
export const SHORTCUT_OPTIONS = SHORTCUT_PAGES.map((h) => PAGE.get(h)).filter(Boolean) as Array<{ href: string; label: string; icon: string; perm: string }>;

function ActivityList() {
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => {
    api<{ recentActivity: Activity[] }>('/dashboard/stats').then((s) => setItems(s.recentActivity.slice(0, 7))).catch(() => setItems([]));
  }, []);
  if (!items) return <p className="mt-6 text-center text-sm text-muted">Loading…</p>;
  if (!items.length) return <p className="mt-6 text-center text-sm text-muted">Nothing has happened yet.</p>;
  return (
    <ul className="mt-3 space-y-1">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 rounded-2xl px-2 py-1.5">
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--bar)' }} />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13px] text-ink">{a.description}</div>
            <div className="text-[11px] text-muted">{timeAgo(a.createdAt)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AppointmentList() {
  const [items, setItems] = useState<Appointment[] | null>(null);
  useEffect(() => {
    api<Appointment[]>(`/calendars/appointments?from=${encodeURIComponent(new Date().toISOString())}&limit=20`)
      .then((l) => setItems(l.filter((a) => a.status !== 'cancelled').slice(0, 6)))
      .catch(() => setItems([]));
  }, []);
  if (!items) return <p className="mt-6 text-center text-sm text-muted">Loading…</p>;
  if (!items.length) return <p className="mt-6 text-center text-sm text-muted">No upcoming appointments.</p>;
  return (
    <ul className="mt-3 space-y-1">
      {items.map((a) => {
        const d = new Date(a.startAt);
        return (
          <li key={a.id} className="flex items-center gap-3 rounded-2xl px-2 py-1.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--pill)] text-center leading-none">
              <span className="text-[10px] uppercase text-muted">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
              <span className="text-[15px] font-bold text-ink num">{d.getDate()}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{a.title || a.calendar?.name || 'Appointment'}</div>
              <div className="truncate text-[12px] text-muted num">
                {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {a.contact ? ` · ${`${a.contact.firstName ?? ''} ${a.contact.lastName ?? ''}`.trim()}` : ''}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Renders one widget's content. `editing` swaps notes and shortcuts into their editors. */
export function WidgetBody({
  w,
  data,
  editing,
  onConfig,
  onCompleteTask,
  onEditTarget,
}: {
  w: Widget;
  data: Overview;
  editing: boolean;
  onConfig: (config: Widget['config']) => void;
  onCompleteTask: (id: string) => void;
  onEditTarget: () => void;
}) {
  const { can } = useAuth();
  const c = data.currency;
  const t = w.title;
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  switch (w.type) {
    case 'won':
      return (
        <Kpi label={t ?? 'Won this month'} value={money(data.won.thisMonth, c)}>
          {data.target ? (
            <>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--track)]">
                <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${Math.min(100, data.won.targetPct ?? 0)}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-muted num">
                {data.won.targetPct}% of target{data.won.changePct !== null && <> · <Trend pct={data.won.changePct} /> vs last month</>}
                {can('workspaces:write') && <button className="ml-1 underline-offset-2 hover:underline" onClick={onEditTarget}>Edit</button>}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-muted">
              {data.won.deals} deal{data.won.deals === 1 ? '' : 's'}{data.won.changePct !== null && <> · <Trend pct={data.won.changePct} /> vs last month</>}
              {can('workspaces:write') && <> · <button className="font-medium text-ink underline-offset-2 hover:underline" onClick={onEditTarget}>Set a target</button></>}
            </p>
          )}
        </Kpi>
      );
    case 'pipeline':
      return <Kpi label={t ?? 'Open pipeline'} value={money(data.pipeline.value, c)}><p className="mt-3 text-[12px] text-muted num">{data.pipeline.deals} open deal{data.pipeline.deals === 1 ? '' : 's'}</p></Kpi>;
    case 'forecast':
      return <Kpi label={t ?? 'Weighted forecast'} value={money(data.pipeline.weighted, c)}><p className="mt-3 text-[12px] text-muted">by stage probability</p></Kpi>;
    case 'winrate':
      return <Kpi label={t ?? 'Win rate'} value={data.winRate.pct === null ? '—' : `${data.winRate.pct}%`}><p className="mt-3 text-[12px] text-muted num">{data.winRate.closed ? `${data.winRate.won} of ${data.winRate.closed} closed deals won` : 'No closed deals yet'}</p></Kpi>;
    case 'revenue':
      return (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Head title={t ?? 'Revenue won'} sub={`Last 12 months${data.target ? ' against the monthly target' : ''}`} />
            <div className="flex items-center gap-3 text-[12px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--bar)' }} /> Won</span>
              {data.target && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--ink)] opacity-50" /> Target</span>}
            </div>
          </div>
          <RevenueChart months={data.months} target={data.target} currency={c} />
        </>
      );
    case 'stages':
      return <><Head title={t ?? 'Pipeline by stage'} sub="Value in each stage" link={{ href: '/pipeline', label: 'Board' }} /><StageBars stages={data.stages} currency={c} /></>;
    case 'nextBest': {
      const m = data.nextBestMove;
      return (
        <div className="flex h-full flex-col">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">◎ {t ?? 'Next best move'}</div>
          {m ? (
            <>
              <div className="mt-3 text-[20px] font-bold leading-snug text-ink">{m.title}</div>
              <div className="mt-1 text-[13px] text-muted">
                {[m.company || m.contact, m.stage, m.closeDate ? `closes ${new Date(m.closeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-ink num">{money(m.value, c)}</div>
              <div className="text-[12px] text-muted num">{m.probability}% likely to close</div>
              <div className="flex-1" />
              <Link href={`/pipeline?deal=${m.id}`} className="btn-primary mt-5 h-11 w-full">Open deal <Icon name="chevronRight" className="h-4 w-4" /></Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No open deals right now. Add one to see what to focus on.</p>
          )}
        </div>
      );
    }
    case 'today':
      return (
        <>
          <Head title={t ?? 'Today'} sub={`${data.today.length} to do`} link={{ href: '/tasks', label: 'Agenda' }} />
          {data.today.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">Nothing due today. 🎉</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {data.today.map((task) => {
                const overdue = new Date(task.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
                return (
                  <li key={task.id} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-[var(--track)]">
                    <input type="checkbox" aria-label={`Mark "${task.title}" done`} className="mt-0.5" onChange={() => onCompleteTask(task.id)} disabled={!can('contacts:write')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">{task.title}</div>
                      <div className={`truncate text-[12px] num ${overdue ? 'font-medium text-[#B4502F]' : 'text-muted'}`}>
                        {overdue ? `Overdue · ${new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {task.contact ? ` · ${task.contact}` : ''}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      );
    case 'leaderboard':
      return (
        <>
          <Head title={t ?? 'Leaderboard'} sub="Won this month" link={{ href: '/settings', label: 'Team' }} />
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
        </>
      );
    case 'activity':
      return <><Head title={t ?? 'Recent activity'} sub="Across this workspace" /><ActivityList /></>;
    case 'appointments':
      return can('appointments:read') ? (
        <><Head title={t ?? 'Upcoming appointments'} sub="Your next bookings" link={{ href: '/calendars', label: 'Calendar' }} /><AppointmentList /></>
      ) : (
        <><Head title={t ?? 'Upcoming appointments'} /><p className="mt-6 text-center text-sm text-muted">You don&apos;t have access to calendars.</p></>
      );
    case 'note': {
      const text = w.config?.text ?? '';
      const editingNote = editing || noteDraft !== null;
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold text-ink">{t ?? 'Note'}</h2>
            {!editing && noteDraft === null && <button className="btn-ghost h-7 w-7 px-0" aria-label="Edit note" onClick={() => setNoteDraft(text)}><Icon name="pencil" className="h-3.5 w-3.5" /></button>}
          </div>
          {editingNote ? (
            <>
              <textarea
                className="input mt-2 min-h-[120px] flex-1 resize-y bg-transparent"
                aria-label="Note text"
                maxLength={2000}
                value={editing ? text : noteDraft ?? ''}
                placeholder="Goals for the week, a reminder, a quote…"
                onChange={(e) => (editing ? onConfig({ text: e.target.value }) : setNoteDraft(e.target.value))}
                autoFocus={!editing}
              />
              {!editing && (
                <div className="mt-2 flex justify-end gap-2">
                  <button className="btn-ghost h-8" onClick={() => setNoteDraft(null)}>Cancel</button>
                  <button className="btn-primary h-8" onClick={() => { onConfig({ text: noteDraft ?? '' }); setNoteDraft(null); }}>Save</button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{text || <span className="text-muted">Empty note. Click the pencil to write something.</span>}</p>
          )}
        </div>
      );
    }
    case 'shortcuts': {
      const links = w.config?.links ?? [];
      if (editing)
        return (
          <>
            <h2 className="text-[15px] font-semibold text-ink">{t ?? 'Shortcuts'}</h2>
            <p className="text-[12px] text-muted">Pick up to 8 pages</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {SHORTCUT_OPTIONS.filter((p) => !p.perm || can(p.perm)).map((p) => {
                const on = links.includes(p.href);
                return (
                  <label key={p.href} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 text-[13px] text-ink hover:bg-[var(--track)]">
                    <input type="checkbox" checked={on} disabled={!on && links.length >= 8} onChange={() => onConfig({ links: on ? links.filter((l) => l !== p.href) : [...links, p.href] })} />
                    {p.label}
                  </label>
                );
              })}
            </div>
          </>
        );
      const pages = links.map((h) => PAGE.get(h)).filter(Boolean) as Array<{ href: string; label: string; icon: string }>;
      return (
        <>
          <h2 className="text-[15px] font-semibold text-ink">{t ?? 'Shortcuts'}</h2>
          {pages.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">No shortcuts yet. Use Customize to pick pages.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {pages.map((p) => (
                <Link key={p.href} href={p.href} className="flex items-center gap-2 rounded-2xl bg-[var(--pill)] px-3 py-2.5 text-[13px] font-medium text-ink transition hover:-translate-y-px">
                  <Icon name={p.icon} className="h-4 w-4 text-muted" /> <span className="truncate">{p.label}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      );
    }
  }
}
