import { describe, expect, it } from 'vitest';
import { detectImageType, linkExpiry, signImage, stripMetadata, verifyImage } from './images';

const seg = (marker: number, payload: Buffer) => {
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
};
const jpeg = (...segments: Buffer[]) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);

const crc = (_: Buffer) => Buffer.alloc(4);
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc(data)]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const wchunk = (fourcc: string, data: Buffer) => {
  const h = Buffer.alloc(8);
  h.write(fourcc, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};
const webp = (...chunks: Buffer[]) => {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
};

describe('detectImageType', () => {
  it('recognises real image signatures only', () => {
    expect(detectImageType(jpeg())).toBe('image/jpeg');
    expect(detectImageType(Buffer.concat([PNG_SIG, chunk('IEND', Buffer.alloc(0))]))).toBe('image/png');
    expect(detectImageType(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(detectImageType(webp(wchunk('VP8 ', Buffer.alloc(4))))).toBe('image/webp');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('<html><script>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('stripMetadata', () => {
  it('JPEG: removes EXIF (GPS), IPTC and comments, keeps JFIF and colour profile', () => {
    const exif = seg(0xe1, Buffer.from('Exif\0\0GPS 37.7749 -122.4194'));
    const input = jpeg(seg(0xe0, Buffer.from('JFIF\0')), exif, seg(0xe2, Buffer.from('ICC_PROFILE')), seg(0xed, Buffer.from('Photoshop')), seg(0xfe, Buffer.from('comment')));
    const out = stripMetadata(input, 'image/jpeg');
    const s = out.toString('latin1');
    expect(s).not.toContain('GPS');
    expect(s).not.toContain('Photoshop');
    expect(s).not.toContain('comment');
    expect(s).toContain('JFIF');
    expect(s).toContain('ICC_PROFILE');
    expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });
  it('PNG: removes eXIf and text chunks', () => {
    const input = Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(13)), chunk('eXIf', Buffer.from('GPS')), chunk('tEXt', Buffer.from('Author\0Rosa')), chunk('IDAT', Buffer.from('pixels')), chunk('IEND', Buffer.alloc(0))]);
    const s = stripMetadata(input, 'image/png').toString('latin1');
    expect(s).not.toContain('GPS');
    expect(s).not.toContain('Rosa');
    expect(s).toContain('IHDR');
    expect(s).toContain('pixels');
  });
  it('WebP: removes EXIF/XMP, clears flags and fixes the size', () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x10;
    const out = stripMetadata(webp(wchunk('VP8X', vp8x), wchunk('VP8 ', Buffer.from('frame')), wchunk('EXIF', Buffer.from('GPS!')), wchunk('XMP ', Buffer.from('<x/>'))), 'image/webp');
    const s = out.toString('latin1');
    expect(s).not.toContain('GPS');
    expect(s).not.toContain('<x/>');
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20] & 0x0c).toBe(0);
    expect(out[20] & 0x10).toBe(0x10);
  });
  it('rejects truncated or malformed files', () => {
    expect(() => stripMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg')).toThrow();
    expect(() => stripMetadata(Buffer.concat([PNG_SIG, Buffer.from([0, 0, 1, 0])]), 'image/png')).toThrow();
  });
});

describe('signed links', () => {
  const now = Date.UTC(2026, 10, 19, 10, 20);
  it('expire on hour boundaries between 1 and 2 hours out', () => {
    const exp = linkExpiry(now);
    expect(exp % 3_600_000).toBe(0);
    expect(exp - now).toBeGreaterThanOrEqual(3_600_000);
    expect(exp - now).toBeLessThanOrEqual(2 * 3_600_000);
  });
  it('verify signature, expiry and id', () => {
    const exp = linkExpiry(now);
    const sig = signImage('secret', 'img1', exp);
    expect(verifyImage('secret', 'img1', exp, sig, now)).toBe(true);
    expect(verifyImage('secret', 'img2', exp, sig, now)).toBe(false);
    expect(verifyImage('other', 'img1', exp, sig, now)).toBe(false);
    expect(verifyImage('secret', 'img1', exp, sig, exp + 1)).toBe(false);
    expect(verifyImage('secret', 'img1', exp + 10 * 3_600_000, signImage('secret', 'img1', exp + 10 * 3_600_000), now)).toBe(false); // no far-future links
  });
});
