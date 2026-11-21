import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Brackets, LessThanOrEqual, Repository } from 'typeorm';
import { BlogPost } from '../database/entities/blog.entity';
import { Site } from '../database/entities/site.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { POST_SLUG_RE, cleanTags, excerptOf, postSlug, readMinutes, rssXml } from './blog-text';

class PostFieldsDto {
  @IsOptional() @IsString() @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(300) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(100_000) body?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverImageUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) authorName?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsIn(['draft', 'published']) status?: 'draft' | 'published';
  /** Publish date; in the future = scheduled. */
  @IsOptional() @ValidateIf((o) => o.publishedAt !== null) @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string;
}
class CreatePostDto extends PostFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
}
class UpdatePostDto extends PostFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
}
class ListQuery {
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}

const PAGE_SIZE = 10;
const isHttps = (u: string) => /^https:\/\/[^\s"'<>]+$/i.test(u);

@Injectable()
export class BlogService {
  constructor(
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly config: ConfigService,
  ) {}

  private async site(workspaceId: string, siteId: string) {
    const s = await this.sites.findOne({ where: { id: siteId, workspaceId } });
    if (!s) throw new NotFoundException('Site not found');
    return s;
  }

  private view(p: BlogPost) {
    const live = p.status === 'published' && !!p.publishedAt && p.publishedAt.getTime() <= Date.now();
    return { ...p, state: p.status === 'draft' ? 'draft' : live ? 'published' : 'scheduled', readMinutes: readMinutes(p.body) };
  }

  async list(workspaceId: string, siteId: string) {
    await this.site(workspaceId, siteId);
    const rows = await this.posts.find({ where: { siteId, workspaceId }, order: { updatedAt: 'DESC' } });
    return rows.map((p) => ({ ...this.view(p), body: undefined }));
  }

  async get(workspaceId: string, siteId: string, id: string) {
    const p = await this.posts.findOne({ where: { id, siteId, workspaceId } });
    if (!p) throw new NotFoundException('Post not found');
    return p;
  }

  /** A free slug for the site, adding -2, -3… when taken. */
  private async freeSlug(siteId: string, base: string, exceptId?: string) {
    for (let n = 1; n < 200; n++) {
      const s = n === 1 ? base : `${base.slice(0, 95)}-${n}`;
      const taken = await this.posts.findOne({ where: { siteId, slug: s }, select: { id: true } });
      if (!taken || taken.id === exceptId) return s;
    }
    throw new ConflictException('Could not find a free URL for this post');
  }

  private apply(p: BlogPost, dto: PostFieldsDto & { title?: string }) {
    if (dto.title !== undefined) p.title = dto.title.trim();
    if (dto.excerpt !== undefined) p.excerpt = dto.excerpt.trim();
    if (dto.body !== undefined) p.body = dto.body;
    if (dto.coverImageUrl !== undefined) {
      const u = dto.coverImageUrl.trim();
      if (u && !isHttps(u)) throw new BadRequestException('Cover image must be an https:// link');
      p.coverImageUrl = u;
    }
    if (dto.authorName !== undefined) p.authorName = dto.authorName.trim();
    if (dto.tags !== undefined) p.tags = cleanTags(dto.tags);
    if (dto.seoTitle !== undefined) p.seoTitle = dto.seoTitle.trim();
    if (dto.seoDescription !== undefined) p.seoDescription = dto.seoDescription.trim();
    if (dto.publishedAt !== undefined) p.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    if (dto.status !== undefined) p.status = dto.status;
    // Publishing without a date means "now".
    if (p.status === 'published' && !p.publishedAt) p.publishedAt = new Date();
  }

  async create(workspaceId: string, siteId: string, dto: CreatePostDto) {
    await this.site(workspaceId, siteId);
    const p = this.posts.create({ workspaceId, siteId, status: 'draft', tags: [], views: 0 });
    this.apply(p, dto);
    const wanted = dto.slug?.trim() ? dto.slug.trim().toLowerCase() : postSlug(p.title);
    if (!POST_SLUG_RE.test(wanted)) throw new BadRequestException('URL must be lowercase letters, numbers and dashes');
    p.slug = await this.freeSlug(siteId, wanted);
    return this.view(await this.posts.save(p));
  }

  async update(workspaceId: string, siteId: string, id: string, dto: UpdatePostDto) {
    const p = await this.get(workspaceId, siteId, id);
    this.apply(p, dto);
    if (dto.slug !== undefined && dto.slug.trim().toLowerCase() !== p.slug) {
      const wanted = dto.slug.trim().toLowerCase();
      if (!POST_SLUG_RE.test(wanted)) throw new BadRequestException('URL must be lowercase letters, numbers and dashes');
      if ((await this.freeSlug(siteId, wanted, p.id)) !== wanted) throw new ConflictException('Another post already uses that URL');
      p.slug = wanted;
    }
    return this.view(await this.posts.save(p));
  }

  async remove(workspaceId: string, siteId: string, id: string) {
    const p = await this.get(workspaceId, siteId, id);
    await this.posts.delete({ id: p.id });
    return { id };
  }

  // ---- Public ----
  private async publicSite(slug: string) {
    const s = await this.sites.findOne({ where: { slug, isPublished: true } });
    if (!s) throw new NotFoundException('This site is not published');
    return s;
  }

  private siteInfo(s: Site) {
    return { name: s.name, slug: s.slug, theme: s.theme, nav: s.kind === 'website' ? s.pages.map((p) => ({ title: p.title, path: p.path })) : [] };
  }

  private live(siteId: string) {
    return this.posts
      .createQueryBuilder('p')
      .where('p.site_id = :siteId', { siteId })
      .andWhere(`p.status = 'published'`)
      .andWhere('p.published_at <= now()');
  }

  private card(p: BlogPost) {
    return {
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt || excerptOf(p.body),
      coverImageUrl: p.coverImageUrl,
      authorName: p.authorName,
      tags: p.tags,
      publishedAt: p.publishedAt,
      readMinutes: readMinutes(p.body),
    };
  }

  async publicList(slug: string, q: ListQuery) {
    const s = await this.publicSite(slug);
    const page = q.page ?? 1;
    const qb = this.live(s.id).orderBy('p.published_at', 'DESC').skip((page - 1) * PAGE_SIZE).take(PAGE_SIZE);
    const tag = q.tag?.trim().toLowerCase();
    if (tag) qb.andWhere(':tag = ANY(p.tags)', { tag });
    const [rows, total] = await qb.getManyAndCount();
    const tags: Array<{ tag: string; count: number }> = await this.posts.query(
      `SELECT t AS tag, COUNT(*)::int AS count FROM blog_posts, unnest(tags) t
        WHERE site_id = $1 AND status = 'published' AND published_at <= now() AND deleted_at IS NULL
        GROUP BY t ORDER BY count DESC, t LIMIT 30`,
      [s.id],
    );
    return { site: this.siteInfo(s), posts: rows.map((p) => this.card(p)), tags, tag: tag ?? null, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total };
  }

  async publicPost(slug: string, postSlugParam: string) {
    const s = await this.publicSite(slug);
    const p = await this.live(s.id).andWhere('p.slug = :slug', { slug: postSlugParam }).getOne();
    if (!p) throw new NotFoundException('Post not found');
    const neighbour = (dir: '<' | '>') =>
      this.live(s.id)
        .andWhere(
          new Brackets((w) =>
            w.where(`p.published_at ${dir} :at`, { at: p.publishedAt }).orWhere(`p.published_at = :at AND p.id ${dir} :id`, { at: p.publishedAt, id: p.id }),
          ),
        )
        .orderBy('p.published_at', dir === '<' ? 'DESC' : 'ASC')
        .addOrderBy('p.id', dir === '<' ? 'DESC' : 'ASC')
        .select(['p.title', 'p.slug'])
        .getOne();
    const [older, newer] = await Promise.all([neighbour('<'), neighbour('>')]);
    return {
      site: this.siteInfo(s),
      post: { ...this.card(p), body: p.body, seoTitle: p.seoTitle || p.title, seoDescription: p.seoDescription || p.excerpt || excerptOf(p.body, 160) },
      older: older ? { title: older.title, slug: older.slug } : null,
      newer: newer ? { title: newer.title, slug: newer.slug } : null,
    };
  }

  async recordView(slug: string, postSlugParam: string) {
    await this.posts.query(
      `UPDATE blog_posts p SET views = views + 1 FROM sites s
        WHERE s.id = p.site_id AND s.slug = $1 AND s.is_published AND s.deleted_at IS NULL
          AND p.slug = $2 AND p.status = 'published' AND p.published_at <= now() AND p.deleted_at IS NULL`,
      [slug, postSlugParam],
    );
    return { ok: true };
  }

  async rss(slug: string) {
    const s = await this.publicSite(slug);
    const rows = await this.live(s.id).orderBy('p.published_at', 'DESC').take(30).getMany();
    const base = `${(this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(/\/$/, '')}/s/${s.slug}/blog`;
    return rssXml({
      title: `${s.name} — Blog`,
      url: base,
      description: `Latest posts from ${s.name}`,
      items: rows.map((p) => ({ title: p.title, url: `${base}/${p.slug}`, excerpt: p.excerpt || excerptOf(p.body), publishedAt: p.publishedAt!, author: p.authorName || undefined, tags: p.tags })),
    });
  }
}

@Controller('sites/:siteId/posts')
export class BlogController {
  constructor(private readonly svc: BlogService) {}

  @Get()
  @Permissions('websites:read')
  list(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.svc.list(ws, siteId);
  }

  @Post()
  @Permissions('websites:write')
  create(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: CreatePostDto) {
    return this.svc.create(ws, siteId, dto);
  }

  @Get(':id')
  @Permissions('websites:read')
  get(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, siteId, id);
  }

  @Put(':id')
  @Permissions('websites:write')
  update(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.svc.update(ws, siteId, id, dto);
  }

  @Delete(':id')
  @Permissions('websites:write')
  remove(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, siteId, id);
  }
}

@Controller('public/sites/:slug/blog')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicBlogController {
  constructor(private readonly svc: BlogService) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  list(@Param('slug') slug: string, @Query() q: ListQuery) {
    return this.svc.publicList(slug, q);
  }

  @Get('rss.xml')
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  rss(@Param('slug') slug: string) {
    return this.svc.rss(slug);
  }

  @Get(':postSlug')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  post(@Param('slug') slug: string, @Param('postSlug') postSlugParam: string) {
    return this.svc.publicPost(slug, postSlugParam);
  }

  @Post(':postSlug/view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  view(@Param('slug') slug: string, @Param('postSlug') postSlugParam: string) {
    return this.svc.recordView(slug, postSlugParam);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, Site])],
  controllers: [BlogController, PublicBlogController],
  providers: [BlogService],
})
export class BlogModule {}
