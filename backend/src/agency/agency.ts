import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Workspace } from '../database/entities/workspace.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { Organization } from '../database/entities/organization.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { PipelineStage } from '../database/entities/pipeline-stage.entity';
import { Workflow } from '../database/entities/workflow.entity';
import { Form } from '../database/entities/form.entity';
import { Calendar } from '../database/entities/calendar.entity';
import { CustomField } from '../database/entities/crm-extras.entity';
import { Site } from '../database/entities/site.entity';
import { Course, Snapshot } from '../database/entities/course.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug } from '../common/slug';
import { ActivityService } from '../events/activity.service';

/** Roles that can see and manage every sub-account (workspace) in their organization. */
export const AGENCY_ROLES = ['super_admin', 'agency_owner', 'agency_admin', 'workspace_owner'];

class CreateSubAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsUUID() snapshotId?: string;
}
class RenameDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
}
class CreateSnapshotDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsUUID() sourceWorkspaceId: string;
}
class ApplySnapshotDto {
  @IsUUID() workspaceId: string;
}

/** Replace every occurrence of old ids with new ids inside a JSON-able value. */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  if (!map.size) return value;
  let s = JSON.stringify(value);
  for (const [from, to] of map) s = s.split(from).join(to);
  return JSON.parse(s);
}

@Injectable()
export class AgencyService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(Snapshot) private readonly snapshots: Repository<Snapshot>,
    private readonly activity: ActivityService,
  ) {}

  /** Organizations where the user holds an agency-level role on at least one workspace. */
  async organizations(userId: string) {
    const rows = await this.members
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .innerJoin('w.organization', 'o')
      .select('o.id', 'id')
      .addSelect('o.name', 'name')
      .addSelect('o.plan', 'plan')
      .addSelect('COUNT(DISTINCT w2.id)', 'subAccounts')
      .leftJoin(Workspace, 'w2', 'w2.organization_id = o.id AND w2.deleted_at IS NULL')
      .where('m.user_id = :userId AND m.role IN (:...roles)', { userId, roles: AGENCY_ROLES })
      .groupBy('o.id')
      .addGroupBy('o.name')
      .addGroupBy('o.plan')
      .getRawMany();
    return rows.map((r) => ({ ...r, subAccounts: Number(r.subAccounts) }));
  }

  async assertAccess(userId: string, orgId: string) {
    const ok = await this.members
      .createQueryBuilder('m')
      .innerJoin('m.workspace', 'w')
      .where('m.user_id = :userId AND w.organization_id = :orgId AND m.role IN (:...roles)', { userId, orgId, roles: AGENCY_ROLES })
      .getCount()
      .then((n) => n > 0);
    if (!ok) throw new ForbiddenException('You do not have agency access to this organization');
  }

  private async workspaceInOrg(orgId: string, workspaceId: string) {
    const ws = await this.workspaces.findOne({ where: { id: workspaceId, organizationId: orgId } });
    if (!ws) throw new NotFoundException('Sub-account not found in this organization');
    return ws;
  }

  /** Sub-accounts with headline metrics, in one round trip per metric. */
  async subAccounts(userId: string, orgId: string) {
    await this.assertAccess(userId, orgId);
    const list = await this.workspaces.find({ where: { organizationId: orgId }, order: { createdAt: 'ASC' } });
    if (!list.length) return [];
    const ids = list.map((w) => w.id);
    const metric = async (sql: string) => {
      const rows: Array<{ ws: string; v: string }> = await this.ds.query(sql, [ids]);
      return new Map(rows.map((r) => [r.ws, Number(r.v)]));
    };
    const [contacts, leads30, pipeline, revenue30, unread, upcoming, lastActivity, mine] = await Promise.all([
      metric(`SELECT workspace_id ws, COUNT(*) v FROM contacts WHERE workspace_id = ANY($1) AND deleted_at IS NULL GROUP BY 1`),
      metric(`SELECT workspace_id ws, COUNT(*) v FROM contacts WHERE workspace_id = ANY($1) AND deleted_at IS NULL AND created_at > now() - interval '30 days' GROUP BY 1`),
      metric(`SELECT workspace_id ws, COALESCE(SUM(value),0) v FROM opportunities WHERE workspace_id = ANY($1) AND deleted_at IS NULL AND status = 'open' GROUP BY 1`),
      metric(`SELECT workspace_id ws, COALESCE(SUM(total),0) v FROM invoices WHERE workspace_id = ANY($1) AND deleted_at IS NULL AND status = 'paid' AND paid_at > now() - interval '30 days' GROUP BY 1`),
      metric(`SELECT workspace_id ws, COALESCE(SUM(unread_count),0) v FROM conversations WHERE workspace_id = ANY($1) AND deleted_at IS NULL GROUP BY 1`),
      metric(`SELECT workspace_id ws, COUNT(*) v FROM appointments WHERE workspace_id = ANY($1) AND deleted_at IS NULL AND start_at > now() AND status <> 'cancelled' GROUP BY 1`),
      this.ds.query(`SELECT workspace_id ws, MAX(created_at) v FROM activities WHERE workspace_id = ANY($1) GROUP BY 1`, [ids]).then((r) => new Map(r.map((x: any) => [x.ws, x.v]))),
      this.members.find({ where: { userId, workspaceId: In(ids) } }).then((r) => new Map(r.map((m) => [m.workspaceId, m.role]))),
    ]);
    return list.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt,
      myRole: mine.get(w.id) ?? null,
      metrics: {
        contacts: contacts.get(w.id) ?? 0,
        newLeads30d: leads30.get(w.id) ?? 0,
        openPipeline: pipeline.get(w.id) ?? 0,
        revenue30d: revenue30.get(w.id) ?? 0,
        unread: unread.get(w.id) ?? 0,
        upcomingAppointments: upcoming.get(w.id) ?? 0,
        lastActivityAt: lastActivity.get(w.id) ?? null,
      },
    }));
  }

  async createSubAccount(userId: string, orgId: string, dto: CreateSubAccountDto) {
    await this.assertAccess(userId, orgId);
    const snapshot = dto.snapshotId ? await this.snapshots.findOne({ where: { id: dto.snapshotId, organizationId: orgId } }) : null;
    if (dto.snapshotId && !snapshot) throw new NotFoundException('Snapshot not found');
    const ws = await this.ds.transaction(async (tx) => {
      const created = await tx.save(tx.create(Workspace, { name: dto.name, organizationId: orgId, settings: {} }));
      // The agency user gets owner access so they can switch into the new account.
      await tx.save(tx.create(WorkspaceMember, { userId, workspaceId: created.id, role: 'workspace_owner' }));
      if (snapshot) await this.importContent(tx, created.id, snapshot.content);
      return created;
    });
    await this.activity.record(ws.id, 'workspace.created', `Sub-account created${snapshot ? ` from snapshot "${snapshot.name}"` : ''}`, { userId });
    return { id: ws.id, name: ws.name };
  }

  async rename(userId: string, orgId: string, workspaceId: string, dto: RenameDto) {
    await this.assertAccess(userId, orgId);
    const ws = await this.workspaceInOrg(orgId, workspaceId);
    ws.name = dto.name;
    await this.workspaces.save(ws);
    return { id: ws.id, name: ws.name };
  }

  /** Agency users can join any sub-account in their org (e.g. to support a client). */
  async join(userId: string, orgId: string, workspaceId: string) {
    await this.assertAccess(userId, orgId);
    await this.workspaceInOrg(orgId, workspaceId);
    const existing = await this.members.findOne({ where: { userId, workspaceId } });
    if (!existing) await this.members.save(this.members.create({ userId, workspaceId, role: 'agency_admin' }));
    return { workspaceId };
  }

  // ---- Snapshots ----
  async listSnapshots(userId: string, orgId: string) {
    await this.assertAccess(userId, orgId);
    return this.snapshots.find({ where: { organizationId: orgId }, select: ['id', 'name', 'summary', 'sourceWorkspaceId', 'createdAt'], order: { createdAt: 'DESC' } });
  }

  async createSnapshot(userId: string, orgId: string, dto: CreateSnapshotDto) {
    await this.assertAccess(userId, orgId);
    await this.workspaceInOrg(orgId, dto.sourceWorkspaceId);
    const content = await this.exportContent(dto.sourceWorkspaceId);
    const summary = Object.fromEntries(Object.entries(content).map(([k, v]) => [k, (v as any[]).length]));
    const s = await this.snapshots.save(this.snapshots.create({ organizationId: orgId, name: dto.name, sourceWorkspaceId: dto.sourceWorkspaceId, content, summary }));
    return { id: s.id, name: s.name, summary };
  }

  async deleteSnapshot(userId: string, orgId: string, id: string) {
    await this.assertAccess(userId, orgId);
    const res = await this.snapshots.softDelete({ id, organizationId: orgId });
    if (!res.affected) throw new NotFoundException('Snapshot not found');
    return { id };
  }

  async applySnapshot(userId: string, orgId: string, id: string, dto: ApplySnapshotDto) {
    await this.assertAccess(userId, orgId);
    await this.workspaceInOrg(orgId, dto.workspaceId);
    const s = await this.snapshots.findOne({ where: { id, organizationId: orgId } });
    if (!s) throw new NotFoundException('Snapshot not found');
    const imported = await this.ds.transaction((tx) => this.importContent(tx, dto.workspaceId, s.content));
    await this.activity.record(dto.workspaceId, 'snapshot.applied', `Snapshot "${s.name}" applied`, { userId });
    return { imported };
  }

  private async exportContent(ws: string) {
    const m = this.ds.manager;
    const strip = <T extends Record<string, any>>(row: T) => {
      const { workspaceId, createdAt, updatedAt, deletedAt, ...rest } = row as any;
      return rest;
    };
    const [pipelines, workflows, forms, calendars, customFields, sites, courses] = await Promise.all([
      m.find(Pipeline, { where: { workspaceId: ws }, relations: { stages: true }, order: { createdAt: 'ASC' } }),
      m.find(Workflow, { where: { workspaceId: ws } }),
      m.find(Form, { where: { workspaceId: ws } }),
      m.find(Calendar, { where: { workspaceId: ws } }),
      m.find(CustomField, { where: { workspaceId: ws } }),
      m.find(Site, { where: { workspaceId: ws } }),
      m.find(Course, { where: { workspaceId: ws } }),
    ]);
    return {
      pipelines: pipelines.map((p) => ({ ...strip(p), stages: p.stages.sort((a, b) => a.position - b.position).map(strip) })),
      workflows: workflows.map((w) => ({ ...strip(w), runCount: 0 })),
      forms: forms.map((f) => ({ ...strip(f), submissionCount: 0 })),
      calendars: calendars.map(strip),
      customFields: customFields.map(strip),
      sites: sites.map((s) => ({ ...strip(s), stats: {} })),
      courses: courses.map(strip),
    };
  }

  /** Recreates snapshot content in a workspace with fresh ids; references are remapped. */
  private async importContent(tx: EntityManager, ws: string, content: Record<string, any[]>) {
    const map = new Map<string, string>();
    const fresh = (old: string) => {
      const id = randomUUID();
      map.set(old, id);
      return id;
    };
    const counts: Record<string, number> = {};

    // Pre-assign new ids so later rows can reference earlier ones.
    for (const p of content.pipelines ?? []) {
      fresh(p.id);
      for (const s of p.stages ?? []) fresh(s.id);
    }
    for (const key of ['forms', 'calendars', 'customFields', 'workflows', 'sites', 'courses']) for (const r of content[key] ?? []) fresh(r.id);

    for (const p of content.pipelines ?? []) {
      await tx.insert(Pipeline, { id: map.get(p.id), workspaceId: ws, name: p.name });
      for (const s of p.stages ?? []) {
        await tx.insert(PipelineStage, { id: map.get(s.id), workspaceId: ws, pipelineId: map.get(p.id), name: s.name, position: s.position, probability: s.probability });
      }
    }
    counts.pipelines = content.pipelines?.length ?? 0;

    const existingKeys = new Set((await tx.find(CustomField, { where: { workspaceId: ws } })).map((f) => f.key));
    counts.customFields = 0;
    for (const f of content.customFields ?? []) {
      if (existingKeys.has(f.key)) continue;
      await tx.insert(CustomField, { id: map.get(f.id), workspaceId: ws, key: f.key, label: f.label, type: f.type, options: f.options, position: f.position });
      counts.customFields++;
    }
    for (const f of content.forms ?? []) {
      await tx.insert(Form, { ...f, id: map.get(f.id), workspaceId: ws, slug: makeSlug(f.name), submissionCount: 0 });
    }
    counts.forms = content.forms?.length ?? 0;
    for (const c of content.calendars ?? []) {
      await tx.insert(Calendar, { ...c, id: map.get(c.id), workspaceId: ws, slug: makeSlug(c.name) });
    }
    counts.calendars = content.calendars?.length ?? 0;
    for (const c of content.courses ?? []) {
      await tx.insert(Course, { ...c, id: map.get(c.id), workspaceId: ws });
    }
    counts.courses = content.courses?.length ?? 0;
    // Workflows come in unpublished so nothing fires until the account is ready.
    for (const w of content.workflows ?? []) {
      const remapped = remapIds({ triggerConfig: w.triggerConfig, steps: w.steps }, map);
      await tx.insert(Workflow, { id: map.get(w.id), workspaceId: ws, name: w.name, triggerType: w.triggerType, triggerConfig: remapped.triggerConfig, steps: remapped.steps as any, isPublished: false, runCount: 0 });
    }
    counts.workflows = content.workflows?.length ?? 0;
    for (const s of content.sites ?? []) {
      await tx.insert(Site, { id: map.get(s.id), workspaceId: ws, name: s.name, slug: makeSlug(s.name), kind: s.kind, theme: s.theme, pages: remapIds(s.pages, map), isPublished: false, stats: {} });
    }
    counts.sites = content.sites?.length ?? 0;
    return counts;
  }
}

@Controller('agency')
@SkipTenant()
export class AgencyController {
  constructor(private readonly svc: AgencyService) {}

  @Get('organizations')
  organizations(@CurrentUser('id') userId: string) {
    if (!userId) throw new ForbiddenException('Agency console requires a user session');
    return this.svc.organizations(userId);
  }

  @Get(':orgId/sub-accounts')
  list(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.svc.subAccounts(userId, orgId);
  }

  @Post(':orgId/sub-accounts')
  create(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateSubAccountDto) {
    return this.svc.createSubAccount(userId, orgId, dto);
  }

  @Put(':orgId/sub-accounts/:workspaceId')
  rename(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('workspaceId', ParseUUIDPipe) ws: string, @Body() dto: RenameDto) {
    return this.svc.rename(userId, orgId, ws, dto);
  }

  @Post(':orgId/sub-accounts/:workspaceId/join')
  join(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('workspaceId', ParseUUIDPipe) ws: string) {
    return this.svc.join(userId, orgId, ws);
  }

  @Get(':orgId/snapshots')
  snapshots(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.svc.listSnapshots(userId, orgId);
  }

  @Post(':orgId/snapshots')
  createSnapshot(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateSnapshotDto) {
    return this.svc.createSnapshot(userId, orgId, dto);
  }

  @Delete(':orgId/snapshots/:id')
  deleteSnapshot(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteSnapshot(userId, orgId, id);
  }

  @Post(':orgId/snapshots/:id/apply')
  apply(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplySnapshotDto) {
    return this.svc.applySnapshot(userId, orgId, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceMember, Workspace, Organization, Snapshot])],
  controllers: [AgencyController],
  providers: [AgencyService],
  exports: [AgencyService],
})
export class AgencyModule {}
