import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A custom domain for a site. Anyone may claim a name (pending), but it only routes once a DNS TXT record proves
 * ownership; at most one verified row per hostname, enforced by a partial unique index.
 */
@Entity('custom_domains')
@Index(['hostname'], { unique: true, where: `"status" = 'verified' AND "deleted_at" IS NULL` })
@Index(['siteId'])
@Index(['status', 'lastCheckedAt'])
export class CustomDomain extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @Column({ length: 253 })
  hostname: string;

  /** pending | verified | failed */
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'verified' | 'failed';

  @Column({ name: 'verification_token', length: 40 })
  verificationToken: string;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 300, nullable: true })
  lastError: string | null;
}
