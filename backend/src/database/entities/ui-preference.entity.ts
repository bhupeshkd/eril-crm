import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Appearance, Widget } from '@eril/shared';

/** A team member's own look of the app in one workspace: Overview layout and appearance. */
@Entity('ui_preferences')
@Index(['workspaceId', 'userId'], { unique: true })
export class UiPreference extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Overview widgets; null = default layout. */
  @Column({ type: 'jsonb', nullable: true })
  widgets: Widget[] | null;

  /** Colours, surfaces, fonts, sidebar and menu; null = team default (or the built-in look). */
  @Column({ type: 'jsonb', nullable: true })
  appearance: Appearance | null;
}
