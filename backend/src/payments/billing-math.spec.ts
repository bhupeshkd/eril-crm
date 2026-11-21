import { describe, expect, it } from 'vitest';
import { addInterval, couponDiscount, couponProblem, monthlyValue } from './billing-math';

const base = { type: 'percent' as const, amount: 20, currency: null, isActive: true, expiresAt: null, maxRedemptions: null, redemptions: 0, appliesTo: 'all' as const };

describe('couponDiscount', () => {
  it('percent', () => expect(couponDiscount({ type: 'percent', amount: 15 }, 199.99)).toBe(30));
  it('fixed never exceeds subtotal', () => {
    expect(couponDiscount({ type: 'fixed', amount: 50 }, 30)).toBe(30);
    expect(couponDiscount({ type: 'fixed', amount: 50 }, 300)).toBe(50);
  });
  it('clamps percent above 100', () => expect(couponDiscount({ type: 'percent', amount: 150 }, 80)).toBe(80));
});

describe('couponProblem', () => {
  it('accepts a valid coupon', () => expect(couponProblem(base, 'invoices', 'USD')).toBeNull());
  it('rejects inactive, expired, exhausted, wrong scope, wrong currency', () => {
    expect(couponProblem({ ...base, isActive: false }, 'invoices', 'USD')).toMatch(/active/);
    expect(couponProblem({ ...base, expiresAt: new Date('2020-01-01') }, 'invoices', 'USD')).toMatch(/expired/);
    expect(couponProblem({ ...base, maxRedemptions: 2, redemptions: 2 }, 'invoices', 'USD')).toMatch(/limit/);
    expect(couponProblem({ ...base, appliesTo: 'subscriptions' }, 'invoices', 'USD')).toMatch(/only applies/);
    expect(couponProblem({ ...base, type: 'fixed', currency: 'EUR' }, 'invoices', 'USD')).toMatch(/EUR/);
  });
});

describe('addInterval', () => {
  const d = (s: string) => new Date(s);
  it('adds a month', () => expect(addInterval(d('2026-03-15T10:00:00Z'), 'month').toISOString()).toBe('2026-04-15T10:00:00.000Z'));
  it('clamps to month end and keeps the anchor', () => {
    const feb = addInterval(d('2026-01-31T00:00:00Z'), 'month');
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addInterval(feb, 'month', 31).toISOString().slice(0, 10)).toBe('2026-03-31');
  });
  it('handles leap years', () => expect(addInterval(d('2028-02-29T00:00:00Z'), 'year').toISOString().slice(0, 10)).toBe('2029-02-28'));
  it('rolls over December', () => expect(addInterval(d('2026-12-10T00:00:00Z'), 'month').toISOString().slice(0, 10)).toBe('2027-01-10'));
});

describe('monthlyValue', () => {
  it('normalises yearly plans', () => {
    expect(monthlyValue(1200, 1, 'year')).toBe(100);
    expect(monthlyValue(49, 3, 'month')).toBe(147);
  });
});
