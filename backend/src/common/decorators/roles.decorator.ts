import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Marks a route as requiring one of the given roles.
 * Used by RolesGuard in combination with @UseGuards(RolesGuard).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
