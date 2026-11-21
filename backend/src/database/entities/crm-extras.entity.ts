import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'] as const;

@Entity('custom_fields')
@Index(['workspaceId', 'key'], { unique: true, where: '"deleted_at" IS NULL' })
export class CustomField extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** Stable machine key, e.g. "budget" → contact.customFields.budget */
  @Column({ length: 64 })
  key: string;

  @Column({ length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 20, default: 'text' })
  type: (typeof CUSTOM_FIELD_TYPES)[number];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  options: string[];

  @Column({ type: 'int', default: 0 })
  position: number;
}

@Entity('contact_notes')
@Index(['contactId', 'createdAt'])
export class ContactNote extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;
}

@Entity('tasks')
@Index(['workspaceId', 'completed', 'dueAt'])
export class Task extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => Contact, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ default: false })
  completed: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

/** Filters shared by the contacts list, saved smart lists and campaign audiences. */
export interface ContactFilters {
  search?: string;
  statuses?: string[];
  /** Contact must have at least one of these tags. */
  tags?: string[];
  source?: string;
  /** Only contacts added in the last N days. */
  createdWithinDays?: number;
}

/** A named, saved contact filter ("smart list"). Membership is computed live, never stored. */
@Entity('smart_lists')
@Index('IDX_smart_lists_workspace', ['workspaceId'])
export class SmartList extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  filters: ContactFilters;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;
}
