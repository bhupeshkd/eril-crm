/**
 * iCalendar (RFC 5545) reading and writing for calendar sync, without dependencies.
 * Reading turns a feed into busy blocks: timezones (TZID), all-day events, DURATION, repeating events
 * (DAILY / WEEKLY with BYDAY / MONTHLY by day of month / YEARLY, with INTERVAL, COUNT, UNTIL), EXDATE exceptions
 * and moved occurrences (RECURRENCE-ID). Cancelled and "free" (TRANSP:TRANSPARENT) events are ignored.
 */
import { addDays, isValidTimeZone, weekdayOf, zonedToUtc } from './time';

export interface Busy {
  start: Date;
  end: Date;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** A few Windows zone names Outlook writes in TZID, mapped to IANA names. */
const WINDOWS_TZ: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'India Standard Time': 'Asia/Kolkata',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  UTC: 'UTC',
};

function zoneOf(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const t = tzid.replace(/^"|"$/g, '').replace(/^\/[^/]+\/[^/]+\//, ''); // strip "/mozilla.org/20070129_1/" style prefixes
  if (isValidTimeZone(t)) return t;
  return WINDOWS_TZ[t] ?? fallback;
}

function parseProps(lines: string[]): Prop[] {
  return lines.map((line) => {
    // name;param=a;param="b:c":value — the value starts at the first ':' outside quotes.
    let inQuote = false;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      else if (line[i] === ':' && !inQuote) { cut = i; break; }
    }
    const head = cut === -1 ? line : line.slice(0, cut);
    const value = cut === -1 ? '' : line.slice(cut + 1);
    const [name, ...ps] = head.split(';');
    const params: Record<string, string> = {};
    for (const p of ps) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), params, value };
  });
}

/** A date-time as local wall clock (date + time) plus zone, or an exact UTC instant. */
interface When {
  date: string; // YYYY-MM-DD (local)
  time: string; // HH:MM (local)
  tz: string;
  allDay: boolean;
}

function parseWhen(p: Prop | undefined, fallbackTz: string): When | null {
  if (!p) return null;
  const v = p.value.trim().split(',')[0];
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date, time: '00:00', tz: zoneOf(p.params.TZID, fallbackTz), allDay: true };
  if (m[7]) return { date, time: `${m[4]}:${m[5]}`, tz: 'UTC', allDay: false };
  return { date, time: `${m[4]}:${m[5]}`, tz: zoneOf(p.params.TZID, fallbackTz), allDay: false };
}

const toUtc = (w: When) => zonedToUtc(w.date, w.time, w.tz);

/** "P1DT2H30M" → milliseconds. */
export function durationMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = (((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 24 + Number(m[4] || 0)) * 60 + Number(m[5] || 0)) * 60_000 + Number(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_OCCURRENCES = 1000;

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Date | null;
  byDay: number[] | null;
}

function parseRule(v: string, fallbackTz: string): Rule | null {
  const parts = Object.fromEntries(v.split(';').map((kv) => kv.split('=') as [string, string]).map(([k, x]) => [k.toUpperCase(), x]));
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ)) return null;
  const until = parts.UNTIL ? parseWhen({ name: 'UNTIL', params: {}, value: parts.UNTIL }, fallbackTz) : null;
  const byDay = parts.BYDAY ? parts.BYDAY.split(',').map((d: string) => DAYS.indexOf(d.slice(-2))).filter((d: number) => d >= 0) : null;
  return {
    freq: parts.FREQ as Rule['freq'],
    interval: Math.max(1, Math.min(365, Number(parts.INTERVAL) || 1)),
    count: parts.COUNT ? Math.max(1, Math.min(MAX_OCCURRENCES, Number(parts.COUNT) || 1)) : null,
    // UNTIL is inclusive; date-only UNTIL means the end of that day.
    until: until ? (until.allDay ? new Date(toUtc({ ...until, date: addDays(until.date, 1) }).getTime() - 1) : toUtc(until)) : null,
    byDay: byDay && byDay.length ? byDay : null,
  };
}

const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Local start dates of a repeating event, in order (stops at COUNT/UNTIL or the window end). */
function occurrenceDates(start: When, rule: Rule, windowEnd: Date): string[] {
  const out: string[] = [];
  let produced = 0;
  const startDow = weekdayOf(start.date);
  const days = rule.freq === 'WEEKLY' ? (rule.byDay ?? [startDow]) : null;
  const dom = start.date.slice(8, 10);
  const md = start.date.slice(5);
  // Walk day by day from the first date; generous upper bound keeps this cheap and safe.
  for (let i = 0, d = start.date; i < 366 * 12; i++, d = addDays(d, 1)) {
    const at = toUtc({ ...start, date: d });
    if (at > windowEnd || (rule.until && at > rule.until)) break;
    const diffDays = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${start.date}T00:00:00Z`)) / 86_400_000);
    let hit = false;
    if (rule.freq === 'DAILY') hit = diffDays % rule.interval === 0;
    else if (rule.freq === 'WEEKLY') {
      // Weeks counted from the week (starting Monday) that holds the first occurrence.
      const weekStart = addDays(start.date, -((startDow + 6) % 7));
      const weeks = Math.floor(Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000) / 7);
      hit = weeks % rule.interval === 0 && days!.includes(weekdayOf(d));
    } else if (rule.freq === 'MONTHLY') hit = d.slice(8, 10) === dom && monthsBetween(start.date, d) % rule.interval === 0;
    else hit = d.slice(5) === md && (Number(d.slice(0, 4)) - Number(start.date.slice(0, 4))) % rule.interval === 0;
    if (!hit) continue;
    out.push(d);
    produced++;
    if ((rule.count && produced >= rule.count) || produced >= MAX_OCCURRENCES) break;
  }
  return out;
}

/** Busy blocks from an .ics feed that overlap [from, to). */
export function parseIcsBusy(text: string, from: Date, to: Date): Busy[] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const calTz = zoneOf(/^X-WR-TIMEZONE:(.+)$/m.exec(unfolded)?.[1]?.trim(), 'UTC');
  const events: Prop[][] = [];
  let cur: string[] | null = null;
  let depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; depth = 0; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(parseProps(cur)); cur = null; continue; }
    if (!cur) continue;
    // Skip nested components (e.g. VALARM) inside an event.
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:')) { depth--; continue; }
    if (depth === 0) cur.push(line);
  }

  const get = (ev: Prop[], n: string) => ev.find((p) => p.name === n);
  // Occurrences moved or edited individually replace their slot in the series.
  const overridden = new Set<string>();
  for (const ev of events) {
    const rid = get(ev, 'RECURRENCE-ID');
    const uid = get(ev, 'UID')?.value;
    const w = parseWhen(rid, calTz);
    if (uid && w) overridden.add(`${uid}|${toUtc(w).getTime()}`);
  }

  const busy: Busy[] = [];
  for (const ev of events) {
    if ((get(ev, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue;
    if ((get(ev, 'TRANSP')?.value ?? '').toUpperCase() === 'TRANSPARENT') continue;
    const start = parseWhen(get(ev, 'DTSTART'), calTz);
    if (!start) continue;
    const startAt = toUtc(start);
    const endProp = parseWhen(get(ev, 'DTEND'), calTz);
    const dur = get(ev, 'DURATION') ? durationMs(get(ev, 'DURATION')!.value) : null;
    const lengthMs = endProp ? toUtc(endProp).getTime() - startAt.getTime() : dur ?? (start.allDay ? 86_400_000 : 0);
    if (lengthMs <= 0) continue;
    const uid = get(ev, 'UID')?.value;
    const exdates = new Set(
      ev.filter((p) => p.name === 'EXDATE').flatMap((p) => p.value.split(',').map((v) => parseWhen({ ...p, value: v }, start.tz)).filter(Boolean).map((w) => toUtc(w!).getTime())),
    );
    const rrule = get(ev, 'RRULE');
    const rule = rrule && !get(ev, 'RECURRENCE-ID') ? parseRule(rrule.value, start.tz) : null;
    const dates = rule ? occurrenceDates(start, rule, to) : [start.date];
    for (const d of dates) {
      const s = toUtc({ ...start, date: d });
      if (exdates.has(s.getTime())) continue;
      if (rule && uid && overridden.has(`${uid}|${s.getTime()}`)) continue;
      // All-day events keep whole local days, so a DST change doesn't shift them.
      const e = start.allDay && endProp ? toUtc({ ...endProp, date: addDays(d, Math.round(lengthMs / 86_400_000)) }) : new Date(s.getTime() + lengthMs);
      if (e > from && s < to) busy.push({ start: s, end: e });
      if (busy.length >= 5000) break;
    }
  }
  return mergeBusy(busy);
}

/** Sorted, overlapping/adjacent blocks merged. */
export function mergeBusy(list: Busy[]): Busy[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Busy[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) { if (b.end > last.end) last.end = b.end; }
    else out.push({ start: new Date(b.start), end: new Date(b.end) });
  }
  return out;
}

// ---- Writing ----
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lines longer than 75 octets continue on the next line after a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export interface FeedEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  cancelled?: boolean;
  updated?: Date;
}

/** A subscribable calendar feed. */
export function buildIcs(name: string, events: FeedEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ERIL//Calendar feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(e.uid)}`,
      `DTSTAMP:${stamp(e.updated ?? now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
