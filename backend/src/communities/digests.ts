import { Body, Controller, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Brackets, In, Repository } from 'typeorm';
import { renderEmail } from '@eril/shared';
import { Community, CommunityChannel, CommunityMember, CommunityPost } from '../database/entities/community.entity';
import { User } from '../database/entities/user.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { InboxService } from '../communication/inbox.service';
import { digestDesign, digestSince, effectiveFrequency, isDue, rankPosts, type DigestFrequency, type DigestPost } from './digest';

class RunDto {
  /** Dev/testing: send to everyone with new content regardless of the configured hour/day. */
  @IsOptional() @IsBoolean() ignoreSchedule?: boolean;
}
class PreviewQuery {
  @IsUUID() memberId: string;
}

const TICK_MS = 5 * 60_000;

@Injectable()
export class CommunityDigestsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommunityDigestsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(CommunityChannel) private readonly channels: Repository<CommunityChannel>,
    @InjectRepository(CommunityMember) private readonly members: Repository<CommunityMember>,
    @InjectRepository(CommunityPost) private readonly posts: Repository<CommunityPost>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly inbox: InboxService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => {
      if (this.running) return; // a slow run never overlaps the next tick
      this.running = true;
      this.tick()
        .catch((e) => this.logger.error(`Digest run failed: ${e.message}`))
        .finally(() => (this.running = false));
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private portalUrl(token: string) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/community/${token}`;
  }

  async tick(now = new Date(), opts: { communityId?: string; workspaceId?: string; ignoreSchedule?: boolean } = {}) {
    const where: any = { isActive: true };
    if (opts.communityId) where.id = opts.communityId;
    if (opts.workspaceId) where.workspaceId = opts.workspaceId;
    const list = (await this.communities.find({ where })).filter((c) => c.digestFrequency !== 'off');
    let sent = 0;
    let empty = 0;
    for (const c of list) {
      const members = await this.members
        .createQueryBuilder('m')
        .addSelect('m.accessToken')
        .innerJoinAndSelect('m.contact', 'ct')
        .where('m.community_id = :cid AND m.status = :st', { cid: c.id, st: 'active' })
        .andWhere('ct.email IS NOT NULL AND ct.dnd = false')
        .getMany();
      for (const m of members) {
        const frequency = effectiveFrequency(m.digest, c.digestFrequency);
        if (frequency === 'off') continue;
        if (!opts.ignoreSchedule && !isDue(now, { frequency, hour: c.digestHour, weekday: c.digestWeekday, timezone: c.timezone, lastDigestAt: m.lastDigestAt })) continue;
        const d = await this.build(c, m, frequency, now);
        if (!d) {
          empty++;
          continue;
        }
        // Claim first so two API instances (or a manual run) never send the same digest twice.
        const claimed = await this.members
          .createQueryBuilder()
          .update(CommunityMember)
          .set({ lastDigestAt: now })
          .where('id = :id', { id: m.id })
          .andWhere(m.lastDigestAt ? 'last_digest_at = :prev' : 'last_digest_at IS NULL', { prev: m.lastDigestAt })
          .execute();
        if (!claimed.affected) continue;
        const msg = await this.inbox
          .send(c.workspaceId, { contactId: m.contactId, channel: 'email', subject: d.subject, body: d.text }, null, { html: d.html })
          .catch((e) => ({ status: 'failed', error: e.message }));
        if (msg.status === 'failed') {
          // Let the next run retry rather than silently skipping a period.
          await this.members.update({ id: m.id }, { lastDigestAt: m.lastDigestAt });
          this.logger.warn(`Digest to member ${m.id} failed: ${(msg as any).error}`);
        } else sent++;
      }
    }
    return { sent, empty };
  }

  async runNow(workspaceId: string, communityId: string, ignoreSchedule: boolean) {
    if (!(await this.communities.exist({ where: { id: communityId, workspaceId } }))) throw new NotFoundException('Community not found');
    return this.tick(new Date(), { communityId, workspaceId, ignoreSchedule });
  }

  /** The digest a member would get right now, or null when nothing is new for them. */
  async build(c: Community, m: CommunityMember, frequency: DigestFrequency, now: Date) {
    const since = digestSince(now, frequency, m.createdAt, m.lastDigestAt, m.lastSeenAt);
    const live = (await this.channels.find({ where: { communityId: c.id } })).map((x) => ({ id: x.id, name: x.name }));
    if (!live.length) return null;
    const rows = await this.posts
      .createQueryBuilder('p')
      .where('p.community_id = :cid AND p.hidden = false AND p.created_at > :since', { cid: c.id, since })
      .andWhere('p.channel_id IN (:...ch)', { ch: live.map((x) => x.id) })
      .andWhere(new Brackets((q) => q.where('p.member_id IS NULL').orWhere('p.member_id <> :me', { me: m.id })))
      .orderBy('p.created_at', 'DESC')
      .take(200)
      .getMany();
    if (!rows.length) return null;
    const [{ comments }] = await this.posts.query(
      `SELECT COUNT(*)::int AS comments FROM community_comments cc JOIN community_posts p ON p.id = cc.post_id
        WHERE p.community_id = $1 AND p.deleted_at IS NULL AND cc.deleted_at IS NULL AND cc.hidden = false
          AND cc.created_at > $2 AND cc.member_id IS DISTINCT FROM $3`,
      [c.id, since, m.id],
    );
    const authorMembers = [...new Set(rows.map((r) => r.memberId).filter(Boolean))] as string[];
    const authorUsers = [...new Set(rows.map((r) => r.authorUserId).filter(Boolean))] as string[];
    const [ms, us] = await Promise.all([
      authorMembers.length ? this.members.find({ where: { id: In(authorMembers) }, withDeleted: true }) : [],
      authorUsers.length ? this.users.find({ where: { id: In(authorUsers) }, select: { id: true, name: true } }) : [],
    ]);
    const posts: DigestPost[] = rows.map((p) => ({
      author: p.authorUserId ? `${us.find((u) => u.id === p.authorUserId)?.name ?? 'Team'} (team)` : ms.find((x) => x.id === p.memberId)?.displayName ?? 'A member',
      channel: live.find((x) => x.id === p.channelId)?.name ?? '',
      body: p.body || '📷 Photo',
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      pinned: p.pinned,
      createdAt: p.createdAt,
    }));
    const portal = this.portalUrl(m.accessToken);
    const design = digestDesign({
      communityName: c.name,
      memberName: m.displayName,
      frequency,
      posts: rankPosts(posts, 5),
      totalPosts: rows.length,
      totalComments: comments,
      portalUrl: portal,
      settingsUrl: `${portal}?digest=settings`,
    });
    const r = renderEmail(design);
    return { ...r, totalPosts: rows.length, totalComments: comments };
  }

  async preview(workspaceId: string, communityId: string, memberId: string) {
    const c = await this.communities.findOne({ where: { id: communityId, workspaceId } });
    if (!c) throw new NotFoundException('Community not found');
    const m = await this.members.createQueryBuilder('m').addSelect('m.accessToken').where('m.id = :id AND m.community_id = :cid', { id: memberId, cid: c.id }).getOne();
    if (!m) throw new NotFoundException('Member not found');
    const frequency = effectiveFrequency(m.digest, c.digestFrequency);
    // Preview what the next scheduled digest would contain (weekly if digests are off, so staff can still see it).
    const d = await this.build(c, m, frequency === 'off' ? 'weekly' : frequency, new Date());
    if (!d) return { empty: true, frequency };
    // The preview is shown to staff: swap the member's personal link for a placeholder.
    const scrub = (s: string) => s.split(m.accessToken).join('PERSONAL-LINK');
    return { empty: false, frequency, subject: d.subject, html: scrub(d.html), totalPosts: d.totalPosts, totalComments: d.totalComments };
  }
}

@Controller('communities/:id/digests')
export class CommunityDigestsController {
  constructor(private readonly svc: CommunityDigestsService) {}

  @Get('preview')
  @Permissions('courses:read')
  preview(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PreviewQuery) {
    return this.svc.preview(ws, id, q.memberId);
  }

  /** Dev/test only: run the digest job now for this community. */
  @Post('run')
  @Permissions('courses:write')
  run(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RunDto) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.svc.runNow(ws, id, !!dto.ignoreSchedule);
  }
}
