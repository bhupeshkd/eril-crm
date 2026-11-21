/** Pure helpers for text-to-pay messages (no entity imports, so Vitest can load them). */

export const MESSAGE_MAX = 320;

export function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export const DEFAULT_REQUEST = 'Hi {{name}}, here is your secure payment link for {{description}} ({{amount}}): {{link}}';
export const DEFAULT_RECEIPT = 'Thanks {{name}}! We received your payment of {{amount}} for {{description}}. Receipt: {{link}}';

/**
 * Fills {{name}}, {{amount}}, {{description}} and {{link}}. The link is always included exactly once
 * (appended if the template forgot it), so a custom message can never go out without a way to pay.
 */
export function fillMessage(template: string | undefined, v: { name: string; amount: string; description: string; link: string }) {
  let t = String(template ?? '').trim().slice(0, MESSAGE_MAX) || DEFAULT_REQUEST;
  const hasLink = /\{\{\s*link\s*\}\}/i.test(t);
  t = t
    .replace(/\{\{\s*name\s*\}\}/gi, v.name)
    .replace(/\{\{\s*amount\s*\}\}/gi, v.amount)
    .replace(/\{\{\s*description\s*\}\}/gi, v.description);
  // Replace only the first {{link}} and drop any extras.
  let used = false;
  t = t.replace(/\{\{\s*link\s*\}\}/gi, () => (used ? '' : ((used = true), v.link)));
  return hasLink ? t.replace(/[ \t]{2,}/g, ' ').trim() : `${t} ${v.link}`;
}
