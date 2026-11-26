import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A browser or installed app that receives push notifications for a user (Web Push).
 * One row per device; the endpoint is unique, so re-subscribing a device updates its row.
 */
@Entity('push_subscriptions')
@Index(['endpoint'], { unique: true })
@Index(['userId'])
export class PushSubscription extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 1000 })
  endpoint: string;

  @Column({ length: 200 })
  p256dh: string;

  @Column({ length: 100 })
  auth: string;

  /** Short device label from the user agent, e.g. "Chrome on Android". */
  @Column({ type: 'varchar', length: 80, default: '' })
  label: string;

  /** Which kinds of alert this device gets (see PUSH_TOPICS). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  topics: string[];

  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  @Column({ name: 'failure_count', type: 'int', default: 0 })
  failureCount: number;
}
