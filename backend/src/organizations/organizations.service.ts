import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../database/entities/organization.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgs: Repository<Organization>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
  ) {}

  async listForUser(userId: string) {
    return this.members
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .innerJoin('w.organization', 'o')
      .where('m.userId = :userId', { userId })
      .select([
        'o.id AS "organizationId"',
        'o.name AS "organizationName"',
        'o.plan AS "plan"',
        'w.id AS "workspaceId"',
        'w.name AS "workspaceName"',
        'm.role AS "role"',
      ])
      .getRawMany();
  }

  async create(userId: string, name: string) {
    const org = this.orgs.create({ name, plan: 'free' });
    await this.orgs.save(org);

    const ws = this.workspaces.create({
      name: `${name} Workspace`,
      organization: org,
      organizationId: org.id,
      settings: {},
    });
    await this.workspaces.save(ws);

    await this.members.save(
      this.members.create({ user: { id: userId } as any, workspace: ws, role: 'workspace_admin' }),
    );

    return { organizationId: org.id, workspaceId: ws.id };
  }

  async delete(userId: string, orgId: string) {
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    // Only the owning member of any workspace may delete (simplified Phase 1 rule).
    const membership = await this.members
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .where('m.userId = :userId AND w.organizationId = :orgId', { userId, orgId })
      .getOne();
    if (!membership || membership.role !== 'workspace_owner') {
      throw new ForbiddenException('Only workspace owners may delete an organization');
    }
    await this.orgs.remove(org);
    return { deleted: true };
  }
}
