import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A custom domain for a site. Anyone may claim a name (pending), but it only routes once a DNS TXT record proves
 * ownership; at most one verified row per hostname, enforced by a partial unique index.
 */
@Entity('custom_domains')
@Index(['hostname'], { unique: true, where: `"status" = 'verified' AND "deleted_at" IS NULL` })
@Index(['siteId'])
@Index('IDX_custom_domains_org', ['organizationId'])
@Index(['status', 'lastCheckedAt'])
export class CustomDomain extends BaseEntity {
  /** Set for site domains (app domains belong to an organization instead). */
  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId: string | null;

  /** site: serves a published site. app: an agency's own address for the staff app (white-label login). */
  @Column({ type: 'varchar', length: 10, default: 'site' })
  kind: 'site' | 'app';

  /** Set for site domains. */
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  /** Set for app domains: the agency organization whose branding and login the domain shows. */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

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
