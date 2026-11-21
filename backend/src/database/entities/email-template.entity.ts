import { Column, Entity, Index } from 'typeorm';
import type { EmailBlock, EmailTheme } from '@eril/shared';
import { BaseEntity } from './base.entity';

@Entity('email_templates')
@Index(['workspaceId'])
export class EmailTemplate extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, default: '' })
  subject: string;

  @Column({ name: 'preview_text', length: 255, default: '' })
  previewText: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  theme: EmailTheme;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  blocks: EmailBlock[];
}
