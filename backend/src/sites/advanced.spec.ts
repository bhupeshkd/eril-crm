import { describe, expect, it } from 'vitest';
import { sanitizePages } from './sanitize';
import { signPayload } from '../developer/sign';
import { parseEmailDraft } from '../ai/parse';
import { isPrivateAddress } from '../automation/webhook';

describe('sanitizePages', () => {
  const page = (blocks: any[], path = '') => ({ title: 'P', path, blocks });

  it('drops unsafe links but keeps safe ones', () => {
    const [p] = sanitizePages([
      page([{ type: 'hero', props: { heading: 'Hi', buttonLink: 'javascript:alert(1)', image: 'data:text/html,x', secondLink: 'next' } }]),
    ]);
    expect(p.blocks[0].props).toEqual({ heading: 'Hi', secondLink: 'next' });
    const [q] = sanitizePages([page([{ type: 'cta', props: { buttonLink: 'https://example.com', imageUrl: '/a.png' } }])]);
    expect(q.blocks[0].props).toEqual({ buttonLink: 'https://example.com', imageUrl: '/a.png' });
  });

  it('rejects unknown block types, bad paths and duplicates', () => {
    expect(() => sanitizePages([page([{ type: 'script', props: {} }])])).toThrow(/unknown type/);
    expect(() => sanitizePages([page([], 'Bad Path')])).toThrow(/path/);
    expect(() => sanitizePages([page([]), page([])])).toThrow(/Duplicate/);
    expect(() => sanitizePages([])).toThrow(/at least one page/);
  });

  it('sanitises nested arrays', () => {
    const [p] = sanitizePages([page([{ type: 'features', props: { items: [{ title: 'A', link: 'vbscript:x' }] } }])]);
    expect(p.blocks[0].props.items).toEqual([{ title: 'A' }]);
  });
});

describe('signPayload', () => {
  it('is deterministic and secret-dependent', () => {
    expect(signPayload('s1', '100', '{}')).toBe(signPayload('s1', '100', '{}'));
    expect(signPayload('s1', '100', '{}')).not.toBe(signPayload('s2', '100', '{}'));
    expect(signPayload('s1', '100', '{}')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseEmailDraft', () => {
  it('splits subject and body', () => {
    expect(parseEmailDraft('Subject: Hello there\n\nHi Ann,\nThanks!')).toEqual({ subject: 'Hello there', body: 'Hi Ann,\nThanks!' });
  });
  it('falls back to body only', () => {
    expect(parseEmailDraft('Hi Ann')).toEqual({ subject: '', body: 'Hi Ann' });
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['::1', true],
    ['::ffff:10.0.0.1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
  ])('%s → %s', (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));
});
