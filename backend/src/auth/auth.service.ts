import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException, Optional } from '@nestjs/common';
import { SaasAccessService } from '../saas/access';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DataSource, IsNull } from 'typeorm';
import { Invitation } from '../database/entities/invitation.entity';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { Organization } from '../database/entities/organization.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Role } from '../database/entities/role.entity';
import { RolePermission } from '../database/entities/permission.entity';
import { DEFAULT_ROLE_PERMISSIONS } from '@eril/shared';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SwitchWorkspaceDto } from './dto/switch-workspace.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,
    @InjectRepository(WorkspaceMember)
    private readonly membersRepo: Repository<WorkspaceMember>,
    @InjectRepository(Organization)
    private readonly orgsRepo: Repository<Organization>,
    @InjectRepository(Workspace)
    private readonly workspacesRepo: Repository<Workspace>,
    @InjectRepository(Role)
    private readonly rolesRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionsRepo: Repository<RolePermission>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
    @Optional() private readonly saas?: SaasAccessService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.usersRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const { user, workspaceId } = await this.usersRepo.manager.transaction(async (tx) => {
      const user = tx.create(User, {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        role: 'workspace_owner',
      });
      await tx.save(user);

      const org = tx.create(Organization, {
        name: dto.organizationName || `${dto.name}'s Organization`,
      });
      await tx.save(org);

      const workspace = tx.create(Workspace, {
        name: dto.workspaceName || 'Main Workspace',
        organization: org,
        organizationId: org.id,
        settings: {},
      });
      await tx.save(workspace);

      await tx.save(
        tx.create(WorkspaceMember, {
          user,
          workspace,
          role: 'workspace_owner',
        }),
      );

      await this.seedDefaultRoles(tx, workspace.id);

      user.emailVerificationToken = uuidv4().replace(/-/g, '');
      user.emailVerificationExpiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      );
      await tx.save(user);

      this.logger.log(
        `Registered user ${user.email} for organization "${org.name}" / workspace "${workspace.name}"`,
      );

      return { user, workspaceId: workspace.id };
    });
    // Issue tokens after commit so the membership lookup sees the new rows.
    return this.issueTokens(user, workspaceId);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email.toLowerCase() })
      .getOne();
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.mfaEnabled) {
      if (!dto.mfaCode) {
        throw new UnauthorizedException('MFA code required');
      }
      if (!authenticator.check(dto.mfaCode, user.mfaSecret)) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    const membership = await this.membersRepo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    const workspaceId = membership?.workspaceId ?? null;

    await this.usersRepo.update(user.id, { lastLoginAt: new Date() });

    return this.issueTokens(user, workspaceId);
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { emailVerificationToken: token },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }
    if (user.emailVerificationExpiresAt < new Date()) {
      throw new BadRequestException('Verification token expired');
    }
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    await this.usersRepo.save(user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { email: email.toLowerCase() },
    });
    // Do not leak whether the email exists.
    if (!user) {
      this.logger.warn(`Forgot password requested for unknown email ${email}`);
      return;
    }
    user.passwordResetToken = uuidv4().replace(/-/g, '');
    user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.usersRepo.save(user);
    // Phase 1: EMAIL_PROVIDER=console -> log instead of sending.
    this.logger.log(
      `Password reset token for ${user.email}: ${user.passwordResetToken}`,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { passwordResetToken: token },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException('Reset token expired');
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await this.sessionsRepo.update(
      { userId: user.id },
      { revokedAt: new Date() },
    );
    await this.usersRepo.save(user);
  }

  async switchWorkspace(
    userId: string,
    dto: SwitchWorkspaceDto,
  ): Promise<AuthTokens> {
    const membership = await this.membersRepo.findOne({
      where: { userId, workspaceId: dto.workspaceId },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.issueTokens(user, dto.workspaceId);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const found = await this.findSessionByRefreshToken(refreshToken);
    if (!found) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (found.revokedAt || found.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    const user = await this.usersRepo.findOne({ where: { id: found.userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    // Rotate: revoke old, issue new.
    found.revokedAt = new Date();
    await this.sessionsRepo.save(found);
    const membership = await this.membersRepo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    return this.issueTokens(user, membership?.workspaceId ?? null);
  }

  async logout(refreshToken: string): Promise<void> {
    const found = await this.findSessionByRefreshToken(refreshToken);
    if (found) {
      found.revokedAt = new Date();
      await this.sessionsRepo.save(found);
    }
  }

  async enableMfa(userId: string): Promise<{ secret: string }> {
    const secret = authenticator.generateSecret();
    await this.usersRepo.update(userId, { mfaEnabled: true, mfaSecret: secret });
    return { secret };
  }

  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user || !user.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }
    if (!authenticator.check(code, user.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.usersRepo.update(userId, { mfaEnabled: false, mfaSecret: null });
  }

  async verifyMfaToken(userId: string, code: string): Promise<string> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user || !user.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }
    if (!authenticator.check(code, user.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    const membership = await this.membersRepo.findOne({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return (await this.issueTokens(user, membership?.workspaceId ?? null)).accessToken;
  }

  // -------------------------------------------------------------------------
  // Team invitations (public: the token in the link is the credential)
  // -------------------------------------------------------------------------

  private async findInvitation(token: string) {
    if (!/^[0-9a-f]{64}$/.test(token ?? '')) throw new NotFoundException('This invitation link is not valid');
    const inv = await this.ds.getRepository(Invitation).findOne({
      where: { invitationToken: token },
      relations: { workspace: { organization: true }, invitedBy: true },
    });
    if (!inv) throw new NotFoundException('This invitation link is not valid');
    return inv;
  }

  async invitationInfo(token: string) {
    const inv = await this.findInvitation(token);
    const existing = await this.usersRepo.findOne({ where: { email: inv.email } });
    return {
      email: inv.email,
      role: inv.role,
      workspaceName: inv.workspace?.name,
      organizationName: inv.workspace?.organization?.name ?? null,
      invitedBy: inv.invitedBy?.name ?? null,
      hasAccount: !!existing,
      status: inv.acceptedAt ? 'accepted' : inv.expiresAt < new Date() ? 'expired' : 'pending',
    };
  }

  /**
   * Accept an invitation. Without an account, `name` + `password` create one (the email is
   * treated as verified, since the link was delivered to it). With an account, the current
   * password (and MFA code if enabled) proves ownership. Either way the user lands signed in
   * on the invited workspace.
   */
  async acceptInvitation(token: string, dto: AcceptInviteDto): Promise<AuthTokens> {
    const inv = await this.findInvitation(token);
    // Plan seat limit for SaaS client accounts.
    await this.saas?.assertCapacity(inv.workspaceId, 'users');
    if (inv.acceptedAt) throw new BadRequestException('This invitation has already been used. Sign in instead.');
    if (inv.expiresAt < new Date()) throw new BadRequestException('This invitation has expired. Ask for a new one.');

    let user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect(['user.passwordHash', 'user.mfaSecret'])
      .where('user.email = :email', { email: inv.email })
      .getOne();

    if (user) {
      if (!(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Incorrect password');
      if (user.mfaEnabled) {
        if (!dto.mfaCode) throw new UnauthorizedException('MFA code required');
        if (!authenticator.check(dto.mfaCode, user.mfaSecret)) throw new UnauthorizedException('Invalid MFA code');
      }
    } else {
      if (!dto.name?.trim()) throw new BadRequestException('Enter your name');
      if (dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    }

    const result = await this.ds.transaction(async (tx) => {
      if (!user) {
        user = tx.create(User, {
          email: inv.email,
          passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
          name: dto.name!.trim(),
          role: 'team_member',
          emailVerified: true,
        });
        await tx.save(user);
      }
      // Mark used first, guarded on acceptedAt so a double-submit can't add the member twice.
      const claimed = await tx.update(Invitation, { id: inv.id, acceptedAt: IsNull() }, { acceptedAt: new Date() });
      if (!claimed.affected) throw new BadRequestException('This invitation has already been used. Sign in instead.');
      const already = await tx.findOne(WorkspaceMember, { where: { userId: user.id, workspaceId: inv.workspaceId } });
      if (!already) await tx.save(tx.create(WorkspaceMember, { userId: user.id, workspaceId: inv.workspaceId, role: inv.role }));
      return user;
    });

    await this.usersRepo.update(result.id, { lastLoginAt: new Date(), currentWorkspaceId: inv.workspaceId });
    this.logger.log(`${result.email} accepted an invitation to workspace ${inv.workspaceId} as ${inv.role}`);
    return this.issueTokens(result, inv.workspaceId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async seedDefaultRoles(
    tx: any,
    workspaceId: string,
  ): Promise<void> {
    for (const [name, permissions] of Object.entries(
      DEFAULT_ROLE_PERMISSIONS,
    )) {
      const role = tx.create(Role, { name, workspaceId });
      await tx.save(role);
      for (const permission of permissions) {
        await tx.save(
          tx.create(RolePermission, { roleId: role.id, permission }),
        );
      }
    }
  }

  private async issueTokens(
    user: User,
    workspaceId: string | null,
    keepWorkspaceId?: string,
  ): Promise<AuthTokens> {
    const memberships = await this.membersRepo
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .innerJoin('w.organization', 'o')
      .select([
        'm.workspace_id AS "workspaceId"',
        'w.name AS "workspaceName"',
        'w.organization_id AS "organizationId"',
        'o.name AS "organizationName"',
        'm.role AS "role"',
      ])
      .where('m.userId = :userId', { userId: user.id })
      .getRawMany();

    const activeWorkspaceId = keepWorkspaceId ?? workspaceId;
    const active =
      memberships.find((m) => m.workspaceId === activeWorkspaceId) ??
      memberships[0];
    const activeRole = active?.role ?? user.role;
    const permissions =
      DEFAULT_ROLE_PERMISSIONS[activeRole] ?? DEFAULT_ROLE_PERMISSIONS.team_member;

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      currentOrganizationId: active?.organizationId ?? null,
      currentWorkspaceId: activeWorkspaceId,
      workspaceMemberships: memberships,
      permissions,
    };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get('JWT_ACCESS_TTL') || '15m',
    });
    const refreshToken = uuidv4().replace(/-/g, '');
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

    const session = this.sessionsRepo.create({
      userId: user.id,
      refreshTokenHash: refreshHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await this.sessionsRepo.save(session);

    return { accessToken, refreshToken };
  }

  private async findSessionByRefreshToken(
    token: string,
  ): Promise<Session | null> {
    const hash = createHash('sha256').update(token).digest('hex');
    return this.sessionsRepo.findOne({
      where: { refreshTokenHash: hash },
    });
  }
}
