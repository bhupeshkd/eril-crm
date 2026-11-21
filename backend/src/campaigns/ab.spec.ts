import { describe, expect, it } from 'vitest';
import { normaliseAbTest, pickWinner, splitForTest } from './ab';

const seq = () => {
  let x = 0.37;
  return () => (x = (x * 9301 + 0.49297) % 1);
};

describe('splitForTest', () => {
  it('takes the test share, split evenly, and holds the rest', () => {
    const ids = Array.from({ length: 100 }, (_, i) => i);
    const { a, b, rest } = splitForTest(ids, 20, seq());
    expect(a.length).toBe(10);
    expect(b.length).toBe(10);
    expect(rest.length).toBe(80);
    expect(new Set([...a, ...b, ...rest]).size).toBe(100);
  });
  it('sends everyone in the test when testPercent is 100', () => {
    const { a, b, rest } = splitForTest([1, 2, 3, 4, 5], 100, seq());
    expect(a.length + b.length).toBe(5);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
    expect(rest).toEqual([]);
  });
  it('always tests at least one contact per variant', () => {
    const { a, b } = splitForTest([1, 2, 3, 4], 10, seq());
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });
});

describe('pickWinner', () => {
  it('uses the chosen metric rate, not raw counts', () => {
    const r = [
      { variant: 'A' as const, tracked: 100, opened: 30, clicked: 10 },
      { variant: 'B' as const, tracked: 50, opened: 20, clicked: 2 },
    ];
    expect(pickWinner(r, 'opens')).toBe('B'); // 40% vs 30%
    expect(pickWinner(r, 'clicks')).toBe('A'); // 10% vs 4%
  });
  it('breaks ties with the other metric, then keeps A', () => {
    expect(pickWinner([{ variant: 'A', tracked: 10, opened: 5, clicked: 1 }, { variant: 'B', tracked: 10, opened: 5, clicked: 2 }], 'opens')).toBe('B');
    expect(pickWinner([{ variant: 'A', tracked: 10, opened: 0, clicked: 0 }, { variant: 'B', tracked: 10, opened: 0, clicked: 0 }], 'clicks')).toBe('A');
    expect(pickWinner([], 'opens')).toBe('A');
  });
});

describe('normaliseAbTest', () => {
  it('validates input', () => {
    expect(normaliseAbTest({ subjectB: ' ' })).toEqual({ error: 'Variant B needs a subject line' });
    expect('error' in normaliseAbTest({ subjectB: 'x', testPercent: 5 })).toBe(true);
    expect('error' in normaliseAbTest({ subjectB: 'x', waitMinutes: 1 })).toBe(true);
    expect(normaliseAbTest({ subjectB: ' Hi ', testPercent: '30', metric: 'clicks', waitMinutes: 60 })).toEqual({
      config: { subjectB: 'Hi', testPercent: 30, metric: 'clicks', waitMinutes: 60 },
    });
  });
});
