import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SaasAccessService } from '../saas/access';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { Workspace } from '../database/entities/workspace.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { User } from '../database/entities/user.entity';
import { Organization } from '../database/entities/organization.entity';
import { Invitation } from '../database/entities/invitation.entity';
import { EmailProvider } from '../communication/providers';
import { randomBytes } from 'crypto';

/** Roles that can be given inside a workspace (agency/super roles are never granted here). */
export const ASSIGNABLE_ROLES = ['workspace_owner', 'workspace_admin', 'manager', 'team_member', 'sales_agent', 'marketing_manager'];
const MANAGERS = ['workspace_owner', 'workspace_admin'];
const INVITE_TTL_MS = 7 * 864e5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ROLE_LABELS: Record<string, string> = {
  workspace_owner: 'Owner',
  workspace_admin: 'Admin',
  manager: 'Manager',
  team_member: 'Team member',
  sales_agent: 'Sales agent',
  marketing_manager: 'Marketing manager',
};

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgs: Repository<Organization>,
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    private readonly email: EmailProvider,
    private readonly config: ConfigService,
    @Optional() private readonly saas?: SaasAccessService,
  ) {}

  async list(userId: string) {
    return this.members
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .where('m.userId = :userId', { userId })
      .select(['w.id AS "workspaceId"', 'w.name AS "workspaceName"', 'm.role AS "role"'])
      .getRawMany();
  }

  async create(userId: string, name: string) {
    const org = this.orgs.create({ name: `${name} Organization`, plan: 'free' });
    await this.orgs.save(org);

    const ws = this.workspaces.create({
      name,
      organization: org,
      organizationId: org.id,
      settings: {},
    });
    await this.workspaces.save(ws);

    await this.members.save(
      this.members.create({ user: { id: userId } as any, workspace: ws, role: 'workspace_owner' }),
    );
    return { workspaceId: ws.id, organizationId: org.id };
  }

  // ---------------------------------------------------------------------------
  // Access checks
  // ---------------------------------------------------------------------------

  /** Any member may see who else is in the workspace; others get 404 (no existence leak). */
  async assertMember(workspaceId: string, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId) || !(await this.members.exist({ where: { workspaceId, userId } }))) {
      throw new NotFoundException('Workspace not found');
    }
  }

  /** Only owners/admins may add or invite people, and only owners may grant the owner role. */
  async assertManager(workspaceId: string, userId: string, role?: string) {
    await this.assertMember(workspaceId, userId);
    const me = await this.members.findOneOrFail({ where: { workspaceId, userId } });
    if (!MANAGERS.includes(me.role)) throw new ForbiddenException('Only workspace owners and admins can manage the team');
    if (role !== undefined) {
      if (!ASSIGNABLE_ROLES.includes(role)) throw new BadRequestException(`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
      if (role === 'workspace_owner' && me.role !== 'workspace_owner') throw new ForbiddenException('Only an owner can add another owner');
    }
    return me;
  }

  private async ownerCount(workspaceId: string) {
    return this.members.count({ where: { workspaceId, role: 'workspace_owner' } });
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async membersOf(workspaceId: string) {
    return this.members
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u')
      .where('m.workspaceId = :workspaceId', { workspaceId })
      .select([
        'u.id AS "userId"',
        'u.email AS "email"',
        'u.name AS "name"',
        'm.role AS "role"',
        'm.created_at AS "joinedAt"',
        'u.last_login_at AS "lastLoginAt"',
      ])
      .orderBy('m.created_at', 'ASC')
      .getRawMany();
  }

  async addMember(workspaceId: string, email: string, role: string) {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user) throw new NotFoundException('User not found');
    const ws = await this.workspaces.findOne({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (await this.members.exist({ where: { workspaceId, userId: user.id } })) throw new ConflictException('Already a member');
    if (!['agency_owner', 'agency_admin', 'super_admin'].includes(role)) await this.saas?.assertCapacity(workspaceId, 'users');
    await this.members.save(this.members.create({ user, workspace: ws, role }));
    return { added: true };
  }

  /** Change someone's role. Admins can't touch owners; the last owner can't be demoted. */
  async changeRole(workspaceId: string, userId: string, role: string, requesterId: string) {
    const me = await this.assertManager(workspaceId, requesterId, role);
    const target = await this.members.findOne({ where: { workspaceId, userId } });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === role) return { role };
    if (target.role === 'workspace_owner') {
      if (me.role !== 'workspace_owner') throw new ForbiddenException('Only an owner can change another owner’s role');
      if ((await this.ownerCount(workspaceId)) <= 1) throw new BadRequestException('A workspace needs at least one owner. Make someone else an owner first.');
    }
    await this.members.update({ id: target.id }, { role });
    return { role };
  }

  /** Owners/admins remove others; anyone may leave. The last owner can do neither. */
  async removeMember(workspaceId: string, userId: string, requesterId: string) {
    const requester = await this.members.findOne({ where: { userId: requesterId, workspaceId } });
    if (!requester) throw new NotFoundException('Workspace not found');
    const target = await this.members.findOne({ where: { userId, workspaceId } });
    if (!target) throw new NotFoundException('Member not found');
    const self = userId === requesterId;
    if (!self && !MANAGERS.includes(requester.role)) throw new ForbiddenException('Not allowed to remove members');
    if (!self && target.role === 'workspace_owner' && requester.role !== 'workspace_owner') throw new ForbiddenException('Only an owner can remove another owner');
    if (target.role === 'workspace_owner' && (await this.ownerCount(workspaceId)) <= 1) {
      throw new BadRequestException('A workspace needs at least one owner. Make someone else an owner first.');
    }
    await this.members.delete({ id: target.id });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  private inviteUrl(token: string) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/invite/${token}`;
  }

  async pendingInvitations(workspaceId: string) {
    const rows = await this.invitations.find({
      where: { workspaceId, acceptedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      relations: { invitedBy: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy?.name ?? null,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      inviteUrl: this.inviteUrl(i.invitationToken),
    }));
  }

  /**
   * Invite someone by email. Re-inviting a pending address refreshes the link and role
   * instead of creating a duplicate. The link is also returned so an admin can share it
   * directly (useful when no email provider is configured).
   */
  async invite(workspaceId: string, rawEmail: string, role: string, invitedBy: string) {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address');
    const ws = await this.workspaces.findOne({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (!['agency_owner', 'agency_admin', 'super_admin'].includes(role)) await this.saas?.assertCapacity(workspaceId, 'users');

    const existingUser = await this.users.findOne({ where: { email } });
    if (existingUser && (await this.members.exist({ where: { workspaceId, userId: existingUser.id } }))) {
      throw new ConflictException(`${email} is already on this team`);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    let inv = await this.invitations.findOne({ where: { workspaceId, email, acceptedAt: IsNull() } });
    if (inv) {
      Object.assign(inv, { role, invitationToken: token, expiresAt, invitedById: invitedBy });
    } else {
      inv = this.invitations.create({ email, workspaceId, invitedById: invitedBy, role, invitationToken: token, expiresAt });
    }
    await this.invitations.save(inv);
    await this.sendInviteEmail(inv, ws.name, invitedBy, !!existingUser);
    return { id: inv.id, email, role, inviteUrl: this.inviteUrl(token), expiresAt };
  }

  async resendInvitation(workspaceId: string, invitationId: string, requesterId: string) {
    await this.assertManager(workspaceId, requesterId);
    const inv = await this.invitations.findOne({ where: { id: invitationId, workspaceId, acceptedAt: IsNull() } });
    if (!inv) throw new NotFoundException('Invitation not found');
    return this.invite(workspaceId, inv.email, inv.role, requesterId);
  }

  async revokeInvitation(workspaceId: string, invitationId: string, requesterId: string) {
    await this.assertManager(workspaceId, requesterId);
    const res = await this.invitations.delete({ id: invitationId, workspaceId, acceptedAt: IsNull() });
    if (!res.affected) throw new NotFoundException('Invitation not found');
    return { revoked: true };
  }

  private async sendInviteEmail(inv: Invitation, workspaceName: string, invitedBy: string, hasAccount: boolean) {
    const inviter = await this.users.findOne({ where: { id: invitedBy } });
    const who = inviter?.name || 'A teammate';
    const url = this.inviteUrl(inv.invitationToken);
    const roleLabel = ROLE_LABELS[inv.role] ?? inv.role;
    const action = hasAccount ? 'Sign in to accept' : 'Create your account';
    const body = `${who} invited you to join ${workspaceName} on ERIL as ${roleLabel}.\n\n${action}: ${url}\n\nThis link expires in 7 days. If you weren’t expecting this, you can ignore this email.`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#0f172a">
<p style="font-size:16px"><strong>${esc(who)}</strong> invited you to join <strong>${esc(workspaceName)}</strong> on ERIL as <strong>${esc(roleLabel)}</strong>.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#5847d7;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${action}</a></p>
<p style="color:#64748b;font-size:13px">This link expires in 7 days. If you weren’t expecting this, you can ignore this email.</p></div>`;
    try {
      await this.email.send({ to: inv.email, subject: `${who} invited you to ${workspaceName} on ERIL`, body, html });
    } catch (e) {
      // The invitation still exists and its link is shown to the admin, so don't fail the request.
      this.logger.warn(`Invite email to ${inv.email} failed: ${(e as Error).message}`);
    }
  }
}
