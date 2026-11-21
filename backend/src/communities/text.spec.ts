import { describe, expect, it } from 'vitest';
import { cleanBody, cleanDisplayName, defaultDisplayName, resolveMentions } from './text';

describe('cleanBody', () => {
  it('trims, normalises newlines and collapses blank runs', () => {
    expect(cleanBody('  hi\r\n\r\n\r\n\r\nthere  ', 100)).toBe('hi\n\nthere');
  });
  it('removes control and bidi-override characters but keeps text', () => {
    expect(cleanBody('a\u0000b‮c​d\te', 100)).toBe('abcd\te');
  });
  it('enforces the limit and tolerates junk input', () => {
    expect(cleanBody('x'.repeat(50), 10)).toHaveLength(10);
    expect(cleanBody(null, 10)).toBe('');
    expect(cleanBody({ a: 1 }, 100)).toBe('[object Object]');
  });
});

describe('display names', () => {
  it('uses first name and last initial', () => {
    expect(defaultDisplayName('Rosa', 'diaz')).toBe('Rosa D.');
    expect(defaultDisplayName('Rosa Maria', '')).toBe('Rosa');
    expect(defaultDisplayName('', 'Diaz')).toBe('Diaz');
    expect(defaultDisplayName(null, null)).toBe('Member');
  });
  it('cleans custom names', () => {
    expect(cleanDisplayName('  Big\n\n  Al  ')).toBe('Big Al');
  });
});


describe('resolveMentions', () => {
  const people = [
    { id: 'a', displayName: 'Rosa D.' },
    { id: 'b', displayName: 'Sam' },
    { id: 'c', displayName: 'Al' },
  ];
  it('keeps only names that appear as @mentions', () => {
    expect(resolveMentions('Thanks @Rosa D. and @sam!', people).map((m) => m.memberId)).toEqual(['a', 'b']);
  });
  it('ignores partial names, emails and missing mentions', () => {
    expect(resolveMentions('mail me at x@Sam.com or @Alice', people)).toEqual([]);
    expect(resolveMentions('@Sammy hi', people)).toEqual([]);
    expect(resolveMentions('no mentions', people)).toEqual([]);
  });
  it('dedupes and caps', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, displayName: `User${i}` }));
    const body = many.map((m) => `@${m.displayName}`).join(' ');
    expect(resolveMentions(body, [...many, many[0]])).toHaveLength(10);
  });
  it('treats regex characters in names literally', () => {
    expect(resolveMentions('hey @A.B', [{ id: 'x', displayName: 'A.B' }, { id: 'y', displayName: 'A+B' }]).map((m) => m.memberId)).toEqual(['x']);
  });
});
