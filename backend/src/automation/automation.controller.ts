import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { WORKFLOW_ACTIONS, WORKFLOW_TRIGGERS } from '../database/entities/workflow.entity';
import { CONDITION_OPERATORS } from './conditions';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto, TriggerWorkflowDto, UpdateWorkflowDto } from './dto';

@Controller('automation')
export class AutomationController {
  constructor(private readonly workflows: WorkflowsService) {}

  /** Builder metadata: available triggers, actions and operators. */
  @Get('meta')
  @Permissions('workflows:read')
  meta() {
    return { triggers: WORKFLOW_TRIGGERS, actions: WORKFLOW_ACTIONS, operators: CONDITION_OPERATORS };
  }

  @Get('workflows')
  @Permissions('workflows:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.workflows.list(ws);
  }

  @Post('workflows')
  @Permissions('workflows:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(ws, dto);
  }

  @Get('workflows/:id')
  @Permissions('workflows:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.get(ws, id);
  }

  @Put('workflows/:id')
  @Permissions('workflows:write')
  update(
    @Tenant('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflows.update(ws, id, dto);
  }

  @Delete('workflows/:id')
  @Permissions('workflows:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.remove(ws, id);
  }

  @Post('workflows/:id/trigger')
  @Permissions('workflows:execute')
  trigger(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriggerWorkflowDto,
  ) {
    return this.workflows.trigger(ws, id, dto, userId);
  }

  @Get('workflows/:id/runs')
  @Permissions('workflows:read')
  runs(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.listRuns(ws, id);
  }
}
