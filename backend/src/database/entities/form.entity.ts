import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

export const FORM_FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox'] as const;

export interface FormField {
  key: string;
  label: string;
  type: (typeof FORM_FIELD_TYPES)[number];
  required?: boolean;
  placeholder?: string;
  options?: string[];
  /** firstName | lastName | email | phone | companyName | custom:<key> | none */
  mapTo?: string;
}

export interface FormSettings {
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  tags?: string[];
  /** Brand colour for the hosted page, e.g. #2953e0 */
  color?: string;
}

@Entity('forms')
@Index(['slug'], { unique: true })
export class Form extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 120 })
  slug: string;

  /** form = single page; survey = one question per step */
  @Column({ type: 'varchar', length: 10, default: 'form' })
  kind: 'form' | 'survey';

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fields: FormField[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  settings: FormSettings;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'submission_count', type: 'int', default: 0 })
  submissionCount: number;
}

@Entity('form_submissions')
@Index(['formId', 'createdAt'])
export class FormSubmission extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'form_id', type: 'uuid' })
  formId: string;

  @ManyToOne(() => Contact, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;
}
