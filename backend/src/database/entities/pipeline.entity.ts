import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PipelineStage } from './pipeline-stage.entity';

@Entity('pipelines')
@Index(['workspaceId'])
export class Pipeline extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @OneToMany(() => PipelineStage, (s) => s.pipeline, { cascade: true })
  stages: PipelineStage[];
}
