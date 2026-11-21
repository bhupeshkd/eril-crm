/**
 * ERIL shared domain types.
 * Kept framework-free so backend, frontend and workers can all import them.
 */

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

export type PlanTier = 'free' | 'professional' | 'agency' | 'enterprise';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

/** Serialized user returned by /auth/me */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  currentOrganizationId: string | null;
  currentWorkspaceId: string | null;
}

export interface Organization {
  id: string;
  name: string;
  plan: PlanTier;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  organizationId: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A workspace membership + role for the current user */
export interface WorkspaceMembership {
  workspaceId: string;
  workspaceName: string;
  organizationId: string;
  organizationName: string;
  role: UserRole;
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginatedMeta;
}

/** Standard API error body */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId?: string;
}
