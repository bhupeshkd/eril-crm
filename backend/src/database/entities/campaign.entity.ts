import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { AbTestConfig } from '../../campaigns/ab';

export interface CampaignAudience {
  /** A saved smart list; status/tag filters below narrow it further. */
  listId?: string;
  /** Contact statuses to include; empty = all */
  statuses?: string[];
  /** Contacts must have at least one of these tags; empty = no tag filter */
  tags?: string[];
}

export interface CampaignStats {
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
}

@Entity('campaigns')
@Index(['workspaceId', 'status'])
export class Campaign extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  /** email | sms */
  @Column({ type: 'varchar', length: 10, default: 'email' })
  channel: 'email' | 'sms';

  @Column({ length: 255, default: '' })
  subject: string;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  audience: CampaignAudience;

  /** Email campaigns can use a designed template instead of the plain body. */
  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId: string | null;

  /** Email only: test two subject lines on part of the audience, then send the winner to the rest. */
  @Column({ name: 'ab_test', type: 'jsonb', nullable: true })
  abTest: AbTestConfig | null;

  /** When the A/B test is judged (set once the test group has been sent). */
  @Column({ name: 'ab_decide_at', type: 'timestamptz', nullable: true })
  abDecideAt: Date | null;

  @Column({ name: 'ab_winner', type: 'varchar', length: 1, nullable: true })
  abWinner: 'A' | 'B' | null;

  /** draft | scheduled | sending | testing | sent | failed */
  @Index()
  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status: string;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'jsonb', default: () => `'{"recipients":0,"sent":0,"failed":0,"skipped":0}'` })
  stats: CampaignStats;
}
