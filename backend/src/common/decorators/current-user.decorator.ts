import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  currentOrganizationId?: string | null;
  currentWorkspaceId?: string | null;
  permissions?: string[];
}

/** Injects request.user, or a single property of it: @CurrentUser('id'). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user ?? null;
    return data && user ? user[data] : user;
  },
);
