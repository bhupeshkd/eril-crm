import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Pipeline } from '../database/entities/pipeline.entity';
import { PipelineStage } from '../database/entities/pipeline-stage.entity';
import { Opportunity } from '../database/entities/opportunity.entity';
import { Contact } from '../database/entities/contact.entity';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import {
  CreateOpportunityDto,
  CreatePipelineDto,
  MoveOpportunityDto,
  StageInputDto,
  UpdateOpportunityDto,
  UpdatePipelineDto,
} from './dto';

export const DEFAULT_STAGES: StageInputDto[] = [
  { name: 'Lead', probability: 10 },
  { name: 'Qualified', probability: 30 },
  { name: 'Proposal', probability: 50 },
  { name: 'Negotiation', probability: 75 },
  { name: 'Won', probability: 100 },
  { name: 'Lost', probability: 0 },
];

@Injectable()
export class SalesService {
  constructor(
    @InjectRepository(Pipeline) private readonly pipelines: Repository<Pipeline>,
    @InjectRepository(PipelineStage) private readonly stages: Repository<PipelineStage>,
    @InjectRepository(Opportunity) private readonly opps: Repository<Opportunity>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly ds: DataSource,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  // ---- Pipelines -----------------------------------------------------------
  async listPipelines(workspaceId: string) {
    let list = await this.findPipelines(workspaceId);
    if (list.length === 0) {
      await this.createPipeline(workspaceId, { name: 'Sales Pipeline' });
      list = await this.findPipelines(workspaceId);
    }
    return list;
  }

  private findPipelines(workspaceId: string) {
    return this.pipelines.find({
      where: { workspaceId },
      relations: { stages: true },
      order: { createdAt: 'ASC', stages: { position: 'ASC' } },
    });
  }

  async getPipeline(workspaceId: string, id: string) {
    const p = await this.pipelines.findOne({
      where: { id, workspaceId },
      relations: { stages: true },
      order: { stages: { position: 'ASC' } },
    });
    if (!p) throw new NotFoundException('Pipeline not found');
    return p;
  }

  async createPipeline(workspaceId: string, dto: CreatePipelineDto) {
    const stages = dto.stages?.length ? dto.stages : DEFAULT_STAGES;
    const pipeline = await this.pipelines.save(
      this.pipelines.create({
        workspaceId,
        name: dto.name,
        stages: stages.map((s, i) =>
          this.stages.create({ workspaceId, name: s.name, probability: s.probability ?? 0, position: i }),
        ),
      }),
    );
    return this.getPipeline(workspaceId, pipeline.id);
  }

  async updatePipeline(workspaceId: string, id: string, dto: UpdatePipelineDto) {
    const pipeline = await this.getPipeline(workspaceId, id);
    await this.ds.transaction(async (tx) => {
      if (dto.name) await tx.update(Pipeline, { id }, { name: dto.name });
      if (dto.stages) {
        const keepIds = dto.stages.map((s) => s.id).filter(Boolean);
        const removed = pipeline.stages.filter((s) => !keepIds.includes(s.id));
        if (removed.length) {
          const inUse = await tx.count(Opportunity, {
            where: { stageId: In(removed.map((s) => s.id)) },
          });
          if (inUse > 0) {
            throw new BadRequestException(
              'Cannot remove a stage that still has opportunities; move them first',
            );
          }
          await tx.delete(PipelineStage, { id: In(removed.map((s) => s.id)) });
        }
        for (const [i, s] of dto.stages.entries()) {
          if (s.id) {
            if (!pipeline.stages.some((x) => x.id === s.id)) {
              throw new BadRequestException(`Stage ${s.id} does not belong to this pipeline`);
            }
            await tx.update(PipelineStage, { id: s.id }, { name: s.name, probability: s.probability ?? 0, position: i });
          } else {
            await tx.save(
              tx.create(PipelineStage, { workspaceId, pipelineId: id, name: s.name, probability: s.probability ?? 0, position: i }),
            );
          }
        }
      }
    });
    return this.getPipeline(workspaceId, id);
  }

  async deletePipeline(workspaceId: string, id: string) {
    const p = await this.getPipeline(workspaceId, id);
    const count = await this.pipelines.count({ where: { workspaceId } });
    if (count <= 1) throw new BadRequestException('A workspace needs at least one pipeline');
    await this.ds.transaction(async (tx) => {
      await tx.softDelete(Opportunity, { pipelineId: id });
      await tx.softDelete(PipelineStage, { pipelineId: id });
      await tx.softDelete(Pipeline, { id: p.id });
    });
    return { id };
  }

  /** Kanban board: stages with their ordered opportunities and totals. */
  async board(workspaceId: string, pipelineId: string) {
    const pipeline = await this.getPipeline(workspaceId, pipelineId);
    const opps = await this.opps.find({
      where: { workspaceId, pipelineId },
      relations: { contact: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      stages: pipeline.stages.map((s) => {
        const items = opps.filter((o) => o.stageId === s.id);
        return {
          ...s,
          opportunities: items,
          totalValue: items.reduce((sum, o) => sum + Number(o.value), 0),
        };
      }),
    };
  }

  // ---- Opportunities -------------------------------------------------------
  async getOpportunity(workspaceId: string, id: string) {
    const o = await this.opps.findOne({
      where: { id, workspaceId },
      relations: { contact: true, stage: true },
    });
    if (!o) throw new NotFoundException('Opportunity not found');
    return o;
  }

  async createOpportunity(
    workspaceId: string,
    dto: CreateOpportunityDto,
    userId?: string | null,
    meta: Record<string, any> = {},
  ) {
    const pipeline = await this.getPipeline(workspaceId, dto.pipelineId);
    const stage = dto.stageId
      ? pipeline.stages.find((s) => s.id === dto.stageId)
      : pipeline.stages[0];
    if (!stage) throw new BadRequestException('Stage does not belong to this pipeline');
    if (dto.contactId) await this.assertContact(workspaceId, dto.contactId);

    const position = await this.opps.count({ where: { workspaceId, stageId: stage.id } });
    const opp = await this.opps.save(
      this.opps.create({
        workspaceId,
        title: dto.title,
        value: dto.value ?? 0,
        probability: dto.probability ?? null,
        status: dto.status ?? statusForStage(stage.name),
        contactId: dto.contactId ?? null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        position,
        expectedCloseDate: dto.expectedCloseDate ?? null,
      }),
    );
    await this.activity.record(workspaceId, 'opportunity.created', `Deal "${opp.title}" created in ${stage.name}`, {
      entityType: 'opportunity',
      entityId: opp.id,
      userId,
    });
    this.events.emit({
      type: 'opportunity.created',
      workspaceId,
      userId,
      contactId: opp.contactId,
      payload: { ...meta, opportunity: opp, stage },
    });
    return this.getOpportunity(workspaceId, opp.id);
  }

  async updateOpportunity(workspaceId: string, id: string, dto: UpdateOpportunityDto) {
    const opp = await this.getOpportunity(workspaceId, id);
    if (dto.contactId) await this.assertContact(workspaceId, dto.contactId);
    const { contact, stage, ...rest } = opp;
    await this.opps.save({ ...rest, ...dto });
    return this.getOpportunity(workspaceId, id);
  }

  async deleteOpportunity(workspaceId: string, id: string) {
    const opp = await this.getOpportunity(workspaceId, id);
    await this.opps.softDelete({ id: opp.id });
    await this.compact(opp.stageId);
    return { id };
  }

  /** Drag-and-drop: move to a stage and position, re-indexing both columns. */
  async moveOpportunity(workspaceId: string, id: string, dto: MoveOpportunityDto, userId?: string | null) {
    const opp = await this.getOpportunity(workspaceId, id);
    const pipeline = await this.getPipeline(workspaceId, opp.pipelineId);
    const ref = dto.stageId ?? dto.stage;
    if (!ref) throw new BadRequestException('stageId is required');
    const target = pipeline.stages.find(
      (s) => s.id === ref || s.name.toLowerCase() === ref.toLowerCase(),
    );
    if (!target) throw new BadRequestException('Stage does not belong to this pipeline');

    const fromStage = opp.stage;
    await this.ds.transaction(async (tx) => {
      const column = await tx.find(Opportunity, {
        where: { stageId: target.id, id: Not(opp.id) },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
      const index = Math.min(dto.position ?? column.length, column.length);
      column.splice(index, 0, opp);
      for (const [i, o] of column.entries()) {
        await tx.update(Opportunity, { id: o.id }, { position: i });
      }
      const patch: Partial<Opportunity> = { stageId: target.id };
      if (fromStage.id !== target.id) patch.status = statusForStage(target.name, opp.status);
      await tx.update(Opportunity, { id: opp.id }, patch);
    });
    if (fromStage.id !== target.id) {
      await this.compact(fromStage.id);
      await this.activity.record(
        workspaceId,
        'opportunity.stage_changed',
        `Deal "${opp.title}" moved from ${fromStage.name} to ${target.name}`,
        { entityType: 'opportunity', entityId: opp.id, userId },
      );
      this.events.emit({
        type: 'opportunity.stage_changed',
        workspaceId,
        userId,
        contactId: opp.contactId,
        payload: { opportunity: { ...opp, stageId: target.id }, fromStage, toStage: target },
      });
    }
    return this.getOpportunity(workspaceId, id);
  }

  private async compact(stageId: string) {
    const rows = await this.opps.find({ where: { stageId }, order: { position: 'ASC', createdAt: 'ASC' } });
    for (const [i, o] of rows.entries()) {
      if (o.position !== i) await this.opps.update({ id: o.id }, { position: i });
    }
  }

  private async assertContact(workspaceId: string, contactId: string) {
    const exists = await this.contacts.exist({ where: { id: contactId, workspaceId } });
    if (!exists) throw new NotFoundException('Contact not found');
  }
}

function statusForStage(stageName: string, current = 'open') {
  const n = stageName.toLowerCase();
  if (n === 'won' || n === 'closed won') return 'won';
  if (n === 'lost' || n === 'closed lost') return 'lost';
  return current === 'won' || current === 'lost' ? 'open' : current;
}
