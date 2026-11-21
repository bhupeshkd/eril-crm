import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity';
import { DEFAULT_ROLE_PERMISSIONS } from '@eril/shared';
import { SKIP_TENANT_KEY } from '../decorators/skip-tenant.decorator';

/**
 * TenantGuard enforces that every authenticated request carries an active
 * workspace context (x-workspace-id header) and that the authenticated user
 * is a member of that workspace. The resolved workspace is attached to
 * request.tenant for downstream services.
 *
 * This is the server-side enforcement of workspace-level data isolation.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      // Public routes or routes without auth are skipped; JwtAuthGuard handles auth.
      return true;
    }

    if (user.apiKeyId) {
      // API keys are bound to exactly one workspace.
      request.tenant = { workspaceId: user.currentWorkspaceId, organizationId: null, role: user.role };
      return true;
    }

    const workspaceId =
      request.headers['x-workspace-id'] ||
      request.headers['x-eril-workspace'] ||
      user.currentWorkspaceId;
    if (!workspaceId) {
      throw new ForbiddenException(
        'Workspace context is required. Pass the x-workspace-id header.',
      );
    }

    const membership = await this.members.findOne({
      where: { userId: user.id, workspaceId },
      relations: { workspace: true },
    });
    if (!membership) {
      throw new ForbiddenException('Workspace access denied');
    }

    request.tenant = {
      workspaceId,
      organizationId: membership.workspace?.organizationId,
      role: membership.role,
    };
    // Permissions follow the role held in the *active* workspace.
    user.permissions =
      DEFAULT_ROLE_PERMISSIONS[membership.role] ?? user.permissions ?? [];
    return true;
  }
}
