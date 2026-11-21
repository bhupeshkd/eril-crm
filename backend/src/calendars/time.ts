/** Timezone helpers built on Intl (no external date library). Unit-tested in time.spec.ts. */

/** Offset (ms) of `tz` from UTC at instant `date`, e.g. +19800000 for Asia/Kolkata. */
export function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock date + time in `tz` to a UTC instant (DST-safe). */
export function zonedToUtc(dateStr: string, time: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) as seen in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Date(now.getTime() + tzOffsetMs(now, tz)).toISOString().slice(0, 10);
}

export function formatInZone(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

export interface SlotInput {
  date: string;
  timezone: string;
  windows: Array<{ start: string; end: string }>;
  durationMinutes: number;
  intervalMinutes: number;
  bufferMinutes: number;
  earliest: Date;
  busy: Array<{ start: Date; end: Date }>;
}

/** Generates free slot start times for one day. */
export function computeSlots(i: SlotInput): Date[] {
  const out: Date[] = [];
  const dur = i.durationMinutes * 60_000;
  const step = Math.max(5, i.intervalMinutes) * 60_000;
  const buf = i.bufferMinutes * 60_000;
  for (const w of i.windows) {
    const winStart = zonedToUtc(i.date, w.start, i.timezone).getTime();
    const winEnd = zonedToUtc(i.date, w.end, i.timezone).getTime();
    for (let t = winStart; t + dur <= winEnd; t += step) {
      if (t < i.earliest.getTime()) continue;
      const clash = i.busy.some((b) => t < b.end.getTime() + buf && t + dur > b.start.getTime() - buf);
      if (!clash) out.push(new Date(t));
    }
  }
  return out;
}
