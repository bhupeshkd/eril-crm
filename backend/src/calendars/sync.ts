import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { Between, In, IsNull, LessThan, Or, Repository } from 'typeorm';
import { CalendarFeed, ExternalCalendar } from '../database/entities/calendar-sync.entity';
import { Appointment, Calendar } from '../database/entities/calendar.entity';
import { Contact } from '../database/entities/contact.entity';
import { User } from '../database/entities/user.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildIcs, parseIcsBusy, type Busy } from './ics';
import { normalizeFeedUrl, safeFetchText } from './safe-fetch';

class AddExternalDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) url: string;
  /** Block this booking calendar; omit to block your own time on team calendars. */
  @IsOptional() @IsUUID() calendarId?: string;
}

const MANAGERS = ['workspace_owner', 'workspace_admin', 'manager', 'agency_owner', 'agency_admin', 'super_admin'];
const HORIZON_DAYS = 180;
const REFRESH_MS = 15 * 60_000;

@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(CalendarFeed) private readonly feeds: Repository<CalendarFeed>,
    @InjectRepository(ExternalCalendar) private readonly externals: Repository<ExternalCalendar>,
    @InjectRepository(Appointment) private readonly appts: Repository<Appointment>,
    @InjectRepository(Calendar) private readonly calendars: Repository<Calendar>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => this.refreshDue().catch((e) => this.logger.error(`Calendar sync failed: ${e.message}`)), 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Local test servers only; never in production. */
  private get allowPrivate() {
    return process.env.NODE_ENV !== 'production' && this.config.get<string>('CALENDAR_SYNC_ALLOW_PRIVATE') === 'true';
  }

  private get apiBase() {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix.replace(/^\/|\/$/g, '')}`;
  }

  // ---- Outbound feed ----
  private async feedFor(workspaceId: string, userId: string) {
    let f = await this.feeds.findOne({ where: { workspaceId, userId } });
    if (!f) {
      await this.feeds.createQueryBuilder().insert().into(CalendarFeed).values({ workspaceId, userId, token: randomBytes(24).toString('base64url') }).orIgnore().execute();
      f = await this.feeds.findOneByOrFail({ workspaceId, userId });
    }
    return f;
  }
  private feedUrl(token: string) {
    return `${this.apiBase}/public/calendar-feed/${token}.ics`;
  }

  async overview(workspaceId: string, userId: string, role: string) {
    const feed = await this.feedFor(workspaceId, userId);
    const manager = MANAGERS.includes(role);
    const rows = await this.externals.find({ where: manager ? { workspaceId } : { workspaceId, userId }, order: { createdAt: 'ASC' } });
    const users = rows.some((r) => r.userId) ? await this.users.find({ where: { id: In(rows.map((r) => r.userId).filter(Boolean) as string[]) }, select: { id: true, name: true } }) : [];
    const cals = rows.some((r) => r.calendarId) ? await this.calendars.find({ where: { id: In(rows.map((r) => r.calendarId).filter(Boolean) as string[]) }, select: { id: true, name: true } }) : [];
    return {
      feedUrl: this.feedUrl(feed.token),
      external: rows.map((r) => ({
        id: r.id,
        name: r.name,
        blocks: r.calendarId ? { kind: 'calendar', name: cals.find((c) => c.id === r.calendarId)?.name ?? 'Calendar' } : { kind: 'member', name: users.find((u) => u.id === r.userId)?.name ?? 'Team member', isMe: r.userId === userId },
        busyCount: r.busy.length,
        lastSyncedAt: r.lastSyncedAt,
        lastError: r.lastError,
      })),
    };
  }

  async regenerate(workspaceId: string, userId: string) {
    const f = await this.feedFor(workspaceId, userId);
    await this.feeds.update({ id: f.id }, { token: randomBytes(24).toString('base64url') });
    return { feedUrl: this.feedUrl((await this.feeds.findOneByOrFail({ id: f.id })).token) };
  }

  /** The user's appointments (assigned to them) from 30 days ago to 6 months ahead, as iCal. */
  async feedIcs(token: string): Promise<string | null> {
    if (!/^[\w-]{20,64}$/.test(token)) return null;
    const f = await this.feeds.findOne({ where: { token } });
    if (!f) return null;
    const user = await this.users.findOne({ where: { id: f.userId }, select: { id: true, name: true } });
    const rows = await this.appts.find({
      where: { workspaceId: f.workspaceId, assignedUserId: f.userId, startAt: Between(new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + HORIZON_DAYS * 86_400_000)) },
      relations: { calendar: true },
      order: { startAt: 'ASC' },
      take: 2000,
    });
    const people = rows.length ? await this.contacts.find({ where: { id: In([...new Set(rows.map((r) => r.contactId))]) }, select: { id: true, firstName: true, lastName: true } }) : [];
    return buildIcs(`${user?.name ?? 'My'} appointments`, rows.map((a) => {
      const c = people.find((p) => p.id === a.contactId);
      return {
        uid: `${a.id}@eril`,
        start: a.startAt,
        end: a.endAt,
        summary: a.title,
        description: [c ? `With ${`${c.firstName} ${c.lastName}`.trim()}` : '', a.calendar?.name ? `Calendar: ${a.calendar.name}` : '', a.notes ?? ''].filter(Boolean).join('\n'),
        location: a.calendar?.location || undefined,
        cancelled: a.status === 'cancelled',
        updated: a.updatedAt,
      };
    }));
  }

  // ---- Inbound (busy times) ----
  async add(workspaceId: string, userId: string, role: string, dto: AddExternalDto) {
    if (dto.calendarId) {
      if (!MANAGERS.includes(role)) throw new ForbiddenException('Only owners, admins and managers can connect a calendar to a booking calendar');
      if (!(await this.calendars.exist({ where: { id: dto.calendarId, workspaceId } }))) throw new NotFoundException('Calendar not found');
    }
    const url = normalizeFeedUrl(dto.url, this.allowPrivate);
    if (!url) throw new BadRequestException('Paste the calendar’s secret iCal address (it starts with https:// or webcal://)');
    if ((await this.externals.count({ where: { workspaceId } })) >= 50) throw new BadRequestException('Up to 50 connected calendars per workspace');
    const row = this.externals.create({ workspaceId, userId: dto.calendarId ? null : userId, calendarId: dto.calendarId ?? null, name: dto.name.trim(), url: url.toString(), busy: [] });
    // Fetch once up front so a wrong link is caught straight away.
    const r = await this.fetchBusy(row.url);
    if ('error' in r) throw new BadRequestException(`Couldn't read that calendar: ${r.error}`);
    Object.assign(row, { busy: r.busy, lastSyncedAt: new Date(), lastError: null });
    const saved = await this.externals.save(row);
    return { id: saved.id, busyCount: saved.busy.length };
  }

  private async fetchBusy(url: string): Promise<{ busy: Array<{ s: string; e: string }> } | { error: string }> {
    try {
      const text = await safeFetchText(url, { allowPrivate: this.allowPrivate });
      if (!/BEGIN:VCALENDAR/.test(text)) return { error: 'that link isn’t an iCal calendar' };
      const busy = parseIcsBusy(text, new Date(Date.now() - 86_400_000), new Date(Date.now() + HORIZON_DAYS * 86_400_000));
      return { busy: busy.map((b) => ({ s: b.start.toISOString(), e: b.end.toISOString() })) };
    } catch (e) {
      return { error: String((e as Error).message ?? e).slice(0, 200) };
    }
  }

  private async own(workspaceId: string, userId: string, role: string, id: string) {
    const row = await this.externals.createQueryBuilder('x').addSelect('x.url').where('x.id = :id AND x.workspace_id = :ws', { id, ws: workspaceId }).getOne();
    if (!row || (row.userId !== userId && !MANAGERS.includes(role))) throw new NotFoundException('Calendar not found');
    return row;
  }

  async refresh(workspaceId: string, userId: string, role: string, id: string) {
    const row = await this.own(workspaceId, userId, role, id);
    return this.sync(row);
  }

  /** Keeps the last good busy times when a refresh fails. */
  private async sync(row: ExternalCalendar) {
    const r = await this.fetchBusy(row.url);
    if ('error' in r) await this.externals.update({ id: row.id }, { lastError: r.error, lastSyncedAt: new Date() });
    else await this.externals.update({ id: row.id }, { busy: r.busy, lastError: null, lastSyncedAt: new Date() });
    const fresh = await this.externals.findOneByOrFail({ id: row.id });
    return { id: fresh.id, busyCount: fresh.busy.length, lastError: fresh.lastError, lastSyncedAt: fresh.lastSyncedAt };
  }

  async remove(workspaceId: string, userId: string, role: string, id: string) {
    const row = await this.own(workspaceId, userId, role, id);
    await this.externals.delete({ id: row.id });
    return { id };
  }

  async refreshDue() {
    const due = await this.externals.createQueryBuilder('x').addSelect('x.url').where('x.last_synced_at IS NULL OR x.last_synced_at < :t', { t: new Date(Date.now() - REFRESH_MS) }).orderBy('x.last_synced_at', 'ASC', 'NULLS FIRST').take(20).getMany();
    for (const row of due) await this.sync(row).catch((e) => this.logger.warn(`Calendar ${row.id}: ${e.message}`));
    return due.length;
  }
}

/** Busy blocks from connected outside calendars, for slot generation and host assignment. */
export async function externalBusy(repo: Repository<ExternalCalendar>, workspaceId: string, opts: { userIds?: string[]; calendarId?: string }, from: Date, to: Date) {
  const byUser = new Map<string, Busy[]>();
  const forCalendar: Busy[] = [];
  const where = [
    ...(opts.userIds?.length ? [{ workspaceId, userId: In(opts.userIds) }] : []),
    ...(opts.calendarId ? [{ workspaceId, calendarId: opts.calendarId }] : []),
  ];
  if (!where.length) return { byUser, forCalendar };
  for (const row of await repo.find({ where })) {
    const blocks = row.busy.map((b) => ({ start: new Date(b.s), end: new Date(b.e) })).filter((b) => b.end > from && b.start < to);
    if (row.userId) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), ...blocks]);
    else forCalendar.push(...blocks);
  }
  return { byUser, forCalendar };
}

@Controller('calendar-sync')
export class CalendarSyncController {
  constructor(private readonly svc: CalendarSyncService) {}

  @Get()
  @Permissions('calendars:read')
  overview(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string) {
    return this.svc.overview(ws, me, role);
  }

  @Post('feed/regenerate')
  @Permissions('calendars:read')
  regenerate(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string) {
    return this.svc.regenerate(ws, me);
  }

  @Post('external')
  @Permissions('calendars:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  add(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string, @Body() dto: AddExternalDto) {
    return this.svc.add(ws, me, role, dto);
  }

  @Post('external/:id/refresh')
  @Permissions('calendars:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.refresh(ws, me, role, id);
  }

  @Delete('external/:id')
  @Permissions('calendars:read')
  remove(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, me, role, id);
  }
}

@Controller('public/calendar-feed')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class CalendarFeedController {
  constructor(private readonly svc: CalendarSyncService) {}

  @Get(':file')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async feed(@Param('file') file: string, @Res() res: Response) {
    const ics = await this.svc.feedIcs(file.replace(/\.ics$/, ''));
    if (!ics) return res.status(404).type('text/plain').send('Calendar feed not found');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="appointments.ics"' });
    res.send(ics);
  }
}
