import { describe, expect, it } from 'vitest';
import { isMetaId, metaSignature, parseWebhook, validMetaSignature } from './meta-rules';

describe('signatures', () => {
  const body = '{"object":"page","entry":[]}';
  it('HMAC-SHA256 over the exact raw body', () => {
    const sig = metaSignature('app-secret', body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(validMetaSignature('app-secret', body, sig)).toBe(true);
    expect(validMetaSignature('app-secret', Buffer.from(body), sig)).toBe(true);
  });
  it('rejects other secrets, changed bodies (even whitespace) and missing headers', () => {
    const sig = metaSignature('app-secret', body);
    expect(validMetaSignature('other', body, sig)).toBe(false);
    expect(validMetaSignature('app-secret', body.replace(':', ': '), sig)).toBe(false);
    expect(validMetaSignature('app-secret', body, undefined)).toBe(false);
    expect(validMetaSignature('app-secret', undefined, sig)).toBe(false);
  });
});

describe('parseWebhook', () => {
  it('extracts Messenger messages and skips echoes, reads and reactions', () => {
    const out = parseWebhook({
      object: 'page',
      entry: [
        {
          id: '111222333',
          messaging: [
            { sender: { id: '900001' }, recipient: { id: '111222333' }, timestamp: 1700000000000, message: { mid: 'm_1', text: 'Hi there' } },
            { sender: { id: '111222333' }, recipient: { id: '900001' }, message: { mid: 'm_2', text: 'our reply', is_echo: true } },
            { sender: { id: '900001' }, recipient: { id: '111222333' }, read: { watermark: 1 } },
            { sender: { id: '900001' }, recipient: { id: '111222333' }, message: { mid: 'm_3', attachments: [{ type: 'image', payload: { url: 'https://cdn.fb.example/a.jpg' } }, { type: 'image', payload: { url: 'javascript:x' } }] } },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { platform: 'facebook', pageId: '111222333', senderId: '900001', mid: 'm_1', text: 'Hi there', attachments: [], timestamp: 1700000000000 },
      expect.objectContaining({ mid: 'm_3', text: '', attachments: ['https://cdn.fb.example/a.jpg'] }),
    ]);
  });
  it('recognises Instagram and ignores unknown objects', () => {
    expect(parseWebhook({ object: 'instagram', entry: [{ id: '17841400', messaging: [{ sender: { id: '5' }, message: { mid: 'ig1', text: 'yo' } }] }] })[0].platform).toBe('instagram');
    expect(parseWebhook({ object: 'user', entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
  it('ids', () => {
    expect(isMetaId('111222333')).toBe(true);
    expect(isMetaId('abc')).toBe(false);
  });
});
