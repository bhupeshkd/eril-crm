/** When a deal's close date changes: set on becoming won/lost, cleared on reopening, kept otherwise. */
export function closedAtFor(prevStatus: string | null, nextStatus: string, prevClosedAt: Date | null, now = new Date()): Date | null {
  const closed = nextStatus === 'won' || nextStatus === 'lost';
  if (!closed) return null;
  if (prevStatus === nextStatus && prevClosedAt) return prevClosedAt;
  return now;
}
