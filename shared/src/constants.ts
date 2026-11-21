/**
 * Central permission registry.
 * Permissions are strings of the form "<resource>:<action>".
 * Phase 1 defines the full intended vocabulary; RBAC wiring for later
 * modules maps their endpoints to these permissions as they are built.
 */
export const PERMISSIONS = [
  // Platform
  'platform:read',
  'platform:admin',

  // Organizations & workspaces
  'organizations:read',
  'organizations:write',
  'organizations:delete',
  'workspaces:read',
  'workspaces:write',
  'workspaces:delete',

  // Users, roles, invitations
  'users:read',
  'users:write',
  'users:invite',
  'users:remove',
  'roles:read',
  'roles:write',

  // CRM
  'contacts:read',
  'contacts:write',
  'contacts:delete',
  'contacts:import',
  'contacts:export',
  'companies:read',
  'companies:write',
  'companies:delete',

  // Sales
  'pipelines:read',
  'pipelines:write',
  'opportunities:read',
  'opportunities:write',
  'opportunities:delete',

  // Conversations
  'conversations:read',
  'conversations:write',

  // Automation
  'workflows:read',
  'workflows:write',
  'workflows:execute',

  // Websites & funnels
  'websites:read',
  'websites:write',
  'websites:publish',
  'funnels:read',
  'funnels:write',
  'funnels:publish',

  // Marketing
  'campaigns:read',
  'campaigns:write',
  'campaigns:send',
  'forms:read',
  'forms:write',
  'forms:read_submissions',

  // Calendars
  'calendars:read',
  'calendars:write',
  'appointments:read',
  'appointments:write',

  // Payments
  'payments:read',
  'payments:write',
  'invoices:read',
  'invoices:write',

  // Courses
  'courses:read',
  'courses:write',

  // Analytics
  'analytics:read',

  // Integrations & AI
  'integrations:read',
  'integrations:write',
  'ai:read',
  'ai:write',

  // Admin
  'admin:read',
  'admin:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** API base path (backend global prefix + version) */
export const API_BASE = '/api/v1';

/** Public routes that do not require authentication */
export const PUBLIC_ROUTES = [
  '/auth/register',
  '/auth/login',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/health',
] as const;
