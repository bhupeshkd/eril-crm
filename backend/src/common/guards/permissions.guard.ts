import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user || !Array.isArray(user.permissions)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const missing = requiredPermissions.filter(
      (p) => !user.permissions.includes(p),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
