import { describe, expect, it } from 'vitest';
import { channelOf, cleanAttribution, cleanTouch } from './attribution';

describe('cleanTouch', () => {
  it('drops junk and unknown keys', () => {
    expect(cleanTouch(null)).toBeNull();
    expect(cleanTouch('x')).toBeNull();
    expect(cleanTouch({ evil: 'x' })).toBeNull();
  });
  it('keeps known fields, lower-cases source/medium, trims and caps length', () => {
    const t = cleanTouch({ source: ' Google ', medium: 'CPC', campaign: 'Spring Sale', term: 'x'.repeat(500) })!;
    expect(t.source).toBe('google');
    expect(t.medium).toBe('cpc');
    expect(t.campaign).toBe('Spring Sale');
    expect(t.term).toHaveLength(120);
    expect(t.capturedAt).toMatch(/^\d{4}-/);
  });
  it('only keeps http(s) URLs', () => {
    expect(cleanTouch({ referrer: 'javascript:alert(1)', source: 'a' })!.referrer).toBeUndefined();
    expect(cleanTouch({ landingPage: 'https://ex.com/p?a=1' })!.landingPage).toBe('https://ex.com/p?a=1');
  });
  it('does not accept a capture time in the future', () => {
    const t = cleanTouch({ source: 'a', capturedAt: '2999-01-01T00:00:00Z' })!;
    expect(new Date(t.capturedAt!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('cleanAttribution', () => {
  it('fills a missing first or last from the other', () => {
    const a = cleanAttribution({ last: { source: 'fb' } });
    expect(a.first?.source).toBe('fb');
    expect(a.last?.source).toBe('fb');
    expect(cleanAttribution({}).first).toBeNull();
  });
});

describe('channelOf', () => {
  it.each([
    [null, 'Not tracked'],
    [{ gclid: 'abc' }, 'Google Ads'],
    [{ fbclid: 'x', medium: 'paid' }, 'Meta Ads'],
    [{ fbclid: 'x' }, 'Organic social'],
    [{ msclkid: 'x' }, 'Microsoft Ads'],
    [{ source: 'linkedin', medium: 'cpc' }, 'Paid: linkedin'],
    [{ source: 'mailchimp', medium: 'email' }, 'Email'],
    [{ source: 'instagram', medium: 'social' }, 'Social: instagram'],
    [{ source: 'partner' }, 'Campaign: partner'],
    [{ referrer: 'https://www.google.com/search?q=x' }, 'Organic search'],
    [{ referrer: 'https://l.facebook.com/' }, 'Organic social'],
    [{ referrer: 'https://blog.example.com/post' }, 'Referral: blog.example.com'],
    [{ landingPage: 'https://app/f/x' }, 'Direct'],
  ])('%j → %s', (touch, expected) => {
    expect(channelOf(touch as any)).toBe(expected);
  });
});
