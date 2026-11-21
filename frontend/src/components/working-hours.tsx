'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Availability } from '@/lib/types-ext';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

type Hours = { timezone: string; weekly: Availability; daysOff: string[] };
type Row = { userId: string; name: string; email: string; role: string; hours: Hours | null };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MANAGERS = ['workspace_owner', 'workspace_admin', 'manager', 'agency_owner', 'agency_admin', 'super_admin'];
const DEFAULT_WEEK: Availability = Object.fromEntries(DAYS.map((_, i) => [String(i), i > 0 && i < 6 ? [{ start: '09:00', end: '17:00' }] : []]));

/** "Mon–Fri 09:00–17:00" style summary of a weekly schedule. */
function summary(h: Hours) {
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const key = JSON.stringify(h.weekly[String(i)] ?? []);
    let j = i;
    while (j + 1 < 7 && JSON.stringify(h.weekly[String(j + 1)] ?? []) === key) j++;
    const w = h.weekly[String(i)] ?? [];
    if (w.length) parts.push(`${DAYS[i]}${j > i ? `–${DAYS[j]}` : ''} ${w.map((x) => `${x.start}–${x.end}`).join(', ')}`);
    i = j + 1;
  }
  return parts.join(' · ') || 'Not working any day';
}

/** Calendars → Working hours: each person's own schedule; team calendars only offer and assign them within it. */
export function WorkingHours() {
  const toast = useToast();
  const { me } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const role = me?.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId)?.role ?? '';
  const canEdit = (r: Row) => r.userId === me?.id || MANAGERS.includes(role);

  const load = useCallback(() => {
    api<Row[]>('/calendars/member-hours').then(setRows).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  async function clear(r: Row) {
    if (!confirm(`Remove ${r.userId === me?.id ? 'your' : `${r.name}'s`} working hours? Team calendars will use their own hours for ${r.userId === me?.id ? 'you' : 'them'}.`)) return;
    try {
      await api(`/calendars/member-hours/${r.userId}`, { method: 'DELETE' });
      toast('Working hours removed');
      load();
    } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!rows) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold">Working hours</h2>
        <p className="text-[13px] text-slate-500">Team calendars only offer times when at least one member is working, and only assign bookings to people who are. No hours set means the calendar&apos;s own hours apply.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{r.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.name}{r.userId === me?.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}</div>
              <div className="truncate text-xs text-slate-500">
                {r.hours ? <>{summary(r.hours)} <span className="text-slate-400">· {r.hours.timezone}</span>{r.hours.daysOff.length > 0 && <span className="text-amber-700"> · {r.hours.daysOff.length} day{r.hours.daysOff.length === 1 ? '' : 's'} off</span>}</> : <span className="text-slate-400">Follows each calendar&apos;s hours</span>}
              </div>
            </div>
            {canEdit(r) && (
              <div className="flex gap-1">
                <button className="btn-secondary h-8 px-3 text-xs" onClick={() => setEditing(r)}><Icon name="clock" className="h-3.5 w-3.5" /> {r.hours ? 'Edit' : 'Set hours'}</button>
                {r.hours && <button className="btn-ghost h-8 px-2 text-xs" onClick={() => clear(r)}>Clear</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && <HoursEditor row={editing} self={editing.userId === me?.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Working hours saved'); load(); }} />}
    </section>
  );
}

function HoursEditor({ row, self, onClose, onSaved }: { row: Row; self: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [tz, setTz] = useState(row.hours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [week, setWeek] = useState<Availability>(row.hours?.weekly ?? DEFAULT_WEEK);
  const [daysOff, setDaysOff] = useState<string[]>(row.hours?.daysOff ?? []);
  const [newDay, setNewDay] = useState('');
  const [busy, setBusy] = useState(false);
  const setDay = (d: number, list: Availability[string]) => setWeek({ ...week, [d]: list });
  const today = new Date().toISOString().slice(0, 10);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/calendars/member-hours/${row.userId}`, { method: 'PUT', body: { timezone: tz, weekly: week, daysOff } });
      onSaved();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open wide title={self ? 'Your working hours' : `${row.name}'s working hours`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="wh-tz">Timezone</label>
          <input id="wh-tz" className="input" list="wh-tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
          <datalist id="wh-tz-list">
            {(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']).map((z) => <option key={z} value={z} />)}
          </datalist>
        </div>
        <fieldset>
          <legend className="label">Weekly hours</legend>
          <div className="space-y-2">
            {DAYS.map((d, i) => {
              const list = week[String(i)] ?? [];
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-20 items-center gap-2">
                    <input type="checkbox" checked={list.length > 0} onChange={(e) => setDay(i, e.target.checked ? [{ start: '09:00', end: '17:00' }] : [])} />
                    {d}
                  </label>
                  {list.length === 0 && <span className="text-slate-400">Off</span>}
                  {list.map((w, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <input aria-label={`${d} start`} type="time" className="input w-28 py-1" value={w.start} onChange={(e) => setDay(i, list.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)))} />
                      –
                      <input aria-label={`${d} end`} type="time" className="input w-28 py-1" value={w.end} onChange={(e) => setDay(i, list.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)))} />
                      <button type="button" className="btn-ghost px-1.5 py-0.5" aria-label="Remove window" onClick={() => setDay(i, list.filter((_, k) => k !== j))}>✕</button>
                    </span>
                  ))}
                  {list.length > 0 && <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setDay(i, [...list, { start: '18:00', end: '20:00' }])}>+ window</button>}
                </div>
              );
            })}
          </div>
        </fieldset>
        <div>
          <span className="label">Days off</span>
          <div className="flex flex-wrap items-center gap-2">
            {daysOff.map((d) => (
              <span key={d} className="badge bg-amber-50 text-amber-800">
                {new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                <button type="button" aria-label={`Remove ${d}`} className="ml-1 opacity-60 hover:opacity-100" onClick={() => setDaysOff(daysOff.filter((x) => x !== d))}>✕</button>
              </span>
            ))}
            <input aria-label="Add a day off" type="date" min={today} className="input w-44 py-1" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
            <button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={!newDay} onClick={() => { if (!daysOff.includes(newDay)) setDaysOff([...daysOff, newDay].sort()); setNewDay(''); }}>Add</button>
          </div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
