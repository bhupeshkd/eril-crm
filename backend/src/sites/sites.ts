import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { BLOCK_TYPES, Review, Site, SiteBlock, SitePage } from '../database/entities/site.entity';
import { Form } from '../database/entities/form.entity';
import { Calendar } from '../database/entities/calendar.entity';
import { Product } from '../database/entities/payment.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug } from '../common/slug';
import { COLOR_RE, id, sanitizePages } from './sanitize';

export { sanitizePages };

class SiteFieldsDto {
  @IsOptional() @IsIn(['website', 'funnel']) kind?: 'website' | 'funnel';
  @IsOptional() @IsObject() theme?: Site['theme'];
  @IsOptional() @IsArray() pages?: SitePage[];
  @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class CreateSiteDto extends SiteFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @IsOptional() @IsIn(['blank', 'lead-funnel', 'agency-website']) template?: string;
}
export class UpdateSiteDto extends SiteFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}

function template(kind: string): { kind: 'website' | 'funnel'; pages: SitePage[] } {
  if (kind === 'lead-funnel') {
    return {
      kind: 'funnel',
      pages: [
        {
          id: id(), title: 'Opt-in', path: '', blocks: [
            { id: id(), type: 'hero', props: { heading: 'Get your free marketing audit', subheading: 'Find out exactly what is holding your growth back — in 48 hours.', buttonText: 'Claim my audit', buttonLink: 'next' } },
            { id: id(), type: 'features', props: { heading: 'What you get', items: [{ title: 'Ads review', body: 'Wasted spend and quick wins.' }, { title: 'SEO check', body: 'Technical issues ranked by impact.' }, { title: 'Action plan', body: 'A 30-day plan you can run yourself.' }] } },
          ],
        },
        { id: id(), title: 'Book a call', path: 'book', blocks: [{ id: id(), type: 'text', props: { heading: 'Pick a time', body: 'Choose a slot below and we will walk you through your audit.' } }, { id: id(), type: 'booking', props: {} }] },
        { id: id(), title: 'Thank you', path: 'thanks', blocks: [{ id: id(), type: 'hero', props: { heading: "You're all set!", subheading: 'Check your inbox for the confirmation.' } }] },
      ],
    };
  }
  if (kind === 'agency-website') {
    return {
      kind: 'website',
      pages: [
        {
          id: id(), title: 'Home', path: '', blocks: [
            { id: id(), type: 'hero', props: { heading: 'Grow faster with a team that gets results', subheading: 'Websites, ads and automation for local businesses.', buttonText: 'Get a quote', buttonLink: '/contact' } },
            { id: id(), type: 'features', props: { heading: 'Services', items: [{ title: 'Web design', body: 'Fast, modern sites that convert.' }, { title: 'Paid ads', body: 'Google & Meta campaigns that pay back.' }, { title: 'Automation', body: 'Follow up with every lead, automatically.' }] } },
            { id: id(), type: 'reviews', props: { heading: 'What clients say' } },
            { id: id(), type: 'cta', props: { heading: 'Ready to grow?', buttonText: 'Talk to us', buttonLink: '/contact' } },
            { id: id(), type: 'footer', props: { text: '© Your Agency' } },
          ],
        },
        { id: id(), title: 'Contact', path: 'contact', blocks: [{ id: id(), type: 'text', props: { heading: 'Contact us', body: 'Tell us about your project.' } }, { id: id(), type: 'form', props: {} }] },
      ],
    };
  }
  return { kind: 'website', pages: [{ id: id(), title: 'Home', path: '', blocks: [{ id: id(), type: 'hero', props: { heading: 'Welcome', subheading: 'Edit this page in the builder.' } }] }] };
}

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Form) private readonly forms: Repository<Form>,
    @InjectRepository(Calendar) private readonly calendars: Repository<Calendar>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    private readonly config: ConfigService,
  ) {}

  publicUrl(s: Site) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/s/${s.slug}`;
  }

  list(workspaceId: string) {
    return this.sites.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
  }

  async get(workspaceId: string, id: string) {
    const s = await this.sites.findOne({ where: { id, workspaceId } });
    if (!s) throw new NotFoundException('Site not found');
    return s;
  }

  create(workspaceId: string, dto: CreateSiteDto) {
    const t = template(dto.template ?? 'blank');
    return this.sites.save(
      this.sites.create({
        workspaceId,
        name: dto.name,
        slug: makeSlug(dto.name),
        kind: dto.kind ?? t.kind,
        theme: { primaryColor: '#2953e0', background: '#ffffff', font: 'sans', ...(dto.theme ?? {}) },
        pages: dto.pages ? sanitizePages(dto.pages) : t.pages,
        isPublished: false,
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateSiteDto) {
    const s = await this.get(workspaceId, id);
    if (dto.name !== undefined) s.name = dto.name;
    if (dto.kind !== undefined) s.kind = dto.kind;
    if (dto.pages !== undefined) s.pages = sanitizePages(dto.pages);
    if (dto.isPublished !== undefined) s.isPublished = dto.isPublished;
    if (dto.theme) {
      s.theme = {
        primaryColor: COLOR_RE.test(dto.theme.primaryColor ?? '') ? dto.theme.primaryColor : s.theme.primaryColor,
        background: COLOR_RE.test(dto.theme.background ?? '') ? dto.theme.background : s.theme.background,
        font: dto.theme.font === 'serif' ? 'serif' : 'sans',
      };
    }
    return this.sites.save(s);
  }

  async remove(workspaceId: string, id: string) {
    const s = await this.get(workspaceId, id);
    await this.sites.softRemove(s);
    return { id };
  }

  /** Editor/preview data: the page plus everything its embed blocks need. */
  async render(site: Site) {
    const ws = site.workspaceId;
    const [forms, calendars, products, reviews] = await Promise.all([
      this.forms.find({ where: { workspaceId: ws, isActive: true }, select: ['id', 'name', 'slug'] }),
      this.calendars.find({ where: { workspaceId: ws, isActive: true }, select: ['id', 'name', 'slug'] }),
      this.products.find({ where: { workspaceId: ws, isActive: true }, select: ['id', 'name', 'description', 'price', 'currency', 'interval'] }),
      this.reviews.find({ where: { workspaceId: ws, isPublic: true }, relations: { contact: true }, order: { createdAt: 'DESC' }, take: 12 }),
    ]);
    const [{ has }] = await this.sites.query(
      `SELECT EXISTS (SELECT 1 FROM blog_posts WHERE site_id = $1 AND status = 'published' AND published_at <= now() AND deleted_at IS NULL) AS has`,
      [site.id],
    );
    return {
      name: site.name,
      kind: site.kind,
      theme: site.theme,
      pages: site.pages,
      /** Show a "Blog" link when the site has published posts. */
      hasBlog: !!has,
      embeds: {
        forms: forms.map((f) => ({ id: f.id, name: f.name, slug: f.slug })),
        calendars: calendars.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
        products,
        reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, author: r.contact ? `${r.contact.firstName} ${(r.contact.lastName || '').slice(0, 1)}.`.trim() : 'Customer' })),
      },
    };
  }

  async publicSite(slug: string) {
    const s = await this.sites.findOne({ where: { slug, isPublished: true } });
    if (!s) throw new NotFoundException('This site is not published');
    return s;
  }

  async recordView(slug: string, path: string) {
    const clean = /^[a-z0-9-]{0,60}$/.test(path) ? path || '/' : '/';
    await this.sites.query(
      `UPDATE sites SET stats = jsonb_set(stats, ARRAY[$2::text], to_jsonb(COALESCE((stats->>$2)::int, 0) + 1))
       WHERE slug = $1 AND is_published = true AND deleted_at IS NULL`,
      [slug, clean],
    );
    return { ok: true };
  }

  /** Resolve embed references for ids used in blocks (forms/calendars in this workspace only). */
  async assertEmbeds(workspaceId: string, pages: SitePage[]) {
    const formIds = pages.flatMap((p) => p.blocks.filter((b) => b.type === 'form' && b.props.formId).map((b) => b.props.formId));
    const calIds = pages.flatMap((p) => p.blocks.filter((b) => b.type === 'booking' && b.props.calendarId).map((b) => b.props.calendarId));
    if (formIds.length && (await this.forms.count({ where: { workspaceId, id: In(formIds) } })) !== new Set(formIds).size) {
      throw new BadRequestException('A form block references a form that does not exist');
    }
    if (calIds.length && (await this.calendars.count({ where: { workspaceId, id: In(calIds) } })) !== new Set(calIds).size) {
      throw new BadRequestException('A booking block references a calendar that does not exist');
    }
  }
}

@Controller('sites')
export class SitesController {
  constructor(private readonly svc: SitesService) {}

  @Get()
  @Permissions('websites:read')
  async list(@Tenant('workspaceId') ws: string) {
    return (await this.svc.list(ws)).map((s) => ({ ...s, pages: s.pages.map((p) => ({ id: p.id, title: p.title, path: p.path })), publicUrl: this.svc.publicUrl(s) }));
  }

  @Post()
  @Permissions('websites:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateSiteDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('websites:read')
  async get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.svc.get(ws, id);
    return { ...s, publicUrl: this.svc.publicUrl(s), preview: await this.svc.render(s) };
  }

  @Put(':id')
  @Permissions('websites:write')
  async update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteDto) {
    if (dto.pages) await this.svc.assertEmbeds(ws, sanitizePages(dto.pages));
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('websites:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }
}

@Controller('public/sites')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicSitesController {
  constructor(private readonly svc: SitesService) {}

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    return this.svc.render(await this.svc.publicSite(slug));
  }

  @Post(':slug/view')
  view(@Param('slug') slug: string, @Body('path') path: string) {
    return this.svc.recordView(slug, String(path ?? ''));
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Site, Form, Calendar, Product, Review])],
  controllers: [SitesController, PublicSitesController],
  providers: [SitesService],
})
export class SitesModule {}
