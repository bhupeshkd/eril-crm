import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT, fillMessage, fmtMoney } from './pay-message';

const v = { name: 'Rosa', amount: '$120.00', description: 'Deep clean', link: 'https://app.example/invoice/abc' };

describe('fmtMoney', () => {
  it('formats by currency and survives unknown codes', () => {
    expect(fmtMoney(120, 'USD')).toBe('$120.00');
    expect(fmtMoney(99.5, 'EUR')).toBe('€99.50');
    expect(fmtMoney(5, 'ZZ')).toBe('ZZ 5.00');
  });
});

describe('fillMessage', () => {
  it('uses the default template', () => {
    expect(fillMessage(undefined, v)).toBe('Hi Rosa, here is your secure payment link for Deep clean ($120.00): https://app.example/invoice/abc');
  });
  it('fills a custom template', () => {
    expect(fillMessage('{{name}}, pay {{ amount }} here {{link}} thanks', v)).toBe('Rosa, pay $120.00 here https://app.example/invoice/abc thanks');
  });
  it('always includes the link exactly once', () => {
    expect(fillMessage('Please pay today', v)).toBe('Please pay today https://app.example/invoice/abc');
    expect(fillMessage('{{link}} and again {{link}}', v).match(/invoice\/abc/g)).toHaveLength(1);
  });
  it('caps long templates but keeps the link', () => {
    const out = fillMessage('x'.repeat(1000), v);
    expect(out.length).toBeLessThan(400);
    expect(out.endsWith(v.link)).toBe(true);
  });
  it('receipt template', () => {
    expect(fillMessage(DEFAULT_RECEIPT, v)).toContain('We received your payment of $120.00 for Deep clean');
  });
});
