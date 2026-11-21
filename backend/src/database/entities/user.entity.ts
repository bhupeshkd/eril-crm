import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Organization } from './organization.entity';
import { WorkspaceMember } from './workspace-member.entity';
import { Invitation } from './invitation.entity';

export type UserRole =
  | 'super_admin'
  | 'agency_owner'
  | 'agency_admin'
  | 'workspace_owner'
  | 'workspace_admin'
  | 'manager'
  | 'team_member'
  | 'sales_agent'
  | 'marketing_manager';

@Entity('users')
export class User extends BaseEntity {
  @Index()
  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: 'team_member' })
  role: UserRole;

  @Column({ name: 'email_verified', default: false })
  emailVerified: boolean;

  @Column({ name: 'current_workspace_id', nullable: true })
  currentWorkspaceId: string;

  @Column({ name: 'email_verification_token', nullable: true, select: false })
  emailVerificationToken: string;

  @Column({
    name: 'email_verification_expires_at',
    nullable: true,
    select: false,
    type: 'timestamptz',
  })
  emailVerificationExpiresAt: Date;

  @Column({ name: 'password_reset_token', nullable: true, select: false })
  passwordResetToken: string;

  @Column({
    name: 'password_reset_expires_at',
    nullable: true,
    select: false,
    type: 'timestamptz',
  })
  passwordResetExpiresAt: Date;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled: boolean;

  @Column({ name: 'mfa_secret', nullable: true, select: false })
  mfaSecret: string;

  @Column({ name: 'last_login_at', nullable: true, type: 'timestamptz' })
  lastLoginAt: Date;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'current_organization_id' })
  currentOrganization: Organization;

  @OneToMany(() => WorkspaceMember, (m) => m.user)
  workspaceMemberships: WorkspaceMember[];

  @OneToMany(() => Invitation, (i) => i.invitedBy)
  sentInvitations: Invitation[];
}
