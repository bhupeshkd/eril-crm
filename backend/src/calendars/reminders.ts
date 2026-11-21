import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment, AppointmentReminder } from '../database/entities/calendar.entity';
import { Contact } from '../database/entities/contact.entity';
import { User } from '../database/entities/user.entity';
import { InboxService } from '../communication/inbox.service';
import { dueReminders, MAX_REMINDER_MINUTES, reminderKey, type Reminder } from './hours';
import { formatInZone } from './time';

/** Sends calendar reminders before appointments. Each reminder is claimed once per appointment time, so it never repeats. */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Appointment) private readonly appts: Repository<Appointment>,
    @InjectRepository(AppointmentReminder) private readonly sent: Repository<AppointmentReminder>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly inbox: InboxService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => this.run().catch((e) => this.logger.error(`Reminders failed: ${e.message}`)), 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: send every reminder that is due at `now`. Exposed for tests/ops. */
  async run(now = new Date(), workspaceId?: string) {
    if (this.running) return { sent: 0, skipped: 0 };
    this.running = true;
    let sent = 0;
    let skipped = 0;
    try {
      const qb = this.appts
        .createQueryBuilder('a')
        .innerJoinAndSelect('a.calendar', 'c')
        .where(`a.status IN ('booked', 'confirmed')`)
        .andWhere('a.start_at > :now AND a.start_at <= :until', { now, until: new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000) })
        .andWhere(`jsonb_array_length(c.reminders) > 0`)
        .orderBy('a.startAt', 'ASC')
        .take(500);
      if (workspaceId) qb.andWhere('a.workspace_id = :workspaceId', { workspaceId });
      for (const a of await qb.getMany()) {
        for (const r of dueReminders({ startAt: a.startAt, bookedAt: a.updatedAt ?? a.createdAt }, a.calendar.reminders ?? [], now)) {
          const key = reminderKey(r, a.startAt);
          const claim = await this.sent
            .createQueryBuilder()
            .insert()
            .into(AppointmentReminder)
            .values({ workspaceId: a.workspaceId, appointmentId: a.id, key, channel: r.channel, status: 'sent' })
            .orIgnore()
            .returning('id')
            .execute();
          const id = claim.identifiers[0]?.id as string | undefined;
          if (!id) continue; // already handled
          const result = await this.deliver(a, r).catch((e) => ({ ok: false, detail: String(e.message ?? e).slice(0, 300) }));
          if (result.ok) sent++;
          else {
            skipped++;
            await this.sent.update({ id }, { status: 'skipped', detail: result.detail });
          }
        }
      }
      return { sent, skipped };
    } finally {
      this.running = false;
    }
  }

  private async deliver(a: Appointment, r: Reminder): Promise<{ ok: boolean; detail?: string }> {
    const contact = await this.contacts.findOne({ where: { id: a.contactId, workspaceId: a.workspaceId } });
    if (!contact) return { ok: false, detail: 'Contact deleted' };
    if (contact.dnd) return { ok: false, detail: 'Contact is on do-not-disturb' };
    if (r.channel === 'email' && !contact.email) return { ok: false, detail: 'Contact has no email' };
    if (r.channel === 'sms' && !contact.phone) return { ok: false, detail: 'Contact has no phone' };
    const cal = a.calendar;
    const host = a.assignedUserId ? await this.users.findOne({ where: { id: a.assignedUserId }, select: { id: true, name: true } }) : null;
    const when = `${formatInZone(a.startAt, cal.timezone)} (${cal.timezone})`;
    const body =
      r.channel === 'sms'
        ? `Reminder: ${cal.name}${host ? ` with ${host.name}` : ''} on ${when}.${cal.location ? ` ${cal.location}` : ''}`
        : `Hi ${contact.firstName},\n\nThis is a reminder of your appointment "${cal.name}"${host ? ` with ${host.name}` : ''} on ${when}.` +
          (cal.location ? `\nLocation: ${cal.location}` : '') +
          `\n\nSee you then!`;
    const msg = await this.inbox.send(a.workspaceId, { contactId: contact.id, channel: r.channel, subject: `Reminder: ${cal.name}`, body } as any);
    const status = (msg as any)?.status;
    return status === 'failed' ? { ok: false, detail: 'Provider rejected the message' } : { ok: true };
  }
}
