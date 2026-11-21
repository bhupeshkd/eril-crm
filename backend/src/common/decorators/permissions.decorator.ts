import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Marks a route as requiring all of the given permissions.
 * Used by PermissionsGuard in combination with @UseGuards(PermissionsGuard).
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
