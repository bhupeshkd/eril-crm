import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Workspace } from './workspace.entity';

@Entity('api_keys')
export class ApiKey extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  keyHash: string;

  @Column({ name: 'key_prefix' })
  keyPrefix: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'workspace_id' })
  workspaceId: string;

  @Column({ name: 'last_used_at', nullable: true, type: 'timestamptz' })
  lastUsedAt: Date;

  @Column({ name: 'revoked_at', nullable: true, type: 'timestamptz' })
  revokedAt: Date;

  /** Role whose permission set the key gets (e.g. workspace_admin, manager). */
  @Column({ type: 'varchar', length: 40, default: 'workspace_admin' })
  role: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;
}

@Entity('webhook_subscriptions')
export class WebhookSubscription extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 1000 })
  url: string;

  /** Event types to deliver; empty = all. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  events: string[];

  /** HMAC-SHA256 signing secret (shown once at creation). */
  @Column({ length: 80, select: false })
  secret: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_status', type: 'varchar', length: 120, nullable: true })
  lastStatus: string | null;

  @Column({ name: 'last_delivered_at', type: 'timestamptz', nullable: true })
  lastDeliveredAt: Date | null;

  @Column({ name: 'failure_count', type: 'int', default: 0 })
  failureCount: number;
}
