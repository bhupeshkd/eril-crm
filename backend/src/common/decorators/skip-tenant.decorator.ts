import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'skipTenant';

/**
 * Marks a route as not requiring an active workspace context
 * (e.g. auth endpoints that run before a workspace is selected).
 */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);
