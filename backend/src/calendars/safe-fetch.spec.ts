import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateIp, normalizeFeedUrl, safeFetchText } from './safe-fetch';

describe('isPrivateIp', () => {
  it('blocks loopback, private, link-local, metadata and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '142.250.72.14', '172.32.0.1', '2606:4700:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('normalizeFeedUrl', () => {
  it('accepts https and webcal, rejects the rest', () => {
    expect(normalizeFeedUrl('webcal://calendar.example.com/a.ics')?.toString()).toBe('https://calendar.example.com/a.ics');
    expect(normalizeFeedUrl('https://calendar.google.com/calendar/ical/x/basic.ics')).not.toBeNull();
    expect(normalizeFeedUrl('http://calendar.example.com/a.ics')).toBeNull();
    expect(normalizeFeedUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeFeedUrl('https://user:pass@calendar.example.com/a.ics')).toBeNull();
    expect(normalizeFeedUrl('not a url')).toBeNull();
  });
});

describe('safeFetchText', () => {
  it('refuses private hosts before connecting', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(/private network/);
    await expect(assertPublicHost('[::1]')).rejects.toThrow(/private network/);
    await expect(assertPublicHost('localhost')).rejects.toThrow(/private network/);
    await expect(safeFetchText('https://127.0.0.1/x.ics')).rejects.toThrow(/private network/);
    await expect(safeFetchText('http://example.com/x.ics')).rejects.toThrow(/https/);
  });
});
