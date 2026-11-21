import { describe, expect, it } from 'vitest';
import { cleanReminders, dueReminders, leadTime, reminderKey, withinHours } from './hours';

const nineToFive = { '1': [{ start: '09:00', end: '17:00' }], '2': [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] };

describe('withinHours', () => {
  const h = { timezone: 'Asia/Kolkata', weekly: nineToFive, daysOff: ['2026-11-30'] };
  it('accepts slots inside a window in the member timezone', () => {
    // Mon 2026-11-23 10:00 IST = 04:30Z
    expect(withinHours(new Date('2026-11-23T04:30:00Z'), new Date('2026-11-23T05:00:00Z'), h)).toBe(true);
  });
  it('rejects slots that spill out of a window, fall in a gap, or on a day off', () => {
    expect(withinHours(new Date('2026-11-23T11:15:00Z'), new Date('2026-11-23T11:45:00Z'), h)).toBe(false); // 16:45-17:15 IST
    expect(withinHours(new Date('2026-11-24T06:45:00Z'), new Date('2026-11-24T07:15:00Z'), h)).toBe(false); // Tue 12:15 IST lunch
    expect(withinHours(new Date('2026-11-30T04:30:00Z'), new Date('2026-11-30T05:00:00Z'), h)).toBe(false); // day off
    expect(withinHours(new Date('2026-11-22T04:30:00Z'), new Date('2026-11-22T05:00:00Z'), h)).toBe(false); // Sunday
  });
  it('no hours means always available', () => {
    expect(withinHours(new Date(), new Date(), null)).toBe(true);
  });
});

describe('reminders', () => {
  const start = new Date('2026-12-01T15:00:00Z');
  const created = new Date('2026-11-20T10:00:00Z');
  const rs = [{ minutesBefore: 1440, channel: 'email' as const }, { minutesBefore: 60, channel: 'sms' as const }];
  it('is due once its time has come, until the appointment starts', () => {
    expect(dueReminders({ startAt: start, bookedAt: created }, rs, new Date('2026-11-30T14:59:00Z'))).toEqual([]);
    expect(dueReminders({ startAt: start, bookedAt: created }, rs, new Date('2026-11-30T15:00:00Z'))).toEqual([rs[0]]);
    expect(dueReminders({ startAt: start, bookedAt: created }, rs, new Date('2026-12-01T14:10:00Z'))).toEqual(rs);
    expect(dueReminders({ startAt: start, bookedAt: created }, rs, new Date('2026-12-01T15:00:00Z'))).toEqual([]);
  });
  it('skips reminders that were already past when the booking was made', () => {
    expect(dueReminders({ startAt: start, bookedAt: new Date('2026-12-01T10:00:00Z') }, rs, new Date('2026-12-01T14:10:00Z'))).toEqual([rs[1]]);
  });
  it('keys change when the appointment moves', () => {
    expect(reminderKey(rs[0], start)).not.toBe(reminderKey(rs[0], new Date(start.getTime() + 3_600_000)));
  });
  it('validates and sorts', () => {
    expect(cleanReminders([{ minutesBefore: 60, channel: 'sms' }, { minutesBefore: 1440, channel: 'email' }, { minutesBefore: 60, channel: 'sms' }])).toEqual([
      { minutesBefore: 1440, channel: 'email' },
      { minutesBefore: 60, channel: 'sms' },
    ]);
    expect(typeof cleanReminders([{ minutesBefore: 1, channel: 'sms' }])).toBe('string');
    expect(typeof cleanReminders([{ minutesBefore: 60, channel: 'fax' }])).toBe('string');
    expect(typeof cleanReminders(new Array(4).fill({ minutesBefore: 60, channel: 'sms' }))).toBe('string');
  });
  it('words lead times', () => {
    expect(leadTime(1440)).toBe('1 day');
    expect(leadTime(120)).toBe('2 hours');
    expect(leadTime(15)).toBe('15 minutes');
  });
});
