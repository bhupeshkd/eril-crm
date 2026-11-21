/** Community gamification: members earn a point for every like their posts get from someone else. Pure helpers. */

/** Points needed to reach levels 1–9. */
export const LEVEL_POINTS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015] as const;
export const MAX_LEVEL = LEVEL_POINTS.length;

export function levelFor(points: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_POINTS.length; i++) if (points >= LEVEL_POINTS[i]) level = i + 1;
  return level;
}

/** Level, points to the next level and progress through the current one (0–100). */
export function progress(points: number) {
  const level = levelFor(points);
  if (level === MAX_LEVEL) return { level, points, nextLevelAt: null, toNext: 0, percent: 100 };
  const from = LEVEL_POINTS[level - 1];
  const to = LEVEL_POINTS[level];
  return { level, points, nextLevelAt: to, toNext: to - points, percent: Math.floor(((points - from) / (to - from)) * 100) };
}

export const PERIODS = ['7d', '30d', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export function periodStart(p: Period, now = new Date()): Date | null {
  if (p === 'all') return null;
  return new Date(now.getTime() - (p === '7d' ? 7 : 30) * 86_400_000);
}

/** Standard competition ranking ("1, 2, 2, 4") over rows already sorted by points, highest first. */
export function rank<T extends { points: number }>(rows: T[]): Array<T & { rank: number }> {
  let prevPoints = Number.NaN;
  let prevRank = 0;
  return rows.map((r, i) => {
    const rnk = r.points === prevPoints ? prevRank : i + 1;
    prevPoints = r.points;
    prevRank = rnk;
    return { ...r, rank: rnk };
  });
}
