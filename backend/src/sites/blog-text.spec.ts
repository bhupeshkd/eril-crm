import { describe, expect, it } from 'vitest';
import { cleanTags, deviceOf, escapeXml, excerptOf, isSafeUrl, plainText, postSlug, readMinutes, rssXml, withUtm } from './blog-text';
import { encodeQr, qrSvg, reedSolomon } from '../qr/encoder';

describe('blog text', () => {
  it('slugs titles', () => {
    expect(postSlug('Hello, World! 10 Tips')).toBe('hello-world-10-tips');
    expect(postSlug('Crème Brûlée — the guide')).toBe('creme-brulee-the-guide');
    expect(postSlug('!!!')).toBe('post');
    expect(postSlug('a'.repeat(150)).length).toBe(100);
  });
  it('turns markdown into plain text', () => {
    expect(plainText('# Title\n\nSome **bold** and _it_ with a [link](https://x.io) ![img](https://x.io/a.png)\n- item\n> quote')).toBe('Title Some bold and it with a link item quote');
  });
  it('reading time and excerpts', () => {
    expect(readMinutes('word '.repeat(450))).toBe(2);
    expect(readMinutes('hi')).toBe(1);
    const ex = excerptOf('The quick brown fox jumps over the lazy dog. '.repeat(10), 60);
    expect(ex.endsWith('…') && ex.length <= 61).toBe(true);
    expect(excerptOf('Short one.')).toBe('Short one.');
  });
  it('builds a valid, escaped RSS feed', () => {
    const xml = rssXml({ title: 'Tips & <Tricks>', url: 'https://s/blog', description: 'd', items: [{ title: 'A "quote"', url: 'https://s/blog/a', excerpt: 'x < y', publishedAt: new Date('2026-11-20T10:00:00Z'), tags: ['news'] }] });
    expect(xml).toContain('<title>Tips &amp; &lt;Tricks&gt;</title>');
    expect(xml).toContain('<title>A &quot;quote&quot;</title>');
    expect(xml).toContain('<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>');
    expect(xml).toContain('<category>news</category>');
    expect(escapeXml(`'`)).toBe('&apos;');
  });
  it('cleans tags', () => {
    expect(cleanTags([' News ', 'news', 'How  To', '', 5])).toEqual(['news', 'how to', '5']);
    expect(cleanTags('x')).toEqual([]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe('QR destinations', () => {
  it('only allows http(s) links', () => {
    expect(isSafeUrl('https://example.com/a?b=1')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,hi')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
  it('adds UTM tags without overriding existing ones', () => {
    expect(withUtm('https://x.io/p?a=1', 'Spring Flyer')).toBe('https://x.io/p?a=1&utm_source=qr&utm_medium=qr&utm_campaign=spring-flyer');
    expect(withUtm('https://x.io/?utm_source=poster', 'X')).toContain('utm_source=poster');
  });
  it('classifies devices', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(deviceOf(undefined)).toBe('other');
  });
});

describe('QR encoder', () => {
  it('matches the reference Reed–Solomon example', () => {
    expect(reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('picks the smallest version and keeps the fixed patterns', () => {
    const q = encodeQr('https://eril.app/q/AbCd1234', 'M');
    expect(q.version).toBe(3);
    expect(q.size).toBe(29);
    // Finder pattern corners are dark, separator is light, dark module is set.
    expect(q.modules[0][0] && q.modules[0][q.size - 1] && q.modules[q.size - 1][0]).toBe(true);
    expect(q.modules[7][7]).toBe(false);
    expect(q.modules[q.size - 8][8]).toBe(true);
  });
  it('rejects text that does not fit', () => {
    expect(() => encodeQr('x'.repeat(300), 'H')).toThrow(/too long/);
  });
  it('renders SVG with a quiet zone and safe colours', () => {
    const svg = qrSvg('hi', { color: '#112233', background: 'red"/><script>' });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('fill="#112233"');
    expect(svg).not.toContain('<script>');
  });
});
