import { describe, expect, it } from 'vitest';
import { captionFor, overallStatus, validatePost } from './social-rules';

describe('validatePost', () => {
  it('accepts a normal Facebook post', () => {
    expect(validatePost({ body: 'Open house Saturday!', link: 'https://bloom.example/open' }, ['facebook'])).toEqual([]);
  });
  it('requires content, accounts and safe links', () => {
    expect(validatePost({ body: '  ' }, ['facebook'])).toContain('Write something or add an image');
    expect(validatePost({ body: 'x' }, [])).toContain('Pick at least one page or account');
    expect(validatePost({ body: 'x', link: 'javascript:alert(1)' }, ['facebook'])).toContain('Link must start with http:// or https://');
    expect(validatePost({ body: 'x', imageUrl: 'http://insecure/a.jpg' }, ['facebook'])).toContain('Image must be an https:// link');
  });
  it('Instagram needs an image and a short caption', () => {
    expect(validatePost({ body: 'hi' }, ['instagram'])).toContain('Instagram posts need an image');
    expect(validatePost({ body: 'x'.repeat(2201), imageUrl: 'https://img.example/a.jpg' }, ['instagram'])).toContain('Instagram captions can be up to 2,200 characters');
    expect(validatePost({ body: 'Nice', imageUrl: 'https://img.example/a.jpg' }, ['instagram', 'facebook'])).toEqual([]);
  });
});

describe('overallStatus', () => {
  it('summarises targets', () => {
    expect(overallStatus([{ status: 'published' }, { status: 'published' }])).toBe('published');
    expect(overallStatus([{ status: 'published' }, { status: 'failed' }])).toBe('partial');
    expect(overallStatus([{ status: 'failed' }])).toBe('failed');
    expect(overallStatus([{ status: 'published' }, { status: 'pending' }])).toBe('publishing');
    expect(overallStatus([])).toBe('failed');
  });
});

describe('captionFor', () => {
  it('adds the link to Instagram captions only', () => {
    expect(captionFor('instagram', 'New mugs!', 'https://bloom.example/shop')).toBe('New mugs!\n\nhttps://bloom.example/shop');
    expect(captionFor('facebook', 'New mugs!', 'https://bloom.example/shop')).toBe('New mugs!');
  });
});
