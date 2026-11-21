import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Company } from './company.entity';

export const CONTACT_STATUSES = ['lead', 'customer', 'churned'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

@Entity('contacts')
@Index(['workspaceId', 'email'])
@Index(['workspaceId', 'status'])
export class Contact extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'first_name', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', length: 100, default: '' })
  lastName: string;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  email: string | null;

  @Column({ type: 'varchar', nullable: true, length: 30 })
  phone: string | null;

  @Column({ type: 'varchar', length: 20, default: 'lead' })
  status: ContactStatus;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => Company, (c) => c.contacts, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company: Company | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  /** Values for workspace-defined custom fields, keyed by CustomField.key. */
  @Column({ name: 'custom_fields', type: 'jsonb', default: () => "'{}'" })
  customFields: Record<string, any>;

  /** Where the contact came from: manual, form, booking, import, api. */
  @Column({ type: 'varchar', length: 50, default: 'manual' })
  source: string;

  /** Do-not-disturb: excluded from campaigns and automated messages. */
  @Column({ default: false })
  dnd: boolean;
}
