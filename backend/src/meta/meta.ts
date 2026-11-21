import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { MetaIdentity, MetaPage } from '../database/entities/meta.entity';
import { Message } from '../database/entities/message.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { isMetaId, parseWebhook, validMetaSignature, type MetaMessage } from './meta-rules';

class ConnectDto {
  @IsIn(['facebook', 'instagram']) platform: 'facebook' | 'instagram';
  @IsString() @IsNotEmpty() @MaxLength(32) pageId: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) accessToken: string;
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    @InjectRepository(MetaPage) private readonly pages: Repository<MetaPage>,
    @InjectRepository(MetaIdentity) private readonly identities: Repository<MetaIdentity>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    private readonly contacts: ContactsService,
    private readonly inbox: InboxService,
    private readonly config: ConfigService,
  ) {}

  private get apiBase() {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix.replace(/^\/|\/$/g, '')}`;
  }

  setup() {
    return {
      webhookUrl: `${this.apiBase}/public/meta/webhook`,
      verifyTokenSet: !!this.config.get<string>('META_VERIFY_TOKEN'),
      appSecretSet: !!this.config.get<string>('META_APP_SECRET'),
      provider: (this.config.get<string>('META_PROVIDER') || 'console').toLowerCase(),
    };
  }

  list(workspaceId: string) {
    return this.pages.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
  }

  async connect(workspaceId: string, dto: ConnectDto) {
    if (!isMetaId(dto.pageId.trim())) throw new BadRequestException('Page / account id is the long number from Meta (e.g. 104501234567890)');
    const pageId = dto.pageId.trim();
    if (await this.pages.exist({ where: { platform: dto.platform, pageId } })) throw new ConflictException('That page is already connected');
    const p = await this.pages.save(this.pages.create({ workspaceId, platform: dto.platform, pageId, name: dto.name.trim(), accessToken: dto.accessToken.trim() }));
    const { accessToken, ...safe } = p;
    return safe;
  }

  async disconnect(workspaceId: string, id: string) {
    const p = await this.pages.findOne({ where: { id, workspaceId } });
    if (!p) throw new NotFoundException('Page not found');
    await this.pages.softRemove(p);
    return { id };
  }

  // ---- Webhook ----
  /** Meta's subscription handshake: echo the challenge only when the verify token matches. */
  handshake(mode: string, token: string, challenge: string): string | null {
    const expected = this.config.get<string>('META_VERIFY_TOKEN');
    return expected && mode === 'subscribe' && token === expected && /^[\w-]{1,200}$/.test(challenge ?? '') ? challenge : null;
  }

  /** Signature check over the raw body. Without META_APP_SECRET, unsigned events are accepted only outside production. */
  assertFromMeta(raw: Buffer | undefined, header: string | undefined) {
    const secret = this.config.get<string>('META_APP_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Meta webhooks are not configured');
      return;
    }
    if (!validMetaSignature(secret, raw, header)) throw new ForbiddenException('Invalid signature');
  }

  async receive(payload: unknown) {
    const msgs = parseWebhook(payload);
    let stored = 0;
    for (const m of msgs) if (await this.store(m).catch((e) => { this.logger.warn(`Meta message ${m.mid} failed: ${e.message}`); return false; })) stored++;
    return { received: msgs.length, stored };
  }

  private async store(m: MetaMessage): Promise<boolean> {
    const page = await this.pages.findOne({ where: { platform: m.platform, pageId: m.pageId } });
    if (!page) return false; // not connected (or disconnected)
    if (await this.messages.exist({ where: { providerMessageId: m.mid, workspaceId: page.workspaceId } })) return false; // Meta retries
    let identity = await this.identities.findOne({ where: { platform: m.platform, pageId: m.pageId, psid: m.senderId } });
    if (!identity || identity.workspaceId !== page.workspaceId) {
      const label = m.platform === 'facebook' ? 'Facebook' : 'Instagram';
      const contact = await this.contacts.create(page.workspaceId, { firstName: `${label} user`, lastName: m.senderId.slice(-4), source: m.platform } as any);
      if (identity) await this.identities.update({ id: identity.id }, { workspaceId: page.workspaceId, contactId: contact.id });
      else identity = await this.identities.save(this.identities.create({ workspaceId: page.workspaceId, platform: m.platform, pageId: m.pageId, psid: m.senderId, contactId: contact.id }));
      identity.contactId = contact.id;
    }
    await this.identities.update({ id: identity.id }, { lastInboundAt: new Date(Math.min(m.timestamp, Date.now())) });
    const body = [m.text, ...m.attachments.map((u) => `📎 ${u}`)].filter(Boolean).join('\n');
    await this.inbox.receive(page.workspaceId, { contactId: identity.contactId, channel: m.platform, body } as any, { providerMessageId: m.mid, toAddress: page.name });
    return true;
  }
}

@Controller('meta')
export class MetaController {
  constructor(private readonly svc: MetaService) {}

  @Get('pages')
  @Permissions('conversations:read')
  async pages(@Tenant('workspaceId') ws: string) {
    return { pages: await this.svc.list(ws), setup: this.svc.setup() };
  }

  @Post('pages')
  @Permissions('workspaces:write')
  connect(@Tenant('workspaceId') ws: string, @Body() dto: ConnectDto) {
    return this.svc.connect(ws, dto);
  }

  @Delete('pages/:id')
  @Permissions('workspaces:write')
  disconnect(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.disconnect(ws, id);
  }
}

@Controller('public/meta')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class MetaWebhookController {
  constructor(private readonly svc: MetaService) {}

  @Get('webhook')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const ok = this.svc.handshake(mode, token, challenge);
    if (ok === null) return res.status(403).type('text/plain').send('Verification failed');
    res.status(200).type('text/plain').send(ok);
  }

  @Post('webhook')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  async events(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig: string | undefined, @Res() res: Response) {
    this.svc.assertFromMeta(req.rawBody, sig);
    await this.svc.receive(req.body);
    res.status(200).type('text/plain').send('EVENT_RECEIVED');
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([MetaPage, MetaIdentity, Message]), CrmModule, CommunicationModule],
  controllers: [MetaController, MetaWebhookController],
  providers: [MetaService],
})
export class MetaModule {}
