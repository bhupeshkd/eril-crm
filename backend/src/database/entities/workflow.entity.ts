import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export const WORKFLOW_TRIGGERS = [
  'manual',
  'contact.created',
  'contact.updated',
  'contact.tag_added',
  'opportunity.created',
  'opportunity.stage_changed',
  'message.received',
  'form.submitted',
  'appointment.booked',
  'appointment.status_changed',
  'invoice.paid',
  'task.completed',
  'review.received',
  'course.enrolled',
  'course.completed',
  'subscription.created',
  'subscription.canceled',
  'invoice.overdue',
  'email.opened',
  'email.clicked',
  'order.submitted',
  'order.paid',
  'community.member_joined',
  'community.post_created',
  'call.missed',
] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_ACTIONS = [
  'send_email',
  'send_sms',
  'add_tag',
  'remove_tag',
  'update_contact',
  'create_opportunity',
  'create_task',
  'add_note',
  'webhook',
  'send_review_request',
  'ai_generate',
  'enroll_in_course',
  'wait',
  'log',
  'condition',
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTIONS)[number];

export interface WorkflowStep {
  id: string;
  type: WorkflowActionType;
  config: Record<string, any>;
  /** Branches, only used by `condition` steps. */
  then?: WorkflowStep[];
  else?: WorkflowStep[];
}

@Entity('workflows')
@Index(['workspaceId', 'triggerType'])
export class Workflow extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ name: 'trigger_type', type: 'varchar', length: 50, default: 'manual' })
  triggerType: WorkflowTrigger;

  /** Optional trigger filter, e.g. { tag: 'vip' } or { stageId }. */
  @Column({ name: 'trigger_config', type: 'jsonb', default: () => "'{}'" })
  triggerConfig: Record<string, any>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  steps: WorkflowStep[];

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  @Column({ name: 'run_count', type: 'int', default: 0 })
  runCount: number;
}
