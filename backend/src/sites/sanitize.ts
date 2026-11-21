import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SiteBlock, SitePage } from '../database/entities/site.entity';

const BLOCK_TYPES = ['hero', 'text', 'features', 'image', 'video', 'cta', 'form', 'booking', 'pricing', 'reviews', 'faq', 'footer'];

export const id = () => randomUUID().slice(0, 8);
const LINK_RE = /^(https?:\/\/|mailto:|tel:|\/|#)|^next$/i;
export const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Validates structure and strips anything unsafe (links must be http(s)/mailto/tel/relative/#/next). */
export function sanitizePages(pages: any[]): SitePage[] {
  if (!Array.isArray(pages) || pages.length === 0) throw new BadRequestException('A site needs at least one page');
  if (pages.length > 30) throw new BadRequestException('A site can have at most 30 pages');
  const paths = new Set<string>();
  return pages.map((p, i) => {
    const path = String(p?.path ?? '').trim().toLowerCase();
    if (path && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(path)) throw new BadRequestException(`Page ${i + 1}: path must be lowercase letters, numbers and dashes`);
    if (paths.has(path)) throw new BadRequestException(`Duplicate page path "${path || '/'}"`);
    paths.add(path);
    const blocks = Array.isArray(p?.blocks) ? p.blocks : [];
    if (blocks.length > 60) throw new BadRequestException(`Page ${i + 1} has too many blocks`);
    return {
      id: String(p?.id || id()),
      title: String(p?.title || 'Untitled').slice(0, 120),
      path,
      description: p?.description ? String(p.description).slice(0, 300) : undefined,
      blocks: blocks.map((b: any, j: number): SiteBlock => {
        if (!BLOCK_TYPES.includes(b?.type)) throw new BadRequestException(`Page ${i + 1}, block ${j + 1}: unknown type "${b?.type}"`);
        return { id: String(b.id || id()), type: b.type, props: sanitizeProps(b.props ?? {}) };
      }),
    };
  });
}

function sanitizeProps(props: Record<string, any>, depth = 0): Record<string, any> {
  if (depth > 3) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props).slice(0, 40)) {
    if (typeof v === 'string') {
      const s = v.slice(0, 5000);
      if (/(link|url|href|image|src)$/i.test(k) && s && !LINK_RE.test(s)) continue; // drop javascript:, data: etc.
      out[k] = s;
    } else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 30).map((x) => (x && typeof x === 'object' ? sanitizeProps(x, depth + 1) : typeof x === 'string' ? x.slice(0, 2000) : x));
    else if (v && typeof v === 'object') out[k] = sanitizeProps(v, depth + 1);
  }
  return out;
}

