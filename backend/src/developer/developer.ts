import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { DEFAULT_ROLE_PERMISSIONS } from '@eril/shared';
import { ApiKey, WebhookSubscription } from '../database/entities/api-key.entity';
import { WORKFLOW_TRIGGERS } from '../database/entities/workflow.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { DomainEvent, EventsService } from '../events/events.service';
import { postWebhook } from '../automation/webhook';
import { signPayload } from './sign';

export const WEBHOOK_EVENTS = [...new Set([...WORKFLOW_TRIGGERS.filter((t) => t !== 'manual'), 'review.received'])];
const KEY_ROLES = ['workspace_admin', 'manager', 'team_member', 'marketing_manager', 'sales_agent'];

export const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex');

export { signPayload };

class CreateKeyDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsIn(KEY_ROLES) role?: string;
}
class WebhookDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(1000) url: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class DeveloperService implements OnModuleInit {
  private readonly logger = new Logger(DeveloperService.name);

  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    @InjectRepository(WebhookSubscription) private readonly hooks: Repository<WebhookSubscription>,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    this.events.onAny((e) => this.dispatch(e));
  }

  // ---- API keys ----
  listKeys(workspaceId: string) {
    return this.keys.find({
      where: { workspaceId, revokedAt: IsNull() },
      select: ['id', 'name', 'keyPrefix', 'role', 'lastUsedAt', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async createKey(workspaceId: string, dto: CreateKeyDto, userId: string) {
    const raw = `eril_${randomBytes(24).toString('base64url')}`;
    const key = await this.keys.save(
      this.keys.create({ workspaceId, name: dto.name, role: dto.role ?? 'workspace_admin', keyHash: hashKey(raw), keyPrefix: raw.slice(0, 12), createdBy: userId }),
    );
    // The raw key is returned exactly once.
    return { id: key.id, name: key.name, role: key.role, keyPrefix: key.keyPrefix, key: raw };
  }

  async revokeKey(workspaceId: string, id: string) {
    const res = await this.keys.update({ id, workspaceId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!res.affected) throw new NotFoundException('API key not found');
    return { id };
  }

  /** Used by the auth guard. */
  async authenticate(raw: string) {
    if (!raw?.startsWith('eril_')) return null;
    const key = await this.keys.findOne({ where: { keyHash: hashKey(raw), revokedAt: IsNull() } });
    if (!key) return null;
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.keys.update({ id: key.id }, { lastUsedAt: new Date() });
    }
    return {
      id: null,
      apiKeyId: key.id,
      email: `api-key:${key.keyPrefix}`,
      name: `API key "${key.name}"`,
      role: key.role,
      currentWorkspaceId: key.workspaceId,
      permissions: DEFAULT_ROLE_PERMISSIONS[key.role] ?? [],
    };
  }

  // ---- Webhooks ----
  listHooks(workspaceId: string) {
    return this.hooks.find({ where: { workspaceId }, order: { createdAt: 'DESC' } });
  }

  async createHook(workspaceId: string, dto: WebhookDto) {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const hook = await this.hooks.save(this.hooks.create({ workspaceId, url: dto.url, events: dto.events ?? [], isActive: dto.isActive ?? true, secret }));
    return { ...hook, secret };
  }

  async updateHook(workspaceId: string, id: string, dto: WebhookDto) {
    const hook = await this.hooks.findOne({ where: { id, workspaceId } });
    if (!hook) throw new NotFoundException('Webhook not found');
    Object.assign(hook, { url: dto.url, events: dto.events ?? hook.events, isActive: dto.isActive ?? hook.isActive });
    if (dto.isActive) hook.failureCount = 0;
    return this.hooks.save(hook);
  }

  async deleteHook(workspaceId: string, id: string) {
    const res = await this.hooks.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Webhook not found');
    return { id };
  }

  async test(workspaceId: string, id: string) {
    const hook = await this.hooks.createQueryBuilder('h').addSelect('h.secret').where('h.id = :id AND h.workspace_id = :ws', { id, ws: workspaceId }).getOne();
    if (!hook) throw new NotFoundException('Webhook not found');
    const status = await this.deliver(hook, { type: 'webhook.test', workspaceId, payload: { message: 'Hello from ERIL' } });
    if (!status.ok) throw new BadRequestException(`Delivery failed: ${status.detail}`);
    return status;
  }

  private async dispatch(e: DomainEvent) {
    const hooks = await this.hooks
      .createQueryBuilder('h')
      .addSelect('h.secret')
      .where('h.workspace_id = :ws AND h.is_active = true', { ws: e.workspaceId })
      .andWhere("(cardinality(h.events) = 0 OR :t = ANY(h.events))", { t: e.type })
      .getMany();
    for (const h of hooks) await this.deliver(h, e);
  }

  private async deliver(hook: WebhookSubscription, e: DomainEvent) {
    const { __workflowDepth, previous, ...data } = e.payload ?? {};
    const body = JSON.stringify({ id: randomBytes(12).toString('hex'), type: e.type, workspaceId: e.workspaceId, contactId: e.contactId ?? null, data, createdAt: new Date().toISOString() });
    const ts = Math.floor(Date.now() / 1000).toString();
    let ok = false;
    let detail = '';
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const status = await postWebhook(hook.url, null, { 'X-Eril-Event': e.type, 'X-Eril-Timestamp': ts, 'X-Eril-Signature': `sha256=${signPayload(hook.secret, ts, body)}` }, body);
        ok = true;
        detail = `HTTP ${status}`;
      } catch (err) {
        detail = String(err?.message ?? err).slice(0, 110);
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
    const failureCount = ok ? 0 : hook.failureCount + 1;
    // Auto-disable endpoints that keep failing.
    await this.hooks.update({ id: hook.id }, { lastStatus: detail, lastDeliveredAt: new Date(), failureCount, isActive: failureCount >= 20 ? false : hook.isActive });
    if (!ok) this.logger.warn(`Webhook ${hook.id} failed for ${e.type}: ${detail}`);
    return { ok, detail };
  }
}

@Controller('developer')
export class DeveloperController {
  constructor(private readonly svc: DeveloperService) {}

  @Get('events')
  @Permissions('integrations:read')
  eventTypes() {
    return WEBHOOK_EVENTS;
  }

  @Get('api-keys')
  @Permissions('integrations:read')
  keys(@Tenant('workspaceId') ws: string) {
    return this.svc.listKeys(ws);
  }

  @Post('api-keys')
  @Permissions('integrations:write')
  createKey(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: CreateKeyDto) {
    return this.svc.createKey(ws, dto, userId);
  }

  @Delete('api-keys/:id')
  @Permissions('integrations:write')
  revoke(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeKey(ws, id);
  }

  @Get('webhooks')
  @Permissions('integrations:read')
  hooks(@Tenant('workspaceId') ws: string) {
    return this.svc.listHooks(ws);
  }

  @Post('webhooks')
  @Permissions('integrations:write')
  createHook(@Tenant('workspaceId') ws: string, @Body() dto: WebhookDto) {
    return this.svc.createHook(ws, dto);
  }

  @Put('webhooks/:id')
  @Permissions('integrations:write')
  updateHook(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WebhookDto) {
    return this.svc.updateHook(ws, id, dto);
  }

  @Delete('webhooks/:id')
  @Permissions('integrations:write')
  deleteHook(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteHook(ws, id);
  }

  @Post('webhooks/:id/test')
  @Permissions('integrations:write')
  test(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.test(ws, id);
  }
}

// Global: JwtAuthGuard (used app-wide and per-controller) needs DeveloperService for API-key auth.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, WebhookSubscription])],
  controllers: [DeveloperController],
  providers: [DeveloperService],
  exports: [DeveloperService],
})
export class DeveloperModule {}
