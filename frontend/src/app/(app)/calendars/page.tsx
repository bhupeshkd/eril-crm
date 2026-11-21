'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import type { Appointment, Availability, CalendarT, Member } from '@/lib/types-ext';
import { EmptyState, Modal, PageHeader, Spinner, StatusBadge, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';
import { WorkingHours } from '@/components/working-hours';
import { CalendarSync } from '@/components/calendar-sync';

/** Users in the current workspace (team calendar members / hosts). */
function useMembers() {
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (me?.currentWorkspaceId) api<Member[]>(`/workspaces/${me.currentWorkspaceId}/members`).then(setMembers).catch(() => {});
  }, [me?.currentWorkspaceId]);
  return members;
}

const DISTRIBUTION_LABEL = { round_robin: 'Round robin', balanced: 'Balanced' } as const;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_ACTIONS: Array<[Appointment['status'], string]> = [
  ['confirmed', 'Confirm'],
  ['showed', 'Showed'],
  ['noshow', 'No-show'],
  ['cancelled', 'Cancel'],
];

/** One accent per calendar (by list order). */
const CAL_COLORS = [
  { dot: 'bg-brand-500', bar: 'bg-brand-500', soft: 'bg-brand-50 text-brand-700', ring: 'ring-brand-200' },
  { dot: 'bg-sky-500', bar: 'bg-sky-500', soft: 'bg-sky-50 text-sky-700', ring: 'ring-sky-200' },
  { dot: 'bg-emerald-500', bar: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700', ring: 'ring-emerald-200' },
  { dot: 'bg-amber-500', bar: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700', ring: 'ring-amber-200' },
  { dot: 'bg-rose-500', bar: 'bg-rose-500', soft: 'bg-rose-50 text-rose-700', ring: 'ring-rose-200' },
  { dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-500', soft: 'bg-fuchsia-50 text-fuchsia-700', ring: 'ring-fuchsia-200' },
  { dot: 'bg-teal-500', bar: 'bg-teal-500', soft: 'bg-teal-50 text-teal-700', ring: 'ring-teal-200' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const minutesBetween = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 60000);
const durLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

export default function CalendarsPage() {
  const toast = useToast();
  const { can, me } = useAuth();
  const members = useMembers();
  const [hostFilter, setHostFilter] = useState('');
  const [tab, setTab] = useState<'appointments' | 'calendars' | 'hours' | 'sync'>('appointments');
  const [calendars, setCalendars] = useState<CalendarT[] | null>(null);
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [range, setRange] = useState<'upcoming' | 'past'>('upcoming');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthAppts, setMonthAppts] = useState<Appointment[]>([]);
  const [editing, setEditing] = useState<CalendarT | 'new' | null>(null);
  const [booking, setBooking] = useState(false);

  const loadCalendars = useCallback(() => api<CalendarT[]>('/calendars').then(setCalendars).catch((e) => toast(errorText(e), 'error')), [toast]);
  const host = hostFilter ? `&assignedUserId=${hostFilter}` : '';
  const loadAppts = useCallback(() => {
    let q: string;
    if (selectedDay) {
      const start = fromKey(selectedDay);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      q = `from=${start.toISOString()}&to=${end.toISOString()}`;
    } else {
      const now = new Date().toISOString();
      q = range === 'upcoming' ? `from=${now}` : `to=${now}`;
    }
    api<Appointment[]>(`/calendars/appointments?${q}${host}`)
      .then((a) => setAppts(!selectedDay && range === 'past' ? a.reverse() : a))
      .catch((e) => toast(errorText(e), 'error'));
  }, [range, selectedDay, host, toast]);
  // Appointments in the visible month (plus spill-over days) for the mini calendar's dots and counts.
  const loadMonth = useCallback(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    api<Appointment[]>(`/calendars/appointments?from=${start.toISOString()}&to=${end.toISOString()}${host}`).then(setMonthAppts).catch(() => {});
  }, [month, host]);

  useEffect(() => {
    loadCalendars();
  }, [loadCalendars]);
  useEffect(() => {
    loadAppts();
  }, [loadAppts]);
  useEffect(() => {
    loadMonth();
  }, [loadMonth]);
  const reload = () => {
    loadAppts();
    loadMonth();
  };

  const colorOf = useMemo(() => {
    const m = new Map<string, (typeof CAL_COLORS)[number]>();
    (calendars ?? []).forEach((c, i) => m.set(c.id, CAL_COLORS[i % CAL_COLORS.length]));
    return (id: string) => m.get(id) ?? CAL_COLORS[0];
  }, [calendars]);

  const grouped = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appts ?? []) {
      const k = dayKey(new Date(a.startAt));
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [appts]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of monthAppts) {
      if (a.status === 'cancelled') continue;
      const k = dayKey(new Date(a.startAt));
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [monthAppts]);

  const stats = useMemo(() => {
    const now = new Date();
    const today = dayKey(now);
    const week = +now + 7 * 86_400_000;
    const live = monthAppts.filter((a) => a.status !== 'cancelled');
    return {
      today: live.filter((a) => dayKey(new Date(a.startAt)) === today).length,
      week: live.filter((a) => +new Date(a.startAt) >= +now && +new Date(a.startAt) <= week).length,
      month: live.filter((a) => new Date(a.startAt).getMonth() === month.getMonth()).length,
    };
  }, [monthAppts, month]);

  async function reassign(a: Appointment, assignedUserId: string) {
    try {
      await api(`/calendars/appointments/${a.id}`, { method: 'PUT', body: { assignedUserId: assignedUserId || null } });
      toast('Host updated');
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function setStatus(a: Appointment, status: Appointment['status']) {
    try {
      await api(`/calendars/appointments/${a.id}`, { method: 'PUT', body: { status } });
      toast(`Marked ${status}`);
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Calendars"
        subtitle="Appointments and booking pages"
        actions={
          <>
            {can('appointments:write') && calendars?.length ? (
              <button className="btn-secondary" onClick={() => setBooking(true)}><Icon name="plus" className="h-4 w-4" /> Book appointment</button>
            ) : null}
            {can('calendars:write') && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="calendar" className="h-4 w-4" /> New calendar</button>}
          </>
        }
      />
      <div className="mb-5 flex w-fit gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist">
        {([['appointments', 'Appointments'], ['calendars', 'Booking calendars'], ['hours', 'Working hours'], ['sync', 'Sync']] as const).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {l}
            {t === 'calendars' && calendars && <span className="ml-1.5 text-slate-400">{calendars.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'hours' ? (
        <WorkingHours />
      ) : tab === 'sync' ? (
        <CalendarSync calendars={calendars ?? []} />
      ) : tab === 'calendars' ? (
        !calendars ? <div className="grid h-48 place-items-center"><Spinner /></div> : calendars.length === 0 ? (
          <EmptyState title="No booking calendars yet">Create a calendar to get a public booking link people can use to pick a time.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {calendars.map((c) => {
              const color = colorOf(c.id);
              return (
                <div key={c.id} className="card card-hover flex flex-col overflow-hidden">
                  <div className={`h-1.5 ${color.bar}`} />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${color.soft}`}>
                        <Icon name={c.type === 'team' ? 'communities' : 'calendar'} className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[15px] font-semibold">{c.name}</h2>
                        <p className="text-xs text-slate-500">{c.durationMinutes} min · {c.timezone}</p>
                      </div>
                      <span className={`badge ${c.isActive ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-600 ring-slate-500/10'}`}>
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                        {c.isActive ? 'Live' : 'Off'}
                      </span>
                    </div>
                    {c.type === 'team' && (
                      <p className="mt-3 text-xs text-slate-600">
                        <span className="badge mr-1 bg-indigo-50 text-indigo-700 ring-indigo-600/15">Team · {DISTRIBUTION_LABEL[c.distribution]}</span>
                        {c.teamMemberIds.map((id) => members.find((m) => m.userId === id)?.name).filter(Boolean).join(', ') || `${c.teamMemberIds.length} members`}
                      </p>
                    )}
                    <div className="mt-4 flex gap-1" aria-label="Available days">
                      {DAYS.map((d, i) => {
                        const on = !!c.availability?.[i]?.length;
                        return (
                          <span key={d} title={on ? c.availability[i].map((w) => `${w.start}–${w.end}`).join(', ') : 'Unavailable'} className={`grid h-7 flex-1 place-items-center rounded-md text-[11px] font-medium ${on ? `${color.soft}` : 'bg-slate-50 text-slate-300'}`}>
                            {d[0]}
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 py-1 pl-3 pr-1 text-xs">
                      <Icon name="sites" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <code className="flex-1 truncate text-slate-600">{c.bookingUrl?.replace(/^https?:\/\//, '')}</code>
                      <button className="btn-ghost h-7 px-2 text-xs" onClick={() => { navigator.clipboard.writeText(c.bookingUrl!); toast('Link copied'); }}>Copy</button>
                    </div>
                    <div className="mt-auto flex gap-2 pt-4">
                      <a className="btn-secondary h-8 flex-1 text-xs" href={`/book/${c.slug}`} target="_blank" rel="noreferrer"><Icon name="external" className="h-3.5 w-3.5" /> Open page</a>
                      {can('calendars:write') && <button className="btn-secondary h-8 flex-1 text-xs" onClick={() => setEditing(c)}><Icon name="pencil" className="h-3.5 w-3.5" /> Edit</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Left: month + legend */}
          <aside className="space-y-4">
            <MiniMonth
              month={month}
              onMonth={setMonth}
              selected={selectedDay}
              onSelect={(k) => setSelectedDay(k === selectedDay ? null : k)}
              counts={byDay}
              colorOf={colorOf}
            />
            <div className="grid grid-cols-3 gap-2">
              {[['Today', stats.today], ['Next 7 days', stats.week], ['This month', stats.month]].map(([l, v]) => (
                <div key={l as string} className="card px-3 py-2.5 text-center">
                  <div className="text-lg font-semibold tabular-nums">{v}</div>
                  <div className="text-[11px] text-slate-500">{l}</div>
                </div>
              ))}
            </div>
            {calendars && calendars.length > 0 && (
              <div className="card p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Calendars</div>
                <ul className="space-y-1.5">
                  {calendars.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-[13px]">
                      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${colorOf(c.id).dot}`} />
                      <span className="flex-1 truncate text-slate-700">{c.name}</span>
                      <span className="text-xs tabular-nums text-slate-400">{monthAppts.filter((a) => a.calendarId === c.id && a.status !== 'cancelled').length}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* Right: agenda */}
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {selectedDay ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-brand-50 py-1 pl-3 pr-1 text-[13px] font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
                  {fromKey(selectedDay).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                  <button className="grid h-6 w-6 place-items-center rounded-md hover:bg-brand-100" aria-label="Show all days" onClick={() => setSelectedDay(null)}><Icon name="close" className="h-3.5 w-3.5" /></button>
                </span>
              ) : (
                <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Range">
                  {(['upcoming', 'past'] as const).map((r) => (
                    <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{r}</button>
                  ))}
                </div>
              )}
              {members.length > 1 && (
                <select aria-label="Filter by host" className="input ml-auto h-9 w-auto py-0 text-[13px]" value={hostFilter} onChange={(e) => setHostFilter(e.target.value)}>
                  <option value="">All hosts</option>
                  {me && <option value={me.id}>My appointments</option>}
                  {members.filter((m) => m.userId !== me?.id).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              )}
            </div>

            {!appts ? <div className="grid h-48 place-items-center"><Spinner /></div> : appts.length === 0 ? (
              <EmptyState title={selectedDay ? 'Nothing booked this day' : `No ${range} appointments`}>Share a booking link or book one manually.</EmptyState>
            ) : (
              <div className="space-y-6">
                {grouped.map(([k, list]) => {
                  const d = fromKey(k);
                  const isToday = k === dayKey(new Date());
                  return (
                    <section key={k} className="flex gap-4">
                      <div className="w-14 shrink-0 pt-1 text-center">
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? 'text-brand-600' : 'text-slate-400'}`}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                        <div className={`mx-auto mt-0.5 grid h-10 w-10 place-items-center rounded-full text-lg font-semibold tabular-nums ${isToday ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30' : 'text-slate-800'}`}>{d.getDate()}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{d.toLocaleDateString(undefined, { month: 'short' })}</div>
                      </div>
                      <ul className="min-w-0 flex-1 space-y-2">
                        {list.map((a) => {
                          const color = colorOf(a.calendarId);
                          const cancelled = a.status === 'cancelled';
                          return (
                            <li key={a.id} className={`card relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden py-3 pl-5 pr-3 ${cancelled ? 'opacity-60' : ''}`}>
                              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${color.bar}`} />
                              <div className="w-24 shrink-0">
                                <div className={`text-[13.5px] font-semibold tabular-nums ${cancelled ? 'line-through' : ''}`}>{clock(a.startAt)}</div>
                                <div className="text-[11px] text-slate-500">{durLabel(minutesBetween(a.startAt, a.endAt))} · until {clock(a.endAt)}</div>
                              </div>
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <ContactAvatar c={a.contact} size="h-8 w-8 text-[11px]" />
                                <div className="min-w-0">
                                  <Link href={`/contacts/${a.contactId}`} className="block truncate text-[13.5px] font-semibold text-slate-900 hover:text-brand-700">{a.contact.firstName} {a.contact.lastName}</Link>
                                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                    <span className="inline-flex items-center gap-1"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />{a.calendar?.name}</span>
                                    {a.host && <span>· with {a.host.name}</span>}
                                    {a.source === 'booking_page' && <span>· booked online</span>}
                                  </div>
                                  {a.notes && <div className="mt-0.5 truncate text-xs italic text-slate-500">“{a.notes}”</div>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {can('appointments:write') && members.length > 0 && !cancelled && (
                                  <select
                                    aria-label="Host"
                                    className="h-8 max-w-[9rem] cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:border-slate-300 focus:border-brand-400 focus:outline-none"
                                    value={a.assignedUserId ?? ''}
                                    onChange={(e) => reassign(a, e.target.value)}
                                  >
                                    {a.calendar?.type !== 'team' && <option value="">No host</option>}
                                    {members
                                      .filter((m) => a.calendar?.type !== 'team' || a.calendar.teamMemberIds.includes(m.userId) || m.userId === a.assignedUserId)
                                      .map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                                  </select>
                                )}
                                <StatusBadge status={a.status} />
                                {can('appointments:write') && (
                                  <select aria-label="Change status" className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:border-slate-300 focus:border-brand-400 focus:outline-none" value="" onChange={(e) => e.target.value && setStatus(a, e.target.value as Appointment['status'])}>
                                    <option value="">Update…</option>
                                    {STATUS_ACTIONS.filter(([s]) => s !== a.status).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                                  </select>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={editing !== null} title={editing === 'new' ? 'New calendar' : 'Edit calendar'} onClose={() => setEditing(null)} wide>
        {editing !== null && (
          <CalendarEditor
            cal={editing === 'new' ? null : editing}
            onDone={(msg) => {
              setEditing(null);
              toast(msg);
              loadCalendars();
            }}
          />
        )}
      </Modal>
      <Modal open={booking} title="Book appointment" onClose={() => setBooking(false)}>
        {booking && calendars && (
          <ManualBooking
            calendars={calendars}
            onDone={() => {
              setBooking(false);
              toast('Appointment booked');
              setTab('appointments');
              reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}

/** Month grid with a dot per calendar that has bookings that day. */
function MiniMonth({
  month,
  onMonth,
  selected,
  onSelect,
  counts,
  colorOf,
}: {
  month: Date;
  onMonth: (d: Date) => void;
  selected: string | null;
  onSelect: (k: string) => void;
  counts: Map<string, Appointment[]>;
  colorOf: (id: string) => (typeof CAL_COLORS)[number];
}) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = dayKey(new Date());
  const shift = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <div className="flex items-center gap-1">
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => { const d = new Date(); onMonth(new Date(d.getFullYear(), d.getMonth(), 1)); onSelect(today); }}>Today</button>
          <button className="btn-ghost h-7 w-7 px-0" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="arrowLeft" className="h-4 w-4" /></button>
          <button className="btn-ghost h-7 w-7 px-0" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevronRight" className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DAYS.map((d) => <div key={d} className="pb-1 text-[10px] font-semibold uppercase text-slate-400">{d[0]}</div>)}
        {cells.map((d) => {
          const k = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const list = counts.get(k) ?? [];
          const isSel = selected === k;
          const isToday = k === today;
          const dots = [...new Set(list.map((a) => a.calendarId))].slice(0, 3);
          return (
            <button
              key={k}
              onClick={() => onSelect(k)}
              aria-pressed={isSel}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `, ${list.length} appointment${list.length === 1 ? '' : 's'}` : ''}`}
              className={`relative mx-auto grid h-9 w-9 place-items-center rounded-full text-[13px] tabular-nums transition ${
                isSel ? 'bg-brand-600 font-semibold text-white shadow-sm shadow-brand-600/30' : isToday ? 'font-semibold text-brand-700 ring-1 ring-inset ring-brand-300' : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'
              }`}
            >
              {d.getDate()}
              {dots.length > 0 && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {dots.map((id) => <span key={id} className={`h-1 w-1 rounded-full ${isSel ? 'bg-white' : colorOf(id).dot}`} />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TIMEZONES = (() => {
  try {
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];
  }
})();

function CalendarEditor({ cal, onDone }: { cal: CalendarT | null; onDone: (msg: string) => void }) {
  const members = useMembers();
  const [team, setTeam] = useState({
    type: cal?.type ?? ('personal' as CalendarT['type']),
    teamMemberIds: cal?.teamMemberIds ?? [],
    distribution: cal?.distribution ?? ('round_robin' as CalendarT['distribution']),
    assignContactOwner: cal?.assignContactOwner ?? false,
  });
  const [load, setLoad] = useState<Array<{ userId: string; name: string; active: boolean; upcoming: number; last30: number }> | null>(null);
  useEffect(() => {
    if (cal?.type === 'team') api<any[]>(`/calendars/${cal.id}/team`).then(setLoad).catch(() => {});
  }, [cal]);
  const toggleMember = (id: string) =>
    setTeam({ ...team, teamMemberIds: team.teamMemberIds.includes(id) ? team.teamMemberIds.filter((x) => x !== id) : [...team.teamMemberIds, id] });
  const [f, setF] = useState({
    name: cal?.name ?? '',
    description: cal?.description ?? '',
    durationMinutes: cal?.durationMinutes ?? 30,
    slotIntervalMinutes: cal?.slotIntervalMinutes ?? 30,
    bufferMinutes: cal?.bufferMinutes ?? 0,
    minNoticeHours: cal?.minNoticeHours ?? 2,
    bookingWindowDays: cal?.bookingWindowDays ?? 60,
    timezone: cal?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: cal?.location ?? '',
    sendConfirmation: cal?.sendConfirmation ?? true,
    isActive: cal?.isActive ?? true,
  });
  const [avail, setAvail] = useState<Availability>(
    cal?.availability ?? Object.fromEntries(DAYS.map((_, i) => [String(i), i > 0 && i < 6 ? [{ start: '09:00', end: '17:00' }] : []])),
  );
  const [reminders, setReminders] = useState(cal?.reminders ?? []);
  const [error, setError] = useState('');
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });

  const setDay = (d: number, list: Availability[string]) => setAvail({ ...avail, [d]: list });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f, ...team, availability: avail, reminders };
      if (cal) await api(`/calendars/${cal.id}`, { method: 'PUT', body });
      else await api('/calendars', { method: 'POST', body });
      onDone(cal ? 'Calendar saved' : 'Calendar created');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="c-name">Name *</label>
          <input id="c-name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="c-desc">Description</label>
          <textarea id="c-desc" rows={2} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-dur">Duration (min)</label>
          <input id="c-dur" type="number" min={5} max={480} className="input" value={f.durationMinutes} onChange={num('durationMinutes')} />
        </div>
        <div>
          <label className="label" htmlFor="c-int">Slot interval (min)</label>
          <input id="c-int" type="number" min={5} max={480} className="input" value={f.slotIntervalMinutes} onChange={num('slotIntervalMinutes')} />
        </div>
        <div>
          <label className="label" htmlFor="c-buf">Buffer between (min)</label>
          <input id="c-buf" type="number" min={0} max={240} className="input" value={f.bufferMinutes} onChange={num('bufferMinutes')} />
        </div>
        <div>
          <label className="label" htmlFor="c-not">Minimum notice (hours)</label>
          <input id="c-not" type="number" min={0} max={720} className="input" value={f.minNoticeHours} onChange={num('minNoticeHours')} />
        </div>
        <div>
          <label className="label" htmlFor="c-win">Bookable days ahead</label>
          <input id="c-win" type="number" min={1} max={365} className="input" value={f.bookingWindowDays} onChange={num('bookingWindowDays')} />
        </div>
        <div>
          <label className="label" htmlFor="c-tz">Timezone</label>
          <select id="c-tz" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="c-loc">Location / meeting link</label>
          <input id="c-loc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. https://meet.example.com/abc or office address" />
        </div>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Who takes bookings</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="c-type" checked={team.type === 'personal'} onChange={() => setTeam({ ...team, type: 'personal' })} /> One calendar (personal / resource)</label>
          <label className="flex items-center gap-2"><input type="radio" name="c-type" checked={team.type === 'team'} onChange={() => setTeam({ ...team, type: 'team' })} /> Team (round robin)</label>
        </div>
        {team.type === 'team' && (
          <div className="mt-3 space-y-3">
            <div>
              <span className="label">Team members (in priority order for ties)</span>
              {members.length === 0 ? <p className="text-sm text-slate-500">No users in this workspace yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {members.map((m) => {
                    const i = team.teamMemberIds.indexOf(m.userId);
                    const stats = load?.find((x) => x.userId === m.userId);
                    return (
                      <li key={m.userId} className="flex items-center gap-2">
                        <label className="flex flex-1 items-center gap-2">
                          <input type="checkbox" checked={i >= 0} onChange={() => toggleMember(m.userId)} />
                          {i >= 0 && <span className="badge bg-slate-100 text-slate-600">{i + 1}</span>}
                          <span>{m.name}</span>
                          <span className="text-xs text-slate-400">{m.email}</span>
                        </label>
                        {stats && <span className="text-xs text-slate-500">{stats.upcoming} upcoming · {stats.last30} in 30 days</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-1 text-xs text-slate-500">A time shows on the booking page when at least one member is free. Members are busy if they host an appointment on any calendar.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="c-dist">Distribution</label>
                <select id="c-dist" className="input" value={team.distribution} onChange={(e) => setTeam({ ...team, distribution: e.target.value as CalendarT['distribution'] })}>
                  <option value="round_robin">Round robin: take turns</option>
                  <option value="balanced">Balanced: fewest bookings (30 days) first</option>
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={team.assignContactOwner} onChange={(e) => setTeam({ ...team, assignContactOwner: e.target.checked })} />
                Make the host the contact’s owner (if unassigned)
              </label>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Weekly availability{team.type === 'team' ? ' (shared by the team)' : ''}</legend>
        <div className="space-y-2">
          {DAYS.map((d, i) => {
            const list = avail[String(i)] ?? [];
            return (
              <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-20 items-center gap-2">
                  <input type="checkbox" checked={list.length > 0} onChange={(e) => setDay(i, e.target.checked ? [{ start: '09:00', end: '17:00' }] : [])} />
                  {d}
                </label>
                {list.length === 0 && <span className="text-slate-400">Unavailable</span>}
                {list.map((w, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <input aria-label={`${d} start`} type="time" className="input w-28 py-1" value={w.start} onChange={(e) => setDay(i, list.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)))} />
                    –
                    <input aria-label={`${d} end`} type="time" className="input w-28 py-1" value={w.end} onChange={(e) => setDay(i, list.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)))} />
                    <button type="button" className="btn-ghost px-1.5 py-0.5" aria-label="Remove window" onClick={() => setDay(i, list.filter((_, k) => k !== j))}>✕</button>
                  </span>
                ))}
                {list.length > 0 && (
                  <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setDay(i, [...list, { start: '18:00', end: '20:00' }])}>+ window</button>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Reminders</legend>
        <div className="space-y-2">
          {reminders.map((r, i) => {
            const unit = r.minutesBefore % 1440 === 0 ? 1440 : r.minutesBefore % 60 === 0 ? 60 : 1;
            const set = (patch: Partial<typeof r>) => setReminders(reminders.map((x, k) => (k === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <select aria-label="Channel" className="input w-28 py-1" value={r.channel} onChange={(e) => set({ channel: e.target.value as 'email' | 'sms' })}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
                <input aria-label="How long before" type="number" min={1} className="input w-20 py-1" value={r.minutesBefore / unit} onChange={(e) => set({ minutesBefore: Math.max(1, Number(e.target.value) || 1) * unit })} />
                <select aria-label="Unit" className="input w-28 py-1" value={unit} onChange={(e) => set({ minutesBefore: (r.minutesBefore / unit) * Number(e.target.value) })}>
                  <option value={1}>minutes</option>
                  <option value={60}>hours</option>
                  <option value={1440}>days</option>
                </select>
                <span className="text-slate-500">before</span>
                <button type="button" className="btn-ghost px-1.5 py-0.5" aria-label="Remove reminder" onClick={() => setReminders(reminders.filter((_, k) => k !== i))}>✕</button>
              </div>
            );
          })}
          {reminders.length < 3 && (
            <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setReminders([...reminders, reminders.length ? { minutesBefore: 60, channel: 'sms' } : { minutesBefore: 1440, channel: 'email' }])}>+ reminder</button>
          )}
          <p className="text-xs text-slate-500">Sent to the contact before each appointment (skipped for do-not-disturb contacts). Up to 3, from 5 minutes to 7 days before.</p>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.sendConfirmation} onChange={(e) => setF({ ...f, sendConfirmation: e.target.checked })} /> Email a confirmation to the contact</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Booking page is live</label>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-between">
        {cal ? (
          <button type="button" className="btn-danger" onClick={async () => { if (confirm('Delete this calendar and its appointments?')) { await api(`/calendars/${cal.id}`, { method: 'DELETE' }); onDone('Calendar deleted'); } }}>Delete</button>
        ) : <span />}
        <button className="btn-primary">{cal ? 'Save' : 'Create calendar'}</button>
      </div>
    </form>
  );
}

function ManualBooking({ calendars, onDone }: { calendars: CalendarT[]; onDone: () => void }) {
  const members = useMembers();
  const [calendarId, setCalendarId] = useState(calendars[0].id);
  const [host, setHost] = useState('');
  const cal = calendars.find((c) => c.id === calendarId);
  const hostOptions = cal?.type === 'team' ? members.filter((m) => cal.teamMemberIds.includes(m.userId)) : members;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [startAt, setStartAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    setSlots(null);
    setStartAt('');
    api<string[]>(`/calendars/${calendarId}/slots?date=${date}`).then(setSlots).catch(() => setSlots([]));
  }, [calendarId, date]);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('/calendars/appointments', { method: 'POST', body: { calendarId, contactId, startAt, notes: notes || undefined, assignedUserId: host || undefined } });
          onDone();
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <div>
        <label className="label" htmlFor="mb-cal">Calendar</label>
        <select id="mb-cal" className="input" value={calendarId} onChange={(e) => { setCalendarId(e.target.value); setHost(''); }}>
          {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="mb-contact">Contact</label>
        <select id="mb-contact" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="mb-date">Date</label>
        <input id="mb-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <span className="label">Time</span>
        {!slots ? <Spinner /> : slots.length === 0 ? <p className="text-sm text-slate-500">No free slots on this day.</p> : (
          <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
            {slots.map((s) => (
              <button type="button" key={s} aria-pressed={startAt === s} onClick={() => setStartAt(s)} className={`rounded border px-2 py-1 text-xs ${startAt === s ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 hover:border-brand-500'}`}>
                {new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </button>
            ))}
          </div>
        )}
      </div>
      {hostOptions.length > 0 && (
        <div>
          <label className="label" htmlFor="mb-host">Host</label>
          <select id="mb-host" className="input" value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="">{cal?.type === 'team' ? `Auto-assign (${DISTRIBUTION_LABEL[cal.distribution].toLowerCase()})` : 'No host'}</option>
            {hostOptions.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label" htmlFor="mb-notes">Notes</label>
        <input id="mb-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={!startAt || !contactId}>Book</button></div>
    </form>
  );
}
