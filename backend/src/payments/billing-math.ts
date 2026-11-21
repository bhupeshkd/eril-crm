/** Pure billing helpers (no entity imports, so they are unit-testable). */

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CouponLike {
  type: 'percent' | 'fixed';
  amount: number;
  currency: string | null;
  isActive: boolean;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redemptions: number;
  appliesTo: 'all' | 'invoices' | 'subscriptions';
}

/** Discount a coupon gives on a subtotal. Fixed discounts never exceed the subtotal. */
export function couponDiscount(c: Pick<CouponLike, 'type' | 'amount'>, subtotal: number): number {
  if (subtotal <= 0) return 0;
  if (c.type === 'percent') return round2((subtotal * Math.min(100, Math.max(0, c.amount))) / 100);
  return round2(Math.min(subtotal, Math.max(0, c.amount)));
}

/** Returns why a coupon can't be used, or null when it can. */
export function couponProblem(c: CouponLike, use: 'invoices' | 'subscriptions', currency: string, now = new Date()): string | null {
  if (!c.isActive) return 'This coupon is no longer active';
  if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) return 'This coupon has expired';
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return 'This coupon has reached its usage limit';
  if (c.appliesTo !== 'all' && c.appliesTo !== use) return `This coupon only applies to ${c.appliesTo}`;
  if (c.type === 'fixed' && c.currency && c.currency.toUpperCase() !== currency.toUpperCase()) return `This coupon is for ${c.currency} payments`;
  return null;
}

/**
 * Adds one billing interval, clamping to month end (Jan 31 + 1 month = Feb 28/29),
 * and anchoring to the original day of month so Jan 31 → Feb 28 → Mar 31.
 */
export function addInterval(from: Date, interval: 'month' | 'year', anchorDay = from.getUTCDate()): Date {
  const y = from.getUTCFullYear() + (interval === 'year' ? 1 : 0);
  const m = from.getUTCMonth() + (interval === 'month' ? 1 : 0);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds()));
}

/** Monthly recurring revenue contribution of one subscription. */
export function monthlyValue(price: number, quantity: number, interval: 'month' | 'year') {
  const cycle = price * quantity;
  return round2(interval === 'year' ? cycle / 12 : cycle);
}
