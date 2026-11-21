import { describe, expect, it } from 'vitest';
import { featuresFor, isLocked, isPeriod, overageLines, periodOf, periodRange, previousPeriod, standing } from './rules';

describe('featuresFor', () => {
  it('maps permissions to plan features; core permissions need none', () => {
    expect(featuresFor(['campaigns:send'])).toEqual(['marketing']);
    expect(featuresFor(['invoices:write', 'payments:read'])).toEqual(['payments']);
    expect(featuresFor(['contacts:write', 'conversations:read', 'pipelines:read'])).toEqual([]);
    expect(featuresFor(undefined)).toEqual([]);
  });
});

describe('standing', () => {
  it('follows the subscription, with a grace period before suspension', () => {
    expect(standing('trialing', null, 7)).toBe('trialing');
    expect(standing('active', null, 7)).toBe('active');
    expect(standing('past_due', 3, 7)).toBe('past_due');
    expect(standing('past_due', 8, 7)).toBe('suspended');
    expect(standing('past_due', null, 7)).toBe('past_due');
    expect(standing('canceled', null, 7)).toBe('canceled');
    expect(standing(null, null, 7)).toBe('canceled');
  });
  it('locks suspended and canceled accounts only', () => {
    expect(isLocked('suspended')).toBe(true);
    expect(isLocked('canceled')).toBe(true);
    expect(isLocked('past_due')).toBe(false);
    expect(isLocked('trialing')).toBe(false);
  });
});

describe('overageLines', () => {
  it('bills only what exceeds the allowance, at the resell price', () => {
    const lines = overageLines({ emails: 1500, sms: 80 }, { emails: 1000, sms: 100 }, { emailPrice: 0.002, smsPrice: 0.05 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 500, unitPrice: 0.002, amount: 1 });
    expect(lines[0].name).toContain('1,500 used, 1,000 included');
  });
  it('nothing owed when within allowance or price is zero', () => {
    expect(overageLines({ emails: 10, sms: 10 }, { emails: 100, sms: 100 }, { emailPrice: 1, smsPrice: 1 })).toEqual([]);
    expect(overageLines({ emails: 500, sms: 0 }, { emails: 0, sms: 0 }, { emailPrice: 0, smsPrice: 0.05 })).toEqual([]);
  });
  it('rounds money to cents', () => {
    expect(overageLines({ emails: 0, sms: 3 }, { emails: 0, sms: 0 }, { emailPrice: 0, smsPrice: 0.0333 })[0].amount).toBe(0.1);
  });
});

describe('periods', () => {
  it('formats, ranges and steps back across the year boundary', () => {
    expect(periodOf(new Date('2026-11-20T10:00:00Z'))).toBe('2026-11');
    expect(previousPeriod(new Date('2026-01-03T00:00:00Z'))).toBe('2025-12');
    const r = periodRange('2026-12');
    expect(r.start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(isPeriod('2026-13')).toBe(false);
    expect(isPeriod('2026-02')).toBe(true);
  });
});
