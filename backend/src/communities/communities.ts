import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import {
  Community,
  CommunityChannel,
  CommunityComment,
  CommunityLike,
  CommunityMember,
  CommunityImage,
  CommunityMention,
  CommunityPost,
} from '../database/entities/community.entity';
import { CommunityImagePublicController, CommunityImagesService, type UploadedImage, type Uploader } from './community-images';
import { IMAGES_PER_POST, IMAGE_MAX_BYTES } from './images';
import { FILES_PER_POST, FILE_MAX_BYTES } from './files';
import { PERIODS, levelFor, periodStart, progress, rank, type Period } from './levels';
import { Contact } from '../database/entities/contact.entity';
import { Course } from '../database/entities/course.entity';
import { User } from '../database/entities/user.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug, publicToken } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { COMMENT_MAX, MAX_MENTIONS, POST_MAX, cleanBody, cleanDisplayName, defaultDisplayName, resolveMentions } from './text';
import { CommunityDigestsController, CommunityDigestsService } from './digests';
import { isValidTimeZone } from '../calendars/time';

// ---- DTOs -------------------------------------------------------------------
class CommunityFieldsDto {
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['invite', 'open']) joinMode?: 'invite' | 'open';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) autoJoinCourseIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsIn(['off', 'daily', 'weekly']) digestFrequency?: 'off' | 'daily' | 'weekly';
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(6) digestWeekday?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}
export class CreateCommunityDto extends CommunityFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
}
export class UpdateCommunityDto extends CommunityFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}
export class ChannelDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsBoolean() staffOnly?: boolean;
  @IsOptional() position?: number;
}
export class AddMemberDto {
  @IsUUID() contactId: string;
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsIn(['member', 'moderator']) role?: 'member' | 'moderator';
}
export class UpdateMemberDto {
  @IsOptional() @IsIn(['member', 'moderator']) role?: 'member' | 'moderator';
  @IsOptional() @IsIn(['active', 'banned']) status?: 'active' | 'banned';
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
}
export class PostDto {
  @IsUUID() channelId: string;
  /** May be empty when the post has images. */
  @IsString() @MaxLength(POST_MAX + 100) body: string;
  /** Ids returned by the image upload endpoint (up to 4, in display order). */
  @IsOptional() @IsArray() @ArrayMaxSize(IMAGES_PER_POST) @IsUUID('all', { each: true }) imageIds?: string[];
  /** Ids returned by the file upload endpoint (up to 3). */
  @IsOptional() @IsArray() @ArrayMaxSize(FILES_PER_POST) @IsUUID('all', { each: true }) fileIds?: string[];
  /** Member ids picked from @-autocomplete; only those visibly @mentioned in the body are kept. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) mentions?: string[];
}
class LeaderboardQuery {
  @IsOptional() @IsIn(PERIODS as unknown as string[]) period?: Period;
}
export class CommentDto {
  @IsString() @IsNotEmpty() @MaxLength(COMMENT_MAX + 100) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) mentions?: string[];
}
class MentionSearchQuery {
  @IsOptional() @IsString() @MaxLength(40) q?: string;
}
export class ModerateDto {
  @IsOptional() @IsBoolean() hidden?: boolean;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
export class JoinDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsEmail() email: string;
}
export class MeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) displayName?: string;
  @IsOptional() @IsIn(['community', 'off', 'daily', 'weekly']) digest?: 'community' | 'off' | 'daily' | 'weekly';
  @IsOptional() @IsBoolean() mentionEmails?: boolean;
}
class FeedQuery {
  @IsOptional() @IsUUID() channelId?: string;
  /** Deep link to one post (e.g. from a mention email). */
  @IsOptional() @IsUUID() postId?: string;
  @IsOptional() @IsDateString() before?: string;
}

/** Who is acting: a staff user (app) or a member (portal). */
type Actor = { kind: 'staff'; userId: string } | { kind: 'member'; member: CommunityMember };

const PAGE = 20;

@Injectable()
export class CommunitiesService implements OnModuleInit {
  private readonly logger = new Logger(CommunitiesService.name);

  constructor(
    @InjectRepository(Community) private readonly communities: Repository<Community>,
    @InjectRepository(CommunityChannel) private readonly channels: Repository<CommunityChannel>,
    @InjectRepository(CommunityMember) private readonly members: Repository<CommunityMember>,
    @InjectRepository(CommunityPost) private readonly posts: Repository<CommunityPost>,
    @InjectRepository(CommunityComment) private readonly comments: Repository<CommunityComment>,
    @InjectRepository(CommunityLike) private readonly likes: Repository<CommunityLike>,
    @InjectRepository(CommunityMention) private readonly mentionRows: Repository<CommunityMention>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly contacts: ContactsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly images: CommunityImagesService,
  ) {}

  private uploader(a: Actor): Uploader {
    return a.kind === 'member' ? { memberId: a.member.id } : { userId: a.userId };
  }

  uploadImage(c: Community, a: Actor, file?: UploadedImage) {
    return this.images.upload(c.workspaceId, c.id, this.uploader(a), file);
  }

  uploadFile(c: Community, a: Actor, file?: UploadedImage) {
    return this.images.uploadFile(c.workspaceId, c.id, this.uploader(a), file);
  }

  // ---- Points & levels -------------------------------------------------------------------
  /** Likes received from others on each member's posts (optionally since a date). */
  private async points(memberIds: string[], since: Date | null = null): Promise<Map<string, number>> {
    if (!memberIds.length) return new Map();
    const rows: Array<{ id: string; points: number }> = await this.posts.query(
      `SELECT p.member_id AS id, COUNT(*)::int AS points
         FROM community_likes l JOIN community_posts p ON p.id = l.post_id
        WHERE p.member_id = ANY($1) AND (l.member_id IS NULL OR l.member_id <> p.member_id)
          AND l.deleted_at IS NULL AND p.deleted_at IS NULL AND ($2::timestamptz IS NULL OR l.created_at >= $2)
        GROUP BY p.member_id`,
      [memberIds, since],
    );
    return new Map(rows.map((r) => [r.id, r.points]));
  }

  /** Top members by points received in the period, plus where `meId` stands. */
  async leaderboard(communityId: string, period: Period, meId?: string) {
    const since = periodStart(period);
    const rows: Array<{ id: string; name: string; points: number }> = await this.posts.query(
      `SELECT m.id, m.display_name AS name, COUNT(*)::int AS points
         FROM community_likes l
         JOIN community_posts p ON p.id = l.post_id
         JOIN community_members m ON m.id = p.member_id
        WHERE p.community_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
          AND (l.member_id IS NULL OR l.member_id <> p.member_id)
          AND l.deleted_at IS NULL AND p.deleted_at IS NULL AND ($2::timestamptz IS NULL OR l.created_at >= $2)
        GROUP BY m.id, m.display_name
        ORDER BY points DESC, m.display_name ASC`,
      [communityId, since],
    );
    const ranked = rank(rows);
    const allTime = await this.points(ranked.slice(0, 10).map((r) => r.id).concat(meId ? [meId] : []));
    const out = (r: { id: string; name: string; points: number; rank: number }) => ({ rank: r.rank, name: r.name, points: r.points, level: levelFor(allTime.get(r.id) ?? 0), isMe: r.id === meId });
    const mine = meId ? ranked.find((r) => r.id === meId) : undefined;
    return {
      period,
      top: ranked.slice(0, 10).map(out),
      me: meId ? { rank: mine?.rank ?? null, points: mine?.points ?? 0, ...progress(allTime.get(meId) ?? 0) } : null,
    };
  }

  onModuleInit() {
    // Course enrollment → join the communities that list that course.
    this.events.onAny((e) => {
      if (e.type !== 'course.enrolled' || !e.contactId || !e.payload?.course?.id) return;
      this.autoJoin(e.workspaceId, e.contactId, e.payload.course.id).catch((err) => this.logger.error(`Community auto-join failed: ${err.message}`));
    });
  }

  private portalUrl(token: string) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/community/${token}`;
  }

  // ---- Communities --------------------------------------------------------------
  async list(workspaceId: string) {
    const list = await this.communities.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    if (!list.length) return [];
    const ids = list.map((c) => c.id);
    const [m, p] = await Promise.all([
      this.members.query(
        `SELECT community_id AS id, COUNT(*) FILTER (WHERE status = 'active')::int AS members,
                COUNT(*) FILTER (WHERE status = 'active' AND last_seen_at > now() - interval '7 days')::int AS "activeWeek"
           FROM community_members WHERE community_id = ANY($1) AND deleted_at IS NULL GROUP BY community_id`,
        [ids],
      ),
      this.posts.query(
        `SELECT community_id AS id, COUNT(*)::int AS posts, COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS "postsWeek"
           FROM community_posts WHERE community_id = ANY($1) AND deleted_at IS NULL GROUP BY community_id`,
        [ids],
      ),
    ]);
    return list.map((c) => ({ ...c, ...(m.find((x: any) => x.id === c.id) ?? { members: 0, activeWeek: 0 }), ...(p.find((x: any) => x.id === c.id) ?? { posts: 0, postsWeek: 0 }), id: c.id }));
  }

  async get(workspaceId: string, id: string) {
    const c = await this.communities.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Community not found');
    return c;
  }

  async detail(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    const channels = await this.channels.find({ where: { communityId: id }, order: { position: 'ASC', createdAt: 'ASC' } });
    return { ...c, channels, joinUrl: c.joinMode === 'open' ? `${this.config.get('APP_URL') || 'http://localhost:3000'}/join/${c.slug}` : null };
  }

  private async cleanFields(workspaceId: string, dto: CommunityFieldsDto) {
    const out: Partial<Community> = {};
    if (dto.timezone !== undefined && !isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown timezone');
    if (dto.autoJoinCourseIds) {
      const ids = [...new Set(dto.autoJoinCourseIds)];
      if (ids.length && (await this.courses.count({ where: { workspaceId, id: In(ids) } })) !== ids.length) throw new BadRequestException('Some courses were not found');
      out.autoJoinCourseIds = ids;
    }
    if (dto.tags) out.tags = dto.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    return out;
  }

  async create(workspaceId: string, dto: CreateCommunityDto) {
    const c = await this.communities.save(
      this.communities.create({ ...dto, ...(await this.cleanFields(workspaceId, dto)), workspaceId, slug: makeSlug(dto.name), description: dto.description ?? '' }),
    );
    await this.channels.save([
      this.channels.create({ workspaceId, communityId: c.id, name: 'Announcements', description: 'News from the team', position: 0, staffOnly: true }),
      this.channels.create({ workspaceId, communityId: c.id, name: 'General', description: 'Introduce yourself and chat', position: 1 }),
    ]);
    return this.detail(workspaceId, c.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateCommunityDto) {
    const c = await this.get(workspaceId, id);
    Object.assign(c, dto, await this.cleanFields(workspaceId, dto));
    await this.communities.save(c);
    return this.detail(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    await this.communities.softRemove(c);
    return { id };
  }

  // ---- Channels -------------------------------------------------------------------
  async addChannel(workspaceId: string, communityId: string, dto: ChannelDto) {
    await this.get(workspaceId, communityId);
    if (!dto.name?.trim()) throw new BadRequestException('Channel name is required');
    const count = await this.channels.count({ where: { communityId } });
    if (count >= 30) throw new BadRequestException('A community can have up to 30 channels');
    return this.channels.save(
      this.channels.create({ workspaceId, communityId, name: dto.name.trim(), description: dto.description ?? '', staffOnly: !!dto.staffOnly, position: Number(dto.position ?? count) || count }),
    );
  }

  private async channelOf(workspaceId: string, communityId: string, channelId: string) {
    const ch = await this.channels.findOne({ where: { id: channelId, communityId, workspaceId } });
    if (!ch) throw new NotFoundException('Channel not found');
    return ch;
  }

  async updateChannel(workspaceId: string, communityId: string, channelId: string, dto: ChannelDto) {
    const ch = await this.channelOf(workspaceId, communityId, channelId);
    if (dto.name !== undefined) ch.name = dto.name.trim() || ch.name;
    if (dto.description !== undefined) ch.description = dto.description;
    if (dto.staffOnly !== undefined) ch.staffOnly = dto.staffOnly;
    if (dto.position !== undefined && Number.isFinite(Number(dto.position))) ch.position = Number(dto.position);
    return this.channels.save(ch);
  }

  async removeChannel(workspaceId: string, communityId: string, channelId: string) {
    const ch = await this.channelOf(workspaceId, communityId, channelId);
    if ((await this.channels.count({ where: { communityId } })) <= 1) throw new BadRequestException('A community needs at least one channel');
    await this.channels.softRemove(ch);
    return { id: channelId };
  }

  // ---- Members --------------------------------------------------------------------
  async listMembers(workspaceId: string, communityId: string) {
    await this.get(workspaceId, communityId);
    const rows = await this.members
      .createQueryBuilder('m')
      .addSelect('m.accessToken')
      .leftJoinAndSelect('m.contact', 'c')
      .where('m.community_id = :communityId', { communityId })
      .orderBy('m.created_at', 'DESC')
      .getMany();
    const counts: Array<{ id: string; posts: number }> = rows.length
      ? await this.posts.query(
          `SELECT member_id AS id, COUNT(*)::int AS posts FROM community_posts WHERE community_id = $1 AND member_id IS NOT NULL AND deleted_at IS NULL GROUP BY member_id`,
          [communityId],
        )
      : [];
    return rows.map(({ accessToken, contact, ...m }) => ({
      ...m,
      contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email },
      posts: counts.find((x) => x.id === m.id)?.posts ?? 0,
      // Staff can copy a member's personal link for support.
      portalUrl: m.status === 'active' ? this.portalUrl(accessToken) : null,
    }));
  }

  /**
   * Adds (or re-invites) a contact. Banned members stay banned unless staff re-add them.
   * Emails the personal link when `notify` is set.
   */
  async addMember(
    workspaceId: string,
    community: Community,
    contact: Contact,
    opts: { source: 'staff' | 'join_page' | 'course'; notify: boolean; role?: 'member' | 'moderator'; userId?: string | null },
  ) {
    let m = await this.members.createQueryBuilder('m').addSelect('m.accessToken').where('m.community_id = :cid AND m.contact_id = :pid', { cid: community.id, pid: contact.id }).withDeleted().getOne();
    let created = false;
    if (m?.status === 'banned' && opts.source !== 'staff') return { member: m, created: false, banned: true };
    if (!m) {
      m = await this.members.save(
        this.members.create({
          workspaceId,
          communityId: community.id,
          contactId: contact.id,
          accessToken: publicToken(),
          displayName: defaultDisplayName(contact.firstName, contact.lastName),
          role: opts.role ?? 'member',
          source: opts.source,
        }),
      );
      created = true;
    } else if (m.deletedAt || m.status === 'banned') {
      await this.members.restore({ id: m.id });
      await this.members.update({ id: m.id }, { status: 'active', ...(opts.role ? { role: opts.role } : {}) });
      m.status = 'active';
      created = true;
    } else if (opts.role && opts.role !== m.role) {
      await this.members.update({ id: m.id }, { role: opts.role });
    }
    if (created && community.tags.length) await this.contacts.upsert(workspaceId, { email: contact.email, tags: community.tags }).catch(() => undefined);
    if (opts.notify && contact.email && (!contact.dnd || opts.source === 'join_page')) {
      await this.inbox
        .send(
          workspaceId,
          {
            contactId: contact.id,
            channel: 'email',
            subject: created ? `You're in: ${community.name}` : `Your link to ${community.name}`,
            body: `Hi ${contact.firstName || 'there'},\n\n${created ? `You've been added to the "${community.name}" community.` : `Here's your link to the "${community.name}" community.`} Open it here (it's your personal access, so please don't share it):\n\n${this.portalUrl(m.accessToken)}`,
          },
          opts.userId,
        )
        .catch((e) => this.logger.warn(`Community invite email failed: ${e.message}`));
    }
    if (created) {
      await this.activity.record(workspaceId, 'community.member_joined', `${contact.firstName} ${contact.lastName} joined "${community.name}"`.trim(), {
        entityType: 'contact',
        entityId: contact.id,
        userId: opts.userId,
      });
      this.events.emit({
        type: 'community.member_joined',
        workspaceId,
        userId: opts.userId,
        contactId: contact.id,
        payload: { community: { id: community.id, name: community.name }, source: opts.source, contact: { firstName: contact.firstName, lastName: contact.lastName } },
      });
    }
    return { member: m, created, banned: false };
  }

  async staffAddMember(workspaceId: string, communityId: string, dto: AddMemberDto, userId: string) {
    const c = await this.get(workspaceId, communityId);
    const contact = await this.contactRepo.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    const { member, created } = await this.addMember(workspaceId, c, contact, { source: 'staff', notify: dto.notify !== false, role: dto.role, userId });
    return { id: member.id, created, portalUrl: this.portalUrl(member.accessToken) };
  }

  private async memberOf(workspaceId: string, communityId: string, memberId: string) {
    const m = await this.members.findOne({ where: { id: memberId, communityId, workspaceId } });
    if (!m) throw new NotFoundException('Member not found');
    return m;
  }

  async updateMember(workspaceId: string, communityId: string, memberId: string, dto: UpdateMemberDto) {
    const m = await this.memberOf(workspaceId, communityId, memberId);
    const patch: Partial<CommunityMember> = {};
    if (dto.role) patch.role = dto.role;
    if (dto.status) patch.status = dto.status;
    if (dto.displayName !== undefined) patch.displayName = cleanDisplayName(dto.displayName) || m.displayName;
    await this.members.update({ id: m.id }, patch);
    return { ...m, ...patch };
  }

  /** New personal link (old one stops working), e.g. if a member shared theirs. */
  async resetLink(workspaceId: string, communityId: string, memberId: string) {
    const m = await this.memberOf(workspaceId, communityId, memberId);
    const token = publicToken();
    await this.members.update({ id: m.id }, { accessToken: token });
    return { portalUrl: this.portalUrl(token) };
  }

  async removeMember(workspaceId: string, communityId: string, memberId: string) {
    const m = await this.memberOf(workspaceId, communityId, memberId);
    await this.members.softRemove(m);
    return { id: memberId };
  }

  private async autoJoin(workspaceId: string, contactId: string, courseId: string) {
    const list = await this.communities
      .createQueryBuilder('c')
      .where('c.workspace_id = :workspaceId AND c.is_active = true AND :courseId = ANY(c.auto_join_course_ids)', { workspaceId, courseId })
      .getMany();
    if (!list.length) return;
    const contact = await this.contactRepo.findOne({ where: { id: contactId, workspaceId } });
    if (!contact) return;
    for (const c of list) await this.addMember(workspaceId, c, contact, { source: 'course', notify: true });
  }

  // ---- Public join page (open communities) -------------------------------------------
  private async openCommunity(slug: string) {
    const c = await this.communities.findOne({ where: { slug, isActive: true, joinMode: 'open' } });
    if (!c) throw new NotFoundException('This community is not open for sign-ups');
    return c;
  }

  async joinInfo(slug: string) {
    const c = await this.openCommunity(slug);
    const members = await this.members.count({ where: { communityId: c.id, status: 'active' } });
    return { name: c.name, description: c.description, members };
  }

  /**
   * Always answers the same way and only ever emails the link, so the page can't be used to
   * take over someone else's membership or to find out who is a member.
   */
  async join(slug: string, dto: JoinDto) {
    const c = await this.openCommunity(slug);
    const [firstName, ...rest] = dto.name.trim().split(/\s+/);
    const { contact } = await this.contacts.upsert(c.workspaceId, { firstName, lastName: rest.join(' '), email: dto.email, source: 'community' });
    await this.addMember(c.workspaceId, c, contact, { source: 'join_page', notify: true });
    return { ok: true, message: 'Check your email for your personal link to the community.' };
  }

  // ---- Portal (member magic link) -------------------------------------------------------
  async memberByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundException('This community link is not valid');
    const m = await this.members.findOne({ where: { accessToken: token } });
    if (!m) throw new NotFoundException('This community link is not valid or access was removed');
    if (m.status === 'banned') throw new ForbiddenException('Your access to this community has been removed');
    const c = await this.communities.findOne({ where: { id: m.communityId, isActive: true } });
    if (!c) throw new NotFoundException('This community is closed');
    if (!m.lastSeenAt || Date.now() - m.lastSeenAt.getTime() > 60_000) await this.members.update({ id: m.id }, { lastSeenAt: new Date() });
    return { m, c };
  }

  async portal(token: string) {
    const { m, c } = await this.memberByToken(token);
    const channels = await this.channels.find({ where: { communityId: c.id }, order: { position: 'ASC', createdAt: 'ASC' } });
    const [members, unreadMentions, pts] = await Promise.all([
      this.members.count({ where: { communityId: c.id, status: 'active' } }),
      this.mentionRows.count({ where: { memberId: m.id, readAt: IsNull() } }),
      this.points([m.id]),
    ]);
    return {
      community: { name: c.name, description: c.description, members, digestFrequency: c.digestFrequency },
      channels: channels.map((ch) => ({ id: ch.id, name: ch.name, description: ch.description, staffOnly: ch.staffOnly })),
      me: { id: m.id, displayName: m.displayName, role: m.role, digest: m.digest, mentionEmails: m.mentionEmails, unreadMentions, ...progress(pts.get(m.id) ?? 0) },
    };
  }

  async updateMe(token: string, dto: MeDto) {
    const { m } = await this.memberByToken(token);
    const patch: Partial<CommunityMember> = {};
    if (dto.displayName !== undefined) {
      patch.displayName = cleanDisplayName(dto.displayName);
      if (!patch.displayName) throw new BadRequestException('Enter a display name');
    }
    if (dto.digest) patch.digest = dto.digest;
    if (dto.mentionEmails !== undefined) patch.mentionEmails = dto.mentionEmails;
    if (Object.keys(patch).length) await this.members.update({ id: m.id }, patch);
    return { displayName: patch.displayName ?? m.displayName, digest: patch.digest ?? m.digest, mentionEmails: patch.mentionEmails ?? m.mentionEmails };
  }

  // ---- @mentions -------------------------------------------------------------------------
  /** Autocomplete: active members whose display name contains `q` (names only). */
  async mentionSearch(communityId: string, q: string | undefined, excludeMemberId?: string) {
    const qb = this.members
      .createQueryBuilder('m')
      .select(['m.id', 'm.displayName'])
      .where('m.community_id = :cid AND m.status = :st', { cid: communityId, st: 'active' })
      .orderBy('m.display_name', 'ASC')
      .take(8);
    const term = (q ?? '').trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
    if (term) qb.andWhere('m.display_name ILIKE :t', { t: `%${term}%` });
    if (excludeMemberId) qb.andWhere('m.id <> :me', { me: excludeMemberId });
    return (await qb.getMany()).map((m) => ({ id: m.id, displayName: m.displayName }));
  }

  /** Members picked in the composer, kept only if active, not the author and visibly @mentioned. */
  private async pickMentions(c: Community, a: Actor, body: string, ids?: string[]) {
    if (!ids?.length) return [];
    const list = await this.members.find({ where: { id: In([...new Set(ids)].slice(0, 20)), communityId: c.id, status: 'active' } });
    return resolveMentions(body, list.filter((m) => !(a.kind === 'member' && m.id === a.member.id)), MAX_MENTIONS);
  }

  /** Emails per author per hour; extra mentions are still recorded (inbox) but not emailed. */
  static readonly MENTION_EMAILS_PER_HOUR = 30;

  private async recordMentions(
    c: Community,
    a: Actor,
    mentions: Array<{ memberId: string; name: string }>,
    target: { postId: string; commentId?: string; channelName: string; excerpt: string },
  ) {
    if (!mentions.length) return;
    const by = a.kind === 'member' ? { byMemberId: a.member.id, byUserId: null } : { byMemberId: null, byUserId: a.userId };
    const rows = await this.mentionRows.save(
      mentions.map((x) => this.mentionRows.create({ workspaceId: c.workspaceId, communityId: c.id, memberId: x.memberId, postId: target.postId, commentId: target.commentId ?? null, ...by })),
    );
    const sentLastHour = await this.mentionRows
      .createQueryBuilder('r')
      .where(a.kind === 'member' ? 'r.by_member_id = :by' : 'r.by_user_id = :by', { by: a.kind === 'member' ? a.member.id : a.userId })
      .andWhere(`r.emailed_at > now() - interval '1 hour'`)
      .getCount();
    let budget = CommunitiesService.MENTION_EMAILS_PER_HOUR - sentLastHour;
    const people = await this.members
      .createQueryBuilder('m')
      .addSelect('m.accessToken')
      .innerJoinAndSelect('m.contact', 'ct')
      .where('m.id IN (:...ids)', { ids: mentions.map((x) => x.memberId) })
      .getMany();
    const author = a.kind === 'member' ? a.member.displayName : (await this.users.findOne({ where: { id: a.userId }, select: { id: true, name: true } }))?.name ?? 'The team';
    for (const m of people) {
      const row = rows.find((r) => r.memberId === m.id)!;
      if (budget <= 0 || !m.mentionEmails || !m.contact.email || m.contact.dnd) continue;
      budget--;
      const link = `${this.portalUrl(m.accessToken)}?post=${target.postId}`;
      const msg = await this.inbox
        .send(
          c.workspaceId,
          {
            contactId: m.contactId,
            channel: 'email',
            subject: `${author} mentioned you in ${c.name}`,
            body:
              `Hi ${m.contact.firstName || m.displayName},\n\n${author} mentioned you ${target.commentId ? 'in a comment ' : ''}in #${target.channelName}:\n\n` +
              `\u201c${target.excerpt}\u201d\n\nSee it and reply (this is your personal link, please don't share it):\n${link}\n\n` +
              `Don't want these emails? Turn them off here: ${this.portalUrl(m.accessToken)}?digest=settings`,
          },
          null,
        )
        .catch((e) => ({ status: 'failed', error: e.message }));
      if (msg.status !== 'failed') await this.mentionRows.update({ id: row.id }, { emailedAt: new Date() });
    }
  }

  /** The member's Mentions inbox (latest 30). */
  async myMentions(token: string) {
    const { m, c } = await this.memberByToken(token);
    const rows = await this.mentionRows.find({ where: { memberId: m.id, communityId: c.id }, order: { createdAt: 'DESC' }, take: 30 });
    if (!rows.length) return [];
    const [posts, comments] = await Promise.all([
      this.posts.find({ where: { id: In(rows.map((r) => r.postId)), hidden: false } }),
      this.comments.find({ where: { id: In(rows.map((r) => r.commentId).filter(Boolean) as string[]), hidden: false } }),
    ]);
    const live = new Set((await this.channels.find({ where: { communityId: c.id } })).map((x) => x.id));
    const who = await this.authors(rows.map((r) => ({ memberId: r.byMemberId, authorUserId: r.byUserId })));
    return rows
      .map((r) => {
        const p = posts.find((x) => x.id === r.postId);
        const cm = r.commentId ? comments.find((x) => x.id === r.commentId) : null;
        // Mentions in content that was since hidden or deleted disappear.
        if (!p || !live.has(p.channelId) || (r.commentId && !cm)) return null;
        const au = who({ memberId: r.byMemberId, authorUserId: r.byUserId });
        return { id: r.id, postId: r.postId, inComment: !!r.commentId, excerpt: (cm ?? p).body.slice(0, 200), createdAt: r.createdAt, unread: !r.readAt, author: { name: au.name, badge: au.badge, level: au.level } };
      })
      .filter(Boolean);
  }

  async markMentionsRead(token: string) {
    const { m } = await this.memberByToken(token);
    await this.mentionRows.update({ memberId: m.id, readAt: IsNull() }, { readAt: new Date() });
    return { ok: true };
  }

  // ---- Feed (shared by staff and portal) --------------------------------------------------
  private canModerate(a: Actor) {
    return a.kind === 'staff' || a.member.role === 'moderator';
  }

  private async authors(rows: Array<{ memberId: string | null; authorUserId: string | null }>) {
    const memberIds = [...new Set(rows.map((r) => r.memberId).filter(Boolean))] as string[];
    const userIds = [...new Set(rows.map((r) => r.authorUserId).filter(Boolean))] as string[];
    const [ms, us] = await Promise.all([
      memberIds.length ? this.members.find({ where: { id: In(memberIds) }, withDeleted: true }) : [],
      userIds.length ? this.users.find({ where: { id: In(userIds) }, select: { id: true, name: true } }) : [],
    ]);
    const pts = await this.points(memberIds);
    return (r: { memberId: string | null; authorUserId: string | null }) => {
      if (r.authorUserId) return { name: us.find((u) => u.id === r.authorUserId)?.name ?? 'Team', badge: 'Team' as const, memberId: null, contactId: null, level: null };
      const m = ms.find((x) => x.id === r.memberId);
      return { name: m?.displayName ?? 'Former member', badge: m?.role === 'moderator' ? ('Moderator' as const) : null, memberId: m?.id ?? null, contactId: m?.contactId ?? null, level: m ? levelFor(pts.get(m.id) ?? 0) : null };
    };
  }

  /** Names only (no ids) so other members' ids never reach the browser; `isMe` highlights your own name. */
  private mentionsOut(a: Actor, list: Array<{ memberId: string; name: string }> | null | undefined) {
    return (list ?? []).map((x) => ({ name: x.name, isMe: a.kind === 'member' && x.memberId === a.member.id }));
  }

  private isMine(a: Actor, r: { memberId: string | null; authorUserId: string | null }) {
    return a.kind === 'staff' ? r.authorUserId === a.userId : r.memberId === a.member.id;
  }

  async feed(communityId: string, a: Actor, q: FeedQuery) {
    const showHidden = this.canModerate(a);
    // Posts in deleted channels disappear with the channel.
    const live = (await this.channels.find({ where: { communityId }, select: { id: true } })).map((c) => c.id);
    if (q.channelId && !live.includes(q.channelId)) return { posts: [], nextBefore: null };
    const base: any = { communityId, channelId: q.channelId ?? In(live.length ? live : ['00000000-0000-0000-0000-000000000000']), ...(showHidden ? {} : { hidden: false }) };
    if (q.postId) base.id = q.postId;
    const pinned = q.before || q.postId ? [] : await this.posts.find({ where: { ...base, pinned: true }, order: { createdAt: 'DESC' }, take: 5 });
    const rest = await this.posts.find({
      where: { ...base, ...(q.postId ? {} : { pinned: false }), ...(q.before ? { createdAt: LessThan(new Date(q.before)) } : {}) },
      order: { createdAt: 'DESC' },
      take: PAGE + 1,
    });
    const page = rest.slice(0, PAGE);
    const all = [...pinned, ...page];
    const who = await this.authors(all);
    const liked = all.length
      ? new Set(
          (await this.likes.find({ where: { postId: In(all.map((p) => p.id)), ...(a.kind === 'staff' ? { userId: a.userId } : { memberId: a.member.id }) } })).map((l) => l.postId),
        )
      : new Set<string>();
    const staff = a.kind === 'staff';
    const pics = await this.images.forPosts(all.map((p) => p.id));
    const docs = await this.images.filesForPosts(all.map((p) => p.id));
    return {
      posts: all.map((p) => {
        const au = who(p);
        return {
          id: p.id,
          channelId: p.channelId,
          body: p.body,
          pinned: p.pinned,
          ...(showHidden ? { hidden: p.hidden } : {}),
          createdAt: p.createdAt,
          author: { name: au.name, badge: au.badge, level: au.level, ...(staff ? { contactId: au.contactId } : {}) },
          likeCount: p.likeCount,
          liked: liked.has(p.id),
          commentCount: p.commentCount,
          canDelete: this.isMine(a, p) || this.canModerate(a),
          mentions: this.mentionsOut(a, p.mentions),
          images: pics.get(p.id) ?? [],
          files: docs.get(p.id) ?? [],
        };
      }),
      nextBefore: rest.length > PAGE ? page[page.length - 1].createdAt : null,
    };
  }

  private async postIn(communityId: string, postId: string, a: Actor) {
    const p = await this.posts.findOne({ where: { id: postId, communityId } });
    if (!p || (p.hidden && !this.canModerate(a)) || !(await this.channels.exist({ where: { id: p.channelId, communityId } }))) throw new NotFoundException('Post not found');
    return p;
  }

  async createPost(c: Community, a: Actor, dto: PostDto) {
    const ch = await this.channels.findOne({ where: { id: dto.channelId, communityId: c.id } });
    if (!ch) throw new NotFoundException('Channel not found');
    if (ch.staffOnly && !this.canModerate(a)) throw new ForbiddenException(`Only the team can post in #${ch.name}`);
    const body = cleanBody(dto.body, POST_MAX);
    // Only the poster's own, not-yet-used uploads from this community can be attached.
    const imageIds = await this.images.attachable(c.id, this.uploader(a), [...new Set(dto.imageIds ?? [])]);
    if ((dto.imageIds?.length ?? 0) > imageIds.length) throw new BadRequestException('Some images could not be attached. Upload them again.');
    const fileIds = await this.images.attachable(c.id, this.uploader(a), [...new Set(dto.fileIds ?? [])], 'file');
    if ((dto.fileIds?.length ?? 0) > fileIds.length) throw new BadRequestException('Some files could not be attached. Upload them again.');
    if (!body && !imageIds.length && !fileIds.length) throw new BadRequestException('Write something first');
    const mentions = await this.pickMentions(c, a, body, dto.mentions);
    const p = await this.posts.save(
      this.posts.create({
        workspaceId: c.workspaceId,
        communityId: c.id,
        channelId: ch.id,
        body,
        mentions,
        memberId: a.kind === 'member' ? a.member.id : null,
        authorUserId: a.kind === 'staff' ? a.userId : null,
      }),
    );
    // Member activity only: team posts shouldn't start "member posted" automations or notify the team.
    if (a.kind === 'member') this.events.emit({
      type: 'community.post_created',
      workspaceId: c.workspaceId,
      userId: null,
      contactId: a.kind === 'member' ? a.member.contactId : undefined,
      payload: { community: { id: c.id, name: c.name }, channel: { id: ch.id, name: ch.name }, post: { id: p.id, excerpt: body.slice(0, 140) }, author: a.kind === 'member' ? a.member.displayName : 'Team' },
    });
    await this.images.attach(p.id, imageIds);
    await this.images.attach(p.id, fileIds);
    await this.recordMentions(c, a, mentions, { postId: p.id, channelName: ch.name, excerpt: body.slice(0, 200) || '(photo)' }).catch((e) => this.logger.warn(`Mention notices failed: ${e.message}`));
    return (await this.feedItem(c.id, a, p.id))!;
  }

  private async feedItem(communityId: string, a: Actor, postId: string) {
    const p = await this.posts.findOneByOrFail({ id: postId });
    const au = (await this.authors([p]))(p);
    const images = (await this.images.forPosts([p.id])).get(p.id) ?? [];
    const files = (await this.images.filesForPosts([p.id])).get(p.id) ?? [];
    return { id: p.id, channelId: p.channelId, body: p.body, pinned: p.pinned, createdAt: p.createdAt, author: { name: au.name, badge: au.badge, level: au.level }, likeCount: p.likeCount, liked: false, commentCount: p.commentCount, canDelete: true, mentions: this.mentionsOut(a, p.mentions), images, files };
  }

  async deletePost(communityId: string, a: Actor, postId: string) {
    const p = await this.postIn(communityId, postId, a);
    if (!this.isMine(a, p) && !this.canModerate(a)) throw new ForbiddenException('You can only delete your own posts');
    await this.posts.softRemove(p);
    return { id: postId };
  }

  async moderatePost(communityId: string, a: Actor, postId: string, dto: ModerateDto) {
    if (!this.canModerate(a)) throw new ForbiddenException('Only moderators can do that');
    const p = await this.postIn(communityId, postId, a);
    if (dto.hidden !== undefined) p.hidden = dto.hidden;
    if (dto.pinned !== undefined) p.pinned = dto.pinned;
    await this.posts.save(p);
    return { id: p.id, hidden: p.hidden, pinned: p.pinned };
  }

  async toggleLike(communityId: string, a: Actor, postId: string) {
    const p = await this.postIn(communityId, postId, a);
    const who = a.kind === 'staff' ? { userId: a.userId } : { memberId: a.member.id };
    const existing = await this.likes.findOne({ where: { postId: p.id, ...who } });
    if (existing) await this.likes.delete({ id: existing.id });
    else await this.likes.insert({ postId: p.id, ...who }).catch(() => undefined); // double-click race: unique index keeps one
    await this.posts.query(`UPDATE community_posts SET like_count = (SELECT COUNT(*) FROM community_likes WHERE post_id = $1) WHERE id = $1`, [p.id]);
    const { likeCount } = await this.posts.findOneByOrFail({ id: p.id });
    return { liked: !existing, likeCount };
  }

  async listComments(communityId: string, a: Actor, postId: string) {
    const p = await this.postIn(communityId, postId, a);
    const rows = await this.comments.find({ where: { postId: p.id, ...(this.canModerate(a) ? {} : { hidden: false }) }, order: { createdAt: 'ASC' }, take: 500 });
    const who = await this.authors(rows);
    return rows.map((r) => {
      const au = who(r);
      return { id: r.id, body: r.body, createdAt: r.createdAt, ...(this.canModerate(a) ? { hidden: r.hidden } : {}), author: { name: au.name, badge: au.badge, level: au.level }, canDelete: this.isMine(a, r) || this.canModerate(a), mentions: this.mentionsOut(a, r.mentions) };
    });
  }

  private async recount(postId: string) {
    await this.posts.query(
      `UPDATE community_posts SET comment_count = (SELECT COUNT(*) FROM community_comments WHERE post_id = $1 AND hidden = false AND deleted_at IS NULL) WHERE id = $1`,
      [postId],
    );
  }

  async addComment(c: Community, a: Actor, postId: string, dto: CommentDto) {
    const p = await this.postIn(c.id, postId, a);
    const body = cleanBody(dto.body, COMMENT_MAX);
    if (!body) throw new BadRequestException('Write something first');
    const mentions = await this.pickMentions(c, a, body, dto.mentions);
    const cm = await this.comments.save(
      this.comments.create({ workspaceId: c.workspaceId, postId: p.id, body, mentions, memberId: a.kind === 'member' ? a.member.id : null, authorUserId: a.kind === 'staff' ? a.userId : null }),
    );
    await this.recount(p.id);
    // Member activity only: team posts shouldn't start "member posted" automations or notify the team.
    if (a.kind === 'member') this.events.emit({
      type: 'community.comment_created',
      workspaceId: c.workspaceId,
      userId: null,
      contactId: a.kind === 'member' ? a.member.contactId : undefined,
      payload: { community: { id: c.id, name: c.name }, post: { id: p.id }, author: a.kind === 'member' ? a.member.displayName : 'Team' },
    });
    const ch = await this.channels.findOne({ where: { id: p.channelId } });
    await this.recordMentions(c, a, mentions, { postId: p.id, commentId: cm.id, channelName: ch?.name ?? '', excerpt: body.slice(0, 200) }).catch((e) => this.logger.warn(`Mention notices failed: ${e.message}`));
    const au = (await this.authors([cm]))(cm);
    return { id: cm.id, body: cm.body, createdAt: cm.createdAt, author: { name: au.name, badge: au.badge, level: au.level }, canDelete: true, mentions: this.mentionsOut(a, cm.mentions) };
  }

  private async commentIn(communityId: string, commentId: string, a: Actor) {
    const cm = await this.comments.findOne({ where: { id: commentId } });
    if (!cm) throw new NotFoundException('Comment not found');
    await this.postIn(communityId, cm.postId, a);
    return cm;
  }

  async deleteComment(communityId: string, a: Actor, commentId: string) {
    const cm = await this.commentIn(communityId, commentId, a);
    if (!this.isMine(a, cm) && !this.canModerate(a)) throw new ForbiddenException('You can only delete your own comments');
    await this.comments.softRemove(cm);
    await this.recount(cm.postId);
    return { id: commentId };
  }

  async moderateComment(communityId: string, a: Actor, commentId: string, dto: ModerateDto) {
    if (!this.canModerate(a)) throw new ForbiddenException('Only moderators can do that');
    const cm = await this.commentIn(communityId, commentId, a);
    if (dto.hidden !== undefined) await this.comments.update({ id: cm.id }, { hidden: dto.hidden });
    await this.recount(cm.postId);
    return { id: cm.id, hidden: dto.hidden ?? cm.hidden };
  }
}

// ---- Staff controller ---------------------------------------------------------------
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly svc: CommunitiesService) {}
  private staff = (userId: string) => ({ kind: 'staff' as const, userId });

  @Get()
  @Permissions('courses:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('courses:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateCommunityDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('courses:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(ws, id);
  }

  @Put(':id')
  @Permissions('courses:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunityDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('courses:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Post(':id/channels')
  @Permissions('courses:write')
  addChannel(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChannelDto) {
    return this.svc.addChannel(ws, id, dto);
  }

  @Put(':id/channels/:channelId')
  @Permissions('courses:write')
  updateChannel(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Param('channelId', ParseUUIDPipe) channelId: string, @Body() dto: ChannelDto) {
    return this.svc.updateChannel(ws, id, channelId, dto);
  }

  @Delete(':id/channels/:channelId')
  @Permissions('courses:write')
  removeChannel(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Param('channelId', ParseUUIDPipe) channelId: string) {
    return this.svc.removeChannel(ws, id, channelId);
  }

  @Get(':id/mention-search')
  @Permissions('courses:read')
  async staffMentionSearch(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: MentionSearchQuery) {
    await this.svc.get(ws, id);
    return this.svc.mentionSearch(id, q.q);
  }

  @Get(':id/members')
  @Permissions('courses:read')
  members(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listMembers(ws, id);
  }

  @Post(':id/members')
  @Permissions('courses:write')
  addMember(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.svc.staffAddMember(ws, id, dto, userId);
  }

  @Put(':id/members/:memberId')
  @Permissions('courses:write')
  updateMember(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Body() dto: UpdateMemberDto) {
    return this.svc.updateMember(ws, id, memberId, dto);
  }

  @Post(':id/members/:memberId/reset-link')
  @Permissions('courses:write')
  resetLink(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.resetLink(ws, id, memberId);
  }

  @Delete(':id/members/:memberId')
  @Permissions('courses:write')
  removeMember(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.removeMember(ws, id, memberId);
  }

  // Feed as staff (sees hidden content, can moderate everything)
  @Get(':id/posts')
  @Permissions('courses:read')
  async feed(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: FeedQuery) {
    await this.svc.get(ws, id);
    return this.svc.feed(id, this.staff(userId), q);
  }

  @Post(':id/images')
  @Permissions('courses:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } }))
  async staffUpload(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedImage) {
    return this.svc.uploadImage(await this.svc.get(ws, id), this.staff(userId), file);
  }

  @Post(':id/files')
  @Permissions('courses:write')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: FILE_MAX_BYTES, files: 1 } }))
  async staffUploadFile(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedImage) {
    return this.svc.uploadFile(await this.svc.get(ws, id), this.staff(userId), file);
  }

  @Get(':id/leaderboard')
  @Permissions('courses:read')
  async leaderboard(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: LeaderboardQuery) {
    await this.svc.get(ws, id);
    return this.svc.leaderboard(id, q.period ?? '30d');
  }

  @Post(':id/posts')
  @Permissions('courses:write')
  async post(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.svc.createPost(await this.svc.get(ws, id), this.staff(userId), dto);
  }

  @Put(':id/posts/:postId')
  @Permissions('courses:write')
  async moderate(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: ModerateDto) {
    await this.svc.get(ws, id);
    return this.svc.moderatePost(id, this.staff(userId), postId, dto);
  }

  @Delete(':id/posts/:postId')
  @Permissions('courses:write')
  async deletePost(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.svc.get(ws, id);
    return this.svc.deletePost(id, this.staff(userId), postId);
  }

  @Post(':id/posts/:postId/like')
  @Permissions('courses:read')
  async like(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.svc.get(ws, id);
    return this.svc.toggleLike(id, this.staff(userId), postId);
  }

  @Get(':id/posts/:postId/comments')
  @Permissions('courses:read')
  async comments(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string) {
    await this.svc.get(ws, id);
    return this.svc.listComments(id, this.staff(userId), postId);
  }

  @Post(':id/posts/:postId/comments')
  @Permissions('courses:write')
  async comment(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: CommentDto) {
    return this.svc.addComment(await this.svc.get(ws, id), this.staff(userId), postId, dto);
  }

  @Put(':id/comments/:commentId')
  @Permissions('courses:write')
  async moderateComment(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string, @Body() dto: ModerateDto) {
    await this.svc.get(ws, id);
    return this.svc.moderateComment(id, this.staff(userId), commentId, dto);
  }

  @Delete(':id/comments/:commentId')
  @Permissions('courses:write')
  async deleteComment(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    await this.svc.get(ws, id);
    return this.svc.deleteComment(id, this.staff(userId), commentId);
  }
}

// ---- Member portal (magic link) ----------------------------------------------------
@Controller('public/community/:token')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class CommunityPortalController {
  constructor(private readonly svc: CommunitiesService) {}

  private async actor(token: string) {
    const { m, c } = await this.svc.memberByToken(token);
    return { a: { kind: 'member' as const, member: m }, c };
  }

  @Get()
  portal(@Param('token') token: string) {
    return this.svc.portal(token);
  }

  @Put('me')
  me(@Param('token') token: string, @Body() dto: MeDto) {
    return this.svc.updateMe(token, dto);
  }

  @Get('mention-search')
  async mentionSearch(@Param('token') token: string, @Query() q: MentionSearchQuery) {
    const { a, c } = await this.actor(token);
    return this.svc.mentionSearch(c.id, q.q, a.member.id);
  }

  @Get('mentions')
  mentions(@Param('token') token: string) {
    return this.svc.myMentions(token);
  }

  @Post('mentions/read')
  readMentions(@Param('token') token: string) {
    return this.svc.markMentionsRead(token);
  }

  @Get('posts')
  async feed(@Param('token') token: string, @Query() q: FeedQuery) {
    const { a, c } = await this.actor(token);
    return this.svc.feed(c.id, a, q);
  }

  @Post('images')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } }))
  async upload(@Param('token') token: string, @UploadedFile() file?: UploadedImage) {
    const { a, c } = await this.actor(token);
    return this.svc.uploadImage(c, a, file);
  }

  @Post('files')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: FILE_MAX_BYTES, files: 1 } }))
  async uploadFile(@Param('token') token: string, @UploadedFile() file?: UploadedImage) {
    const { a, c } = await this.actor(token);
    return this.svc.uploadFile(c, a, file);
  }

  @Get('leaderboard')
  async leaderboard(@Param('token') token: string, @Query() q: LeaderboardQuery) {
    const { a, c } = await this.actor(token);
    return this.svc.leaderboard(c.id, q.period ?? '30d', a.member.id);
  }

  @Post('posts')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async post(@Param('token') token: string, @Body() dto: PostDto) {
    const { a, c } = await this.actor(token);
    return this.svc.createPost(c, a, dto);
  }

  @Delete('posts/:postId')
  async deletePost(@Param('token') token: string, @Param('postId', ParseUUIDPipe) postId: string) {
    const { a, c } = await this.actor(token);
    return this.svc.deletePost(c.id, a, postId);
  }

  @Put('posts/:postId')
  async moderate(@Param('token') token: string, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: ModerateDto) {
    const { a, c } = await this.actor(token);
    return this.svc.moderatePost(c.id, a, postId, dto);
  }

  @Post('posts/:postId/like')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async like(@Param('token') token: string, @Param('postId', ParseUUIDPipe) postId: string) {
    const { a, c } = await this.actor(token);
    return this.svc.toggleLike(c.id, a, postId);
  }

  @Get('posts/:postId/comments')
  async comments(@Param('token') token: string, @Param('postId', ParseUUIDPipe) postId: string) {
    const { a, c } = await this.actor(token);
    return this.svc.listComments(c.id, a, postId);
  }

  @Post('posts/:postId/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async comment(@Param('token') token: string, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: CommentDto) {
    const { a, c } = await this.actor(token);
    return this.svc.addComment(c, a, postId, dto);
  }

  @Delete('comments/:commentId')
  async deleteComment(@Param('token') token: string, @Param('commentId', ParseUUIDPipe) commentId: string) {
    const { a, c } = await this.actor(token);
    return this.svc.deleteComment(c.id, a, commentId);
  }

  @Put('comments/:commentId')
  async moderateComment(@Param('token') token: string, @Param('commentId', ParseUUIDPipe) commentId: string, @Body() dto: ModerateDto) {
    const { a, c } = await this.actor(token);
    return this.svc.moderateComment(c.id, a, commentId, dto);
  }
}

@Controller('public/communities')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class CommunityJoinController {
  constructor(private readonly svc: CommunitiesService) {}

  @Get(':slug')
  info(@Param('slug') slug: string) {
    return this.svc.joinInfo(slug);
  }

  @Post(':slug/join')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  join(@Param('slug') slug: string, @Body() dto: JoinDto) {
    return this.svc.join(slug, dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Community, CommunityChannel, CommunityMember, CommunityPost, CommunityComment, CommunityLike, CommunityMention, CommunityImage, Contact, Course, User]),
    CrmModule,
    CommunicationModule,
  ],
  // Digest routes (/communities/:id/digests/...) are static, so register them before the :id routes.
  controllers: [CommunityDigestsController, CommunitiesController, CommunityPortalController, CommunityJoinController, CommunityImagePublicController],
  providers: [CommunitiesService, CommunityDigestsService, CommunityImagesService],
})
export class CommunitiesModule {}


