import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Role } from './role.entity';

@Entity('role_permissions')
@Unique(['roleId', 'permission'])
export class RolePermission extends BaseEntity {
  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column()
  permission: string;
}
