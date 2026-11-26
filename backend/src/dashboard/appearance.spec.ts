import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, UI_THEMES, applyTheme, cleanAppearance, cleanLayout, readableOn } from '@eril/shared';

describe('cleanAppearance', () => {
  it('returns the defaults for junk', () => {
    expect(cleanAppearance(null)).toEqual({ ...DEFAULT_APPEARANCE, preset: 'custom' });
    expect(cleanAppearance('x').accent).toBe(DEFAULT_APPEARANCE.accent);
  });
  it('keeps valid choices and drops unsafe ones', () => {
    const a = cleanAppearance({
      accent: '#FF0000', accentEnd: 'red;background:url(x)', font: 'Comic Sans', density: 'compact',
      backdrop: { style: 'mesh', colors: ['#112233', 'nope', '#445566'], blur: 999 },
      surface: { opacity: 0.1, radius: 100, style: 'outline' },
      sidebar: { side: 'right', color: '#000000' },
      nav: { order: ['/pipeline', '/contacts', 'javascript:x', '/pipeline'], hidden: ['/settings', '/calls'] },
      startPage: 'https://evil.example',
    });
    expect(a.accent).toBe('#ff0000');
    expect(a.accentEnd).toBeNull();
    expect(a.font).toBe('Urbanist');
    expect(a.density).toBe('compact');
    expect(a.backdrop).toMatchObject({ style: 'mesh', colors: ['#112233', '#445566'], blur: 80 });
    expect(a.surface).toMatchObject({ opacity: 0.3, radius: 32, style: 'outline' });
    expect(a.sidebar).toMatchObject({ side: 'right', color: '#000000' });
    expect(a.nav).toEqual({ order: ['/pipeline', '/contacts'], hidden: ['/calls'] });
    expect(a.startPage).toBe('/dashboard');
  });
  it('every theme produces a valid appearance and keeps the menu', () => {
    const base = cleanAppearance({ nav: { order: ['/inbox'], hidden: ['/calls'] }, startPage: '/pipeline' });
    for (const t of UI_THEMES) {
      const a = applyTheme(base, t.id);
      expect(cleanAppearance(a)).toEqual(a);
      expect(a.preset).toBe(t.id);
      expect(a.nav).toEqual(base.nav);
      expect(a.startPage).toBe('/pipeline');
    }
  });
  it('picks readable text colours', () => {
    expect(readableOn('#b6e633')).toBe('#181a18');
    expect(readableOn('#181a18')).toBe('#ffffff');
    expect(readableOn('#6366f1')).toBe('#ffffff');
  });
});

describe('widget colours', () => {
  it('keeps a custom gradient and falls back when the colour is bad', () => {
    expect(cleanLayout([{ id: 'a', type: 'won', tint: 'custom', style: { from: '#112233', to: '#445566', angle: 500 } }])).toEqual([
      { id: 'a', type: 'won', size: 'm', tint: 'custom', style: { from: '#112233', to: '#445566', angle: 360 } },
    ]);
    expect(cleanLayout([{ id: 'a', type: 'won', tint: 'custom', style: { from: 'url(x)' } }])).toEqual([{ id: 'a', type: 'won', size: 'm', tint: 'none' }]);
    expect((cleanLayout([{ id: 'a', type: 'won', title: '  My revenue  ' }]) as any)[0].title).toBe('My revenue');
  });
});
