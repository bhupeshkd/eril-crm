import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

@Entity('companies')
@Index(['workspaceId', 'name'])
export class Company extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  domain: string | null;

  @Column({ type: 'varchar', nullable: true, length: 100 })
  industry: string | null;

  @Column({ type: 'varchar', nullable: true, length: 30 })
  phone: string | null;

  @OneToMany(() => Contact, (c) => c.company)
  contacts: Contact[];
}
