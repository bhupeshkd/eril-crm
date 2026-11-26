import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Ip,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { FORM_FIELD_TYPES, Form, FormField, FormSettings, FormSubmission } from '../database/entities/form.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';

class FormFieldsDto {
  @IsOptional() @IsIn(['form', 'survey']) kind?: 'form' | 'survey';
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsArray() fields?: FormField[];
  @IsOptional() @IsObject() settings?: FormSettings;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateFormDto extends FormFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
}
export class UpdateFormDto extends FormFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}
export class SubmitFormDto {
  @IsObject() data: Record<string, any>;
  /** Marketing attribution captured on the page ({ first, last } touches). */
  @IsOptional() @IsObject() attribution?: Record<string, unknown>;
}

const DEFAULT_FIELDS: FormField[] = [
  { key: 'first_name', label: 'First name', type: 'text', required: true, mapTo: 'firstName' },
  { key: 'last_name', label: 'Last name', type: 'text', mapTo: 'lastName' },
  { key: 'email', label: 'Email', type: 'email', required: true, mapTo: 'email' },
  { key: 'phone', label: 'Phone', type: 'phone', mapTo: 'phone' },
  { key: 'message', label: 'How can we help?', type: 'textarea', mapTo: 'none' },
];

const MAP_TARGETS = ['firstName', 'lastName', 'email', 'phone', 'companyName', 'none'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFields(fields: any[]): FormField[] {
  if (!Array.isArray(fields)) throw new BadRequestException('fields must be an array');
  if (fields.length > 100) throw new BadRequestException('A form can have at most 100 fields');
  const keys = new Set<string>();
  return fields.map((f, i) => {
    const where = `fields[${i}]`;
    if (!f || typeof f !== 'object') throw new BadRequestException(`${where} must be an object`);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(f.key ?? '')) throw new BadRequestException(`${where}.key must be snake_case`);
    if (keys.has(f.key)) throw new BadRequestException(`Duplicate field key "${f.key}"`);
    keys.add(f.key);
    if (!f.label) throw new BadRequestException(`${where}.label is required`);
    if (!FORM_FIELD_TYPES.includes(f.type)) throw new BadRequestException(`${where}.type "${f.type}" is not supported`);
    const mapTo = f.mapTo || 'none';
    if (!MAP_TARGETS.includes(mapTo) && !/^custom:[a-z][a-z0-9_]{0,63}$/.test(mapTo)) {
      throw new BadRequestException(`${where}.mapTo "${mapTo}" is not valid`);
    }
    const needsOptions = ['select', 'radio'].includes(f.type);
    const options = Array.isArray(f.options) ? f.options.map(String).filter(Boolean) : [];
    if (needsOptions && options.length === 0) throw new BadRequestException(`${where} needs at least one option`);
    return {
      key: f.key,
      label: String(f.label).slice(0, 200),
      type: f.type,
      required: !!f.required,
      placeholder: f.placeholder ? String(f.placeholder).slice(0, 200) : undefined,
      options: needsOptions || f.type === 'checkbox' ? options : undefined,
      mapTo,
    };
  });
}

/** Validates a public submission against the form definition. Returns cleaned data. */
export function validateSubmission(fields: FormField[], data: Record<string, any>) {
  const clean: Record<string, any> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    let v = data?.[f.key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (f.type === 'checkbox' && !f.options?.length && v !== true);
    if (empty) {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    if (f.type === 'email' && !EMAIL_RE.test(String(v))) errors[f.key] = 'Enter a valid email address';
    else if (f.type === 'number' && Number.isNaN(Number(v))) errors[f.key] = 'Enter a number';
    else if (['select', 'radio'].includes(f.type) && !f.options?.includes(String(v))) errors[f.key] = 'Choose one of the options';
    else if (f.type === 'checkbox' && f.options?.length && (!Array.isArray(v) || v.some((x) => !f.options.includes(String(x))))) {
      errors[f.key] = 'Invalid selection';
    } else if (typeof v === 'string' && v.length > 5000) errors[f.key] = 'Too long';
    clean[f.key] = f.type === 'number' ? Number(v) : v;
  }
  return { clean, errors };
}

@Injectable()
export class FormsService {
  constructor(
    @InjectRepository(Form) private readonly forms: Repository<Form>,
    @InjectRepository(FormSubmission) private readonly subs: Repository<FormSubmission>,
    private readonly contacts: ContactsService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  list(workspaceId: string) {
    return this.forms.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
  }

  async get(workspaceId: string, id: string) {
    const f = await this.forms.findOne({ where: { id, workspaceId } });
    if (!f) throw new NotFoundException('Form not found');
    return f;
  }

  create(workspaceId: string, dto: CreateFormDto) {
    return this.forms.save(
      this.forms.create({
        workspaceId,
        name: dto.name,
        slug: makeSlug(dto.name),
        kind: dto.kind ?? 'form',
        description: dto.description ?? '',
        fields: validateFields(dto.fields ?? DEFAULT_FIELDS),
        settings: dto.settings ?? { submitText: 'Submit', successMessage: 'Thanks! We will be in touch shortly.' },
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateFormDto) {
    const f = await this.get(workspaceId, id);
    if (dto.name !== undefined) f.name = dto.name;
    if (dto.kind !== undefined) f.kind = dto.kind;
    if (dto.description !== undefined) f.description = dto.description;
    if (dto.fields !== undefined) f.fields = validateFields(dto.fields);
    if (dto.settings !== undefined) f.settings = dto.settings;
    if (dto.isActive !== undefined) f.isActive = dto.isActive;
    return this.forms.save(f);
  }

  async remove(workspaceId: string, id: string) {
    const f = await this.get(workspaceId, id);
    await this.forms.softRemove(f);
    return { id };
  }

  async submissions(workspaceId: string, formId: string) {
    await this.get(workspaceId, formId);
    return this.subs.find({ where: { workspaceId, formId }, relations: { contact: true }, order: { createdAt: 'DESC' }, take: 500 });
  }

  async publicForm(slug: string) {
    const f = await this.forms.findOne({ where: { slug, isActive: true } });
    if (!f) throw new NotFoundException('This form does not exist or is turned off');
    return f;
  }

  async submit(slug: string, data: Record<string, any>, ip?: string, attribution?: unknown) {
    const form = await this.publicForm(slug);
    const { clean, errors } = validateSubmission(form.fields, data);
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Please fix the highlighted fields', errors });

    const contactData: Record<string, any> = { customFields: {} };
    for (const f of form.fields) {
      if (clean[f.key] === undefined || !f.mapTo || f.mapTo === 'none') continue;
      if (f.mapTo.startsWith('custom:')) contactData.customFields[f.mapTo.slice(7)] = clean[f.key];
      else contactData[f.mapTo] = String(clean[f.key]);
    }
    let contactId: string | null = null;
    if (contactData.email || contactData.phone) {
      const { contact } = await this.contacts.upsert(form.workspaceId, {
        ...contactData,
        tags: form.settings?.tags ?? [],
        source: `form:${form.name}`.slice(0, 50),
        attribution,
      });
      contactId = contact.id;
    }
    const sub = await this.subs.save(
      this.subs.create({ workspaceId: form.workspaceId, formId: form.id, contactId, data: clean, ipAddress: ip ?? null }),
    );
    await this.forms.increment({ id: form.id }, 'submissionCount', 1);
    await this.activity.record(form.workspaceId, 'form.submitted', `New ${form.kind} submission: ${form.name}`, {
      entityType: 'form',
      entityId: form.id,
    });
    this.events.emit({
      type: 'form.submitted',
      workspaceId: form.workspaceId,
      contactId,
      payload: { form: { id: form.id, name: form.name }, submission: clean, submissionId: sub.id },
    });
    return {
      ok: true,
      message: form.settings?.successMessage || 'Thanks! Your response has been received.',
      redirectUrl: form.settings?.redirectUrl || null,
    };
  }

  publicUrl(f: Form) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/f/${f.slug}`;
  }
}

@Controller('forms')
export class FormsController {
  constructor(private readonly svc: FormsService) {}

  @Get()
  @Permissions('forms:read')
  async list(@Tenant('workspaceId') ws: string) {
    return (await this.svc.list(ws)).map((f) => ({ ...f, publicUrl: this.svc.publicUrl(f) }));
  }

  @Post()
  @Permissions('forms:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateFormDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('forms:read')
  async get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.svc.get(ws, id);
    return { ...f, publicUrl: this.svc.publicUrl(f) };
  }

  @Put(':id')
  @Permissions('forms:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('forms:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Get(':id/submissions')
  @Permissions('forms:read_submissions')
  submissions(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submissions(ws, id);
  }
}

@Controller('public/forms')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicFormsController {
  constructor(private readonly svc: FormsService) {}

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const f = await this.svc.publicForm(slug);
    return { name: f.name, kind: f.kind, description: f.description, fields: f.fields, settings: { submitText: f.settings?.submitText, color: f.settings?.color } };
  }

  @Post(':slug/submit')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Param('slug') slug: string, @Body() dto: SubmitFormDto, @Ip() ip: string) {
    return this.svc.submit(slug, dto.data, ip, dto.attribution);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Form, FormSubmission]), CrmModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService],
})
export class FormsModule {}
