import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, cleanLayout } from './layout-rules';

describe('cleanLayout', () => {
  it('accepts the default layout unchanged', () => {
    expect(cleanLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });
  it('fixes bad sizes and tints instead of failing', () => {
    expect(cleanLayout([{ id: 'a', type: 'won', size: 'huge', tint: 'neon' }])).toEqual([{ id: 'a', type: 'won', size: 'm', tint: 'none' }]);
  });
  it('rejects unknown widgets, duplicate ids and repeated single widgets', () => {
    expect(typeof cleanLayout([{ id: 'a', type: 'stocks' }])).toBe('string');
    expect(typeof cleanLayout([{ id: 'a', type: 'note' }, { id: 'a', type: 'note' }])).toBe('string');
    expect(typeof cleanLayout([{ id: 'a', type: 'won' }, { id: 'b', type: 'won' }])).toBe('string');
    expect(typeof cleanLayout([{ id: 'bad id!', type: 'won' }])).toBe('string');
    expect(typeof cleanLayout('x')).toBe('string');
    expect(typeof cleanLayout(Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, type: 'note' })))).toBe('string');
  });
  it('allows several notes and shortcuts, keeping only safe config', () => {
    const r = cleanLayout([
      { id: 'n1', type: 'note', config: { text: 'x'.repeat(3000), evil: '<script>' } },
      { id: 'n2', type: 'note' },
      { id: 's1', type: 'shortcuts', config: { links: ['/pipeline', 'https://evil.example', '/pipeline', 'javascript:alert(1)', '/contacts'] } },
    ]);
    expect(Array.isArray(r)).toBe(true);
    const [n1, n2, s1] = r as any[];
    expect(n1.config).toEqual({ text: 'x'.repeat(2000) });
    expect(n2.config).toEqual({ text: '' });
    expect(s1.config).toEqual({ links: ['/pipeline', '/contacts'] });
  });
});
