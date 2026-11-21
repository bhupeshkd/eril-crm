import { describe, expect, it } from 'vitest';
import { keywordAction, mapStatus, mediaLines, parseAddress, shouldUpdate, whatsappWindowOpen } from './messaging-rules';

describe('keywords', () => {
  it('recognises opt-out, opt-in and help words only as the whole message', () => {
    expect(keywordAction('STOP')).toBe('stop');
    expect(keywordAction(' unsubscribe. ')).toBe('stop');
    expect(keywordAction('Stop!')).toBe('stop');
    expect(keywordAction('start')).toBe('start');
    expect(keywordAction('HELP')).toBe('help');
    expect(keywordAction('please stop calling me')).toBeNull();
    expect(keywordAction('')).toBeNull();
  });
});

describe('addresses and windows', () => {
  it('detects WhatsApp senders', () => {
    expect(parseAddress('whatsapp:+14155550100')).toEqual({ channel: 'whatsapp', number: '+14155550100' });
    expect(parseAddress('+14155550100')).toEqual({ channel: 'sms', number: '+14155550100' });
  });
  it('24-hour WhatsApp window', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(whatsappWindowOpen(new Date('2026-11-20T12:30:00Z'), now)).toBe(true);
    expect(whatsappWindowOpen(new Date('2026-11-20T11:59:00Z'), now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
});

describe('delivery status', () => {
  it('maps Twilio statuses', () => {
    expect(mapStatus('delivered')).toBe('delivered');
    expect(mapStatus('read')).toBe('delivered');
    expect(mapStatus('undelivered')).toBe('failed');
    expect(mapStatus('queued')).toBeNull();
  });
  it('never moves backwards', () => {
    expect(shouldUpdate('sent', 'delivered')).toBe(true);
    expect(shouldUpdate('delivered', 'sent')).toBe(false);
    expect(shouldUpdate('sent', 'failed')).toBe(true);
    expect(shouldUpdate('delivered', 'failed')).toBe(false);
  });
});

describe('media', () => {
  it('keeps up to 5 https attachments', () => {
    expect(mediaLines({ NumMedia: '2', MediaUrl0: 'https://api.twilio.com/m/1', MediaUrl1: 'javascript:alert(1)' })).toEqual(['https://api.twilio.com/m/1']);
    expect(mediaLines({ NumMedia: '9', ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`MediaUrl${i}`, `https://x.io/${i}`])) })).toHaveLength(5);
  });
});
