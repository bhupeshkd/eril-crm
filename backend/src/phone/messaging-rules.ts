/** Pure helpers for SMS/WhatsApp messaging webhooks (no entity imports, so Vitest can load them). */

const STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'];
const START = ['START', 'UNSTOP', 'YES'];
const HELP = ['HELP', 'INFO'];

/** Carrier-standard keywords: the whole message, ignoring case, spaces and trailing punctuation. */
export function keywordAction(body: string): 'stop' | 'start' | 'help' | null {
  const k = String(body ?? '').trim().replace(/[.!?]+$/, '').toUpperCase();
  if (STOP.includes(k)) return 'stop';
  if (START.includes(k)) return 'start';
  if (HELP.includes(k)) return 'help';
  return null;
}

/** "whatsapp:+14155550100" → { channel: 'whatsapp', number: '+14155550100' }. */
export function parseAddress(addr: string | undefined): { channel: 'sms' | 'whatsapp'; number: string } {
  const a = String(addr ?? '').trim();
  return a.toLowerCase().startsWith('whatsapp:') ? { channel: 'whatsapp', number: a.slice(9) } : { channel: 'sms', number: a };
}

/** WhatsApp lets businesses send free-form messages only within 24 hours of the customer's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;
export function whatsappWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()) {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

/** Twilio message status → ours (null = not worth recording). */
export function mapStatus(s: string | undefined): 'sent' | 'delivered' | 'failed' | null {
  switch ((s ?? '').toLowerCase()) {
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'failed':
    case 'undelivered':
      return 'failed';
    default:
      return null;
  }
}

/** Statuses only move forward (a late "sent" must not undo "delivered"). */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 2 };
export function shouldUpdate(current: string, next: string) {
  return (RANK[next] ?? -1) > (RANK[current] ?? -1);
}

/** Attachments as https links appended to the text (up to 5). */
export function mediaLines(params: Record<string, string>): string[] {
  const n = Math.min(5, Math.max(0, Number(params.NumMedia) || 0));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const url = params[`MediaUrl${i}`];
    if (url && /^https:\/\/[^\s"'<>]+$/.test(url)) out.push(url.slice(0, 500));
  }
  return out;
}
