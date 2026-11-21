/**
 * Minimal QR code encoder (ISO/IEC 18004): byte mode, versions 1–10, error correction L/M/Q/H, automatic mask.
 * Pure and dependency-free so it can be unit-tested and verified against an independent decoder.
 */

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/** [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords] per version, per level L/M/Q/H. */
const BLOCKS: Record<number, Record<EcLevel, [number, number, number, number, number]>> = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};
const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
export const MAX_VERSION = 10;

// ---- GF(256) arithmetic for Reed–Solomon (primitive polynomial 0x11D) ----
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Error-correction codewords for `data` (generator = ∏(x − αⁱ), i < n). */
export function reedSolomon(data: number[], n: number): number[] {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

const dataCapacity = (v: number, ec: EcLevel) => {
  const [, b1, d1, b2, d2] = BLOCKS[v][ec];
  return b1 * d1 + b2 * d2;
};

/** Data codewords (mode, length, bytes, terminator, padding) for the chosen version. */
export function encodeData(bytes: Uint8Array, version: number, ec: EcLevel): number[] {
  const cap = dataCapacity(version, ec);
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits into blocks, adds error correction and interleaves, as the symbol stores them. */
export function finalCodewords(data: number[], version: number, ec: EcLevel): number[] {
  const [ecLen, b1, d1, b2, d2] = BLOCKS[version][ec];
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < b1; i++) { blocks.push(data.slice(k, k + d1)); k += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(data.slice(k, k + d2)); k += d2; }
  const ecBlocks = blocks.map((b) => reedSolomon(b, ecLen));
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x], true = dark */
  modules: boolean[][];
}

/** Encodes text (UTF-8) into a QR matrix, picking the smallest version that fits. */
export function encodeQr(text: string, ec: EcLevel = 'M'): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity(v, ec) * 8) { version = v; break; }
  }
  if (!version) throw new Error(`Text is too long for a QR code (${bytes.length} bytes)`);
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fn[y][x] = true; };

  // Timing patterns, then finders (with separators) over them.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const data = (FORMAT_BITS[ec] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // dark module
  };
  drawFormat(0); // reserve the area; redrawn per mask below
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data, in the two-column zigzag from the bottom-right.
  const words = finalCodewords(encodeData(bytes, version, ec), version, ec);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && i < words.length * 8) {
        modules[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }

  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      let flip: boolean;
      switch (m) {
        case 0: flip = (x + y) % 2 === 0; break;
        case 1: flip = y % 2 === 0; break;
        case 2: flip = x % 3 === 0; break;
        case 3: flip = (x + y) % 3 === 0; break;
        case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (flip) modules[y][x] = !modules[y][x];
    }
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const score = penalty(modules);
    if (score < bestScore) { bestScore = score; best = m; }
    applyMask(m); // XOR again to undo
  }
  applyMask(best);
  drawFormat(best);
  return { version, size, mask: best, modules };
}

/** Standard mask penalty (runs, 2×2 blocks, finder-like patterns, dark balance). */
export function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < n; y++) lines.push(m[y]);
  for (let x = 0; x < n; x++) lines.push(m.map((row) => row[x]));
  const finderA = [true, false, true, true, true, false, true, false, false, false, false];
  const finderB = [...finderA].reverse();
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    for (let i = 0; i + 11 <= n; i++) {
      if (finderA.every((v, k) => line[i + k] === v) || finderB.every((v, k) => line[i + k] === v)) score += 40;
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const c = m[y][x];
    if (m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3;
  }
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

/** Scalable SVG with a 4-module quiet zone. */
export function qrSvg(text: string, opts: { ec?: EcLevel; color?: string; background?: string } = {}): string {
  const { size, modules } = encodeQr(text, opts.ec ?? 'M');
  const q = 4;
  const total = size + q * 2;
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color ?? '') ? opts.color : '#000000';
  const bg = /^#[0-9a-fA-F]{6}$/.test(opts.background ?? '') ? opts.background : '#ffffff';
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${color}"/></svg>`;
}
