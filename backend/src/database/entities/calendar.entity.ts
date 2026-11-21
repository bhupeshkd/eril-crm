import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';
import { User } from './user.entity';

/** Weekly availability: key 0 (Sunday) … 6 (Saturday) → list of HH:MM windows. */
export type WeeklyAvailability = Record<string, Array<{ start: string; end: string }>>;

export const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  '0': [],
  '1': [{ start: '09:00', end: '17:00' }],
  '2': [{ start: '09:00', end: '17:00' }],
  '3': [{ start: '09:00', end: '17:00' }],
  '4': [{ start: '09:00', end: '17:00' }],
  '5': [{ start: '09:00', end: '17:00' }],
  '6': [],
};

@Entity('calendars')
@Index(['slug'], { unique: true })
export class Calendar extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  /** Public booking URL segment: /book/<slug> */
  @Column({ length: 120 })
  slug: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'duration_minutes', type: 'int', default: 30 })
  durationMinutes: number;

  @Column({ name: 'slot_interval_minutes', type: 'int', default: 30 })
  slotIntervalMinutes: number;

  @Column({ name: 'buffer_minutes', type: 'int', default: 0 })
  bufferMinutes: number;

  /** Minimum hours between now and a bookable slot. */
  @Column({ name: 'min_notice_hours', type: 'int', default: 2 })
  minNoticeHours: number;

  @Column({ name: 'booking_window_days', type: 'int', default: 60 })
  bookingWindowDays: number;

  @Column({ length: 64, default: 'UTC' })
  timezone: string;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_AVAILABILITY)}'` })
  availability: WeeklyAvailability;

  @Column({ name: 'send_confirmation', default: true })
  sendConfirmation: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Optional location / meeting link shown on confirmations. */
  @Column({ type: 'varchar', length: 500, default: '' })
  location: string;

  /** personal: one diary for the calendar. team: bookings are shared out among `teamMemberIds`. */
  @Column({ type: 'varchar', length: 20, default: 'personal' })
  type: 'personal' | 'team';

  /** Team calendars: workspace users who take bookings, in priority order (tie-break). */
  @Column({ name: 'team_member_ids', type: 'uuid', array: true, default: () => "'{}'" })
  teamMemberIds: string[];

  /** round_robin: take turns. balanced: fewest bookings in the last 30 days first. */
  @Column({ type: 'varchar', length: 20, default: 'round_robin' })
  distribution: 'round_robin' | 'balanced';

  /** Make the assigned host the contact's owner when the contact has none. */
  @Column({ name: 'assign_contact_owner', default: false })
  assignContactOwner: boolean;

  /** Reminders before each appointment (see calendars/hours.ts), e.g. 1 day before by email. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  reminders: Array<{ minutesBefore: number; channel: 'email' | 'sms' }>;
}

/** A team member's own working hours; team calendars only offer and assign them inside these. */
@Entity('member_hours')
@Index(['workspaceId', 'userId'], { unique: true })
export class MemberHours extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 64, default: 'UTC' })
  timezone: string;

  @Column({ type: 'jsonb' })
  weekly: WeeklyAvailability;

  /** Whole days off ('YYYY-MM-DD' in the member's timezone). */
  @Column({ name: 'days_off', type: 'text', array: true, default: () => "'{}'" })
  daysOff: string[];
}

/** One sent (or skipped) reminder; the unique key stops a reminder going out twice. */
@Entity('appointment_reminders')
@Index(['appointmentId', 'key'], { unique: true })
export class AppointmentReminder extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  /** minutesBefore:channel:startAtMs */
  @Column({ length: 80 })
  key: string;

  @Column({ type: 'varchar', length: 10 })
  channel: 'email' | 'sms';

  /** sent | skipped */
  @Column({ type: 'varchar', length: 10, default: 'sent' })
  status: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  detail: string | null;
}

export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'cancelled', 'showed', 'noshow'] as const;

@Entity('appointments')
@Index(['workspaceId', 'startAt'])
@Index(['calendarId', 'startAt'])
@Index(['assignedUserId', 'startAt'])
export class Appointment extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Calendar, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'calendar_id' })
  calendar: Calendar;

  @Column({ name: 'calendar_id', type: 'uuid' })
  calendarId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'varchar', length: 20, default: 'booked' })
  status: (typeof APPOINTMENT_STATUSES)[number];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Team member hosting this appointment (always set on team calendars, optional elsewhere). */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser: User | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  /** booking_page | manual | workflow */
  @Column({ type: 'varchar', length: 30, default: 'manual' })
  source: string;
}
