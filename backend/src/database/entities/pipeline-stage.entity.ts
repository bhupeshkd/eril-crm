import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Pipeline } from './pipeline.entity';

@Entity('pipeline_stages')
@Index(['pipelineId', 'position'])
export class PipelineStage extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Pipeline, (p) => p.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pipeline_id' })
  pipeline: Pipeline;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Default win probability (0-100) for deals in this stage. */
  @Column({ type: 'int', default: 0 })
  probability: number;
}
