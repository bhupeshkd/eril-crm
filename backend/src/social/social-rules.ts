/** Pure rules for the social planner (no entity imports, so Vitest can load them). */

export type TargetStatus = 'pending' | 'published' | 'failed';
export interface Target {
  /** MetaPage id */
  pageId: string;
  platform: 'facebook' | 'instagram';
  name: string;
  status: TargetStatus;
  externalId: string | null;
  error: string | null;
  publishedAt: string | null;
}
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';

/** Instagram captions are capped at 2,200 characters; Facebook allows far more. */
export const LIMITS = { facebook: 63206, instagram: 2200 } as const;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

/** Problems with a post for the chosen platforms (empty = fine). */
export function validatePost(p: { body: string; link?: string | null; imageUrl?: string | null }, platforms: Array<'facebook' | 'instagram'>): string[] {
  const errs: string[] = [];
  const body = (p.body ?? '').trim();
  if (!body && !p.imageUrl) errs.push('Write something or add an image');
  if (p.link && !HTTPS.test(p.link) && !/^http:\/\/[^\s"'<>]+$/.test(p.link)) errs.push('Link must start with http:// or https://');
  if (p.imageUrl && !HTTPS.test(p.imageUrl)) errs.push('Image must be an https:// link');
  if (!platforms.length) errs.push('Pick at least one page or account');
  if (platforms.includes('instagram')) {
    if (!p.imageUrl) errs.push('Instagram posts need an image');
    if (body.length > LIMITS.instagram) errs.push(`Instagram captions can be up to ${LIMITS.instagram.toLocaleString('en-US')} characters`);
  }
  if (platforms.includes('facebook') && body.length > LIMITS.facebook) errs.push('That post is too long for Facebook');
  return errs;
}

/** Overall status once every target has been tried. */
export function overallStatus(targets: Array<{ status: TargetStatus }>): PostStatus {
  if (!targets.length) return 'failed';
  const ok = targets.filter((t) => t.status === 'published').length;
  if (targets.some((t) => t.status === 'pending')) return 'publishing';
  return ok === targets.length ? 'published' : ok === 0 ? 'failed' : 'partial';
}

/** Instagram doesn't make links in captions clickable, so the link is appended as text. */
export function captionFor(platform: 'facebook' | 'instagram', body: string, link?: string | null) {
  const b = (body ?? '').trim();
  if (platform === 'instagram' && link) return `${b}${b ? '\n\n' : ''}${link}`.slice(0, LIMITS.instagram);
  return b;
}
