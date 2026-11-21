import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface TenantContext {
  workspaceId: string;
  organizationId: string;
  role: string;
}

/** Injects the workspace context resolved by TenantGuard. */
export const Tenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const tenant = ctx.switchToHttp().getRequest().tenant ?? null;
    return data && tenant ? tenant[data] : tenant;
  },
);
