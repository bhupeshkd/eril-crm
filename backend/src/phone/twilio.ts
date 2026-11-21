/** Pure helpers for Twilio Voice webhooks (no entity imports, so Vitest can load them). */
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST param name+value, names sorted)).
 * `url` must be exactly the public URL Twilio requested (scheme, host, path and query).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + (params[k] ?? ''), url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export const twiml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

/** Ring the business's phone; Twilio calls `action` with the result when the attempt ends. */
export interface RecordOpts {
  /** URL Twilio posts the finished recording to. */
  callback: string;
  /** Said to the caller before connecting, e.g. "This call may be recorded." */
  notice?: string;
}

export function dialTwiml(forwardTo: string, timeoutSec: number, action: string, callerId?: string, record?: RecordOpts | null) {
  const rec = record ? ` record="record-from-answer-dual" recordingStatusCallback="${esc(record.callback)}" recordingStatusCallbackMethod="POST"` : '';
  const notice = record?.notice?.trim() ? `<Say>${esc(record.notice.trim().slice(0, 200))}</Say>` : '';
  return twiml(
    notice +
      `<Dial timeout="${Math.max(5, Math.min(60, Math.round(timeoutSec)))}" action="${esc(action)}" method="POST" answerOnBridge="true"${callerId ? ` callerId="${esc(callerId)}"` : ''}${rec}>` +
      `<Number>${esc(forwardTo)}</Number></Dial>`,
  );
}

export interface MenuOption {
  digit: string;
  label: string;
  forwardTo: string;
}

/** "For Sales, press 1. For Support, press 2." */
export function menuPrompt(prompt: string, options: MenuOption[]) {
  const auto = options.map((o) => `For ${o.label}, press ${o.digit}.`).join(' ');
  return [prompt.trim(), auto].filter(Boolean).join(' ').slice(0, 1000);
}

/** Asks for one key; if nothing is pressed Twilio continues to the Redirect, which arrives without Digits. */
export function menuTwiml(prompt: string, options: MenuOption[], action: string, attempt: number) {
  const url = `${action}?attempt=${attempt}`;
  return twiml(
    `<Gather numDigits="1" timeout="6" action="${esc(url)}" method="POST"><Say>${esc(menuPrompt(prompt, options))}</Say></Gather>` +
      `<Redirect method="POST">${esc(`${url}&nokey=1`)}</Redirect>`,
  );
}

/** Validates a menu: up to 9 options, unique keys 1–9, a label and a full phone number each. */
export function cleanMenu(input: unknown): MenuOption[] | string {
  if (!Array.isArray(input)) return 'Menu options must be a list';
  if (input.length > 9) return 'A menu can have up to 9 options';
  const out: MenuOption[] = [];
  for (const o of input) {
    const digit = String(o?.digit ?? '').trim();
    if (!/^[1-9]$/.test(digit)) return 'Each option needs a key from 1 to 9';
    if (out.some((x) => x.digit === digit)) return `Key ${digit} is used twice`;
    const label = String(o?.label ?? '').trim().slice(0, 40);
    if (!label) return `Give option ${digit} a name`;
    const forwardTo = toE164(o?.forwardTo);
    if (!forwardTo) return `Option ${digit} needs a full phone number with country code`;
    out.push({ digit, label, forwardTo });
  }
  return out.sort((a, b) => a.digit.localeCompare(b.digit));
}

/** Click-to-call: once the staff member answers, connect them to the customer. */
export function bridgeTwiml(customer: string, callerId: string, action: string, record?: RecordOpts | null) {
  return dialTwiml(customer, 30, action, callerId, record ? { callback: record.callback } : null);
}

/** Greeting then a recording (or just a goodbye when voicemail is off). */
export function voicemailTwiml(greeting: string, action: string | null) {
  const say = greeting.trim() ? `<Say>${esc(greeting.trim().slice(0, 500))}</Say>` : '';
  return action ? twiml(`${say}<Record maxLength="120" playBeep="true" action="${esc(action)}" method="POST"/>`) : twiml(`${say}<Hangup/>`);
}

export const hangupTwiml = (message = '') => twiml(`${message ? `<Say>${esc(message)}</Say>` : ''}<Hangup/>`);

/** "+1 (415) 555-0100" → "+14155550100"; null when it isn't a plausible E.164 number. */
export function toE164(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  const withPlus = s.startsWith('+') ? `+${digits}` : s.startsWith('00') ? `+${digits.slice(2)}` : null;
  if (!withPlus || !/^\+[1-9]\d{7,14}$/.test(withPlus)) return null;
  return withPlus;
}

/** Fills {{first_name}} and {{business}} in the missed-call text; empty names fall back politely. */
export function textBackMessage(template: string, vars: { firstName?: string | null; business: string }) {
  return template
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.firstName?.trim() || 'there')
    .replace(/\{\{\s*business\s*\}\}/gi, vars.business)
    .trim()
    .slice(0, 480);
}

/** Final call outcome from Twilio's Dial result. */
export function outcomeOf(dialStatus: string | undefined): 'answered' | 'missed' {
  return dialStatus === 'completed' || dialStatus === 'answered' ? 'answered' : 'missed';
}
