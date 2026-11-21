import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export interface WorkflowRunLogEntry {
  stepId: string;
  type: string;
  result: string;
  at: string;
}

@Entity('workflow_runs')
@Index(['workflowId', 'createdAt'])
export class WorkflowRun extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId: string;

  @Column({ name: 'trigger_type', length: 50 })
  triggerType: string;

  /** running | succeeded | failed */
  @Column({ length: 20, default: 'running' })
  status: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  context: Record<string, any>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  log: WorkflowRunLogEntry[];

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** When status = waiting: time to resume, and the step lists still to run. */
  @Column({ name: 'resume_at', type: 'timestamptz', nullable: true })
  resumeAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  pending: any[][] | null;

  @Column({ type: 'int', default: 1 })
  depth: number;
}
