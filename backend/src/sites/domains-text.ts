/** Pure helpers for custom domains (no entity imports, so Vitest can load them). */

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Cleans what someone typed ("https://WWW.Shop.com/path") into a hostname ("www.shop.com"), or explains why it can't be used.
 * Rejects IPs, single-label names, localhost, wildcards and the app's own hosts.
 */
export function normalizeHostname(input: string, reserved: string[] = []): { host: string } | { error: string } {
  let h = String(input ?? '').trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h) return { error: 'Enter a domain like www.example.com' };
  if (h.includes('*')) return { error: "Wildcard domains aren't supported — add each name separately" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return { error: 'Use a domain name, not an IP address' };
  if (h.length > 253) return { error: 'That domain is too long' };
  const labels = h.split('.');
  if (labels.length < 2) return { error: 'Use a full domain like www.example.com' };
  if (!labels.every((l) => LABEL.test(l))) return { error: 'Domains can only use letters, numbers, dashes and dots' };
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return { error: 'Use a domain name, not an IP address' };
  if (h === 'localhost' || h.endsWith('.localhost')) return { error: "localhost can't be connected" };
  if (reserved.some((r) => h === r || h.endsWith(`.${r}`))) return { error: "That domain belongs to the app itself and can't be connected" };
  return { host: h };
}

/** Where the ownership TXT record goes. */
export const txtName = (host: string) => `_eril-verify.${host}`;
export const txtValue = (token: string) => `eril-verify=${token}`;

/** TXT answers arrive as arrays of chunks; long values are split, so join each record's chunks. */
export function hasToken(records: string[][], token: string): boolean {
  return records.some((chunks) => chunks.join('').trim() === txtValue(token));
}

/** Whether the domain already points at our sites endpoint (informational: apex domains often use A/ALIAS instead). */
export function cnameStatus(cnames: string[], target: string): 'ok' | 'missing' | 'other' {
  if (!cnames.length) return 'missing';
  const t = target.toLowerCase().replace(/\.$/, '');
  return cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === t) ? 'ok' : 'other';
}
