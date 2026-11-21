import { describe, expect, it } from 'vitest';
import { renderEmail } from '@eril/shared';
import { digestDesign, digestSince, effectiveFrequency, excerpt, isDue, neutralize, rankPosts } from './digest';

const at = (iso: string) => new Date(iso);
const H = 3_600_000;

describe('effectiveFrequency', () => {
  it('community off wins; otherwise member choice or community default', () => {
    expect(effectiveFrequency('daily', 'off')).toBe('off');
    expect(effectiveFrequency('community', 'weekly')).toBe('weekly');
    expect(effectiveFrequency('off', 'weekly')).toBe('off');
    expect(effectiveFrequency('daily', 'weekly')).toBe('daily');
  });
});

describe('isDue', () => {
  const base = { hour: 9, weekday: 1, timezone: 'Asia/Kolkata', lastDigestAt: null };
  it('uses the community timezone and a 3-hour window', () => {
    // 09:30 IST = 04:00 UTC on Monday 2026-11-16
    expect(isDue(at('2026-11-16T04:00:00Z'), { ...base, frequency: 'daily' })).toBe(true);
    expect(isDue(at('2026-11-16T03:00:00Z'), { ...base, frequency: 'daily' })).toBe(false); // 08:30 IST
    expect(isDue(at('2026-11-16T07:00:00Z'), { ...base, frequency: 'daily' })).toBe(false); // 12:30 IST, window closed
  });
  it('daily at most once per day, weekly only on the weekday and 6+ days apart', () => {
    const now = at('2026-11-16T04:00:00Z');
    expect(isDue(now, { ...base, frequency: 'daily', lastDigestAt: new Date(now.getTime() - 2 * H) })).toBe(false);
    expect(isDue(now, { ...base, frequency: 'daily', lastDigestAt: new Date(now.getTime() - 23 * H) })).toBe(true);
    expect(isDue(now, { ...base, frequency: 'weekly' })).toBe(true);
    expect(isDue(at('2026-11-17T04:00:00Z'), { ...base, frequency: 'weekly' })).toBe(false); // Tuesday
    expect(isDue(now, { ...base, frequency: 'weekly', lastDigestAt: new Date(now.getTime() - 3 * 24 * H) })).toBe(false);
    expect(isDue(now, { ...base, frequency: 'off' })).toBe(false);
  });
});

describe('digestSince', () => {
  const now = at('2026-11-16T04:00:00Z');
  it('takes the latest of joined, last digest, last visit, and one period back', () => {
    expect(digestSince(now, 'weekly', at('2026-01-01T00:00:00Z'), null, null).toISOString()).toBe('2026-11-09T04:00:00.000Z');
    expect(digestSince(now, 'weekly', at('2026-11-15T00:00:00Z'), null, null).toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(digestSince(now, 'daily', at('2026-01-01T00:00:00Z'), at('2026-11-15T10:00:00Z'), at('2026-11-15T20:00:00Z')).toISOString()).toBe('2026-11-15T20:00:00.000Z');
  });
});

describe('content', () => {
  it('ranks pinned, then engagement, then recency', () => {
    const p = (k: string, o: Partial<{ likeCount: number; commentCount: number; pinned: boolean; createdAt: Date }>) => ({ author: k, channel: 'g', body: k, likeCount: 0, commentCount: 0, pinned: false, createdAt: at('2026-11-10T00:00:00Z'), ...o });
    const out = rankPosts([p('old', {}), p('liked', { likeCount: 3 }), p('talked', { commentCount: 2 }), p('pin', { pinned: true }), p('new', { createdAt: at('2026-11-12T00:00:00Z') })], 4);
    expect(out.map((x) => x.author)).toEqual(['pin', 'talked', 'liked', 'new']);
  });
  it('excerpts long text', () => {
    expect(excerpt('a  b\n\nc')).toBe('a b c');
    expect(excerpt('x'.repeat(300), 10)).toBe('xxxxxxxxx…');
  });
  it('member text cannot inject links or bold into the email', () => {
    const design = digestDesign({
      communityName: 'Club',
      memberName: 'Rosa',
      frequency: 'weekly',
      posts: [{ author: '**Admin**', channel: 'general', body: 'Claim your prize [here](https://evil.example) <script>x</script>', likeCount: 1, commentCount: 0, pinned: false, createdAt: new Date() }],
      totalPosts: 1,
      totalComments: 0,
      portalUrl: 'https://app.example/community/tok',
      settingsUrl: 'https://app.example/community/tok?digest=settings',
    });
    const { html, text, subject } = renderEmail(design);
    expect(html).not.toContain('evil.example"');
    expect(html).not.toContain('<strong>Admin</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://app.example/community/tok?digest=settings"');
    expect(text).toContain('Claim your prize');
    expect(subject).toBe('1 new post in Club');
    expect(neutralize('[a](b) **c**')).not.toMatch(/\]\(|\*\*/);
  });
});
