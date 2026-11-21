/** Pure helpers for A/B subject tests (no entity imports, so Vitest can load them). */

export type AbMetric = 'opens' | 'clicks';
export type Variant = 'A' | 'B';

export interface AbTestConfig {
  /** Alternative subject line (variant B). Variant A is the campaign's normal subject. */
  subjectB: string;
  /** Share of the audience used for the test, split evenly between A and B (10–100). */
  testPercent: number;
  /** What decides the winner. */
  metric: AbMetric;
  /** How long to wait for results before sending the winner to everyone else. */
  waitMinutes: number;
}

export interface VariantResult {
  variant: Variant;
  tracked: number;
  opened: number;
  clicked: number;
}

export const AB_LIMITS = { minPercent: 10, maxPercent: 100, minWait: 15, maxWait: 7 * 24 * 60, minAudience: 4 };

/** Fisher–Yates shuffle (injectable RNG for tests). */
export function shuffle<T>(list: T[], rand: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick the test groups. The test group is `testPercent` of the audience (at least one per variant),
 * alternating A/B so both halves are equal (±1). Everyone else waits for the winner.
 */
export function splitForTest<T>(recipients: T[], testPercent: number, rand: () => number = Math.random) {
  const mixed = shuffle(recipients, rand);
  const pct = Math.min(100, Math.max(AB_LIMITS.minPercent, testPercent));
  let size = Math.round((mixed.length * pct) / 100);
  size = Math.min(mixed.length, Math.max(2, size));
  const test = mixed.slice(0, size);
  return {
    a: test.filter((_, i) => i % 2 === 0),
    b: test.filter((_, i) => i % 2 === 1),
    rest: mixed.slice(size),
  };
}

const rate = (n: number, d: number) => (d ? n / d : 0);

/**
 * Winner by the chosen metric's rate; ties fall back to the other metric, then to A
 * (the original subject), so an inconclusive test never changes what you wrote.
 */
export function pickWinner(results: VariantResult[], metric: AbMetric): Variant {
  const get = (v: Variant) => results.find((r) => r.variant === v) ?? { variant: v, tracked: 0, opened: 0, clicked: 0 };
  const a = get('A');
  const b = get('B');
  const primary = (r: VariantResult) => rate(metric === 'opens' ? r.opened : r.clicked, r.tracked);
  const secondary = (r: VariantResult) => rate(metric === 'opens' ? r.clicked : r.opened, r.tracked);
  if (primary(b) !== primary(a)) return primary(b) > primary(a) ? 'B' : 'A';
  if (secondary(b) !== secondary(a)) return secondary(b) > secondary(a) ? 'B' : 'A';
  return 'A';
}

/** Validate and normalise a config from the API. Returns an error message or the clean config. */
export function normaliseAbTest(raw: any): { error: string } | { config: AbTestConfig } {
  const subjectB = String(raw?.subjectB ?? '').trim();
  if (!subjectB) return { error: 'Variant B needs a subject line' };
  if (subjectB.length > 255) return { error: 'Variant B subject is too long' };
  const testPercent = Math.round(Number(raw?.testPercent ?? 20));
  if (!(testPercent >= AB_LIMITS.minPercent && testPercent <= AB_LIMITS.maxPercent)) {
    return { error: `Test group must be ${AB_LIMITS.minPercent}–${AB_LIMITS.maxPercent}% of the audience` };
  }
  const waitMinutes = Math.round(Number(raw?.waitMinutes ?? 240));
  if (!(waitMinutes >= AB_LIMITS.minWait && waitMinutes <= AB_LIMITS.maxWait)) {
    return { error: 'Wait time must be between 15 minutes and 7 days' };
  }
  const metric: AbMetric = raw?.metric === 'clicks' ? 'clicks' : 'opens';
  return { config: { subjectB, testPercent, metric, waitMinutes } };
}
