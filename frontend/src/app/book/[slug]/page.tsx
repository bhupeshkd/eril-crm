'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Spinner, errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';

interface Info {
  name: string;
  description: string;
  durationMinutes: number;
  timezone: string;
  location: string;
  bookingWindowDays: number;
  availableWeekdays: number[];
  isTeam?: boolean;
}

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ startLocal: string; timezone: string; host?: string | null } | null>(null);

  useEffect(() => {
    api<Info>(`/public/calendars/${slug}`, { auth: false }).then(setInfo).catch((e) => setError(errorText(e)));
  }, [slug]);

  const days = useMemo(() => {
    if (!info) return [];
    const out: string[] = [];
    const today = new Date();
    for (let i = 0; i < Math.min(info.bookingWindowDays, 28); i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      if (info.availableWeekdays.includes(d.getDay())) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    }
    return out;
  }, [info]);

  useEffect(() => {
    if (!date && days.length) setDate(days[0]);
  }, [days, date]);

  useEffect(() => {
    if (!date) return;
    setSlots(null);
    setSlot('');
    api<string[]>(`/public/calendars/${slug}/slots?date=${date}`, { auth: false }).then(setSlots).catch(() => setSlots([]));
  }, [slug, date]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDone(await api(`/public/calendars/${slug}/book`, { method: 'POST', auth: false, body: { startAt: slot, ...form, phone: form.phone || undefined, notes: form.notes || undefined } }));
    } catch (err) {
      setError(errorText(err));
      api<string[]>(`/public/calendars/${slug}/slots?date=${date}`, { auth: false }).then(setSlots).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <PublicLoading error={error} brand={{ kind: 'calendar', key: slug }} />;

  const selectedDate = date ? new Date(`${date}T12:00:00`) : null;

  return (
    <PublicShell wide brand={{ kind: 'calendar', key: slug }}>
      <div className="card mx-auto overflow-hidden shadow-pop md:grid md:grid-cols-[280px_1fr]">
        <aside className="border-b border-slate-100 bg-slate-50/60 p-6 md:border-b-0 md:border-r">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/25">
            <Icon name="calendar" className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{info.name}</h1>
          <ul className="mt-4 space-y-2.5 text-sm text-slate-600">
            <li className="flex items-center gap-2.5"><Icon name="clock" className="h-4 w-4 shrink-0 text-slate-400" />{info.durationMinutes} minutes</li>
            {info.location && <li className="flex items-start gap-2.5 break-words"><Icon name="sites" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{info.location}</li>}
            {info.isTeam && <li className="flex items-start gap-2.5"><Icon name="contacts" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />You’ll meet the next available team member</li>}
            {slot && (
              <li className="flex items-start gap-2.5 font-medium text-brand-700">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                {new Date(slot).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </li>
            )}
          </ul>
          {info.description && <p className="mt-5 whitespace-pre-wrap border-t border-slate-200/70 pt-5 text-sm leading-relaxed text-slate-600">{info.description}</p>}
          <p className="mt-5 flex items-center gap-1.5 text-xs text-slate-400"><Icon name="sites" className="h-3.5 w-3.5" />{localTz}</p>
        </aside>

        <section className="min-w-0 p-6 sm:p-7">
          {done ? (
            <div className="py-10 text-center" role="status">
              <SuccessMark />
              <h2 className="text-xl font-semibold tracking-tight">You're booked!</h2>
              <p className="mx-auto mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                <Icon name="calendar" className="h-4 w-4 text-brand-600" />
                {done.startLocal} ({done.timezone})
              </p>
              {done.host && <p className="mt-3 text-sm text-slate-600">You’ll meet with <strong>{done.host}</strong>.</p>}
              <p className="mt-1 text-sm text-slate-500">A confirmation has been sent to {form.email}.</p>
            </div>
          ) : !slot ? (
            <>
              <h2 className="mb-3 text-[15px] font-semibold">Select a date</h2>
              {days.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No dates available right now.</p>
              ) : (
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                  {days.map((d) => {
                    const dt = new Date(`${d}T12:00:00`);
                    const on = date === d;
                    return (
                      <button
                        key={d}
                        onClick={() => setDate(d)}
                        aria-pressed={on}
                        className={`flex w-[4.25rem] shrink-0 flex-col items-center rounded-xl border py-2.5 text-sm transition ${on ? 'border-brand-600 bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50/50'}`}
                      >
                        <span className={`text-[11px] font-medium uppercase ${on ? 'text-brand-100' : 'text-slate-400'}`}>{dt.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                        <span className="text-xl font-semibold leading-tight">{dt.getDate()}</span>
                        <span className={`text-[11px] ${on ? 'text-brand-100' : 'text-slate-400'}`}>{dt.toLocaleDateString(undefined, { month: 'short' })}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <h2 className="mb-3 mt-6 text-[15px] font-semibold">
                Select a time
                {selectedDate && <span className="ml-2 font-normal text-slate-500">{selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
              </h2>
              {!slots ? (
                <div className="grid h-24 place-items-center"><Spinner /></div>
              ) : slots.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No times left on this day — try another date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button key={s} onClick={() => setSlot(s)} className="rounded-lg border border-brand-200 bg-white px-2 py-2.5 text-sm font-semibold text-brand-700 transition hover:-translate-y-px hover:border-brand-500 hover:bg-brand-600 hover:text-white hover:shadow-md hover:shadow-brand-600/20">
                      {new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              )}
              {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
            </>
          ) : (
            <form onSubmit={book} className="space-y-4">
              <button type="button" className="btn-ghost -ml-2 h-8 px-2 text-[13px] text-slate-500" onClick={() => setSlot('')}>
                <Icon name="arrowLeft" className="h-4 w-4" /> Change time
              </button>
              <h2 className="text-[15px] font-semibold">Your details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="b-name">Full name *</label>
                  <input id="b-name" required autoComplete="name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="b-email">Email *</label>
                  <input id="b-email" required type="email" autoComplete="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="b-phone">Phone</label>
                <input id="b-phone" type="tel" autoComplete="tel" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="b-notes">Anything we should know?</label>
                <textarea id="b-notes" rows={3} className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
              <button className="btn-primary h-11 w-full text-[15px]" disabled={busy}>{busy ? 'Booking…' : 'Confirm booking'}</button>
            </form>
          )}
        </section>
      </div>
    </PublicShell>
  );
}
