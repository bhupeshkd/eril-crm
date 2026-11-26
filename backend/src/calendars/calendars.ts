import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  Injectable,
  Logger,
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
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Between, EntityManager, In, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { User } from '../database/entities/user.entity';
import { chooseHost, unionSlots, type HostStats } from './team';
import { APPOINTMENT_STATUSES, Appointment, AppointmentReminder, Calendar, DEFAULT_AVAILABILITY, MemberHours, WeeklyAvailability } from '../database/entities/calendar.entity';
import { cleanReminders, withinHours, type MemberHours as Hours } from './hours';
import { RemindersService } from './reminders';
import { CalendarFeed, ExternalCalendar } from '../database/entities/calendar-sync.entity';
import { CalendarFeedController, CalendarSyncController, CalendarSyncService, externalBusy } from './sync';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { addDays, computeSlots, formatInZone, isValidTimeZone, todayIn, weekdayOf } from './time';

// ---- DTOs -------------------------------------------------------------------
class CalendarFieldsDto {
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(5) @Max(480) slotIntervalMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) bufferMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(720) minNoticeHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) bookingWindowDays?: number;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsObject() availability?: WeeklyAvailability;
  @IsOptional() @IsBoolean() sendConfirmation?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsIn(['personal', 'team']) type?: 'personal' | 'team';
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) teamMemberIds?: string[];
  @IsOptional() @IsIn(['round_robin', 'balanced']) distribution?: 'round_robin' | 'balanced';
  @IsOptional() @IsBoolean() assignContactOwner?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(10) reminders?: Array<{ minutesBefore: number; channel: 'email' | 'sms' }>;
}

export class MemberHoursDto {
  @IsString() timezone: string;
  @IsObject() weekly: WeeklyAvailability;
  @IsOptional() @IsArray() @ArrayMaxSize(366) @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true }) daysOff?: string[];
}

class RunRemindersDto {
  @IsOptional() @IsDateString() at?: string;
}
export class CreateCalendarDto extends CalendarFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
}
export class UpdateCalendarDto extends CalendarFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}

export class CreateAppointmentDto {
  @IsUUID() calendarId: string;
  @IsUUID() contactId: string;
  @IsDateString() startAt: string;
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  @IsOptional() @IsString() notes?: string;
  /** Host. Team calendars pick one automatically when omitted. */
  @IsOptional() @IsUUID() assignedUserId?: string;
}

export class UpdateAppointmentDto {
  @IsOptional() @IsIn(APPOINTMENT_STATUSES as unknown as string[]) status?: (typeof APPOINTMENT_STATUSES)[number];
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsString() notes?: string | null;
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  /** Reassign the host (null clears it on personal calendars). */
  @IsOptional() @ValidateIf((o) => o.assignedUserId !== null) @IsUUID() assignedUserId?: string | null;
}

export class PublicBookingDto {
  @IsDateString() startAt: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Marketing attribution captured on the page ({ first, last } touches). */
  @IsOptional() @IsObject() attribution?: Record<string, unknown>;
}

class SlotQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
}

class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() calendarId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() assignedUserId?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateAvailability(a: WeeklyAvailability): WeeklyAvailability {
  const out: WeeklyAvailability = {};
  for (let d = 0; d < 7; d++) {
    const list = a?.[String(d)] ?? [];
    if (!Array.isArray(list)) throw new BadRequestException(`availability[${d}] must be an array`);
    out[String(d)] = list.map((w) => {
      if (!TIME.test(w?.start) || !TIME.test(w?.end) || w.start >= w.end) {
        throw new BadRequestException(`Invalid window on day ${d}: ${JSON.stringify(w)}`);
      }
      return { start: w.start, end: w.end };
    });
  }
  return out;
}

function checkReminders(input: unknown) {
  const r = cleanReminders(input);
  if (typeof r === 'string') throw new BadRequestException(r);
  return r;
}

// ---- Service ----------------------------------------------------------------
@Injectable()
export class CalendarsService {
  private readonly logger = new Logger(CalendarsService.name);

  constructor(
    @InjectRepository(Calendar) private readonly calendars: Repository<Calendar>,
    @InjectRepository(Appointment) private readonly appts: Repository<Appointment>,
    @InjectRepository(Contact) private readonly contactsRepo: Repository<Contact>,
    @InjectRepository(WorkspaceMember) private readonly membersRepo: Repository<WorkspaceMember>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(MemberHours) private readonly hoursRepo: Repository<MemberHours>,
    @InjectRepository(ExternalCalendar) private readonly extRepo: Repository<ExternalCalendar>,
    private readonly contacts: ContactsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  list(workspaceId: string) {
    return this.calendars.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
  }

  async get(workspaceId: string, id: string) {
    const c = await this.calendars.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Calendar not found');
    return c;
  }

  /** Team members must belong to the workspace; a team calendar needs at least one. */
  private async checkTeam(workspaceId: string, type: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length) {
      const found = await this.membersRepo.count({ where: { workspaceId, userId: In(unique) } });
      if (found !== unique.length) throw new BadRequestException('Every team member must be a user in this workspace');
    }
    if (type === 'team' && !unique.length) throw new BadRequestException('Add at least one team member to a team calendar');
    return unique;
  }

  /** Configured members who are still in the workspace, in configured order. */
  async activeMembers(cal: Calendar): Promise<string[]> {
    if (!cal.teamMemberIds?.length) return [];
    const rows = await this.membersRepo.find({ where: { workspaceId: cal.workspaceId, userId: In(cal.teamMemberIds) }, select: { userId: true } });
    const ok = new Set(rows.map((r) => r.userId));
    return cal.teamMemberIds.filter((id) => ok.has(id));
  }

  async create(workspaceId: string, dto: CreateCalendarDto) {
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown timezone');
    const teamMemberIds = await this.checkTeam(workspaceId, dto.type ?? 'personal', dto.teamMemberIds ?? []);
    return this.calendars.save(
      this.calendars.create({
        ...dto,
        teamMemberIds,
        workspaceId,
        slug: makeSlug(dto.name),
        availability: dto.availability ? validateAvailability(dto.availability) : DEFAULT_AVAILABILITY,
        reminders: dto.reminders ? checkReminders(dto.reminders) : [],
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateCalendarDto) {
    const c = await this.get(workspaceId, id);
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown timezone');
    Object.assign(c, dto);
    c.teamMemberIds = await this.checkTeam(workspaceId, c.type, c.teamMemberIds ?? []);
    if (dto.availability) c.availability = validateAvailability(dto.availability);
    if (dto.reminders) c.reminders = checkReminders(dto.reminders);
    return this.calendars.save(c);
  }

  async remove(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    await this.calendars.softRemove(c);
    return { id };
  }

  /** Available slot starts (UTC ISO strings) for a calendar on a local date. */
  async slots(cal: Calendar, date: string, repo: Repository<Appointment> = this.appts): Promise<string[]> {
    const today = todayIn(cal.timezone);
    if (date < today || date > addDays(today, cal.bookingWindowDays)) return [];
    const windows = cal.availability?.[String(weekdayOf(date))] ?? [];
    if (!windows.length) return [];
    const dayStart = new Date(`${addDays(date, -1)}T00:00:00Z`);
    const dayEnd = new Date(`${addDays(date, 2)}T00:00:00Z`);
    const base = {
      date,
      timezone: cal.timezone,
      windows,
      durationMinutes: cal.durationMinutes,
      intervalMinutes: cal.slotIntervalMinutes,
      bufferMinutes: cal.bufferMinutes,
      earliest: new Date(Date.now() + cal.minNoticeHours * 3_600_000),
    };
    const block = (b: Appointment) => ({ start: b.startAt, end: b.endAt });
    if (cal.type === 'team') {
      // A slot is open if at least one member is free; members are busy across every calendar.
      const members = await this.activeMembers(cal);
      if (!members.length) return [];
      const busy = await repo.find({
        where: { workspaceId: cal.workspaceId, assignedUserId: In(members), status: Not('cancelled'), startAt: Between(dayStart, dayEnd) },
      });
      const hours = await this.hoursFor(cal.workspaceId, members);
      // Busy times from members' connected outside calendars (Google/Outlook/Apple iCal links).
      const ext = await externalBusy(this.extRepo, cal.workspaceId, { userIds: members }, dayStart, dayEnd);
      const dur = cal.durationMinutes * 60_000;
      return unionSlots(
        members.map((m) =>
          computeSlots({ ...base, busy: [...busy.filter((b) => b.assignedUserId === m).map(block), ...(ext.byUser.get(m) ?? [])] })
            .filter((d) => withinHours(d, new Date(d.getTime() + dur), hours.get(m)))
            .map((d) => d.toISOString()),
        ),
      );
    }
    const busy = await repo.find({
      where: { calendarId: cal.id, status: Not('cancelled'), startAt: Between(dayStart, dayEnd) },
    });
    const ext = await externalBusy(this.extRepo, cal.workspaceId, { calendarId: cal.id }, dayStart, dayEnd);
    return computeSlots({ ...base, busy: [...busy.map(block), ...ext.forCalendar] }).map((d) => d.toISOString());
  }

  /** Which of `candidates` have nothing booked (on any calendar) overlapping [start, end) ± buffer. */
  private async freeHosts(repo: Repository<Appointment>, workspaceId: string, candidates: string[], start: Date, end: Date, bufferMinutes = 0, excludeId?: string) {
    if (!candidates.length) return [];
    const buf = bufferMinutes * 60_000;
    const qb = repo
      .createQueryBuilder('a')
      .select('DISTINCT a.assigned_user_id', 'uid')
      .where('a.workspace_id = :workspaceId', { workspaceId })
      .andWhere('a.assigned_user_id IN (:...ids)', { ids: candidates })
      .andWhere(`a.status <> 'cancelled'`)
      .andWhere('a.start_at < :end AND a.end_at > :start', { end: new Date(end.getTime() + buf), start: new Date(start.getTime() - buf) });
    if (excludeId) qb.andWhere('a.id <> :excludeId', { excludeId });
    const busy = new Set((await qb.getRawMany()).map((r) => r.uid));
    return candidates.filter((c) => !busy.has(c));
  }

  /** Rotation/balance data for choosing the next host (cancelled bookings don't count). */
  private async hostStats(repo: Repository<Appointment>, calendarId: string, ids: string[]) {
    const rows: Array<{ uid: string; count: number; last: Date | null }> = await repo.query(
      `SELECT assigned_user_id AS uid,
              COUNT(*) FILTER (WHERE start_at >= now() - interval '30 days')::int AS count,
              MAX(created_at) AS last
         FROM appointments
        WHERE calendar_id = $1 AND assigned_user_id = ANY($2::uuid[]) AND status <> 'cancelled' AND deleted_at IS NULL
        GROUP BY assigned_user_id`,
      [calendarId, ids],
    );
    return new Map<string, HostStats>(rows.map((r) => [r.uid, { count: r.count, lastAssignedAt: r.last ? new Date(r.last).getTime() : null }]));
  }

  /** Serialises bookings per workspace so two people can't grab the same host/slot at once. */
  private withBookingLock<T>(workspaceId: string, fn: (repo: Repository<Appointment>, em: EntityManager) => Promise<T>) {
    return this.appts.manager.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appointments:${workspaceId}`]);
      return fn(em.getRepository(Appointment), em);
    });
  }

  private async hostInfo(userId: string | null) {
    if (!userId) return null;
    const u = await this.usersRepo.findOne({ where: { id: userId }, select: { id: true, name: true, email: true } });
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  }

  /** Booking load per team member (team settings view). */
  async teamStats(workspaceId: string, id: string) {
    const cal = await this.get(workspaceId, id);
    const ids = cal.teamMemberIds ?? [];
    if (!ids.length) return [];
    const [users, rows, active] = await Promise.all([
      this.usersRepo.find({ where: { id: In(ids) }, select: { id: true, name: true, email: true } }),
      this.appts.query(
        `SELECT assigned_user_id AS uid,
                COUNT(*) FILTER (WHERE start_at >= now())::int AS upcoming,
                COUNT(*) FILTER (WHERE start_at >= now() - interval '30 days')::int AS "last30",
                MAX(created_at) AS "lastAssignedAt"
           FROM appointments
          WHERE calendar_id = $1 AND assigned_user_id = ANY($2::uuid[]) AND status <> 'cancelled' AND deleted_at IS NULL
          GROUP BY assigned_user_id`,
        [cal.id, ids],
      ),
      this.activeMembers(cal),
    ]);
    return ids.map((uid) => {
      const u = users.find((x) => x.id === uid);
      const r = rows.find((x: any) => x.uid === uid);
      return { userId: uid, name: u?.name ?? 'Removed user', email: u?.email ?? null, active: active.includes(uid), upcoming: r?.upcoming ?? 0, last30: r?.last30 ?? 0, lastAssignedAt: r?.lastAssignedAt ?? null };
    });
  }

  async listAppointments(workspaceId: string, q: RangeQuery) {
    const where: any = { workspaceId };
    if (q.calendarId) where.calendarId = q.calendarId;
    if (q.contactId) where.contactId = q.contactId;
    if (q.from && q.to) where.startAt = Between(new Date(q.from), new Date(q.to));
    else if (q.from) where.startAt = MoreThan(new Date(q.from));
    else if (q.to) where.startAt = LessThan(new Date(q.to));
    if (q.assignedUserId) where.assignedUserId = q.assignedUserId;
    const list = await this.appts.find({
      where,
      relations: { contact: true, calendar: true },
      order: { startAt: 'ASC' },
      take: Math.min(q.limit ?? 500, 1000),
    });
    const hostIds = [...new Set(list.map((a) => a.assignedUserId).filter(Boolean))] as string[];
    const hosts = hostIds.length ? await this.usersRepo.find({ where: { id: In(hostIds) }, select: { id: true, name: true, email: true } }) : [];
    return list.map((a) => ({ ...a, host: hosts.find((h) => h.id === a.assignedUserId) ?? null }));
  }

  async createAppointment(
    workspaceId: string,
    dto: CreateAppointmentDto & { source?: string },
    userId?: string | null,
    opts: { enforceSlot?: boolean } = {},
  ) {
    const cal = await this.get(workspaceId, dto.calendarId);
    const contact = await this.contactsRepo.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    const start = new Date(dto.startAt);
    const end = new Date(start.getTime() + cal.durationMinutes * 60_000);
    const appt = await this.withBookingLock(workspaceId, async (repo) => {
      if (opts.enforceSlot) {
        const localDate = new Date(start.getTime() + 0).toISOString().slice(0, 10);
        const candidates = [
          ...(await this.slots(cal, addDays(localDate, -1), repo)),
          ...(await this.slots(cal, localDate, repo)),
          ...(await this.slots(cal, addDays(localDate, 1), repo)),
        ];
        if (!candidates.includes(start.toISOString())) {
          throw new ConflictException('That time is no longer available. Please pick another slot.');
        }
      }
      let host: string | null = null;
      if (cal.type === 'team') {
        const members = await this.activeMembers(cal);
        if (!members.length) throw new BadRequestException('This team calendar has no members yet');
        if (dto.assignedUserId && !members.includes(dto.assignedUserId)) throw new BadRequestException('That user is not on this team calendar');
        let free = await this.freeHosts(repo, workspaceId, dto.assignedUserId ? [dto.assignedUserId] : members, start, end, cal.bufferMinutes);
        if (!free.length) throw new ConflictException(dto.assignedUserId ? 'That team member is busy at that time' : 'Nobody on the team is free at that time');
        if (!dto.assignedUserId) {
          // Automatic assignment only picks people who are working then (a teammate can still book someone explicitly).
          const hours = await this.hoursFor(workspaceId, free);
          free = free.filter((id) => withinHours(start, end, hours.get(id)));
          if (!free.length) throw new ConflictException('Nobody on the team is working at that time');
          // …and who aren't busy in their connected outside calendar.
          const buf = cal.bufferMinutes * 60_000;
          const ext = await externalBusy(this.extRepo, workspaceId, { userIds: free }, new Date(start.getTime() - buf), new Date(end.getTime() + buf));
          free = free.filter((id) => !(ext.byUser.get(id) ?? []).some((b) => b.start.getTime() < end.getTime() + buf && b.end.getTime() > start.getTime() - buf));
          if (!free.length) throw new ConflictException('Nobody on the team is free at that time');
        }
        host = chooseHost(free, members, cal.distribution, await this.hostStats(repo, cal.id, free));
      } else {
        if (!opts.enforceSlot) {
          const clash = await repo.exist({
            where: { calendarId: cal.id, status: Not('cancelled'), startAt: LessThan(end), endAt: MoreThan(start) },
          });
          if (clash) throw new ConflictException('This calendar already has an appointment at that time');
        }
        if (dto.assignedUserId) {
          if (!(await this.membersRepo.exist({ where: { workspaceId, userId: dto.assignedUserId } }))) throw new BadRequestException('Host must be a user in this workspace');
          if (!(await this.freeHosts(repo, workspaceId, [dto.assignedUserId], start, end)).length) throw new ConflictException('That team member is busy at that time');
          host = dto.assignedUserId;
        }
      }
      return repo.save(
        repo.create({
          workspaceId,
          calendarId: cal.id,
          contactId: contact.id,
          assignedUserId: host,
          title: dto.title || `${cal.name} with ${contact.firstName} ${contact.lastName}`.trim(),
          startAt: start,
          endAt: end,
          notes: dto.notes ?? null,
          source: dto.source ?? 'manual',
        }),
      );
    });
    const host = await this.hostInfo(appt.assignedUserId);
    if (host && cal.assignContactOwner && !contact.ownerId) {
      await this.contactsRepo.update({ id: contact.id, workspaceId }, { ownerId: host.id });
    }
    await this.activity.record(
      workspaceId,
      'appointment.booked',
      `Appointment booked: ${appt.title} on ${formatInZone(appt.startAt, cal.timezone)}${host ? ` (host: ${host.name})` : ''}`,
      { entityType: 'appointment', entityId: appt.id, userId },
    );
    this.events.emit({
      type: 'appointment.booked',
      workspaceId,
      userId,
      contactId: contact.id,
      payload: { appointment: { ...appt, startLocal: formatInZone(appt.startAt, cal.timezone) }, calendar: cal, host },
    });
    if (cal.sendConfirmation && contact.email && !contact.dnd) {
      const body =
        `Hi ${contact.firstName},\n\nYour appointment "${cal.name}"${host ? ` with ${host.name}` : ''} is confirmed for ` +
        `${formatInZone(appt.startAt, cal.timezone)} (${cal.timezone}).` +
        (cal.location ? `\nLocation: ${cal.location}` : '') +
        `\n\nSee you then!`;
      await this.inbox
        .send(workspaceId, { contactId: contact.id, channel: 'email', subject: `Confirmed: ${cal.name}`, body })
        .catch((e) => this.logger.warn(`Confirmation email failed: ${e.message}`));
    }
    return { ...appt, host };
  }

  async updateAppointment(workspaceId: string, id: string, dto: UpdateAppointmentDto, userId?: string | null) {
    const appt = await this.appts.findOne({ where: { id, workspaceId }, relations: { calendar: true } });
    if (!appt) throw new NotFoundException('Appointment not found');
    const prevStatus = appt.status;
    const { calendar, ...row } = appt;
    await this.withBookingLock(workspaceId, async (repo) => {
      const start = dto.startAt ? new Date(dto.startAt) : appt.startAt;
      const end = new Date(start.getTime() + (appt.endAt.getTime() - appt.startAt.getTime()));
      const host = dto.assignedUserId !== undefined ? dto.assignedUserId : appt.assignedUserId;
      if (dto.assignedUserId !== undefined && dto.assignedUserId !== appt.assignedUserId) {
        if (calendar.type === 'team') {
          if (!host) throw new BadRequestException('Team appointments always need a host');
          if (!(await this.activeMembers(calendar)).includes(host)) throw new BadRequestException('That user is not on this team calendar');
        } else if (host && !(await this.membersRepo.exist({ where: { workspaceId, userId: host } }))) {
          throw new BadRequestException('Host must be a user in this workspace');
        }
      }
      const moving = !!dto.startAt || host !== appt.assignedUserId;
      if (moving && (dto.status ?? appt.status) !== 'cancelled') {
        if (calendar.type !== 'team' && dto.startAt) {
          const clash = await repo.exist({
            where: { calendarId: appt.calendarId, id: Not(id), status: Not('cancelled'), startAt: LessThan(end), endAt: MoreThan(start) },
          });
          if (clash) throw new ConflictException('This calendar already has an appointment at that time');
        }
        if (host && !(await this.freeHosts(repo, workspaceId, [host], start, end, 0, id)).length) {
          throw new ConflictException('The host already has an appointment at that time');
        }
      }
      row.startAt = appt.startAt = start;
      row.endAt = appt.endAt = end;
      row.assignedUserId = appt.assignedUserId = host ?? null;
      if (dto.notes !== undefined) row.notes = appt.notes = dto.notes;
      if (dto.title) row.title = appt.title = dto.title;
      if (dto.status) row.status = appt.status = dto.status;
      await repo.save(row);
    });
    if (dto.status && dto.status !== prevStatus) {
      await this.activity.record(workspaceId, 'appointment.status_changed', `Appointment "${appt.title}" marked ${dto.status}`, {
        entityType: 'appointment',
        entityId: id,
        userId,
      });
      this.events.emit({
        type: 'appointment.status_changed',
        workspaceId,
        userId,
        contactId: appt.contactId,
        payload: { appointment: appt, calendar, status: dto.status, previousStatus: prevStatus },
      });
    }
    return appt;
  }

  // ---- Public booking ----
  async publicCalendar(slug: string) {
    const cal = await this.calendars.findOne({ where: { slug, isActive: true } });
    if (!cal) throw new NotFoundException('This booking page does not exist or is turned off');
    return cal;
  }

  async publicBook(slug: string, dto: PublicBookingDto) {
    const cal = await this.publicCalendar(slug);
    const [firstName, ...rest] = dto.name.trim().split(/\s+/);
    const { contact } = await this.contacts.upsert(cal.workspaceId, {
      firstName,
      lastName: rest.join(' '),
      email: dto.email,
      phone: dto.phone,
      source: 'booking',
      attribution: dto.attribution,
    });
    const appt = await this.createAppointment(
      cal.workspaceId,
      { calendarId: cal.id, contactId: contact.id, startAt: dto.startAt, notes: dto.notes, source: 'booking_page' },
      null,
      { enforceSlot: true },
    );
    return {
      id: appt.id,
      startAt: appt.startAt,
      endAt: appt.endAt,
      calendar: cal.name,
      timezone: cal.timezone,
      startLocal: formatInZone(appt.startAt, cal.timezone),
      // Only the host's name is shown publicly (never their email).
      host: appt.host ? appt.host.name : null,
    };
  }

  // ---- Member working hours ----
  async hoursFor(workspaceId: string, userIds: string[]): Promise<Map<string, Hours>> {
    if (!userIds.length) return new Map();
    const rows = await this.hoursRepo.find({ where: { workspaceId, userId: In(userIds) } });
    return new Map(rows.map((r) => [r.userId, { timezone: r.timezone, weekly: r.weekly, daysOff: r.daysOff ?? [] }]));
  }

  async listMemberHours(workspaceId: string) {
    const members = await this.membersRepo.find({ where: { workspaceId }, relations: { user: true } });
    const hours = await this.hoursRepo.find({ where: { workspaceId } });
    return members
      .filter((m) => m.user)
      .map((m) => {
        const h = hours.find((x) => x.userId === m.userId);
        return { userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, hours: h ? { timezone: h.timezone, weekly: h.weekly, daysOff: h.daysOff } : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Anyone can set their own hours; owners, admins and managers can set anyone's. */
  private assertCanEditHours(actor: { id: string; role: string }, userId: string) {
    const managers = ['workspace_owner', 'workspace_admin', 'manager', 'agency_owner', 'agency_admin', 'super_admin'];
    if (actor.id !== userId && !managers.includes(actor.role)) {
      throw new ForbiddenException('You can only change your own working hours');
    }
  }

  async setMemberHours(workspaceId: string, actor: { id: string; role: string }, userId: string, dto: MemberHoursDto) {
    this.assertCanEditHours(actor, userId);
    if (!(await this.membersRepo.exist({ where: { workspaceId, userId } }))) throw new NotFoundException('Team member not found');
    if (!isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown timezone');
    const weekly = validateAvailability(dto.weekly);
    const daysOff = [...new Set(dto.daysOff ?? [])].sort();
    const row = (await this.hoursRepo.findOne({ where: { workspaceId, userId } })) ?? this.hoursRepo.create({ workspaceId, userId });
    Object.assign(row, { timezone: dto.timezone, weekly, daysOff });
    await this.hoursRepo.save(row);
    return { userId, hours: { timezone: row.timezone, weekly: row.weekly, daysOff: row.daysOff } };
  }

  async clearMemberHours(workspaceId: string, actor: { id: string; role: string }, userId: string) {
    this.assertCanEditHours(actor, userId);
    await this.hoursRepo.delete({ workspaceId, userId });
    return { userId, hours: null };
  }

  publicUrl(cal: Calendar) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/book/${cal.slug}`;
  }
}

// ---- Controllers --------------------------------------------------------------
@Controller('calendars')
export class CalendarsController {
  constructor(
    private readonly svc: CalendarsService,
    private readonly reminders: RemindersService,
  ) {}

  @Get('member-hours')
  @Permissions('calendars:read')
  memberHours(@Tenant('workspaceId') ws: string) {
    return this.svc.listMemberHours(ws);
  }

  @Put('member-hours/:userId')
  @Permissions('calendars:read')
  setMemberHours(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: MemberHoursDto) {
    return this.svc.setMemberHours(ws, { id: me, role }, userId, dto);
  }

  @Delete('member-hours/:userId')
  @Permissions('calendars:read')
  clearMemberHours(@Tenant('workspaceId') ws: string, @Tenant('role') role: string, @CurrentUser('id') me: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.clearMemberHours(ws, { id: me, role }, userId);
  }

  /** Runs one reminder pass for this workspace now (tests/ops). `at` simulates another time outside production. */
  @Post('reminders/run')
  @Permissions('calendars:write')
  runReminders(@Tenant('workspaceId') ws: string, @Body() dto: RunRemindersDto) {
    const at = dto.at && process.env.NODE_ENV !== 'production' ? new Date(dto.at) : new Date();
    return this.reminders.run(at, ws);
  }

  @Get()
  @Permissions('calendars:read')
  async list(@Tenant('workspaceId') ws: string) {
    return (await this.svc.list(ws)).map((c) => ({ ...c, bookingUrl: this.svc.publicUrl(c) }));
  }

  @Post()
  @Permissions('calendars:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateCalendarDto) {
    return this.svc.create(ws, dto);
  }

  @Get('appointments')
  @Permissions('appointments:read')
  appointments(@Tenant('workspaceId') ws: string, @Query() q: RangeQuery) {
    return this.svc.listAppointments(ws, q);
  }

  @Post('appointments')
  @Permissions('appointments:write')
  book(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: CreateAppointmentDto) {
    return this.svc.createAppointment(ws, dto, userId);
  }

  @Put('appointments/:id')
  @Permissions('appointments:write')
  updateAppt(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.svc.updateAppointment(ws, id, dto, userId);
  }

  @Get(':id')
  @Permissions('calendars:read')
  async get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.svc.get(ws, id);
    return { ...c, bookingUrl: this.svc.publicUrl(c) };
  }

  @Get(':id/team')
  @Permissions('calendars:read')
  team(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.teamStats(ws, id);
  }

  @Get(':id/slots')
  @Permissions('calendars:read')
  async slots(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: SlotQuery) {
    return this.svc.slots(await this.svc.get(ws, id), q.date);
  }

  @Put(':id')
  @Permissions('calendars:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCalendarDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('calendars:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }
}

@Controller('public/calendars')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicCalendarsController {
  constructor(private readonly svc: CalendarsService) {}

  @Get(':slug')
  async info(@Param('slug') slug: string) {
    const c = await this.svc.publicCalendar(slug);
    return {
      name: c.name,
      description: c.description,
      durationMinutes: c.durationMinutes,
      timezone: c.timezone,
      location: c.location,
      bookingWindowDays: c.bookingWindowDays,
      availableWeekdays: Object.entries(c.availability ?? {}).filter(([, w]) => w.length).map(([d]) => Number(d)),
      isTeam: c.type === 'team',
    };
  }

  @Get(':slug/slots')
  async slots(@Param('slug') slug: string, @Query() q: SlotQuery) {
    return this.svc.slots(await this.svc.publicCalendar(slug), q.date);
  }

  @Post(':slug/book')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  book(@Param('slug') slug: string, @Body() dto: PublicBookingDto) {
    return this.svc.publicBook(slug, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Calendar, Appointment, AppointmentReminder, MemberHours, CalendarFeed, ExternalCalendar, Contact, WorkspaceMember, User]), CrmModule, CommunicationModule],
  controllers: [CalendarsController, PublicCalendarsController, CalendarSyncController, CalendarFeedController],
  providers: [CalendarsService, RemindersService, CalendarSyncService],
  exports: [CalendarsService],
})
export class CalendarsModule {}
