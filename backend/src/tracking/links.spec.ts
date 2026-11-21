import { describe, expect, it } from 'vitest';
import { injectPixel, isLikelyBot, isRedirectable, rewriteLinks, signLink, verifyLink } from './links';

describe('signed click links', () => {
  it('verifies only the exact token + url', () => {
    const s = signLink('secret', 'tok', 'https://a.com/x');
    expect(verifyLink('secret', 'tok', 'https://a.com/x', s)).toBe(true);
    expect(verifyLink('secret', 'tok', 'https://evil.com', s)).toBe(false);
    expect(verifyLink('secret', 'other', 'https://a.com/x', s)).toBe(false);
    expect(verifyLink('other-secret', 'tok', 'https://a.com/x', s)).toBe(false);
    expect(verifyLink('secret', 'tok', 'https://a.com/x', '')).toBe(false);
  });
});

describe('rewriteLinks', () => {
  it('wraps http(s) links, keeps mailto/#/unsubscribe, round-trips escaping', () => {
    const html = '<a href="https://a.com/?x=1&amp;y=2">A</a> <a href="mailto:a@b.co">M</a> <a href="#">H</a> <a href="https://app/unsubscribe?c=1">U</a>';
    const r = rewriteLinks(html, (u) => `https://t/c?u=${encodeURIComponent(u)}&s=1`, (u) => u.includes('/unsubscribe'));
    expect(r.urls).toEqual(['https://a.com/?x=1&y=2']);
    expect(r.html).toContain('href="https://t/c?u=https%3A%2F%2Fa.com%2F%3Fx%3D1%26y%3D2&amp;s=1"');
    expect(r.html).toContain('href="mailto:a@b.co"');
    expect(r.html).toContain('href="https://app/unsubscribe?c=1"');
  });
});

describe('injectPixel', () => {
  it('goes before </body>', () => {
    expect(injectPixel('<html><body>x</body></html>', 'https://t/o.gif')).toMatch(/x<img src="https:\/\/t\/o\.gif"[^>]+\/><\/body>/);
  });
  it('appends when no body tag', () => expect(injectPixel('x', 'https://t/o.gif').startsWith('x<img')).toBe(true));
});

describe('guards', () => {
  it('redirects only to http(s)', () => {
    expect(isRedirectable('https://a.com')).toBe(true);
    expect(isRedirectable('javascript:alert(1)')).toBe(false);
    expect(isRedirectable('not a url')).toBe(false);
  });
  it('flags scanners', () => {
    expect(isLikelyBot('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
    expect(isLikelyBot('Barracuda Sentinel')).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
  });
});
