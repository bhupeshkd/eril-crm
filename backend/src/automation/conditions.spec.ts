import { describe, expect, it } from 'vitest';
import { evaluateCondition, interpolate, matchesTrigger } from './conditions';

const ctx = {
  contact: { firstName: 'Ada', lastName: 'Lovelace', status: 'lead', tags: ['vip', 'newsletter'], score: 42, email: '' },
  opportunity: { value: 1500 },
};

describe('interpolate', () => {
  it('replaces placeholders and blanks unknown paths', () => {
    expect(interpolate('Hi {{contact.firstName}} {{ contact.lastName }}{{nope.x}}!', ctx)).toBe('Hi Ada Lovelace!');
  });
  it('joins arrays', () => {
    expect(interpolate('{{contact.tags}}', ctx)).toBe('vip, newsletter');
  });
});

describe('evaluateCondition', () => {
  it.each([
    ['contact.status', 'equals', 'LEAD', true],
    ['contact.status', 'not_equals', 'customer', true],
    ['contact.tags', 'contains', 'VIP', true],
    ['contact.tags', 'not_contains', 'vip', false],
    ['contact.lastName', 'contains', 'love', true],
    ['opportunity.value', 'gt', '1000', true],
    ['opportunity.value', 'lt', 1000, false],
    ['opportunity.value', 'equals', '1500', true],
    ['contact.email', 'exists', undefined, false],
    ['contact.phone', 'not_exists', undefined, true],
  ])('%s %s %s → %s', (field, operator, value, expected) => {
    expect(evaluateCondition(ctx, { field, operator: operator as any, value })).toBe(expected);
  });
});

describe('matchesTrigger', () => {
  it('passes with no filter', () => expect(matchesTrigger({}, {})).toBe(true));
  it('filters by tag', () => {
    expect(matchesTrigger({ tag: 'vip' }, { tag: 'VIP' })).toBe(true);
    expect(matchesTrigger({ tag: 'vip' }, { tag: 'other' })).toBe(false);
  });
  it('filters by stage', () => {
    expect(matchesTrigger({ stageId: 's1' }, { toStage: { id: 's1' } })).toBe(true);
    expect(matchesTrigger({ stageId: 's1' }, { toStage: { id: 's2' } })).toBe(false);
  });
});
