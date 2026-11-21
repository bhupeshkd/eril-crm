import { describe, expect, it } from 'vitest';
import { chooseHost, overlaps, unionSlots } from './team';

const order = ['u1', 'u2', 'u3'];

describe('chooseHost', () => {
  it('returns null when nobody is free', () => {
    expect(chooseHost([], order, 'round_robin', new Map())).toBeNull();
  });
  it('round robin: never-assigned first, then whoever waited longest', () => {
    expect(chooseHost(order, order, 'round_robin', new Map())).toBe('u1');
    const stats = new Map([
      ['u1', { count: 1, lastAssignedAt: 300 }],
      ['u2', { count: 5, lastAssignedAt: 100 }],
      ['u3', { count: 0, lastAssignedAt: null }],
    ]);
    expect(chooseHost(order, order, 'round_robin', stats)).toBe('u3');
    expect(chooseHost(['u1', 'u2'], order, 'round_robin', stats)).toBe('u2');
  });
  it('balanced: fewest bookings wins, rotation breaks ties', () => {
    const stats = new Map([
      ['u1', { count: 2, lastAssignedAt: 100 }],
      ['u2', { count: 5, lastAssignedAt: 50 }],
      ['u3', { count: 2, lastAssignedAt: 90 }],
    ]);
    expect(chooseHost(order, order, 'balanced', stats)).toBe('u3');
    expect(chooseHost(order, order, 'round_robin', stats)).toBe('u2');
  });
  it('only picks from the free list', () => {
    expect(chooseHost(['u3'], order, 'balanced', new Map([['u3', { count: 99, lastAssignedAt: 1 }]]))).toBe('u3');
  });
  it('a full rotation gives everyone one booking', () => {
    const stats = new Map<string, { count: number; lastAssignedAt: number | null }>();
    const got: string[] = [];
    for (let t = 1; t <= 6; t++) {
      const h = chooseHost(order, order, 'round_robin', stats)!;
      got.push(h);
      stats.set(h, { count: (stats.get(h)?.count ?? 0) + 1, lastAssignedAt: t });
    }
    expect(got).toEqual(['u1', 'u2', 'u3', 'u1', 'u2', 'u3']);
  });
});

describe('overlaps / unionSlots', () => {
  it('applies buffers on both sides', () => {
    const busy = [{ start: 100, end: 200 }];
    expect(overlaps(200, 300, busy)).toBe(false);
    expect(overlaps(200, 300, busy, 10)).toBe(true);
    expect(overlaps(0, 100, busy)).toBe(false);
    expect(overlaps(150, 160, busy)).toBe(true);
  });
  it('merges slot lists', () => {
    expect(unionSlots([['b', 'a'], ['a', 'c'], []])).toEqual(['a', 'b', 'c']);
  });
});
