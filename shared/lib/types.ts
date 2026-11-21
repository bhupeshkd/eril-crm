// File: eril/shared/lib/types.ts
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  workspaceId: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: 'free' | 'professional' | 'agency' | 'enterprise';
}

export interface Workspace {
  id: string;
  name: string;
  organizationId: string;
  settings: WorkspaceSettings;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName?: string;
  status: 'lead' | 'customer' | 'inactive';
  tags: string[];
  source: string;
  createdAt: Date;
}

export interface Opportunity {
  id: string;
  title: string;
  value: number;
  pipelineId: string;
  stage: string;
  contactId: string;
  probability: number;
  createdAt: Date;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: { type: string; config: any };
  actions: any[];
  isPublished: boolean;
}
