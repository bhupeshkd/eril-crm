import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Install-wide key/value settings generated at runtime (e.g. Web Push keys when none are configured). */
@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn({ length: 80 })
  key: string;

  @Column({ type: 'jsonb' })
  value: any;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
