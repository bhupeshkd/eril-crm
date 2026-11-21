import {
  BadRequestException,
  Body,
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
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsArray, IsDateString, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Campaign, CampaignAudience } from '../database/entities/campaign.entity';
import { SmartList } from '../database/entities/crm-extras.entity';
import { applyContactFilters, cleanFilters } from '../crm/contact-filters';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { ActivityService } from '../events/activity.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { TrackingService } from '../tracking/tracking.service';
import { interpolate } from '../automation/conditions';
import { EmailTemplatesModule, EmailTemplatesService } from '../email-templates/email-templates';
import { EmailTemplate } from '../database/entities/email-template.entity';
import { AB_LIMITS, normaliseAbTest, pickWinner, splitForTest, type Variant } from './ab';

class CampaignFieldsDto {
  @IsOptional() @IsIn(['email', 'sms']) channel?: 'email' | 'sms';
  @IsOptional() @IsString() @MaxLength(255) subject?: string;
  @IsOptional() @IsString() @MaxLength(50000) body?: string;
  @IsOptional() @IsObject() audience?: CampaignAudience;
  @IsOptional() @ValidateIf((o) => o.templateId !== null) @IsUUID() templateId?: string | null;
  /** A/B subject test; null turns it off. */
  @IsOptional() @ValidateIf((o) => o.abTest !== null) @IsObject() abTest?: Record<string, any> | null;
}
export class CreateCampaignDto extends CampaignFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
}
export class UpdateCampaignDto extends CampaignFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}
export class SendCampaignDto {
  /** Omit to send now. */
  @IsOptional() @IsDateString() scheduledAt?: string;
}
export class PickWinnerDto {
  /** Omit to let the results decide. */
  @IsOptional() @IsIn(['A', 'B']) variant?: Variant;
}
class AudienceDto {
  @IsOptional() @IsUUID() listId?: string;
  @IsOptional() @IsArray() statuses?: string[];
  @IsOptional() @IsArray() tags?: string[];
}

@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly inbox: InboxService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly templates: EmailTemplatesService,
    private readonly tracking: TrackingService,
    @InjectRepository(EmailTemplate) private readonly templateRepo: Repository<EmailTemplate>,
    @InjectRepository(SmartList) private readonly smartLists: Repository<SmartList>,
  ) {}

  private async assertTemplate(workspaceId: string, templateId?: string | null) {
    if (templateId && !(await this.templateRepo.exist({ where: { id: templateId, workspaceId } }))) {
      throw new BadRequestException('Email template not found');
    }
  }

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => this.dispatchScheduled().catch((e) => this.logger.error(e.message)), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(workspaceId: string) {
    const [list, rates] = await Promise.all([
      this.campaigns.find({ where: { workspaceId }, order: { createdAt: 'DESC' } }),
      this.tracking.campaignRates(workspaceId),
    ]);
    return list.map((c) => {
      const r = rates.get(c.id);
      return {
        ...c,
        openRate: r?.tracked ? Math.round((r.opened / r.tracked) * 1000) / 10 : null,
        clickRate: r?.tracked ? Math.round((r.clicked / r.tracked) * 1000) / 10 : null,
      };
    });
  }

  async report(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    const tpl = c.abTest ? await this.loadTemplate(c) : null;
    return {
      campaign: { id: c.id, name: c.name, status: c.status, sentAt: c.sentAt, templateId: c.templateId },
      ab: c.abTest
        ? { ...c.abTest, subjectA: this.subjectFor(c, tpl, 'A'), decideAt: c.abDecideAt, winner: c.abWinner }
        : null,
      ...(await this.tracking.campaignReport(workspaceId, id)),
    };
  }

  async get(workspaceId: string, id: string) {
    const c = await this.campaigns.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  /** Validate the A/B config; SMS campaigns never carry one. */
  private abFor(channel: 'email' | 'sms', raw: Record<string, any> | null | undefined) {
    if (!raw || channel !== 'email') return null;
    const r = normaliseAbTest(raw);
    if ('error' in r) throw new BadRequestException(r.error);
    return r.config;
  }

  async create(workspaceId: string, dto: CreateCampaignDto) {
    await this.assertTemplate(workspaceId, dto.templateId);
    const abTest = this.abFor(dto.channel ?? 'email', dto.abTest);
    return this.campaigns.save(this.campaigns.create({ ...dto, abTest, workspaceId, audience: await this.checkAudience(workspaceId, clean(dto.audience)) }));
  }

  async update(workspaceId: string, id: string, dto: UpdateCampaignDto) {
    const c = await this.get(workspaceId, id);
    if (!['draft', 'scheduled'].includes(c.status)) throw new BadRequestException(`A ${c.status} campaign cannot be edited`);
    await this.assertTemplate(workspaceId, dto.templateId);
    const { abTest, ...rest } = dto;
    Object.assign(c, rest);
    c.abTest = this.abFor(c.channel, abTest === undefined ? c.abTest : abTest);
    if (dto.audience) c.audience = await this.checkAudience(c.workspaceId, clean(dto.audience));
    return this.campaigns.save(c);
  }

  async remove(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    if (['sending', 'testing'].includes(c.status)) throw new BadRequestException(`Campaign is ${c.status}`);
    await this.campaigns.softRemove(c);
    return { id };
  }

  /**
   * Recipients: everyone matching the audience (a saved list, or status/tag filters) who
   * isn't on do-not-disturb and has an address for the channel.
   */
  private async audienceQuery(workspaceId: string, a: CampaignAudience, channel: 'email' | 'sms') {
    const qb = this.contacts
      .createQueryBuilder('c')
      .leftJoin('c.company', 'co')
      .where('c.workspace_id = :workspaceId', { workspaceId })
      .andWhere('c.dnd = false')
      .andWhere(channel === 'email' ? 'c.email IS NOT NULL' : 'c.phone IS NOT NULL');
    if (a.listId) {
      const list = await this.smartLists.findOne({ where: { id: a.listId, workspaceId } });
      if (!list) throw new BadRequestException('The contact list this campaign targets was deleted. Pick another audience.');
      applyContactFilters(qb, cleanFilters(list.filters));
    }
    if (a.statuses?.length) qb.andWhere('c.status IN (:...statuses)', { statuses: a.statuses });
    if (a.tags?.length) qb.andWhere('c.tags && :tags::text[]', { tags: a.tags });
    return qb;
  }

  async audienceSize(workspaceId: string, a: CampaignAudience, channel: 'email' | 'sms' = 'email') {
    return { count: await (await this.audienceQuery(workspaceId, clean(a), channel)).getCount() };
  }

  /** Reject audiences that point at another workspace's (or a deleted) list. */
  private async checkAudience(workspaceId: string, a: CampaignAudience) {
    if (a.listId && !(await this.smartLists.exist({ where: { id: a.listId, workspaceId } }))) {
      throw new BadRequestException('Contact list not found');
    }
    return a;
  }

  async send(workspaceId: string, id: string, dto: SendCampaignDto, userId?: string | null) {
    const c = await this.get(workspaceId, id);
    if (!['draft', 'scheduled'].includes(c.status)) throw new BadRequestException(`Campaign is already ${c.status}`);
    const useTemplate = c.channel === 'email' && !!c.templateId;
    if (!useTemplate && !c.body.trim()) throw new BadRequestException('Campaign body is empty');
    if (useTemplate) await this.assertTemplate(workspaceId, c.templateId);
    const tplSubject = useTemplate ? (await this.templateRepo.findOne({ where: { id: c.templateId! } }))?.subject ?? '' : '';
    if (c.channel === 'email' && !c.subject.trim() && !tplSubject.trim()) throw new BadRequestException('Email subject is empty');
    if (c.audience?.listId) await this.audienceSize(workspaceId, c.audience, c.channel); // throws if the list was deleted
    if (c.channel === 'email' && c.abTest) {
      if (!useTemplate) throw new BadRequestException('A/B tests need a designed email (template) so opens and clicks can be measured');
      const { count } = await this.audienceSize(workspaceId, c.audience, 'email');
      if (count < AB_LIMITS.minAudience) throw new BadRequestException(`An A/B test needs at least ${AB_LIMITS.minAudience} recipients (this audience has ${count})`);
    }
    if (dto.scheduledAt && new Date(dto.scheduledAt).getTime() > Date.now() + 30_000) {
      await this.campaigns.update({ id }, { status: 'scheduled', scheduledAt: new Date(dto.scheduledAt) });
      return { ...c, status: 'scheduled', scheduledAt: dto.scheduledAt };
    }
    await this.campaigns.update({ id }, { status: 'sending', scheduledAt: null });
    // Deliver in the background; the UI polls the campaign for progress.
    setImmediate(() => this.deliver(id, userId).catch((e) => this.logger.error(`Campaign ${id} failed: ${e.message}`)));
    return { ...c, status: 'sending' };
  }

  private async dispatchScheduled() {
    const due = await this.campaigns.find({ where: { status: 'scheduled', scheduledAt: LessThanOrEqual(new Date()) }, take: 10 });
    for (const c of due) {
      const res = await this.campaigns.update({ id: c.id, status: 'scheduled' }, { status: 'sending' });
      if (res.affected) await this.deliver(c.id, null);
    }
    const judged = await this.campaigns.find({ where: { status: 'testing', abDecideAt: LessThanOrEqual(new Date()) }, take: 10 });
    for (const c of judged) {
      if (await this.claimTest(c.id)) await this.finishTest(c.id, null, null);
    }
  }

  /** Only one worker (scheduler tick or a user's "pick winner") may finish a test. */
  private async claimTest(id: string) {
    const res = await this.campaigns.update({ id, status: 'testing' }, { status: 'sending' });
    return !!res.affected;
  }

  /** End the A/B test early, either with a chosen variant or by the results so far. */
  async pickWinnerNow(workspaceId: string, id: string, dto: PickWinnerDto, userId?: string | null) {
    const c = await this.get(workspaceId, id);
    if (c.status !== 'testing') throw new BadRequestException('This campaign is not running an A/B test');
    if (!(await this.claimTest(id))) throw new BadRequestException('The test is already being finished');
    setImmediate(() => this.finishTest(id, dto.variant ?? null, userId).catch((e) => this.logger.error(`Campaign ${id} A/B finish failed: ${e.message}`)));
    return { ...c, status: 'sending' };
  }

  private subjectFor(c: Campaign, tpl: EmailTemplate | null, variant: Variant | null) {
    if (variant === 'B' && c.abTest) return c.abTest.subjectB;
    return c.subject.trim() || tpl?.subject || '';
  }

  private async sendBatch(
    c: Campaign,
    tpl: EmailTemplate | null,
    recipients: Contact[],
    subject: string,
    variant: Variant | null,
    stats: Campaign['stats'],
    userId?: string | null,
  ) {
    for (const contact of recipients) {
      const ctx = { contact };
      let send: Promise<any>;
      if (tpl) {
        // Designed email: campaign subject overrides the template's; unsubscribe link in the footer.
        const r = await this.templates.renderFor(c.workspaceId, { ...tpl, subject }, contact, { unsubscribeUrl: this.unsubscribeUrl(contact.id) });
        send = this.inbox.send(c.workspaceId, { contactId: contact.id, channel: 'email', subject: r.subject, body: r.text }, userId, { html: r.html, campaignId: c.id, variant: variant ?? undefined });
      } else {
        let body = interpolate(c.body, ctx);
        if (c.channel === 'email') body += `\n\n—\nUnsubscribe: ${this.unsubscribeUrl(contact.id)}`;
        else body += ' Reply STOP to opt out.';
        send = this.inbox.send(c.workspaceId, { contactId: contact.id, channel: c.channel, subject: interpolate(subject, ctx), body }, userId, { campaignId: c.id, variant: variant ?? undefined });
      }
      const msg = await send.catch((e) => ({ status: 'failed', error: e.message }));
      if (msg.status === 'sent') stats.sent++;
      else stats.failed++;
      if ((stats.sent + stats.failed) % 25 === 0) await this.campaigns.update({ id: c.id }, { stats });
    }
  }

  private loadTemplate(c: Campaign) {
    return c.channel === 'email' && c.templateId ? this.templateRepo.findOne({ where: { id: c.templateId, workspaceId: c.workspaceId } }) : Promise.resolve(null);
  }

  /** Send the winning subject to everyone in the audience who wasn't in the test group. */
  private async finishTest(id: string, forced: Variant | null, userId?: string | null) {
    const c = await this.campaigns.findOneByOrFail({ id });
    const stats = { ...c.stats };
    try {
      const results = await this.tracking.variantResults(c.workspaceId, id);
      const winner = forced ?? pickWinner(results, c.abTest?.metric ?? 'opens');
      await this.campaigns.update({ id }, { abWinner: winner });
      // Recomputed now, so contacts who unsubscribed or left the segment during the test are skipped.
      const rest = await (await this.audienceQuery(c.workspaceId, c.audience, 'email'))
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
                        WHERE m.campaign_id = :cid AND cv.contact_id = c.id)`,
          { cid: id },
        )
        .getMany();
      stats.recipients = stats.sent + stats.failed + rest.length;
      const tpl = await this.loadTemplate(c);
      await this.sendBatch(c, tpl, rest, this.subjectFor(c, tpl, winner), null, stats, userId);
      await this.campaigns.update({ id }, { status: 'sent', sentAt: new Date(), stats });
      await this.activity.record(
        c.workspaceId,
        'campaign.sent',
        `A/B test on "${c.name}" finished: variant ${winner} won${forced ? ' (picked manually)' : ''}; sent to ${rest.length} more contacts`,
        { entityType: 'campaign', entityId: id, userId },
      );
    } catch (e) {
      await this.campaigns.update({ id }, { status: 'failed', stats });
      throw e;
    }
  }

  private async deliver(id: string, userId?: string | null) {
    const c = await this.campaigns.findOneByOrFail({ id });
    const stats = { recipients: 0, sent: 0, failed: 0, skipped: 0 };
    try {
      const recipients = await (await this.audienceQuery(c.workspaceId, c.audience, c.channel)).getMany();
      stats.recipients = recipients.length;
      const tpl = await this.loadTemplate(c);
      if (c.channel === 'email' && c.abTest && recipients.length >= AB_LIMITS.minAudience) {
        const { a, b } = splitForTest(recipients, c.abTest.testPercent);
        await this.sendBatch(c, tpl, a, this.subjectFor(c, tpl, 'A'), 'A', stats, userId);
        await this.sendBatch(c, tpl, b, this.subjectFor(c, tpl, 'B'), 'B', stats, userId);
        const decideAt = new Date(Date.now() + c.abTest.waitMinutes * 60_000);
        await this.campaigns.update({ id }, { status: 'testing', abDecideAt: decideAt, abWinner: null, stats });
        await this.activity.record(c.workspaceId, 'campaign.testing', `A/B test on "${c.name}" started with ${a.length + b.length} contacts`, {
          entityType: 'campaign',
          entityId: id,
          userId,
        });
        return;
      }
      await this.sendBatch(c, tpl, recipients, this.subjectFor(c, tpl, null), null, stats, userId);
      await this.campaigns.update({ id }, { status: 'sent', sentAt: new Date(), stats });
      await this.activity.record(c.workspaceId, 'campaign.sent', `Campaign "${c.name}" sent to ${stats.sent} contacts`, {
        entityType: 'campaign',
        entityId: id,
        userId,
      });
    } catch (e) {
      await this.campaigns.update({ id }, { status: 'failed', stats });
      throw e;
    }
  }

  // ---- Unsubscribe links (HMAC-signed, no login needed) ----
  private sign(contactId: string) {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET') || 'eril-dev-secret';
    return createHmac('sha256', secret).update(`unsub:${contactId}`).digest('base64url');
  }

  unsubscribeUrl(contactId: string) {
    const app = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    return `${app}/unsubscribe?c=${contactId}&t=${this.sign(contactId)}`;
  }

  async unsubscribe(contactId: string, token: string) {
    const expected = Buffer.from(this.sign(contactId));
    const given = Buffer.from(String(token ?? ''));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new BadRequestException('Invalid unsubscribe link');
    }
    const res = await this.contacts.update({ id: contactId }, { dnd: true });
    if (!res.affected) throw new NotFoundException('Contact not found');
    return { ok: true };
  }
}

function clean(a?: CampaignAudience): CampaignAudience {
  const listId = typeof a?.listId === 'string' && /^[0-9a-f-]{36}$/i.test(a.listId) ? a.listId : undefined;
  return {
    ...(listId ? { listId } : {}),
    statuses: (a?.statuses ?? []).filter((s) => ['lead', 'customer', 'churned'].includes(s)),
    tags: (a?.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
  };
}

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  @Permissions('campaigns:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('campaigns:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateCampaignDto) {
    return this.svc.create(ws, dto);
  }

  @Post('audience-size')
  @Permissions('campaigns:read')
  audience(@Tenant('workspaceId') ws: string, @Body() dto: AudienceDto & { channel?: 'email' | 'sms' }) {
    return this.svc.audienceSize(ws, dto, dto.channel ?? 'email');
  }

  @Get(':id/report')
  @Permissions('campaigns:read')
  report(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.report(ws, id);
  }

  @Get(':id')
  @Permissions('campaigns:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, id);
  }

  @Put(':id')
  @Permissions('campaigns:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('campaigns:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Post(':id/ab/winner')
  @Permissions('campaigns:send')
  pickWinner(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PickWinnerDto) {
    return this.svc.pickWinnerNow(ws, id, dto, userId);
  }

  @Post(':id/send')
  @Permissions('campaigns:send')
  send(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendCampaignDto) {
    return this.svc.send(ws, id, dto, userId);
  }
}

@Controller('public/unsubscribe')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class UnsubscribeController {
  constructor(private readonly svc: CampaignsService) {}

  @Post()
  unsubscribe(@Body('c', ParseUUIDPipe) contactId: string, @Body('t') token: string) {
    return this.svc.unsubscribe(contactId, token);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Campaign, Contact, EmailTemplate, SmartList]), CommunicationModule, EmailTemplatesModule],
  controllers: [CampaignsController, UnsubscribeController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
