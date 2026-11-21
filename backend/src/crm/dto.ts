import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CONTACT_STATUSES } from '../database/entities/contact.entity';

const emptyToNull = ({ value }) => (value === '' ? null : value);

class ContactFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((o) => o.email !== null)
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsIn(CONTACT_STATUSES as unknown as string[])
  status?: (typeof CONTACT_STATUSES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((o) => o.companyId !== null)
  @IsUUID()
  companyId?: string | null;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;

  @IsOptional()
  @IsBoolean()
  dnd?: boolean;

  /** Convenience: find-or-create a company by name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;
}

export class CreateContactDto extends ContactFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;
}

export class UpdateContactDto extends ContactFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;
}

export class ContactQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(CONTACT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** Apply a saved smart list's filters. */
  @IsOptional()
  @IsUUID()
  listId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  createdWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

class CompanyFieldsDto {
  @IsOptional()
  @IsString()
  domain?: string | null;

  @IsOptional()
  @IsString()
  industry?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;
}

export class CreateCompanyDto extends CompanyFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

export class UpdateCompanyDto extends CompanyFieldsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}

export class BulkContactsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  ids: string[];

  @IsIn(['add_tag', 'remove_tag', 'set_status', 'delete', 'set_dnd'])
  action: 'add_tag' | 'remove_tag' | 'set_status' | 'delete' | 'set_dnd';

  @IsOptional()
  value?: string | boolean;
}

export class ImportContactsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  rows: Array<Record<string, string>>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
