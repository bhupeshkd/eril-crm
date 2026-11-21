/** Pure helpers for community image uploads (no entity imports, so Vitest can load them). */
import { createHmac, timingSafeEqual } from 'crypto';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGES_PER_POST = 4;
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Identify by magic bytes, never by filename or the browser's claimed type. SVG is deliberately unsupported. */
export function detectImageType(b: Buffer): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** JPEG: drop APP1 (EXIF/XMP: camera, GPS), APP13 (IPTC) and comments; keep everything else. */
function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad jpeg');
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      out.push(b.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(out);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) throw new Error('bad jpeg');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new Error('bad jpeg');
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('bad jpeg');
}

/** PNG: drop eXIf and text chunks (which can hold metadata). */
function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > b.length) throw new Error('bad png');
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  throw new Error('bad png');
}

/** WebP: drop EXIF/XMP chunks, clear their VP8X flags and fix the RIFF size. */
function stripWebp(b: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = b.subarray(i, i + 4).toString('latin1');
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > b.length) throw new Error('bad webp');
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      const chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)));
      if (fourcc === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04);
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Removes location and camera metadata. Throws if the file can't be parsed (then it's rejected). */
export function stripMetadata(b: Buffer, mime: ImageMime): Buffer {
  if (mime === 'image/jpeg') return stripJpeg(b);
  if (mime === 'image/png') return stripPng(b);
  if (mime === 'image/webp') return stripWebp(b);
  return b; // GIF carries no EXIF
}

// ---- Short-lived signed links ---------------------------------------------------------
const HOUR = 3_600_000;

/** Expiry rounded up to the next hour + 1h, so the same link is reused (and cached) for a while. */
export function linkExpiry(now = Date.now()) {
  return Math.ceil((now + HOUR) / HOUR) * HOUR;
}

export function signImage(secret: string, id: string, exp: number) {
  return createHmac('sha256', secret).update(`cimg:${id}:${exp}`).digest('base64url').slice(0, 32);
}

export function verifyImage(secret: string, id: string, exp: number, sig: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp < now || exp > now + 3 * HOUR) return false;
  const a = Buffer.from(signImage(secret, id, exp));
  const b = Buffer.from(String(sig ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
