'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

type Ext = { id: string; name: string; blocks: { kind: 'member' | 'calendar'; name: string; isMe?: boolean }; busyCount: number; lastSyncedAt: string | null; lastError: string | null };
type Overview = { feedUrl: string; external: Ext[] };
const MANAGERS = ['workspace_owner', 'workspace_admin', 'manager', 'agency_owner', 'agency_admin', 'super_admin'];

/** Calendars → Sync: your private feed (out) and outside calendars whose busy times block bookings (in). */
export function CalendarSync({ calendars }: { calendars: Array<{ id: string; name: string }> }) {
  const toast = useToast();
  const { me } = useAuth();
  const role = me?.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId)?.role ?? '';
  const manager = MANAGERS.includes(role);
  const [data, setData] = useState<Overview | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Overview>('/calendar-sync').then(setData).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  async function regenerate() {
    if (!confirm('Make a new feed link? Calendars subscribed to the old link stop updating.')) return;
    try { const r = await api<{ feedUrl: string }>('/calendar-sync/feed/regenerate', { method: 'POST' }); setData((d) => (d ? { ...d, feedUrl: r.feedUrl } : d)); toast('New link created'); } catch (e) { toast(errorText(e), 'error'); }
  }
  async function refresh(x: Ext) {
    setBusyId(x.id);
    try { const r = await api<{ lastError: string | null }>(`/calendar-sync/external/${x.id}/refresh`, { method: 'POST' }); toast(r.lastError ? `Couldn't refresh: ${r.lastError}` : 'Refreshed', r.lastError ? 'error' : 'ok'); load(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusyId(null); }
  }
  async function remove(x: Ext) {
    if (!confirm(`Disconnect ${x.name}? Its busy times stop blocking bookings.`)) return;
    try { await api(`/calendar-sync/external/${x.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!data) return <div className="grid h-48 place-items-center"><Spinner /></div>;
  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="font-semibold">Your appointments in your own calendar</h2>
        <p className="mt-1 text-[13px] text-slate-500">Subscribe to this private link in Google Calendar (Other calendars → From URL), Outlook (Add calendar → Subscribe from web) or Apple Calendar (File → New Calendar Subscription). Appointments assigned to you appear there and update automatically. Don&apos;t share it — anyone with the link can see your schedule.</p>
        <div className="mt-3 flex items-center gap-2">
          <code className="block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">{data.feedUrl}</code>
          <button className="btn-secondary h-9 shrink-0 px-3 text-xs" onClick={() => navigator.clipboard.writeText(data.feedUrl).then(() => toast('Link copied'))}><Icon name="copy" className="h-3.5 w-3.5" /> Copy</button>
          <button className="btn-ghost h-9 shrink-0 px-2 text-xs" onClick={regenerate}>New link</button>
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Block busy times from other calendars</h2>
            <p className="text-[13px] text-slate-500">Connect your Google, Outlook or Apple calendar so people can&apos;t book you when you&apos;re busy there. Refreshed every 15 minutes.</p>
          </div>
          <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> Connect a calendar</button>
        </div>
        {data.external.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nothing connected yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.external.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{x.name}</div>
                  <div className="text-xs text-slate-500">
                    Blocks {x.blocks.kind === 'calendar' ? `booking calendar “${x.blocks.name}”` : x.blocks.isMe ? 'your time on team calendars' : `${x.blocks.name}'s time on team calendars`}
                    {' · '}{x.busyCount} busy {x.busyCount === 1 ? 'time' : 'times'} ahead
                    {x.lastSyncedAt && ` · updated ${new Date(x.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                  </div>
                  {x.lastError && <div className="text-xs text-amber-700">Last refresh failed: {x.lastError} (still using the last good copy)</div>}
                </div>
                <button className="btn-ghost h-8 px-2 text-xs" disabled={busyId === x.id} onClick={() => refresh(x)}>{busyId === x.id ? 'Refreshing…' : 'Refresh'}</button>
                <button className="btn-ghost h-8 px-2 text-xs text-rose-600" onClick={() => remove(x)}>Disconnect</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {adding && <ConnectExternal calendars={manager ? calendars : []} onClose={() => setAdding(false)} onSaved={(n) => { setAdding(false); toast(`Connected — ${n} busy ${n === 1 ? 'time' : 'times'} found`); load(); }} />}
    </div>
  );
}

function ConnectExternal({ calendars, onClose, onSaved }: { calendars: Array<{ id: string; name: string }>; onClose: () => void; onSaved: (busy: number) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', url: '', calendarId: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ busyCount: number }>('/calendar-sync/external', { method: 'POST', body: { name: f.name, url: f.url, ...(f.calendarId ? { calendarId: f.calendarId } : {}) } });
      onSaved(r.busyCount);
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Connect a calendar" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div><label className="label" htmlFor="xc-name">Name</label><input id="xc-name" required maxLength={120} className="input" placeholder="My Google calendar" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div>
          <label className="label" htmlFor="xc-url">Secret iCal address</label>
          <input id="xc-url" required className="input" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">Google: Settings → your calendar → Integrate calendar → <b>Secret address in iCal format</b>. Outlook: Settings → Calendar → Shared calendars → Publish → ICS link. Apple: share as a public calendar.</p>
        </div>
        {calendars.length > 0 && (
          <div>
            <label className="label" htmlFor="xc-target">Busy times block</label>
            <select id="xc-target" className="input" value={f.calendarId} onChange={(e) => setF({ ...f, calendarId: e.target.value })}>
              <option value="">My time on team calendars</option>
              {calendars.map((c) => <option key={c.id} value={c.id}>Booking calendar: {c.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Reading calendar…' : 'Connect'}</button></div>
      </form>
    </Modal>
  );
}
