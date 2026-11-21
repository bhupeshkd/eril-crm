import { describe, expect, it } from 'vitest';
import { buildIcs, durationMs, mergeBusy, parseIcsBusy } from './ics';

const wrap = (body: string, extra = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${extra}${body}END:VCALENDAR\r\n`;
const iso = (b: { start: Date; end: Date }) => `${b.start.toISOString()}–${b.end.toISOString()}`;
const FROM = new Date('2026-11-01T00:00:00Z');
const TO = new Date('2027-01-31T00:00:00Z');

describe('parseIcsBusy', () => {
  it('reads UTC, zoned and floating times, DURATION and folded lines', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261123T150000Z\r\nDTEND:20261123T160000Z\r\nSUMMARY:A very long title that is folded\r\n  across lines\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=America/New_York:20261124T090000\r\nDURATION:PT1H30M\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20261125T100000\r\nDTEND:20261125T103000\r\nEND:VEVENT\r\n',
      'X-WR-TIMEZONE:Asia/Kolkata\r\n',
    );
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual([
      '2026-11-23T15:00:00.000Z–2026-11-23T16:00:00.000Z',
      '2026-11-24T14:00:00.000Z–2026-11-24T15:30:00.000Z', // 09:00 New York (EST)
      '2026-11-25T04:30:00.000Z–2026-11-25T05:00:00.000Z', // floating → calendar zone (IST)
    ]);
  });
  it('maps Outlook Windows zone names', () => {
    const ics = wrap('BEGIN:VEVENT\r\nUID:o\r\nDTSTART;TZID="Pacific Standard Time":20261201T080000\r\nDTEND;TZID="Pacific Standard Time":20261201T090000\r\nEND:VEVENT\r\n');
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual(['2026-12-01T16:00:00.000Z–2026-12-01T17:00:00.000Z']);
  });
  it('skips cancelled and free events, and alarms inside events', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261123T150000Z\r\nDTEND:20261123T160000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:y\r\nDTSTART:20261123T170000Z\r\nDTEND:20261123T180000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:z\r\nDTSTART:20261124T170000Z\r\nDTEND:20261124T180000Z\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nDTSTART:20000101T000000Z\r\nEND:VALARM\r\nEND:VEVENT\r\n',
    );
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual(['2026-11-24T17:00:00.000Z–2026-11-24T18:00:00.000Z']);
  });
  it('all-day events cover whole local days', () => {
    const ics = wrap('BEGIN:VEVENT\r\nUID:d\r\nDTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261128\r\nEND:VEVENT\r\n', 'X-WR-TIMEZONE:America/New_York\r\n');
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual(['2026-11-26T05:00:00.000Z–2026-11-28T05:00:00.000Z']);
  });
  it('weekly repeats on chosen days, with UNTIL, EXDATE and a moved occurrence', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:standup\r\nDTSTART;TZID=Europe/London:20261102T093000\r\nDTEND;TZID=Europe/London:20261102T094500\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261111T235959Z\r\nEXDATE;TZID=Europe/London:20261104T093000\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID;TZID=Europe/London:20261109T093000\r\nDTSTART;TZID=Europe/London:20261109T140000\r\nDTEND;TZID=Europe/London:20261109T141500\r\nEND:VEVENT\r\n',
    );
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual([
      '2026-11-02T09:30:00.000Z–2026-11-02T09:45:00.000Z', // Mon
      // Wed 4th excluded
      '2026-11-09T14:00:00.000Z–2026-11-09T14:15:00.000Z', // Mon 9th moved to 14:00
      '2026-11-11T09:30:00.000Z–2026-11-11T09:45:00.000Z', // Wed 11th, last before UNTIL
    ]);
  });
  it('keeps local time across DST changes and honours COUNT and INTERVAL', () => {
    // 09:00 New York every other day from Oct 31; DST ends Nov 1 (EDT → EST).
    const ics = wrap('BEGIN:VEVENT\r\nUID:dst\r\nDTSTART;TZID=America/New_York:20261031T090000\r\nDTEND;TZID=America/New_York:20261031T100000\r\nRRULE:FREQ=DAILY;INTERVAL=2;COUNT=3\r\nEND:VEVENT\r\n');
    expect(parseIcsBusy(ics, new Date('2026-10-01T00:00:00Z'), TO).map(iso)).toEqual([
      '2026-10-31T13:00:00.000Z–2026-10-31T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z–2026-11-02T15:00:00.000Z',
      '2026-11-04T14:00:00.000Z–2026-11-04T15:00:00.000Z',
    ]);
  });
  it('monthly by date, only inside the window, and unbounded series stop at the window end', () => {
    const ics = wrap('BEGIN:VEVENT\r\nUID:m\r\nDTSTART:20260115T120000Z\r\nDTEND:20260115T130000Z\r\nRRULE:FREQ=MONTHLY\r\nEND:VEVENT\r\n');
    expect(parseIcsBusy(ics, FROM, TO).map((b) => b.start.toISOString().slice(0, 10))).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });
  it('merges overlaps and ignores junk', () => {
    expect(parseIcsBusy('not a calendar', FROM, TO)).toEqual([]);
    const m = mergeBusy([
      { start: new Date('2026-11-23T10:00:00Z'), end: new Date('2026-11-23T11:00:00Z') },
      { start: new Date('2026-11-23T10:30:00Z'), end: new Date('2026-11-23T12:00:00Z') },
      { start: new Date('2026-11-23T12:00:00Z'), end: new Date('2026-11-23T12:30:00Z') },
    ]);
    expect(m.map(iso)).toEqual(['2026-11-23T10:00:00.000Z–2026-11-23T12:30:00.000Z']);
  });
  it('durations', () => {
    expect(durationMs('PT1H30M')).toBe(5_400_000);
    expect(durationMs('P1D')).toBe(86_400_000);
    expect(durationMs('P1W')).toBe(7 * 86_400_000);
    expect(durationMs('nope')).toBeNull();
  });
});

describe('buildIcs', () => {
  it('writes a valid, escaped, folded feed that reads back', () => {
    const ics = buildIcs('Ana — ERIL', [
      { uid: 'appt-1@eril', start: new Date('2026-11-23T15:00:00Z'), end: new Date('2026-11-23T15:30:00Z'), summary: 'Consult; with Lena, re: glazes', description: 'Line 1\nLine 2 ' + 'x'.repeat(120), location: 'Studio A' },
      { uid: 'appt-2@eril', start: new Date('2026-11-24T15:00:00Z'), end: new Date('2026-11-24T16:00:00Z'), summary: 'Cancelled one', cancelled: true },
    ], new Date('2026-11-21T00:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:Consult\\; with Lena\\, re: glazes');
    expect(ics).toContain('DTSTART:20261123T150000Z');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(parseIcsBusy(ics, FROM, TO).map(iso)).toEqual(['2026-11-23T15:00:00.000Z–2026-11-23T15:30:00.000Z']);
  });
});
