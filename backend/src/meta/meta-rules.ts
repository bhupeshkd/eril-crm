/** Pure helpers for Facebook Messenger / Instagram DM webhooks (no entity imports, so Vitest can load them). */
import { createHmac, timingSafeEqual } from 'crypto';

export type MetaPlatform = 'facebook' | 'instagram';

/** X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256(app secret, exact raw request body). */
export function metaSignature(appSecret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function validMetaSignature(appSecret: string, rawBody: Buffer | string | undefined, header: string | undefined): boolean {
  if (!rawBody || !header) return false;
  const want = Buffer.from(metaSignature(appSecret, rawBody));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface MetaMessage {
  platform: MetaPlatform;
  /** Page id (Messenger) or Instagram account id the message was sent to. */
  pageId: string;
  /** Page-scoped id of the person. */
  senderId: string;
  mid: string;
  text: string;
  attachments: string[];
  timestamp: number;
}

/**
 * Pulls customer messages out of a webhook payload. Echoes (our own sends), reads, deliveries and reactions are skipped.
 * Messenger uses object "page"; Instagram uses object "instagram".
 */
export function parseWebhook(payload: any): MetaMessage[] {
  const platform: MetaPlatform | null = payload?.object === 'page' ? 'facebook' : payload?.object === 'instagram' ? 'instagram' : null;
  if (!platform || !Array.isArray(payload.entry)) return [];
  const out: MetaMessage[] = [];
  for (const entry of payload.entry.slice(0, 100)) {
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging.slice(0, 100) : []) {
      const m = ev?.message;
      if (!m || m.is_echo || !m.mid || !ev.sender?.id) continue;
      const attachments = (Array.isArray(m.attachments) ? m.attachments : [])
        .map((a: any) => String(a?.payload?.url ?? ''))
        .filter((u: string) => /^https:\/\/[^\s"'<>]+$/.test(u))
        .slice(0, 5)
        .map((u: string) => u.slice(0, 1000));
      const text = typeof m.text === 'string' ? m.text.slice(0, 5000) : '';
      if (!text && !attachments.length) continue;
      out.push({
        platform,
        pageId: String(entry.id ?? ev.recipient?.id ?? ''),
        senderId: String(ev.sender.id),
        mid: String(m.mid).slice(0, 255),
        text,
        attachments,
        timestamp: Number(ev.timestamp) || Date.now(),
      });
    }
  }
  return out;
}

/** Meta's standard messaging window: free-form replies only within 24 hours of the person's last message. */
export const META_WINDOW_MS = 24 * 3_600_000;

/** Page/account ids are numeric strings. */
export const isMetaId = (s: unknown) => typeof s === 'string' && /^\d{5,25}$/.test(s);
