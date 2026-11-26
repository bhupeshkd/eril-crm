import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { DEFAULT_ROLE_PERMISSIONS } from '@eril/shared';
import { PushSubscription } from '../database/entities/push-subscription.entity';
import { SystemSetting } from '../database/entities/system-setting.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { DomainEvent, EventsService } from '../events/events.service';
import { describeEvent } from '../events/realtime.controller';
import { deviceLabel, pushEndpointAllowed } from './endpoints';

export { deviceLabel, pushEndpointAllowed };

/** Kinds of alert a device can opt into, the events behind each, and the permission needed to see them. */
export const PUSH_TOPICS = {
  messages: { label: 'New messages', events: ['message.received', 'conversation.handed_off'], perm: 'conversations:read' },
  calls: { label: 'Missed calls', events: ['call.missed'], perm: 'conversations:read' },
  appointments: { label: 'New bookings', events: ['appointment.booked'], perm: 'appointments:read' },
  forms: { label: 'Form submissions', events: ['form.submitted'], perm: 'contacts:read' },
  payments: { label: 'Orders and payments', events: ['order.paid', 'invoice.paid', 'subscription.created'], perm: 'payments:read' },
  reviews: { label: 'New reviews', events: ['review.received'], perm: 'contacts:read' },
} as const;
export type PushTopic = keyof typeof PUSH_TOPICS;
const TOPIC_KEYS = Object.keys(PUSH_TOPICS) as PushTopic[];
const TOPIC_OF: Record<string, PushTopic> = Object.fromEntries(TOPIC_KEYS.flatMap((t) => PUSH_TOPICS[t].events.map((e) => [e, t])));

class PushKeysDto {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(100) auth: string;
}

export class SubscribeDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https', 'http'] }) @MaxLength(1000) endpoint: string;
  @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsIn(TOPIC_KEYS, { each: true }) topics?: PushTopic[];
}

export class TestPushDto {
  @IsOptional() @IsUUID() id?: string;
}

export class UpdateTopicsDto {
  @IsArray() @ArrayMaxSize(10) @IsIn(TOPIC_KEYS, { each: true }) topics: PushTopic[];
}

type Message = { title: string; body: string; url: string; tag: string; workspaceId?: string };

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private publicKey = '';
  private ready = false;
  private readonly testHosts: string[];
  /** Per-user send budget, so a burst of events can't flood a phone. */
  private readonly sent = new Map<string, { n: number; at: number }>();

  constructor(
    private readonly config: ConfigService,
    private readonly ds: DataSource,
    private readonly events: EventsService,
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
  ) {
    // Tests point subscriptions at a local fake push service; never set this in production.
    this.testHosts = (this.config.get<string>('PUSH_TEST_ENDPOINT_HOSTS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  async onModuleInit() {
    try {
      let pub = this.config.get<string>('VAPID_PUBLIC_KEY');
      let priv = this.config.get<string>('VAPID_PRIVATE_KEY');
      if (!pub || !priv) {
        // No keys configured: generate a pair once and keep it, so existing subscriptions keep working.
        const row = await this.settings.findOne({ where: { key: 'vapid' } });
        if (row?.value?.publicKey && row.value.privateKey) {
          ({ publicKey: pub, privateKey: priv } = row.value);
        } else {
          const k = webpush.generateVAPIDKeys();
          await this.settings.save({ key: 'vapid', value: k });
          ({ publicKey: pub, privateKey: priv } = k);
          this.logger.warn('Generated Web Push (VAPID) keys and stored them in system_settings. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to manage them yourself.');
        }
      }
      webpush.setVapidDetails(this.subject(), pub!, priv!);
      this.publicKey = pub!;
      this.ready = true;
    } catch (err: any) {
      this.logger.error(`Push notifications disabled: ${err?.message ?? err}`);
    }
    this.events.onAny((e) => this.onEvent(e));
  }

  /** Contact for push services: VAPID_SUBJECT, else the app URL if it's https, else a placeholder mailbox. */
  private subject() {
    const s = this.config.get<string>('VAPID_SUBJECT');
    if (s) return s;
    const app = this.config.get<string>('APP_URL') || '';
    return app.startsWith('https://') ? app : 'mailto:push@eril.local';
  }

  configFor() {
    return { enabled: this.ready, publicKey: this.ready ? this.publicKey : null, topics: TOPIC_KEYS.map((key) => ({ key, label: PUSH_TOPICS[key].label })) };
  }

  private view(s: PushSubscription) {
    return { id: s.id, label: s.label, topics: s.topics, endpointHash: hashEndpoint(s.endpoint), createdAt: s.createdAt, lastSentAt: s.lastSentAt };
  }

  async list(userId: string) {
    const rows = await this.subs.find({ where: { userId }, order: { createdAt: 'ASC' } });
    return rows.map((s) => this.view(s));
  }

  async subscribe(userId: string, dto: SubscribeDto, ua?: string) {
    if (!this.ready) throw new BadRequestException('Push notifications are not available on this server');
    if (!pushEndpointAllowed(dto.endpoint, this.testHosts)) throw new BadRequestException('Unsupported push service');
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(dto.keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(dto.keys.auth)) throw new BadRequestException('Invalid subscription keys');
    if ((await this.subs.count({ where: { userId } })) >= 20 && !(await this.subs.exist({ where: { endpoint: dto.endpoint, userId } }))) {
      throw new BadRequestException('Too many devices. Remove one first.');
    }
    // A device belongs to whoever subscribed it last (e.g. a shared tablet after a different person signs in).
    let row = await this.subs.findOne({ where: { endpoint: dto.endpoint }, withDeleted: true });
    if (row) {
      Object.assign(row, { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, failureCount: 0, deletedAt: null });
      if (dto.topics) row.topics = dto.topics;
    } else {
      row = this.subs.create({ userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, topics: dto.topics ?? [...TOPIC_KEYS] });
    }
    row.label = deviceLabel(ua).slice(0, 80);
    return this.view(await this.subs.save(row));
  }

  async updateTopics(userId: string, id: string, topics: PushTopic[]) {
    const row = await this.subs.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Device not found');
    row.topics = [...new Set(topics)];
    return this.view(await this.subs.save(row));
  }

  async remove(userId: string, id: string) {
    const row = await this.subs.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Device not found');
    await this.subs.delete(row.id);
    return { id };
  }

  async test(userId: string, id?: string) {
    const rows = await this.subs.find({ where: id ? { id, userId } : { userId } });
    if (!rows.length) throw new NotFoundException('No devices to notify');
    const results = await Promise.all(rows.map((s) => this.deliver(s, { title: 'Notifications are on', body: 'You’ll get alerts like this on this device.', url: '/dashboard', tag: 'test' })));
    return { sent: results.filter(Boolean).length, devices: rows.length };
  }

  // ---- Events → notifications ----
  private async onEvent(e: DomainEvent) {
    if (!this.ready) return;
    const topic = TOPIC_OF[e.type];
    if (!topic) return;
    const info = describeEvent(e);
    if (!info) return;
    const perm = PUSH_TOPICS[topic].perm;
    // Members of the workspace with a device opted into this topic, minus whoever caused the event.
    const rows: Array<PushSubscription & { role: string; workspace_name: string }> = await this.ds.query(
      `SELECT s.id, s.user_id AS "userId", s.endpoint, s.p256dh, s.auth, s.failure_count AS "failureCount", m.role, w.name AS workspace_name
         FROM push_subscriptions s
         JOIN workspace_members m ON m.user_id = s.user_id AND m.workspace_id = $1 AND m.deleted_at IS NULL
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE s.deleted_at IS NULL AND s.topics ? $2 AND ($3::uuid IS NULL OR s.user_id <> $3::uuid)`,
      [e.workspaceId, topic, e.userId ?? null],
    );
    const allowed = rows.filter((r) => ((DEFAULT_ROLE_PERMISSIONS as Record<string, readonly string[]>)[r.role] ?? []).includes(perm));
    await Promise.all(
      allowed.map((r) =>
        this.allow(r.userId)
          ? this.deliver(r, { title: r.workspace_name, body: info.title.slice(0, 180), url: info.href || '/dashboard', tag: `${e.type}:${e.payload?.conversationId ?? e.contactId ?? ''}`, workspaceId: e.workspaceId })
          : false,
      ),
    );
  }

  private allow(userId: string) {
    const now = Date.now();
    const s = this.sent.get(userId);
    if (!s || now - s.at > 60_000) {
      this.sent.set(userId, { n: 1, at: now });
      if (this.sent.size > 10_000) this.sent.clear();
      return true;
    }
    return ++s.n <= 20;
  }

  /** Sends one notification. Gone subscriptions are deleted; repeated failures disable the device. */
  private async deliver(s: Pick<PushSubscription, 'id' | 'endpoint' | 'p256dh' | 'auth' | 'failureCount'>, msg: Message): Promise<boolean> {
    if (!pushEndpointAllowed(s.endpoint, this.testHosts)) return false;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...msg, icon: '/app-icon/192' }), {
        TTL: 60 * 60 * 12,
        urgency: msg.tag.startsWith('message') || msg.tag.startsWith('call') ? 'high' : 'normal',
        timeout: 10_000,
      });
      await this.subs.update(s.id, { lastSentAt: new Date(), failureCount: 0 });
      return true;
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        await this.subs.delete(s.id); // unsubscribed in the browser
      } else {
        const failures = (s.failureCount ?? 0) + 1;
        if (failures >= 5) await this.subs.delete(s.id);
        else await this.subs.update(s.id, { failureCount: failures });
        this.logger.warn(`Push to ${new URL(s.endpoint).host} failed (${code ?? err?.message ?? err})`);
      }
      return false;
    }
  }
}

/** Lets the browser tell which listed device is itself without the server echoing endpoints back. */
export function hashEndpoint(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

@Controller('push')
@SkipTenant()
export class PushController {
  constructor(private readonly svc: PushService) {}

  @Get('config')
  config() {
    return this.svc.configFor();
  }

  @Get('subscriptions')
  list(@CurrentUser('id') userId: string) {
    return this.svc.list(userId);
  }

  @Post('subscriptions')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  subscribe(@CurrentUser('id') userId: string, @Body() dto: SubscribeDto, @Headers('user-agent') ua?: string) {
    return this.svc.subscribe(userId, dto, ua);
  }

  @Patch('subscriptions/:id')
  update(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTopicsDto) {
    return this.svc.updateTopics(userId, id, dto.topics);
  }

  @Delete('subscriptions/:id')
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(userId, id);
  }

  @Post('test')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  test(@CurrentUser('id') userId: string, @Body() dto: TestPushDto) {
    return this.svc.test(userId, dto.id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription, SystemSetting])],
  controllers: [PushController],
  providers: [PushService],
})
export class PushModule {}
