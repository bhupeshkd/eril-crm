import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { WORKFLOW_TRIGGERS, WorkflowStep } from '../database/entities/workflow.entity';

class WorkflowFieldsDto {
  @IsOptional()
  @IsIn(WORKFLOW_TRIGGERS as unknown as string[])
  triggerType?: (typeof WORKFLOW_TRIGGERS)[number];

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, any>;

  /** Validated structurally by WorkflowsService.validateSteps. */
  @IsOptional()
  @IsArray()
  steps?: WorkflowStep[];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class CreateWorkflowDto extends WorkflowFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

export class UpdateWorkflowDto extends WorkflowFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}

export class TriggerWorkflowDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}
