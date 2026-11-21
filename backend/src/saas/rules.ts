/** Pure rules for SaaS mode and rebilling (no entity imports, so Vitest can load them). */

/** Feature areas an agency can include in a plan. Core CRM (contacts, conversations, pipeline, tasks) is always on. */
export const SAAS_FEATURES = [
  { key: 'calendars', label: 'Calendars & booking' },
  { key: 'marketing', label: 'Email & SMS campaigns' },
  { key: 'automation', label: 'Workflows & automation' },
  { key: 'forms', label: 'Forms & surveys' },
  { key: 'sites', label: 'Sites & funnels' },
  { key: 'payments', label: 'Payments & invoices' },
  { key: 'memberships', label: 'Courses & communities' },
  { key: 'reputation', label: 'Reputation' },
  { key: 'reporting', label: 'Reporting' },
  { key: 'ai', label: 'AI assistant' },
] as const;
export type SaasFeature = (typeof SAAS_FEATURES)[number]['key'];
export const ALL_FEATURES = SAAS_FEATURES.map((f) => f.key) as SaasFeature[];

/** Permission prefix → feature. Permissions not listed here (contacts, conversations, …) are core and always allowed. */
const PERMISSION_FEATURE: Record<string, SaasFeature> = {
  calendars: 'calendars',
  appointments: 'calendars',
  campaigns: 'marketing',
  workflows: 'automation',
  forms: 'forms',
  websites: 'sites',
  funnels: 'sites',
  payments: 'payments',
  invoices: 'payments',
  courses: 'memberships',
  analytics: 'reporting',
  ai: 'ai',
};

/** Features a route needs, from its required permissions. */
export function featuresFor(permissions: string[] | undefined): SaasFeature[] {
  const out = new Set<SaasFeature>();
  for (const p of permissions ?? []) {
    const f = PERMISSION_FEATURE[p.split(':')[0]];
    if (f) out.add(f);
  }
  return [...out];
}

export function featureLabel(key: string) {
  return SAAS_FEATURES.find((f) => f.key === key)?.label ?? key;
}

export type SaasStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';

/**
 * Account standing from its subscription. Past-due accounts keep working for `graceDays`
 * after the oldest unpaid invoice fell due, then become suspended (read-only). Canceled is read-only too.
 */
export function standing(subStatus: string | null | undefined, oldestOverdueDays: number | null, graceDays: number): SaasStatus {
  if (!subStatus || subStatus === 'canceled') return 'canceled';
  if (subStatus === 'trialing') return 'trialing';
  if (subStatus === 'past_due') return oldestOverdueDays !== null && oldestOverdueDays > graceDays ? 'suspended' : 'past_due';
  return 'active';
}

/** Read-only states: viewing is allowed, changes are not. */
export const isLocked = (s: SaasStatus) => s === 'suspended' || s === 'canceled';

export interface UsageCounts {
  emails: number;
  sms: number;
}
export interface UsagePricing {
  /** Agency's resell price per message beyond the plan's allowance. */
  emailPrice: number;
  smsPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Overage invoice lines for a period; empty when nothing is owed. */
export function overageLines(used: UsageCounts, included: UsageCounts, pricing: UsagePricing) {
  const lines: Array<{ name: string; quantity: number; unitPrice: number; amount: number }> = [];
  const add = (label: string, usedN: number, inc: number, price: number) => {
    const over = Math.max(0, usedN - Math.max(0, inc));
    if (over > 0 && price > 0) lines.push({ name: `${label} beyond plan (${usedN.toLocaleString('en-US')} used, ${inc.toLocaleString('en-US')} included)`, quantity: over, unitPrice: price, amount: round2(over * price) });
  };
  add('Emails', used.emails, included.emails, pricing.emailPrice);
  add('SMS', used.sms, included.sms, pricing.smsPrice);
  return lines;
}

/** 'YYYY-MM' for a date (UTC), and the period boundaries. */
export function periodOf(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function periodRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}
export function previousPeriod(d: Date) {
  return periodOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
}
export const isPeriod = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
