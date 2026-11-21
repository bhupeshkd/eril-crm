import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { PostStatus, Target } from '../../social/social-rules';

/** A social media post planned for one or more connected Facebook Pages / Instagram accounts. */
@Entity('social_posts')
@Index(['workspaceId', 'scheduledAt'])
@Index(['status', 'scheduledAt'])
export class SocialPost extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  link: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 1000, nullable: true })
  imageUrl: string | null;

  /** One entry per destination, with its own result. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  targets: Target[];

  /** draft | scheduled | publishing | published | partial | failed */
  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status: PostStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;
}
