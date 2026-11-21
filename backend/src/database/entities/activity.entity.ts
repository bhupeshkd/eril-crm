import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Timeline entry for the dashboard / record history. */
@Entity('activities')
@Index(['workspaceId', 'createdAt'])
export class Activity extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 50 })
  type: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 50, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;
}
