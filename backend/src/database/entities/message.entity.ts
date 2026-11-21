import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Conversation } from './conversation.entity';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
export class Message extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  /** inbound | outbound */
  @Column({ length: 10 })
  direction: string;

  @Column({ length: 20 })
  channel: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'from_address', length: 255, default: '' })
  fromAddress: string;

  @Column({ name: 'to_address', length: 255, default: '' })
  toAddress: string;

  /** queued | sent | failed | received */
  @Column({ length: 20, default: 'queued' })
  status: string;

  /** Indexed: delivery receipts and duplicate checks look messages up by it. */
  @Index()
  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;

  /** Written and sent by the AI assistant. */
  @Column({ name: 'sent_by_bot', default: false })
  sentByBot: boolean;

  /** Rendered HTML for designed emails (body holds the plain-text version). */
  @Column({ type: 'text', nullable: true, select: false })
  html: string | null;

  /** Random id used in open-pixel / click URLs (designed emails only). */
  @Index({ unique: true, where: '"tracking_token" IS NOT NULL' })
  @Column({ name: 'tracking_token', type: 'varchar', length: 32, nullable: true, select: false })
  trackingToken: string | null;

  /** Campaign this message was sent by (for campaign reports). */
  @Index()
  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId: string | null;

  /** A/B subject test variant this message belonged to (test group only). */
  @Column({ type: 'varchar', length: 1, nullable: true })
  variant: 'A' | 'B' | null;

  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'open_count', type: 'int', default: 0 })
  openCount: number;

  @Column({ name: 'clicked_at', type: 'timestamptz', nullable: true })
  clickedAt: Date | null;

  @Column({ name: 'click_count', type: 'int', default: 0 })
  clickCount: number;
}

@Entity('email_clicks')
@Index(['messageId'])
@Index(['workspaceId', 'createdAt'])
export class EmailClick extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @Column({ name: 'campaign_id', type: 'uuid', nullable: true })
  campaignId: string | null;

  @Column({ type: 'varchar', length: 2000 })
  url: string;

  /** Security scanners/prefetchers are logged but excluded from stats. */
  @Column({ name: 'is_bot', default: false })
  isBot: boolean;
}
