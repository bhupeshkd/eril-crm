import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsDateString,
} from 'class-validator';

export class StageInputDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;
}

export class CreatePipelineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageInputDto)
  stages?: StageInputDto[];
}

export class UpdatePipelineDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  /** Full ordered stage list; stages missing from the list are deleted. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageInputDto)
  stages?: StageInputDto[];
}

class OpportunityFieldsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsIn(['open', 'won', 'lost'])
  status?: string;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string | null;
}

export class CreateOpportunityDto extends OpportunityFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsUUID()
  pipelineId: string;

  /** Defaults to the pipeline's first stage. */
  @IsOptional()
  @IsUUID()
  stageId?: string;
}

export class UpdateOpportunityDto extends OpportunityFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;
}

export class MoveOpportunityDto {
  /** Target stage id. `stage` (name or id) is accepted for API-spec compatibility. */
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  /** Zero-based index within the target column. Defaults to the end. */
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
