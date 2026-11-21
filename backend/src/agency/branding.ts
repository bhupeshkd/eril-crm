import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { Branding, DEFAULT_BRANDING, Organization } from '../database/entities/organization.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { AgencyModule, AgencyService } from './agency';

export class BrandingDto {
  @IsOptional() @IsString() @MaxLength(40) appName?: string;
  /** https only, so a logo can never be a javascript: or data: URL. */
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^(https:\/\/\S+)?$/, { message: 'Logo must be an https:// URL' }) logoUrl?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Colour must look like #5847d7' }) primaryColor?: string;
  @IsOptional() @IsBoolean() hidePoweredBy?: boolean;
}

/**
 * How each public page identifies itself, mapped to the SQL that finds its workspace.
 * Every query takes the key as $1 and returns one `workspace_id`.
 */
const PUBLIC_KEYS: Record<string, string> = {
  calendar: `SELECT workspace_id FROM calendars WHERE slug = $1 AND deleted_at IS NULL`,
  form: `SELECT workspace_id FROM forms WHERE slug = $1 AND deleted_at IS NULL`,
  order: `SELECT workspace_id FROM order_forms WHERE slug = $1 AND deleted_at IS NULL`,
  invoice: `SELECT workspace_id FROM invoices WHERE public_token = $1 AND deleted_at IS NULL`,
  review: `SELECT workspace_id FROM review_requests WHERE token = $1 AND deleted_at IS NULL`,
  join: `SELECT workspace_id FROM communities WHERE slug = $1 AND deleted_at IS NULL`,
  community: `SELECT workspace_id FROM community_members WHERE access_token = $1 AND deleted_at IS NULL`,
  learn: `SELECT workspace_id FROM enrollments WHERE access_token = $1 AND deleted_at IS NULL`,
  invite: `SELECT workspace_id FROM invitations WHERE invitation_token = $1 AND deleted_at IS NULL`,
  contact: `SELECT workspace_id FROM contacts WHERE id::text = $1 AND deleted_at IS NULL`,
};

export function normaliseBranding(b?: Partial<Branding> | null): Branding {
  const out = { ...DEFAULT_BRANDING, ...(b ?? {}) };
  out.appName = (out.appName ?? '').trim() || DEFAULT_BRANDING.appName;
  if (!/^#[0-9a-f]{6}$/i.test(out.primaryColor)) out.primaryColor = DEFAULT_BRANDING.primaryColor;
  if (out.logoUrl && !/^https:\/\//.test(out.logoUrl)) out.logoUrl = '';
  out.hidePoweredBy = !!out.hidePoweredBy;
  return out;
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    private readonly agency: AgencyService,
  ) {}

  async forAgency(userId: string, orgId: string) {
    await this.agency.assertAccess(userId, orgId);
    return this.forOrg(orgId);
  }

  async forOrg(orgId: string) {
    const org = await this.orgs.findOne({ where: { id: orgId } });
    return normaliseBranding(org?.branding);
  }

  async forWorkspace(workspaceId: string) {
    const rows = await this.ds.query(`SELECT o.branding FROM workspaces w JOIN organizations o ON o.id = w.organization_id WHERE w.id = $1`, [workspaceId]);
    return normaliseBranding(rows[0]?.branding);
  }

  async update(userId: string, orgId: string, dto: BrandingDto) {
    await this.agency.assertAccess(userId, orgId);
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new BadRequestException('Organization not found');
    const next = normaliseBranding({ ...org.branding, ...dto, ...(dto.primaryColor ? { primaryColor: dto.primaryColor.toLowerCase() } : {}) });
    org.branding = next;
    await this.orgs.save(org);
    return next;
  }

  /** Branding for a public page. Unknown kinds or keys get the default, so this can't be used to test whether a link is valid. */
  async forPublic(kind: string, key: string) {
    const sql = PUBLIC_KEYS[kind];
    if (!sql || !key || key.length > 200) return normaliseBranding(null);
    try {
      const rows = await this.ds.query(sql, [key]);
      return rows[0] ? this.forWorkspace(rows[0].workspace_id) : normaliseBranding(null);
    } catch {
      return normaliseBranding(null);
    }
  }
}

@Controller()
export class BrandingController {
  constructor(private readonly svc: BrandingService) {}

  /** Branding for the signed-in workspace (app shell). */
  @Get('branding')
  current(@Tenant('workspaceId') ws: string) {
    return this.svc.forWorkspace(ws);
  }

  @Get('agency/:orgId/branding')
  @SkipTenant()
  async get(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.svc.forAgency(userId, orgId);
  }

  @Put('agency/:orgId/branding')
  @SkipTenant()
  update(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: BrandingDto) {
    return this.svc.update(userId, orgId, dto);
  }

  @Get('public/branding/:kind/:key')
  @Public()
  @SkipTenant()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  publicBranding(@Param('kind') kind: string, @Param('key') key: string) {
    return this.svc.forPublic(kind, key);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Organization]), AgencyModule],
  controllers: [BrandingController],
  providers: [BrandingService],
})
export class BrandingModule {}
