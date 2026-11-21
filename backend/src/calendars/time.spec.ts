import { describe, expect, it } from 'vitest';
import { computeSlots, weekdayOf, zonedToUtc } from './time';

describe('zonedToUtc', () => {
  it('converts Kolkata wall time', () => {
    expect(zonedToUtc('2026-03-02', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-03-02T03:30:00.000Z');
  });
  it('handles US DST (EDT vs EST)', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-01-05', '09:00', 'America/New_York').toISOString()).toBe('2026-01-05T14:00:00.000Z');
  });
});

describe('weekdayOf', () => {
  it('returns 1 for a Monday', () => expect(weekdayOf('2026-11-16')).toBe(1));
});

describe('computeSlots', () => {
  const base = {
    date: '2026-03-02',
    timezone: 'UTC',
    windows: [{ start: '09:00', end: '11:00' }],
    durationMinutes: 30,
    intervalMinutes: 30,
    bufferMinutes: 0,
    earliest: new Date('2026-03-01T00:00:00Z'),
    busy: [] as Array<{ start: Date; end: Date }>,
  };
  it('fills the window', () => {
    expect(computeSlots(base).map((d) => d.toISOString().slice(11, 16))).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });
  it('removes busy and buffered slots', () => {
    const busy = [{ start: new Date('2026-03-02T09:30:00Z'), end: new Date('2026-03-02T10:00:00Z') }];
    expect(computeSlots({ ...base, busy }).map((d) => d.toISOString().slice(11, 16))).toEqual(['09:00', '10:00', '10:30']);
    expect(computeSlots({ ...base, busy, bufferMinutes: 15 }).map((d) => d.toISOString().slice(11, 16))).toEqual(['10:30']);
  });
  it('respects minimum notice', () => {
    expect(computeSlots({ ...base, earliest: new Date('2026-03-02T09:45:00Z') }).length).toBe(2);
  });
});
