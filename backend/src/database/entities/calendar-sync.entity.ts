import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** A team member's private iCal feed of their appointments (subscribe in Google/Outlook/Apple Calendar). */
@Entity('calendar_feeds')
@Index(['token'], { unique: true })
@Index(['workspaceId', 'userId'], { unique: true })
export class CalendarFeed extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Secret part of the feed URL; regenerating it revokes old subscriptions. */
  @Column({ length: 64 })
  token: string;
}

/**
 * An outside calendar (secret iCal link) whose busy times block bookings — for a team member (team calendars)
 * or for one booking calendar.
 */
@Entity('external_calendars')
@Index(['workspaceId', 'userId'])
@Index(['workspaceId', 'calendarId'])
export class ExternalCalendar extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** Busy times apply to this team member… */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** …or to this booking calendar. */
  @Column({ name: 'calendar_id', type: 'uuid', nullable: true })
  calendarId: string | null;

  @Column({ length: 120 })
  name: string;

  /** The secret iCal address. Never returned in full. */
  @Column({ type: 'varchar', length: 2000, select: false })
  url: string;

  /** Busy blocks for the coming months, refreshed every 15 minutes. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  busy: Array<{ s: string; e: string }>;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 300, nullable: true })
  lastError: string | null;
}
