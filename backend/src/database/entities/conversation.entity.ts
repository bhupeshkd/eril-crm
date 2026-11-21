import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';
import { Message } from './message.entity';

@Entity('conversations')
@Index(['workspaceId', 'lastMessageAt'])
@Index(['workspaceId', 'contactId', 'channel'])
export class Conversation extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  /** email | sms */
  @Column({ length: 20 })
  channel: string;

  @Column({ length: 255, default: '' })
  subject: string;

  @Column({ name: 'last_message_at', type: 'timestamptz', default: () => 'now()' })
  lastMessageAt: Date;

  @Column({ name: 'last_message_preview', length: 255, default: '' })
  lastMessagePreview: string;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount: number;

  /** AI assistant: paused after a hand-off or when a teammate replies. */
  @Column({ name: 'bot_paused', default: false })
  botPaused: boolean;

  /** AI replies since the assistant was last (re)started here; capped per workspace setting. */
  @Column({ name: 'bot_reply_count', type: 'int', default: 0 })
  botReplyCount: number;

  @Column({ name: 'bot_handoff_reason', type: 'varchar', length: 255, nullable: true })
  botHandoffReason: string | null;

  @Column({ name: 'bot_paused_at', type: 'timestamptz', nullable: true })
  botPausedAt: Date | null;

  @OneToMany(() => Message, (m) => m.conversation)
  messages: Message[];
}
