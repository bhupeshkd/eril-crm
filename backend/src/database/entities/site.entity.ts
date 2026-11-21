import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

export const BLOCK_TYPES = ['hero', 'text', 'features', 'image', 'video', 'cta', 'form', 'booking', 'pricing', 'reviews', 'faq', 'footer'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface SiteBlock {
  id: string;
  type: BlockType;
  props: Record<string, any>;
}

export interface SitePage {
  id: string;
  title: string;
  /** '' = home / first funnel step; otherwise a-z0-9- segment */
  path: string;
  description?: string;
  blocks: SiteBlock[];
}

@Entity('sites')
@Index(['slug'], { unique: true })
export class Site extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 120 })
  slug: string;

  /** website = free navigation; funnel = ordered steps with "next" buttons */
  @Column({ type: 'varchar', length: 10, default: 'website' })
  kind: 'website' | 'funnel';

  @Column({ type: 'jsonb', default: () => "'{}'" })
  theme: { primaryColor?: string; background?: string; font?: 'sans' | 'serif' };

  @Column({ type: 'jsonb', default: () => "'[]'" })
  pages: SitePage[];

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  /** Page views keyed by page path. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  stats: Record<string, number>;
}

@Entity('review_requests')
@Index(['token'], { unique: true })
export class ReviewRequest extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ length: 64 })
  token: string;

  @Column({ type: 'varchar', length: 10, default: 'email' })
  channel: string;

  /** sent | completed */
  @Column({ type: 'varchar', length: 12, default: 'sent' })
  status: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

@Entity('reviews')
@Index(['workspaceId', 'createdAt'])
export class Review extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Contact, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', default: '' })
  comment: string;

  /** Shown on websites' review blocks when true. */
  @Column({ name: 'is_public', default: false })
  isPublic: boolean;

  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId: string | null;

  @Column({ type: 'text', nullable: true })
  reply: string | null;
}
