import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Organization } from './organization.entity';
import { WorkspaceMember } from './workspace-member.entity';

@Entity('workspaces')
export class Workspace extends BaseEntity {
  @Column()
  name: string;

  @ManyToOne(() => Organization, (o) => o.workspaces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @OneToMany(() => WorkspaceMember, (m) => m.workspace)
  members: WorkspaceMember[];
}
