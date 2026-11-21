import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { WORKFLOW_ACTIONS, Workflow, WorkflowStep } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { Contact } from '../database/entities/contact.entity';
import { CONDITION_OPERATORS } from './conditions';
import { WorkflowEngine } from './workflow-engine.service';
import { CreateWorkflowDto, TriggerWorkflowDto, UpdateWorkflowDto } from './dto';

const MAX_DEPTH = 8;
const MAX_TOTAL_STEPS = 100;

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(Workflow) private readonly workflows: Repository<Workflow>,
    @InjectRepository(WorkflowRun) private readonly runs: Repository<WorkflowRun>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly engine: WorkflowEngine,
  ) {}

  list(workspaceId: string) {
    return this.workflows.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
  }

  async get(workspaceId: string, id: string) {
    const wf = await this.workflows.findOne({ where: { id, workspaceId } });
    if (!wf) throw new NotFoundException('Workflow not found');
    return wf;
  }

  create(workspaceId: string, dto: CreateWorkflowDto) {
    const steps = this.validateSteps(dto.steps ?? []);
    return this.workflows.save(
      this.workflows.create({
        workspaceId,
        name: dto.name,
        triggerType: dto.triggerType ?? 'manual',
        triggerConfig: dto.triggerConfig ?? {},
        steps,
        isPublished: dto.isPublished ?? false,
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateWorkflowDto) {
    const wf = await this.get(workspaceId, id);
    if (dto.name !== undefined) wf.name = dto.name;
    if (dto.triggerType !== undefined) wf.triggerType = dto.triggerType;
    if (dto.triggerConfig !== undefined) wf.triggerConfig = dto.triggerConfig;
    if (dto.steps !== undefined) wf.steps = this.validateSteps(dto.steps);
    if (dto.isPublished !== undefined) wf.isPublished = dto.isPublished;
    return this.workflows.save(wf);
  }

  async remove(workspaceId: string, id: string) {
    const wf = await this.get(workspaceId, id);
    await this.workflows.softRemove(wf);
    return { id };
  }

  async trigger(workspaceId: string, id: string, dto: TriggerWorkflowDto, userId?: string) {
    const wf = await this.get(workspaceId, id);
    if (dto.contactId) {
      const ok = await this.contacts.exist({ where: { id: dto.contactId, workspaceId } });
      if (!ok) throw new NotFoundException('Contact not found');
    }
    return this.engine.execute(wf, {
      type: 'manual',
      workspaceId,
      userId,
      contactId: dto.contactId ?? null,
      payload: { data: dto.data ?? {} },
    });
  }

  listRuns(workspaceId: string, workflowId: string) {
    return this.runs.find({
      where: { workspaceId, workflowId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Structural validation of the step tree; assigns ids where missing. */
  validateSteps(steps: any[]): WorkflowStep[] {
    let count = 0;
    const walk = (list: any, depth: number, path: string): WorkflowStep[] => {
      if (!Array.isArray(list)) throw new BadRequestException(`${path} must be an array`);
      if (depth > MAX_DEPTH) throw new BadRequestException('Workflow is nested too deeply');
      return list.map((raw, i) => {
        const where = `${path}[${i}]`;
        if (++count > MAX_TOTAL_STEPS) throw new BadRequestException('Too many steps');
        if (!raw || typeof raw !== 'object') throw new BadRequestException(`${where} must be an object`);
        if (!WORKFLOW_ACTIONS.includes(raw.type)) {
          throw new BadRequestException(`${where}.type "${raw.type}" is not supported`);
        }
        const config = raw.config && typeof raw.config === 'object' ? raw.config : {};
        const step: WorkflowStep = { id: String(raw.id || randomUUID()), type: raw.type, config };
        if (raw.type === 'condition') {
          if (!config.field) throw new BadRequestException(`${where}: condition needs a field`);
          if (!CONDITION_OPERATORS.includes(config.operator)) {
            throw new BadRequestException(`${where}: unknown operator "${config.operator}"`);
          }
          step.then = walk(raw.then ?? [], depth + 1, `${where}.then`);
          step.else = walk(raw.else ?? [], depth + 1, `${where}.else`);
        }
        return step;
      });
    };
    return walk(steps, 0, 'steps');
  }
}
