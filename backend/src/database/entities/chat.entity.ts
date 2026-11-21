import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** The website chat widget of a workspace (one per workspace). */
@Entity('chat_widgets')
@Index(['workspaceId'], { unique: true })
@Index(['publicKey'], { unique: true })
export class ChatWidget extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** Non-secret id used in the embed code. */
  @Column({ name: 'public_key', length: 32 })
  publicKey: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ length: 60, default: 'Chat with us' })
  title: string;

  @Column({ length: 300, default: 'Hi! How can we help you today?' })
  greeting: string;

  /** none: start chatting straight away · email: ask for an email first · name_email: name and email. */
  @Column({ name: 'ask_for', type: 'varchar', length: 20, default: 'email' })
  askFor: 'none' | 'email' | 'name_email';

  @Column({ type: 'varchar', length: 7, default: '' })
  color: string;

  @Column({ type: 'varchar', length: 5, default: 'right' })
  position: 'right' | 'left';
}

/** One visitor's chat on a device; the secret token (stored hashed) lets the widget read and post. */
@Entity('chat_sessions')
@Index(['tokenHash'], { unique: true })
@Index(['workspaceId', 'contactId'])
export class ChatSession extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  /** Page the chat started on. */
  @Column({ name: 'page_url', type: 'varchar', length: 500, default: '' })
  pageUrl: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;
}
