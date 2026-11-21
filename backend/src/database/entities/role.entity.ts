import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Workspace } from './workspace.entity';

@Entity('roles')
@Unique(['workspaceId', 'name'])
export class Role extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', array: true, default: '{}' })
  permissions: string[];

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'workspace_id' })
  workspaceId: string;
}
