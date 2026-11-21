import { describe, expect, it } from 'vitest';
import { bridgeTwiml, cleanMenu, dialTwiml, hangupTwiml, menuPrompt, menuTwiml, outcomeOf, textBackMessage, toE164, twilioSignature, validTwilioSignature, voicemailTwiml } from './twilio';

describe('Twilio signatures', () => {
  // Example from Twilio's webhook security documentation.
  const url = 'https://example.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212' };
  it('matches the documented example', () => {
    expect(twilioSignature('12345', url, params)).toBe('L/OH5YylLD5NRKLltdqwSvS0BnU=');
  });
  it('rejects wrong or missing signatures, other URLs and tampered params', () => {
    const sig = twilioSignature('12345', url, params);
    expect(validTwilioSignature('12345', url, params, sig)).toBe(true);
    expect(validTwilioSignature('12345', url, params, undefined)).toBe(false);
    expect(validTwilioSignature('other', url, params, sig)).toBe(false);
    expect(validTwilioSignature('12345', 'https://evil.example/myapp.php?foo=1&bar=2', params, sig)).toBe(false);
    expect(validTwilioSignature('12345', url, { ...params, From: '+19999999999' }, sig)).toBe(false);
  });
});

describe('TwiML', () => {
  it('dials with a bounded timeout and escapes values', () => {
    const x = dialTwiml('+14155550100', 200, 'https://api.x/voice/dial?a=1&b=2');
    expect(x).toContain('<Dial timeout="60" action="https://api.x/voice/dial?a=1&amp;b=2"');
    expect(x).toContain('<Number>+14155550100</Number>');
  });
  it('voicemail and hangup', () => {
    expect(voicemailTwiml('Leave <a> message', 'https://api.x/vm')).toContain('<Say>Leave &lt;a&gt; message</Say><Record maxLength="120"');
    expect(voicemailTwiml('Bye', null)).toContain('<Say>Bye</Say><Hangup/>');
    expect(hangupTwiml()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
});

describe('helpers', () => {
  it('normalizes numbers', () => {
    expect(toE164('+1 (415) 555-0100')).toBe('+14155550100');
    expect(toE164('0044 20 7946 0958')).toBe('+442079460958');
    expect(toE164('4155550100')).toBeNull(); // needs a country code
    expect(toE164('+0123')).toBeNull();
    expect(toE164('anonymous')).toBeNull();
  });
  it('fills the text-back template', () => {
    expect(textBackMessage('Hi {{first_name}}, sorry we missed your call to {{ business }}!', { firstName: 'Ana', business: 'Bloom' })).toBe('Hi Ana, sorry we missed your call to Bloom!');
    expect(textBackMessage('Hi {{first_name}}', { firstName: '', business: 'B' })).toBe('Hi there');
  });
  it('outcomes', () => {
    expect(outcomeOf('completed')).toBe('answered');
    expect(outcomeOf('no-answer')).toBe('missed');
    expect(outcomeOf('busy')).toBe('missed');
    expect(outcomeOf(undefined)).toBe('missed');
  });
});

describe('menus and recording', () => {
  const opts = [{ digit: '1', label: 'Sales', forwardTo: '+14155550101' }, { digit: '2', label: 'Support', forwardTo: '+14155550102' }];
  it('records answered calls with a notice', () => {
    const x = dialTwiml('+14155550100', 20, 'https://api.x/ds', '+14155550000', { callback: 'https://api.x/rec', notice: 'This call may be recorded.' });
    expect(x).toContain('<Say>This call may be recorded.</Say><Dial');
    expect(x).toContain('record="record-from-answer-dual" recordingStatusCallback="https://api.x/rec" recordingStatusCallbackMethod="POST"');
    expect(dialTwiml('+14155550100', 20, 'https://api.x/ds')).not.toContain('record=');
  });
  it('builds the menu prompt and Gather', () => {
    expect(menuPrompt('Thanks for calling Bloom.', opts)).toBe('Thanks for calling Bloom. For Sales, press 1. For Support, press 2.');
    const x = menuTwiml('Hi.', opts, 'https://api.x/menu', 1);
    expect(x).toContain('<Gather numDigits="1" timeout="6" action="https://api.x/menu?attempt=1" method="POST">');
    expect(x).toContain('<Redirect method="POST">https://api.x/menu?attempt=1&amp;nokey=1</Redirect>');
  });
  it('validates menus', () => {
    expect(cleanMenu([{ digit: 2, label: ' Support ', forwardTo: '+1 415 555 0102' }, { digit: '1', label: 'Sales', forwardTo: '+14155550101' }])).toEqual([
      { digit: '1', label: 'Sales', forwardTo: '+14155550101' },
      { digit: '2', label: 'Support', forwardTo: '+14155550102' },
    ]);
    expect(typeof cleanMenu([{ digit: '0', label: 'X', forwardTo: '+14155550101' }])).toBe('string');
    expect(typeof cleanMenu([{ digit: '1', label: 'A', forwardTo: '+14155550101' }, { digit: '1', label: 'B', forwardTo: '+14155550102' }])).toBe('string');
    expect(typeof cleanMenu([{ digit: '1', label: '', forwardTo: '+14155550101' }])).toBe('string');
    expect(typeof cleanMenu([{ digit: '1', label: 'A', forwardTo: '555' }])).toBe('string');
    expect(typeof cleanMenu('x')).toBe('string');
  });
  it('bridges click-to-call to the customer', () => {
    const x = bridgeTwiml('+14155550199', '+14155550000', 'https://api.x/out');
    expect(x).toContain('callerId="+14155550000"');
    expect(x).toContain('<Number>+14155550199</Number>');
  });
});
