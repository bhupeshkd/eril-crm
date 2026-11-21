export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  currentOrganizationId: string | null;
  currentWorkspaceId: string | null;
  workspaceMemberships: Array<{
    workspaceId: string;
    workspaceName: string;
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
  permissions: string[];
  iat: number;
  exp: number;
}
