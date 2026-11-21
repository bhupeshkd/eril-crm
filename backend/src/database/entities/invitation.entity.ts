import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

@Entity('invitations')
export class Invitation extends BaseEntity {
  @Column()
  email: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'workspace_id' })
  workspaceId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by' })
  invitedBy: User;

  @Column({ name: 'invited_by', nullable: true })
  invitedById: string;

  @Column({ default: 'team_member' })
  role: string;

  @Column({ name: 'invitation_token' })
  invitationToken: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', nullable: true, type: 'timestamptz' })
  acceptedAt: Date;
}
