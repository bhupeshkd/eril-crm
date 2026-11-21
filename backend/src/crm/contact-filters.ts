import { Brackets, SelectQueryBuilder } from 'typeorm';
import { CONTACT_STATUSES } from '../database/entities/contact.entity';
import type { ContactFilters } from '../database/entities/crm-extras.entity';

const MAX_TAGS = 20;

/**
 * Normalise untrusted filter input (request bodies, stored lists): drop unknown keys,
 * invalid statuses and blanks, lower-case tags, clamp the day window.
 */
export function cleanFilters(f: any): ContactFilters {
  const out: ContactFilters = {};
  if (!f || typeof f !== 'object') return out;
  const search = typeof f.search === 'string' ? f.search.trim().slice(0, 100) : '';
  if (search) out.search = search;
  const statuses = (Array.isArray(f.statuses) ? f.statuses : []).filter((s: unknown) => (CONTACT_STATUSES as readonly string[]).includes(String(s)));
  if (statuses.length) out.statuses = [...new Set<string>(statuses)];
  const tags = (Array.isArray(f.tags) ? f.tags : []).map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, MAX_TAGS);
  if (tags.length) out.tags = [...new Set<string>(tags)];
  const source = typeof f.source === 'string' ? f.source.trim().slice(0, 50) : '';
  if (source) out.source = source;
  const days = Math.floor(Number(f.createdWithinDays));
  if (Number.isFinite(days) && days > 0) out.createdWithinDays = Math.min(days, 3650);
  return out;
}

export const isEmptyFilter = (f: ContactFilters) => Object.keys(f).length === 0;

/**
 * Apply filters to a query on `contacts` aliased `c`. Callers that search by company
 * name must have joined the company as `co`; otherwise pass `withCompany: false`.
 */
export function applyContactFilters(qb: SelectQueryBuilder<any>, f: ContactFilters, opts: { withCompany?: boolean } = {}) {
  if (f.search) {
    const term = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    qb.andWhere(
      new Brackets((w) => {
        w.where('c.first_name ILIKE :fTerm', { fTerm: term })
          .orWhere('c.last_name ILIKE :fTerm')
          .orWhere(`(c.first_name || ' ' || c.last_name) ILIKE :fTerm`)
          .orWhere('c.email ILIKE :fTerm');
        if (opts.withCompany !== false) w.orWhere('co.name ILIKE :fTerm');
      }),
    );
  }
  if (f.statuses?.length) qb.andWhere('c.status IN (:...fStatuses)', { fStatuses: f.statuses });
  if (f.tags?.length) qb.andWhere('c.tags && :fTags::text[]', { fTags: f.tags });
  if (f.source) qb.andWhere('c.source = :fSource', { fSource: f.source });
  if (f.createdWithinDays) qb.andWhere(`c.created_at >= now() - make_interval(days => :fDays)`, { fDays: f.createdWithinDays });
  return qb;
}

/** Human summary, e.g. "Leads · tagged vip or hot · added in the last 30 days". */
export function describeFilters(f: ContactFilters) {
  const parts: string[] = [];
  if (f.statuses?.length) parts.push(f.statuses.map((s) => `${s[0].toUpperCase()}${s.slice(1)}s`).join(' or '));
  if (f.tags?.length) parts.push(`tagged ${f.tags.join(' or ')}`);
  if (f.source) parts.push(`from ${f.source.replace(/_/g, ' ')}`);
  if (f.createdWithinDays) parts.push(`added in the last ${f.createdWithinDays} days`);
  if (f.search) parts.push(`matching “${f.search}”`);
  return parts.length ? parts.join(' · ') : 'All contacts';
}
