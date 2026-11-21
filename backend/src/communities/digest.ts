/** Pure helpers for community email digests (no entity imports, so Vitest can load them). */
import type { EmailBlock, EmailDesign } from '@eril/shared';
import { tzOffsetMs } from '../calendars/time';

export type DigestFrequency = 'off' | 'daily' | 'weekly';
export type MemberDigestPref = 'community' | DigestFrequency;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Sends happen within this many hours after the chosen hour; if the server was down longer, that slot is skipped. */
export const SEND_WINDOW_HOURS = 3;

export function effectiveFrequency(member: MemberDigestPref, community: DigestFrequency): DigestFrequency {
  if (community === 'off') return 'off';
  return member === 'community' ? community : member;
}

export interface DueInput {
  frequency: DigestFrequency;
  /** Local hour 0–23 in `timezone`. */
  hour: number;
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  weekday: number;
  timezone: string;
  lastDigestAt: Date | null;
}

/** Is a digest due now? Daily: once per local day at/after `hour`. Weekly: same, on `weekday`, at most every 6 days. */
export function isDue(now: Date, i: DueInput): boolean {
  if (i.frequency === 'off') return false;
  const local = new Date(now.getTime() + tzOffsetMs(now, i.timezone));
  const h = local.getUTCHours();
  if (h < i.hour || h >= i.hour + SEND_WINDOW_HOURS) return false;
  if (i.frequency === 'weekly' && local.getUTCDay() !== i.weekday) return false;
  const gap = now.getTime() - (i.lastDigestAt?.getTime() ?? 0);
  return gap >= (i.frequency === 'daily' ? 20 * HOUR : 6 * DAY);
}

/**
 * What counts as "new" for a member: after their last digest and their last visit (they've
 * already seen anything older), never before they joined, and never older than one period.
 */
export function digestSince(now: Date, frequency: DigestFrequency, joinedAt: Date, lastDigestAt: Date | null, lastSeenAt: Date | null): Date {
  const period = frequency === 'daily' ? DAY : 7 * DAY;
  const t = Math.max(joinedAt.getTime(), lastDigestAt?.getTime() ?? 0, lastSeenAt?.getTime() ?? 0, now.getTime() - period);
  return new Date(t);
}

/**
 * Member text goes into an email that renders **bold** and [label](url). A zero-width space
 * breaks those patterns so a post can't plant a disguised link or styling in a mail from the business.
 */
export function neutralize(text: string): string {
  return text.replace(/\*\*/g, '*​*').replace(/\]\(/g, ']​(');
}

export function excerpt(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export interface DigestPost {
  author: string;
  channel: string;
  body: string;
  likeCount: number;
  commentCount: number;
  pinned: boolean;
  createdAt: Date;
}

/** Pinned first, then the most engaged, then the newest. */
export function rankPosts<T extends DigestPost>(posts: T[], limit = 5): T[] {
  const score = (p: DigestPost) => p.likeCount + 2 * p.commentCount;
  return [...posts]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

let n = 0;
const block = (type: EmailBlock['type'], props: Record<string, any>): EmailBlock => ({ id: `d${++n}`, type, props });

export function digestDesign(i: {
  communityName: string;
  memberName: string;
  frequency: DigestFrequency;
  posts: DigestPost[];
  totalPosts: number;
  totalComments: number;
  portalUrl: string;
  settingsUrl: string;
}): EmailDesign {
  const name = neutralize(i.communityName);
  const more = i.totalPosts - i.posts.length;
  const blocks: EmailBlock[] = [
    block('heading', { text: `What's new in ${name}`, size: 'medium' }),
    block('text', {
      text: `Hi ${neutralize(i.memberName)}, here ${i.totalPosts === 1 ? 'is' : 'are'} **${i.totalPosts} new post${i.totalPosts === 1 ? '' : 's'}**${
        i.totalComments ? ` and ${i.totalComments} comment${i.totalComments === 1 ? '' : 's'}` : ''
      } since ${i.frequency === 'daily' ? 'yesterday' : 'last week'}.`,
    }),
    block('divider', {}),
  ];
  for (const p of i.posts) {
    const meta = [p.likeCount ? `♥ ${p.likeCount}` : '', p.commentCount ? `💬 ${p.commentCount}` : ''].filter(Boolean).join('  ·  ');
    blocks.push(
      block('text', {
        text: `${p.pinned ? '📌 ' : ''}**${neutralize(p.author)}** in #${neutralize(p.channel)}\n${neutralize(excerpt(p.body))}${meta ? `\n${meta}` : ''}`,
      }),
    );
  }
  if (more > 0) blocks.push(block('text', { text: `…and ${more} more post${more === 1 ? '' : 's'}.` }));
  blocks.push(block('button', { label: 'Open the community', url: i.portalUrl, align: 'center' }));
  blocks.push(
    block('footer', {
      text: `You get this ${i.frequency} digest as a member of ${name}. The button above is your personal link, so please don't forward this email. [Change or stop digest emails](${i.settingsUrl})`,
    }),
  );
  return {
    subject: `${i.totalPosts} new post${i.totalPosts === 1 ? '' : 's'} in ${i.communityName}`,
    previewText: i.posts[0] ? `${i.posts[0].author}: ${excerpt(i.posts[0].body, 90)}` : '',
    blocks,
  };
}
