/** Pure helpers for round-robin team calendars (no entity imports, so Vitest can load them). */

export type Distribution = 'round_robin' | 'balanced';

export interface HostStats {
  /** Non-cancelled bookings on this calendar in the balancing window. */
  count: number;
  /** When this member was last given a booking on this calendar (ms), or null if never. */
  lastAssignedAt: number | null;
}

/**
 * Picks who gets a booking among the members free at that time.
 * - round_robin: whoever was assigned longest ago (never-assigned first), so turns rotate.
 * - balanced: fewest bookings in the window, falling back to the rotation rule.
 * Final tie-break is the member order configured on the calendar, so results are deterministic.
 */
export function chooseHost(free: string[], order: string[], distribution: Distribution, stats: Map<string, HostStats>): string | null {
  if (!free.length) return null;
  const pos = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const last = (id: string) => stats.get(id)?.lastAssignedAt ?? -Infinity;
  const count = (id: string) => stats.get(id)?.count ?? 0;
  const sorted = [...free].sort((a, b) => {
    if (distribution === 'balanced' && count(a) !== count(b)) return count(a) - count(b);
    if (last(a) !== last(b)) return last(a) - last(b);
    return pos(a) - pos(b);
  });
  return sorted[0];
}

/** True when [start, end) overlaps any busy block once the buffer is applied on both sides. */
export function overlaps(start: number, end: number, busy: Array<{ start: number; end: number }>, bufferMs = 0): boolean {
  return busy.some((b) => start < b.end + bufferMs && end > b.start - bufferMs);
}

/** Sorted, de-duplicated union of several members' slot lists (ISO strings). */
export function unionSlots(lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}
