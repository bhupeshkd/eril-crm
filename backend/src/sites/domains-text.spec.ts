import { describe, expect, it } from 'vitest';
import { cnameStatus, hasToken, normalizeHostname, txtName, txtValue } from './domains-text';

describe('normalizeHostname', () => {
  it('cleans pasted URLs', () => {
    expect(normalizeHostname('https://WWW.Shop.com/path?x=1')).toEqual({ host: 'www.shop.com' });
    expect(normalizeHostname(' shop.co.uk. ')).toEqual({ host: 'shop.co.uk' });
    expect(normalizeHostname('http://blog.example.com:8080')).toEqual({ host: 'blog.example.com' });
    expect(normalizeHostname('xn--caf-dma.example')).toEqual({ host: 'xn--caf-dma.example' });
  });
  it('rejects unusable names', () => {
    for (const bad of ['', 'localhost', 'app.localhost', 'shop', '10.0.0.1', '*.shop.com', 'bad_name.com', '-shop.com', 'shop-.com', '[::1]', 'a'.repeat(64) + '.com']) {
      expect('error' in normalizeHostname(bad)).toBe(true);
    }
  });
  it('protects the app’s own domains', () => {
    expect('error' in normalizeHostname('app.eril.io', ['eril.io'])).toBe(true);
    expect('error' in normalizeHostname('eril.io', ['eril.io'])).toBe(true);
    expect(normalizeHostname('noteril.io', ['eril.io'])).toEqual({ host: 'noteril.io' });
  });
});

describe('verification records', () => {
  it('names and values', () => {
    expect(txtName('www.shop.com')).toBe('_eril-verify.www.shop.com');
    expect(txtValue('abc')).toBe('eril-verify=abc');
  });
  it('matches the token, joining split TXT chunks', () => {
    expect(hasToken([['v=spf1 -all'], ['eril-verify=', 'abc123']], 'abc123')).toBe(true);
    expect(hasToken([['eril-verify=abc12']], 'abc123')).toBe(false);
    expect(hasToken([], 'abc')).toBe(false);
  });
  it('CNAME status', () => {
    expect(cnameStatus(['sites.eril.io.'], 'sites.eril.io')).toBe('ok');
    expect(cnameStatus(['shops.myshopify.com'], 'sites.eril.io')).toBe('other');
    expect(cnameStatus([], 'sites.eril.io')).toBe('missing');
  });
});
