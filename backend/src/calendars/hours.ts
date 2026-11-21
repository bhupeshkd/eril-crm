/** Pure helpers for member working hours and appointment reminders (no entity imports, so Vitest can load them). */
import { tzOffsetMs, zonedToUtc } from './time';

export type Windows = Record<string, Array<{ start: string; end: string }>>;

export interface MemberHours {
  timezone: string;
  weekly: Windows;
  /** Whole days off, 'YYYY-MM-DD' in the member's timezone. */
  daysOff: string[];
}

const localDate = (at: Date, tz: string) => new Date(at.getTime() + tzOffsetMs(at, tz)).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** True when [start, end) sits inside one of the member's working windows on that local day (no hours set = always). */
export function withinHours(start: Date, end: Date, hours: MemberHours | null | undefined): boolean {
  if (!hours) return true;
  const day = localDate(start, hours.timezone);
  if (hours.daysOff.includes(day)) return false;
  return (hours.weekly[String(weekday(day))] ?? []).some((w) => {
    const ws = zonedToUtc(day, w.start, hours.timezone).getTime();
    const we = zonedToUtc(day, w.end, hours.timezone).getTime();
    return start.getTime() >= ws && end.getTime() <= we;
  });
}

export interface Reminder {
  minutesBefore: number;
  channel: 'email' | 'sms';
}

export const MAX_REMINDERS = 3;
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;

/** Stable id for one reminder of one appointment time; a rescheduled appointment gets fresh reminders. */
export const reminderKey = (r: Reminder, startAt: Date) => `${r.minutesBefore}:${r.channel}:${startAt.getTime()}`;

/**
 * Reminders that should go out now. A reminder is due once its time has come and the appointment hasn't started.
 * Reminders whose time had already passed when the booking was made or last changed (e.g. rescheduled) are skipped.
 */
export function dueReminders(appt: { startAt: Date; bookedAt: Date }, reminders: Reminder[], now: Date): Reminder[] {
  const start = appt.startAt.getTime();
  if (now.getTime() >= start) return [];
  return reminders.filter((r) => {
    const at = start - r.minutesBefore * 60_000;
    return at <= now.getTime() && appt.bookedAt.getTime() <= at;
  });
}

/** Human wording for "in 1 day", "in 2 hours", "in 15 minutes". */
export function leadTime(minutes: number): string {
  const unit = minutes % 1440 === 0 ? ['day', minutes / 1440] : minutes % 60 === 0 ? ['hour', minutes / 60] : ['minute', minutes];
  return `${unit[1]} ${unit[0]}${unit[1] === 1 ? '' : 's'}`;
}

/** Validates/cleans a calendar's reminder list. Returns an error message or the cleaned list. */
export function cleanReminders(input: unknown): Reminder[] | string {
  if (!Array.isArray(input)) return 'reminders must be a list';
  if (input.length > MAX_REMINDERS) return `At most ${MAX_REMINDERS} reminders`;
  const out: Reminder[] = [];
  for (const r of input) {
    const m = Number(r?.minutesBefore);
    if (!Number.isInteger(m) || m < 5 || m > MAX_REMINDER_MINUTES) return 'Reminder times must be between 5 minutes and 7 days before';
    if (r?.channel !== 'email' && r?.channel !== 'sms') return 'Reminder channel must be email or sms';
    if (out.some((x) => x.minutesBefore === m && x.channel === r.channel)) continue;
    out.push({ minutesBefore: m, channel: r.channel });
  }
  return out.sort((a, b) => b.minutesBefore - a.minutesBefore);
}
