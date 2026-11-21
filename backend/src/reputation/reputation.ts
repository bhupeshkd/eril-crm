import {
  BadRequestException,
  Body,
  Controller,
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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Repository } from 'typeorm';
import { Review, ReviewRequest } from '../database/entities/site.entity';
import { Contact } from '../database/entities/contact.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { publicToken } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';

export interface ReputationSettings {
  publicReviewUrl?: string;
  minPublicRating?: number;
  autoPublishMinRating?: number | null;
}

class RequestDto {
  @IsUUID() contactId: string;
  @IsOptional() @IsIn(['email', 'sms']) channel?: 'email' | 'sms';
}
class SettingsDto {
  @IsOptional() @ValidateIf((o) => o.publicReviewUrl !== '') @IsString() @MaxLength(500) publicReviewUrl?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) minPublicRating?: number;
  @IsOptional() @ValidateIf((o) => o.autoPublishMinRating !== null) @IsInt() @Min(1) @Max(5) autoPublishMinRating?: number | null;
}
class ReviewUpdateDto {
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) reply?: string | null;
}
class SubmitReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(3000) comment?: string;
}

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(ReviewRequest) private readonly requests: Repository<ReviewRequest>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  async settings(workspaceId: string): Promise<ReputationSettings> {
    const ws = await this.workspaces.findOneByOrFail({ id: workspaceId });
    return { minPublicRating: 4, autoPublishMinRating: null, publicReviewUrl: '', ...((ws.settings?.reputation as object) ?? {}) };
  }

  async saveSettings(workspaceId: string, dto: SettingsDto) {
    if (dto.publicReviewUrl && !/^https:\/\//.test(dto.publicReviewUrl)) throw new BadRequestException('Review URL must start with https://');
    const ws = await this.workspaces.findOneByOrFail({ id: workspaceId });
    ws.settings = { ...(ws.settings ?? {}), reputation: { ...(await this.settings(workspaceId)), ...dto } };
    await this.workspaces.save(ws);
    return this.settings(workspaceId);
  }

  async summary(workspaceId: string) {
    const row = await this.reviews
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(AVG(r.rating),0)', 'avg')
      .addSelect(`COUNT(*) FILTER (WHERE r.rating >= 4)`, 'positive')
      .where('r.workspace_id = :workspaceId', { workspaceId })
      .getRawOne();
    const dist = await this.reviews
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r.workspace_id = :workspaceId', { workspaceId })
      .groupBy('r.rating')
      .getRawMany();
    const sent = await this.requests.count({ where: { workspaceId } });
    const completed = await this.requests.count({ where: { workspaceId, status: 'completed' } });
    return {
      count: Number(row.count),
      average: Math.round(Number(row.avg) * 10) / 10,
      positive: Number(row.positive),
      distribution: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, Number(dist.find((d) => Number(d.rating) === n)?.count ?? 0)])),
      requestsSent: sent,
      responseRate: sent ? Math.round((completed / sent) * 100) : null,
    };
  }

  list(workspaceId: string) {
    return this.reviews.find({ where: { workspaceId }, relations: { contact: true }, order: { createdAt: 'DESC' }, take: 500 });
  }

  async updateReview(workspaceId: string, id: string, dto: ReviewUpdateDto) {
    const r = await this.reviews.findOne({ where: { id, workspaceId } });
    if (!r) throw new NotFoundException('Review not found');
    if (dto.isPublic !== undefined) r.isPublic = dto.isPublic;
    if (dto.reply !== undefined) r.reply = dto.reply;
    return this.reviews.save(r);
  }

  async request(workspaceId: string, dto: RequestDto, userId?: string | null) {
    const contact = await this.contacts.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    const channel = dto.channel ?? (contact.email ? 'email' : 'sms');
    if (contact.dnd) throw new BadRequestException('Contact is on do-not-disturb');
    const req = await this.requests.save(this.requests.create({ workspaceId, contactId: contact.id, token: publicToken(), channel }));
    const link = `${this.config.get('APP_URL') || 'http://localhost:3000'}/review/${req.token}`;
    const msg = await this.inbox.send(
      workspaceId,
      channel === 'email'
        ? { contactId: contact.id, channel, subject: 'How did we do?', body: `Hi ${contact.firstName},\n\nThanks for choosing us! Could you take 30 seconds to rate your experience?\n\n${link}\n\nIt really helps us improve.` }
        : { contactId: contact.id, channel, body: `Hi ${contact.firstName}, thanks for choosing us! How did we do? ${link}` },
      userId,
    );
    if (msg.status === 'failed') throw new BadRequestException(`Could not send: ${msg.error}`);
    await this.activity.record(workspaceId, 'review.requested', `Review requested from ${contact.firstName} ${contact.lastName}`.trim(), {
      entityType: 'contact',
      entityId: contact.id,
      userId,
    });
    return { id: req.id, link };
  }

  async publicRequest(token: string) {
    const req = await this.requests.findOne({ where: { token }, relations: { contact: true } });
    if (!req) throw new NotFoundException('This review link is not valid');
    const ws = await this.workspaces.findOne({ where: { id: req.workspaceId }, relations: { organization: true } });
    return { req, business: ws?.organization?.name ?? ws?.name ?? 'us' };
  }

  async submit(token: string, dto: SubmitReviewDto) {
    const { req } = await this.publicRequest(token);
    if (req.status === 'completed') throw new BadRequestException('You have already left a review. Thank you!');
    const settings = await this.settings(req.workspaceId);
    const auto = settings.autoPublishMinRating ?? null;
    const review = await this.reviews.save(
      this.reviews.create({
        workspaceId: req.workspaceId,
        contactId: req.contactId,
        rating: dto.rating,
        comment: (dto.comment ?? '').trim(),
        requestId: req.id,
        isPublic: auto !== null && dto.rating >= auto,
      }),
    );
    await this.requests.update({ id: req.id }, { status: 'completed', completedAt: new Date() });
    await this.activity.record(req.workspaceId, 'review.received', `${dto.rating}★ review from ${req.contact.firstName}`, {
      entityType: 'contact',
      entityId: req.contactId,
    });
    this.events.emit({
      type: 'review.received',
      workspaceId: req.workspaceId,
      contactId: req.contactId,
      payload: { review: { id: review.id, rating: review.rating, comment: review.comment }, contact: req.contact },
    });
    // Happy customers are pointed at the public review site; others stay private feedback.
    const goPublic = settings.publicReviewUrl && dto.rating >= (settings.minPublicRating ?? 4);
    return { ok: true, publicReviewUrl: goPublic ? settings.publicReviewUrl : null };
  }
}

@Controller('reputation')
export class ReputationController {
  constructor(private readonly svc: ReputationService) {}

  @Get('summary')
  @Permissions('contacts:read')
  summary(@Tenant('workspaceId') ws: string) {
    return this.svc.summary(ws);
  }

  @Get('reviews')
  @Permissions('contacts:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Put('reviews/:id')
  @Permissions('contacts:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewUpdateDto) {
    return this.svc.updateReview(ws, id, dto);
  }

  @Post('requests')
  @Permissions('conversations:write')
  request(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: RequestDto) {
    return this.svc.request(ws, dto, userId);
  }

  @Get('settings')
  @Permissions('contacts:read')
  settings(@Tenant('workspaceId') ws: string) {
    return this.svc.settings(ws);
  }

  @Put('settings')
  @Permissions('workspaces:write')
  saveSettings(@Tenant('workspaceId') ws: string, @Body() dto: SettingsDto) {
    return this.svc.saveSettings(ws, dto);
  }
}

@Controller('public/reviews')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicReviewsController {
  constructor(private readonly svc: ReputationService) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const { req, business } = await this.svc.publicRequest(token);
    return { business, firstName: req.contact.firstName, completed: req.status === 'completed' };
  }

  @Post(':token')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  submit(@Param('token') token: string, @Body() dto: SubmitReviewDto) {
    return this.svc.submit(token, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Review, ReviewRequest, Contact, Workspace]), CommunicationModule],
  controllers: [ReputationController, PublicReviewsController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
