import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import { Between, In, Repository } from 'typeorm';
import { SocialPost } from '../database/entities/social.entity';
import { MetaPage } from '../database/entities/meta.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../events/activity.service';
import { captionFor, overallStatus, validatePost, type Target } from './social-rules';

class PostDto {
  @IsOptional() @IsString() @MaxLength(63206) body?: string;
  @IsOptional() @ValidateIf((o) => o.link !== null) @IsString() @MaxLength(1000) link?: string | null;
  @IsOptional() @ValidateIf((o) => o.imageUrl !== null) @IsString() @MaxLength(1000) imageUrl?: string | null;
  /** Connected page ids (Settings → Facebook & Instagram). */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) pageIds?: string[];
  /** When to publish; null = keep as a draft. */
  @IsOptional() @ValidateIf((o) => o.scheduledAt !== null) @IsDateString() scheduledAt?: string | null;
  /** Publish right away instead. */
  @IsOptional() @IsBoolean() publishNow?: boolean;
}
class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

/** Facebook Page / Instagram publishing via the Graph API (META_PROVIDER=meta); console mode logs instead. */
@Injectable()
export class SocialPublisher {
  private readonly logger = new Logger(SocialPublisher.name);
  constructor(private readonly config: ConfigService) {}

  private get live() {
    return (this.config.get<string>('META_PROVIDER') || 'console').toLowerCase() === 'meta';
  }

  private async graph(path: string, token: string, params: Record<string, string>) {
    const version = this.config.get<string>('META_GRAPH_VERSION') || 'v19.0';
    const res = await fetch(`https://graph.facebook.com/${version}/${path}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json?.error?.message ?? `Meta error ${res.status}`);
    return json;
  }

  async publish(page: MetaPage, post: { body: string; link: string | null; imageUrl: string | null }): Promise<string> {
    const caption = captionFor(page.platform, post.body, post.link);
    if (!this.live) {
      this.logger.log(`[console ${page.platform} post] ${page.name}: ${caption.slice(0, 120)}${post.imageUrl ? ` [image ${post.imageUrl}]` : ''}`);
      return `console-${randomUUID()}`;
    }
    if (page.platform === 'instagram') {
      // Two steps: create a media container, then publish it.
      const container = await this.graph(`${page.pageId}/media`, page.accessToken, { image_url: post.imageUrl!, caption });
      const done = await this.graph(`${page.pageId}/media_publish`, page.accessToken, { creation_id: container.id });
      return String(done.id);
    }
    const r = post.imageUrl
      ? await this.graph(`${page.pageId}/photos`, page.accessToken, { url: post.imageUrl, caption: [caption, post.link].filter(Boolean).join('\n\n') })
      : await this.graph(`${page.pageId}/feed`, page.accessToken, { message: caption, ...(post.link ? { link: post.link } : {}) });
    return String(r.post_id ?? r.id);
  }
}

@Injectable()
export class SocialService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(SocialPost) private readonly posts: Repository<SocialPost>,
    @InjectRepository(MetaPage) private readonly pages: Repository<MetaPage>,
    private readonly publisher: SocialPublisher,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => this.runDue().catch((e) => this.logger.error(`Social publishing failed: ${e.message}`)), 30_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  accounts(workspaceId: string) {
    return this.pages.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
  }

  async list(workspaceId: string, q: RangeQuery) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 31 * 86_400_000);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 92 * 86_400_000);
    const dated = await this.posts.find({ where: { workspaceId, scheduledAt: Between(from, to) }, order: { scheduledAt: 'ASC' } });
    const drafts = await this.posts.find({ where: { workspaceId, status: 'draft' }, order: { updatedAt: 'DESC' }, take: 50 });
    const seen = new Set(dated.map((p) => p.id));
    return [...drafts.filter((d) => !seen.has(d.id)), ...dated];
  }

  private async get(workspaceId: string, id: string) {
    const p = await this.posts.findOne({ where: { id, workspaceId } });
    if (!p) throw new NotFoundException('Post not found');
    return p;
  }

  /** Builds targets from page ids and checks the post fits every chosen platform. */
  private async targetsFor(workspaceId: string, ids: string[], post: { body: string; link: string | null; imageUrl: string | null }) {
    const unique = [...new Set(ids)];
    const found = unique.length ? await this.pages.find({ where: { id: In(unique), workspaceId } }) : [];
    if (found.length !== unique.length) throw new BadRequestException('Some of the chosen pages are not connected');
    const errs = validatePost(post, found.map((p) => p.platform));
    if (errs.length) throw new BadRequestException(errs.join('. '));
    return found.map<Target>((p) => ({ pageId: p.id, platform: p.platform, name: p.name, status: 'pending', externalId: null, error: null, publishedAt: null }));
  }

  private when(dto: PostDto, fallback: Date | null): { status: 'draft' | 'scheduled'; at: Date | null } {
    if (dto.publishNow) return { status: 'scheduled', at: new Date() };
    const at = dto.scheduledAt === undefined ? fallback : dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (at && at.getTime() < Date.now() - 60_000) throw new BadRequestException('That time has passed. Pick a time in the future, or post now.');
    return at ? { status: 'scheduled', at } : { status: 'draft', at: null };
  }

  async create(workspaceId: string, userId: string, dto: PostDto) {
    const content = { body: (dto.body ?? '').trim(), link: dto.link?.trim() || null, imageUrl: dto.imageUrl?.trim() || null };
    const targets = await this.targetsFor(workspaceId, dto.pageIds ?? [], content);
    const { status, at } = this.when(dto, null);
    const p = await this.posts.save(this.posts.create({ workspaceId, ...content, targets, status, scheduledAt: at, createdBy: userId }));
    return dto.publishNow ? this.publishOne(p.id) : p;
  }

  async update(workspaceId: string, id: string, dto: PostDto) {
    const p = await this.get(workspaceId, id);
    if (p.status !== 'draft' && p.status !== 'scheduled') throw new ConflictException('Only drafts and scheduled posts can be edited');
    const content = {
      body: dto.body !== undefined ? dto.body.trim() : p.body,
      link: dto.link !== undefined ? dto.link?.trim() || null : p.link,
      imageUrl: dto.imageUrl !== undefined ? dto.imageUrl?.trim() || null : p.imageUrl,
    };
    const targets = await this.targetsFor(workspaceId, dto.pageIds ?? p.targets.map((t) => t.pageId), content);
    const { status, at } = this.when(dto, p.scheduledAt);
    // Only update if nobody started publishing it meanwhile.
    const res = await this.posts.update({ id, status: p.status }, { ...content, targets, status, scheduledAt: at });
    if (!res.affected) throw new ConflictException('This post is being published right now');
    return dto.publishNow ? this.publishOne(id) : this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    const p = await this.get(workspaceId, id);
    if (p.status === 'publishing') throw new ConflictException('This post is being published right now');
    // Deleting here never removes what's already on Facebook/Instagram.
    await this.posts.softRemove(p);
    return { id };
  }

  async publishNow(workspaceId: string, id: string) {
    const p = await this.get(workspaceId, id);
    if (p.status !== 'draft' && p.status !== 'scheduled') throw new ConflictException('This post was already published');
    await this.targetsFor(workspaceId, p.targets.map((t) => t.pageId), p);
    await this.posts.update({ id, status: p.status }, { status: 'scheduled', scheduledAt: new Date() });
    return this.publishOne(id);
  }

  /** Scheduler: publish everything that's due. */
  async runDue() {
    const due: Array<{ id: string }> = await this.posts.query(
      `SELECT id FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= now() AND deleted_at IS NULL ORDER BY scheduled_at LIMIT 20`,
    );
    for (const d of due) await this.publishOne(d.id).catch((e) => this.logger.warn(`Post ${d.id}: ${e.message}`));
    return due.length;
  }

  /** Claims the post (scheduled → publishing) so each one is published once, then tries every target. */
  private async publishOne(id: string) {
    const claim = await this.posts.update({ id, status: 'scheduled' }, { status: 'publishing' });
    const p = await this.posts.findOneByOrFail({ id });
    if (!claim.affected) return p;
    const pages = await this.pages.createQueryBuilder('p').addSelect('p.accessToken').where('p.id IN (:...ids)', { ids: p.targets.map((t) => t.pageId).concat('00000000-0000-0000-0000-000000000000') }).getMany();
    const targets: Target[] = [];
    for (const t of p.targets) {
      const page = pages.find((x) => x.id === t.pageId);
      if (!page) {
        targets.push({ ...t, status: 'failed', error: 'This page was disconnected' });
        continue;
      }
      try {
        const externalId = await this.publisher.publish(page, p);
        targets.push({ ...t, status: 'published', externalId, error: null, publishedAt: new Date().toISOString() });
      } catch (e) {
        targets.push({ ...t, status: 'failed', error: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
    const status = overallStatus(targets);
    await this.posts.update({ id }, { targets, status, publishedAt: targets.some((t) => t.status === 'published') ? new Date() : null });
    await this.activity.record(p.workspaceId, `social.${status}`, `Social post ${status === 'published' ? 'published' : status === 'partial' ? 'partly published' : 'failed'} to ${targets.map((t) => t.name).join(', ')}`, {});
    return this.posts.findOneByOrFail({ id });
  }
}

@Controller('social')
export class SocialController {
  constructor(private readonly svc: SocialService) {}

  @Get('accounts')
  @Permissions('campaigns:read')
  accounts(@Tenant('workspaceId') ws: string) {
    return this.svc.accounts(ws);
  }

  @Get('posts')
  @Permissions('campaigns:read')
  list(@Tenant('workspaceId') ws: string, @Query() q: RangeQuery) {
    return this.svc.list(ws, q);
  }

  @Post('posts')
  @Permissions('campaigns:write')
  create(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: PostDto) {
    return this.svc.create(ws, userId, dto);
  }

  @Put('posts/:id')
  @Permissions('campaigns:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto) {
    return this.svc.update(ws, id, dto);
  }

  @Post('posts/:id/publish')
  @Permissions('campaigns:write')
  publish(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publishNow(ws, id);
  }

  @Delete('posts/:id')
  @Permissions('campaigns:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([SocialPost, MetaPage])],
  controllers: [SocialController],
  providers: [SocialService, SocialPublisher],
})
export class SocialModule {}
