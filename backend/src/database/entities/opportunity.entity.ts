import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';
import { PipelineStage } from './pipeline-stage.entity';

const decimal = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('opportunities')
@Index(['workspaceId', 'pipelineId', 'stageId'])
export class Opportunity extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, transformer: decimal })
  value: number;

  @Column({ type: 'int', nullable: true })
  probability: number | null;

  /** open | won | lost */
  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @ManyToOne(() => Contact, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId: string;

  @ManyToOne(() => PipelineStage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stage_id' })
  stage: PipelineStage;

  @Column({ name: 'stage_id', type: 'uuid' })
  stageId: string;

  @Column({ name: 'expected_close_date', type: 'date', nullable: true })
  expectedCloseDate: string | null;

  /** When the deal was won or lost (null while open). Drives "won this month" and revenue charts. */
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
