import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { SalesService } from './sales.service';
import {
  CreateOpportunityDto,
  CreatePipelineDto,
  MoveOpportunityDto,
  UpdateOpportunityDto,
  UpdatePipelineDto,
} from './dto';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('pipelines')
  @Permissions('pipelines:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.sales.listPipelines(ws);
  }

  @Post('pipelines')
  @Permissions('pipelines:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreatePipelineDto) {
    return this.sales.createPipeline(ws, dto);
  }

  @Get('pipelines/:id')
  @Permissions('pipelines:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getPipeline(ws, id);
  }

  @Put('pipelines/:id')
  @Permissions('pipelines:write')
  update(
    @Tenant('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.sales.updatePipeline(ws, id, dto);
  }

  @Delete('pipelines/:id')
  @Permissions('pipelines:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.deletePipeline(ws, id);
  }

  @Get('pipelines/:id/opportunities')
  @Permissions('opportunities:read')
  board(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.board(ws, id);
  }

  @Post('opportunities')
  @Permissions('opportunities:write')
  createOpp(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.sales.createOpportunity(ws, dto, userId);
  }

  @Get('opportunities/:id')
  @Permissions('opportunities:read')
  getOpp(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getOpportunity(ws, id);
  }

  @Put('opportunities/:id')
  @Permissions('opportunities:write')
  updateOpp(
    @Tenant('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.sales.updateOpportunity(ws, id, dto);
  }

  @Put('opportunities/:id/stage')
  @Permissions('opportunities:write')
  move(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveOpportunityDto,
  ) {
    return this.sales.moveOpportunity(ws, id, dto, userId);
  }

  @Delete('opportunities/:id')
  @Permissions('opportunities:delete')
  deleteOpp(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.deleteOpportunity(ws, id);
  }
}
