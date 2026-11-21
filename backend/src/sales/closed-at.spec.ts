import { describe, expect, it } from 'vitest';
import { closedAtFor } from './closed-at';

describe('closedAtFor', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const earlier = new Date('2026-10-01T10:00:00Z');
  it('sets the date when a deal is won or lost', () => {
    expect(closedAtFor('open', 'won', null, now)).toEqual(now);
    expect(closedAtFor(null, 'lost', null, now)).toEqual(now);
  });
  it('keeps the original date while it stays closed the same way', () => {
    expect(closedAtFor('won', 'won', earlier, now)).toEqual(earlier);
  });
  it('re-dates a switch between won and lost, and clears on reopening', () => {
    expect(closedAtFor('lost', 'won', earlier, now)).toEqual(now);
    expect(closedAtFor('won', 'open', earlier, now)).toBeNull();
  });
});
