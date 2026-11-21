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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { Resolver } from 'dns/promises';
import type { Response } from 'express';
import { DataSource, IsNull, LessThan, MoreThan, Not, Or, Repository } from 'typeorm';
import { CustomDomain } from '../database/entities/domain.entity';
import { Site } from '../database/entities/site.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { cnameStatus, hasToken, normalizeHostname, txtName, txtValue } from './domains-text';

class AddDomainDto {
  @IsString() @MaxLength(300) hostname: string;
}
class HostQuery {
  @IsString() @MaxLength(300) host: string;
}
class AskQuery {
  @IsString() @MaxLength(300) domain: string;
}

const PER_SITE = 5;
/** Pending domains are re-checked automatically for this long. */
const AUTO_CHECK_MS = 72 * 3_600_000;

@Injectable()
export class DomainsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainsService.name);
  private timer: NodeJS.Timeout | null = null;
  private resolver = new Resolver({ timeout: 4000, tries: 2 });

  constructor(
    @InjectRepository(CustomDomain) private readonly domains: Repository<CustomDomain>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // DNS_SERVERS lets tests (and private networks) point lookups at a specific resolver.
    const servers = (this.config.get<string>('DNS_SERVERS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (servers.length) this.resolver.setServers(servers);
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => this.checkPending().catch((e) => this.logger.error(`Domain checks failed: ${e.message}`)), 5 * 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Hostnames that belong to the app itself (APP_URL, API_PUBLIC_URL, RESERVED_DOMAINS). */
  private get reserved() {
    const hosts = [this.config.get<string>('APP_URL'), this.config.get<string>('API_PUBLIC_URL')]
      .map((u) => { try { return u ? new URL(u).hostname : ''; } catch { return ''; } })
      .filter((h) => h && h !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(h));
    const extra = (this.config.get<string>('RESERVED_DOMAINS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return [...new Set([...hosts, ...extra])];
  }

  /** What customers point their CNAME at (shown in the instructions). */
  get target() {
    return (this.config.get<string>('DOMAIN_CNAME_TARGET') || 'sites.eril.local').toLowerCase();
  }

  private view(d: CustomDomain) {
    return {
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      verifiedAt: d.verifiedAt,
      lastCheckedAt: d.lastCheckedAt,
      lastError: d.lastError,
      dns: {
        txt: { name: txtName(d.hostname), value: txtValue(d.verificationToken) },
        cname: { name: d.hostname, value: this.target },
      },
    };
  }

  private async site(workspaceId: string, siteId: string) {
    const s = await this.sites.findOne({ where: { id: siteId, workspaceId } });
    if (!s) throw new NotFoundException('Site not found');
    return s;
  }

  async list(workspaceId: string, siteId: string) {
    await this.site(workspaceId, siteId);
    const rows = await this.domains.find({ where: { workspaceId, siteId }, order: { createdAt: 'ASC' } });
    return { target: this.target, domains: rows.map((d) => this.view(d)) };
  }

  async add(workspaceId: string, siteId: string, input: string) {
    await this.site(workspaceId, siteId);
    const n = normalizeHostname(input, this.reserved);
    if ('error' in n) throw new BadRequestException(n.error);
    if (await this.domains.exist({ where: { hostname: n.host, status: 'verified' } })) throw new ConflictException('That domain is already connected to a site');
    if (await this.domains.exist({ where: { hostname: n.host, workspaceId, status: Not('failed') } })) throw new ConflictException('You have already added that domain');
    if ((await this.domains.count({ where: { siteId } })) >= PER_SITE) throw new BadRequestException(`A site can have up to ${PER_SITE} domains`);
    const d = await this.domains.save(
      this.domains.create({ workspaceId, siteId, hostname: n.host, status: 'pending', verificationToken: randomBytes(16).toString('hex') }),
    );
    return this.view(d);
  }

  private async lookup(host: string, token: string) {
    let txtOk = false;
    let txtError: string | null = null;
    try {
      txtOk = hasToken(await this.resolver.resolveTxt(txtName(host)), token);
    } catch (e) {
      const code = (e as { code?: string }).code;
      txtError = code === 'ENOTFOUND' || code === 'ENODATA' ? null : `DNS lookup failed (${code ?? 'error'})`;
    }
    const cnames = await this.resolver.resolveCname(host).catch(() => [] as string[]);
    return { txtOk, txtError, cname: cnameStatus(cnames, this.target) };
  }

  /** Checks DNS now; on success the domain starts routing to the site. */
  async verify(workspaceId: string, siteId: string, id: string) {
    const d = await this.domains.findOne({ where: { id, workspaceId, siteId } });
    if (!d) throw new NotFoundException('Domain not found');
    const r = await this.check(d);
    return { ...this.view(r.domain), cname: r.cname };
  }

  private async check(d: CustomDomain) {
    const { txtOk, txtError, cname } = await this.lookup(d.hostname, d.verificationToken);
    d.lastCheckedAt = new Date();
    if (!txtOk) {
      if (d.status !== 'verified') {
        d.lastError = txtError ?? `TXT record ${txtName(d.hostname)} not found yet. DNS changes can take a few minutes to an hour.`;
        await this.domains.save(d);
      }
      return { domain: d, cname };
    }
    if (d.status === 'verified') {
      d.lastError = null;
      await this.domains.save(d);
      return { domain: d, cname };
    }
    try {
      await this.ds.transaction(async (em) => {
        const repo = em.getRepository(CustomDomain);
        // Proven ownership wins: other accounts' pending claims for the same name are closed.
        await repo.update({ hostname: d.hostname, status: 'pending', id: Not(d.id) }, { status: 'failed', lastError: 'Verified by another account' });
        await repo.update({ id: d.id }, { status: 'verified', verifiedAt: new Date(), lastCheckedAt: d.lastCheckedAt, lastError: null });
      });
    } catch {
      // The partial unique index stops two accounts verifying the same name at once.
      throw new ConflictException('That domain is already connected to another site');
    }
    return { domain: await this.domains.findOneByOrFail({ id: d.id }), cname };
  }

  async remove(workspaceId: string, siteId: string, id: string) {
    const d = await this.domains.findOne({ where: { id, workspaceId, siteId } });
    if (!d) throw new NotFoundException('Domain not found');
    await this.domains.softRemove(d);
    return { id };
  }

  /** Scheduler: keep trying pending domains for a few days after they're added. */
  async checkPending() {
    const due = await this.domains.find({
      where: { status: 'pending', createdAt: MoreThan(new Date(Date.now() - AUTO_CHECK_MS)), lastCheckedAt: Or(IsNull(), LessThan(new Date(Date.now() - 4 * 60_000))) },
      take: 50,
    });
    for (const d of due) await this.check(d).catch((e) => this.logger.warn(`Domain ${d.hostname}: ${e.message}`));
    return due.length;
  }

  // ---- Public ----
  /** Host → published site, for the frontend's routing. */
  async resolve(host: string) {
    const n = normalizeHostname(host);
    if ('error' in n) throw new NotFoundException('Unknown domain');
    const d = await this.domains.findOne({ where: { hostname: n.host, status: 'verified' } });
    const s = d ? await this.sites.findOne({ where: { id: d.siteId, isPublished: true } }) : null;
    if (!s) throw new NotFoundException('Unknown domain');
    return { slug: s.slug, name: s.name };
  }

  /** On-demand TLS "ask" check: only issue certificates for verified domains. */
  async allowed(domain: string) {
    const n = normalizeHostname(domain);
    return 'host' in n && (await this.domains.exist({ where: { hostname: n.host, status: 'verified' } }));
  }
}

@Controller('sites/:siteId/domains')
export class DomainsController {
  constructor(private readonly svc: DomainsService) {}

  @Get()
  @Permissions('websites:read')
  list(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.svc.list(ws, siteId);
  }

  @Post()
  @Permissions('websites:publish')
  add(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: AddDomainDto) {
    return this.svc.add(ws, siteId, dto.hostname);
  }

  @Post(':id/verify')
  @Permissions('websites:publish')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verify(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.verify(ws, siteId, id);
  }

  @Delete(':id')
  @Permissions('websites:publish')
  remove(@Tenant('workspaceId') ws: string, @Param('siteId', ParseUUIDPipe) siteId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, siteId, id);
  }
}

@Controller('public/domains')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicDomainsController {
  constructor(private readonly svc: DomainsService) {}

  @Get('resolve')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  resolve(@Query() q: HostQuery) {
    return this.svc.resolve(q.host);
  }

  /** For Caddy's `on_demand_tls { ask … }` (or similar): 200 = issue a certificate, 404 = don't. */
  @Get('allowed')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async allowed(@Query() q: AskQuery, @Res() res: Response) {
    const ok = await this.svc.allowed(q.domain);
    res.status(ok ? 200 : 404).type('text/plain').send(ok ? 'ok' : 'unknown domain');
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([CustomDomain, Site])],
  controllers: [DomainsController, PublicDomainsController],
  providers: [DomainsService],
})
export class DomainsModule {}
