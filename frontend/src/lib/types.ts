export interface Me {
  id: string;
  email: string;
  name: string;
  role: string;
  currentWorkspaceId: string | null;
  currentOrganizationId: string | null;
  workspaceMemberships: Array<{
    workspaceId: string;
    workspaceName: string;
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
  permissions: string[];
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  contactCount?: number;
}

export type ContactStatus = 'lead' | 'customer' | 'churned';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: ContactStatus;
  tags: string[];
  notes: string | null;
  companyId: string | null;
  company: Company | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  probability: number;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

export interface Opportunity {
  id: string;
  title: string;
  value: number;
  probability: number | null;
  status: 'open' | 'won' | 'lost';
  position: number;
  stageId: string;
  pipelineId: string;
  contactId: string | null;
  contact: Contact | null;
  expectedCloseDate: string | null;
}

export interface Board {
  pipeline: { id: string; name: string };
  stages: Array<Stage & { opportunities: Opportunity[]; totalValue: number }>;
}

export type StepType =
  | 'send_email'
  | 'send_sms'
  | 'add_tag'
  | 'remove_tag'
  | 'update_contact'
  | 'create_opportunity'
  | 'create_task'
  | 'add_note'
  | 'webhook'
  | 'send_review_request'
  | 'ai_generate'
  | 'enroll_in_course'
  | 'wait'
  | 'log'
  | 'condition';

export interface WorkflowStep {
  id: string;
  type: StepType;
  config: Record<string, any>;
  then?: WorkflowStep[];
  else?: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, any>;
  steps: WorkflowStep[];
  isPublished: boolean;
  runCount: number;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  triggerType: string;
  log: Array<{ stepId: string; type: string; result: string; at: string }>;
  error: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  sentByBot?: boolean;
  direction: 'inbound' | 'outbound';
  channel: 'email' | 'sms' | 'chat' | 'whatsapp' | 'facebook' | 'instagram';
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
  hasHtml?: boolean;
  openedAt?: string | null;
  clickedAt?: string | null;
  openCount?: number;
  clickCount?: number;
}

export interface Conversation {
  id: string;
  /** chat = website chat widget */
  channel: 'email' | 'sms' | 'chat' | 'whatsapp' | 'facebook' | 'instagram';
  subject: string;
  contactId: string;
  contact: Contact;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  messages?: Message[];
  /** AI assistant state for this conversation. */
  botPaused?: boolean;
  botReplyCount?: number;
  botHandoffReason?: string | null;
}

export interface Activity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}
