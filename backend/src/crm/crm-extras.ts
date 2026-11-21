import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { LessThan, Repository } from 'typeorm';
import { CUSTOM_FIELD_TYPES, ContactNote, CustomField, Task } from '../database/entities/crm-extras.entity';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { ActivityService } from '../events/activity.service';
import { EventsService } from '../events/events.service';
import { ContactsService } from './contacts.service';
import { BulkContactsDto, ImportContactsDto } from './dto';

// ---- DTOs -------------------------------------------------------------------
export class CustomFieldDto {
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,63}$/, { message: 'key must be lowercase letters, numbers and underscores' })
  key?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @IsIn(CUSTOM_FIELD_TYPES as unknown as string[])
  type: (typeof CUSTOM_FIELD_TYPES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class NoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body: string;
}

export class TaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

// ---- Service ----------------------------------------------------------------
@Injectable()
export class CrmExtrasService {
  constructor(
    @InjectRepository(CustomField) private readonly fields: Repository<CustomField>,
    @InjectRepository(ContactNote) private readonly notes: Repository<ContactNote>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
  ) {}

  listFields(workspaceId: string) {
    return this.fields.find({ where: { workspaceId }, order: { position: 'ASC', createdAt: 'ASC' } });
  }

  async createField(workspaceId: string, dto: CustomFieldDto) {
    const key = dto.key || slugKey(dto.label);
    if (!key) throw new BadRequestException('Could not derive a key from the label');
    if (await this.fields.exist({ where: { workspaceId, key } })) {
      throw new ConflictException(`A field with key "${key}" already exists`);
    }
    const position = await this.fields.count({ where: { workspaceId } });
    return this.fields.save(this.fields.create({ workspaceId, key, label: dto.label, type: dto.type, options: dto.options ?? [], position }));
  }

  async updateField(workspaceId: string, id: string, dto: CustomFieldDto) {
    const f = await this.fields.findOne({ where: { id, workspaceId } });
    if (!f) throw new NotFoundException('Custom field not found');
    Object.assign(f, { label: dto.label, type: dto.type, options: dto.options ?? f.options });
    return this.fields.save(f);
  }

  async deleteField(workspaceId: string, id: string) {
    const res = await this.fields.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Custom field not found');
    return { id };
  }

  private async assertContact(workspaceId: string, contactId: string) {
    if (!(await this.contacts.exist({ where: { id: contactId, workspaceId } }))) {
      throw new NotFoundException('Contact not found');
    }
  }

  async listNotes(workspaceId: string, contactId: string) {
    await this.assertContact(workspaceId, contactId);
    return this.notes.find({ where: { workspaceId, contactId }, order: { createdAt: 'DESC' } });
  }

  async addNote(workspaceId: string, contactId: string, body: string, userId?: string | null) {
    await this.assertContact(workspaceId, contactId);
    const note = await this.notes.save(this.notes.create({ workspaceId, contactId, body, userId: userId ?? null }));
    await this.activity.record(workspaceId, 'note.added', 'Note added to contact', { entityType: 'contact', entityId: contactId, userId });
    return note;
  }

  async deleteNote(workspaceId: string, id: string) {
    const res = await this.notes.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Note not found');
    return { id };
  }

  listTasks(workspaceId: string, q: { contactId?: string; status?: string }) {
    const where: any = { workspaceId };
    if (q.contactId) where.contactId = q.contactId;
    if (q.status === 'open') where.completed = false;
    if (q.status === 'done') where.completed = true;
    if (q.status === 'overdue') Object.assign(where, { completed: false, dueAt: LessThan(new Date()) });
    return this.tasks.find({ where, relations: { contact: true }, order: { completed: 'ASC', dueAt: 'ASC', createdAt: 'DESC' }, take: 500 });
  }

  async createTask(workspaceId: string, dto: TaskDto, userId?: string | null) {
    if (!dto.title) throw new BadRequestException('title is required');
    if (dto.contactId) await this.assertContact(workspaceId, dto.contactId);
    const task = await this.tasks.save(
      this.tasks.create({
        workspaceId,
        title: dto.title,
        description: dto.description ?? null,
        contactId: dto.contactId ?? null,
        assigneeId: dto.assigneeId ?? userId ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      }),
    );
    await this.activity.record(workspaceId, 'task.created', `Task "${task.title}" created`, { entityType: 'task', entityId: task.id, userId });
    return task;
  }

  async updateTask(workspaceId: string, id: string, dto: TaskDto, userId?: string | null) {
    const t = await this.tasks.findOne({ where: { id, workspaceId } });
    if (!t) throw new NotFoundException('Task not found');
    const wasDone = t.completed;
    if (dto.title !== undefined) t.title = dto.title;
    if (dto.description !== undefined) t.description = dto.description;
    if (dto.dueAt !== undefined) t.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.assigneeId !== undefined) t.assigneeId = dto.assigneeId;
    if (dto.completed !== undefined) {
      t.completed = dto.completed;
      t.completedAt = dto.completed ? new Date() : null;
    }
    await this.tasks.save(t);
    if (!wasDone && t.completed) {
      await this.activity.record(workspaceId, 'task.completed', `Task "${t.title}" completed`, { entityType: 'task', entityId: t.id, userId });
      this.events.emit({ type: 'task.completed', workspaceId, userId, contactId: t.contactId, payload: { task: t } });
    }
    return t;
  }

  async deleteTask(workspaceId: string, id: string) {
    const res = await this.tasks.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Task not found');
    return { id };
  }

  openTaskCount(workspaceId: string) {
    return this.tasks.count({ where: { workspaceId, completed: false } });
  }
}

function slugKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 64);
}

// ---- Controller ---------------------------------------------------------------
@Controller('crm')
export class CrmExtrasController {
  constructor(
    private readonly extras: CrmExtrasService,
    private readonly contacts: ContactsService,
  ) {}

  // Static contact routes are registered before CrmController's contacts/:id.
  @Get('contacts/export')
  @Permissions('contacts:export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts.csv"')
  export(@Tenant('workspaceId') ws: string) {
    return this.contacts.exportCsv(ws);
  }

  @Get('contacts/sources')
  @Permissions('contacts:read')
  sources(@Tenant('workspaceId') ws: string) {
    return this.contacts.sources(ws);
  }

  @Post('contacts/import')
  @Permissions('contacts:import')
  import(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: ImportContactsDto) {
    return this.contacts.import(ws, dto, userId);
  }

  @Post('contacts/bulk')
  @Permissions('contacts:write')
  bulk(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: BulkContactsDto) {
    return this.contacts.bulk(ws, dto, userId);
  }

  @Get('custom-fields')
  @Permissions('contacts:read')
  listFields(@Tenant('workspaceId') ws: string) {
    return this.extras.listFields(ws);
  }

  @Post('custom-fields')
  @Permissions('contacts:write')
  createField(@Tenant('workspaceId') ws: string, @Body() dto: CustomFieldDto) {
    return this.extras.createField(ws, dto);
  }

  @Put('custom-fields/:id')
  @Permissions('contacts:write')
  updateField(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomFieldDto) {
    return this.extras.updateField(ws, id, dto);
  }

  @Delete('custom-fields/:id')
  @Permissions('contacts:write')
  deleteField(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteField(ws, id);
  }

  @Get('contacts/:id/notes')
  @Permissions('contacts:read')
  notes(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.listNotes(ws, id);
  }

  @Post('contacts/:id/notes')
  @Permissions('contacts:write')
  addNote(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.extras.addNote(ws, id, dto.body, userId);
  }

  @Delete('notes/:id')
  @Permissions('contacts:write')
  deleteNote(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteNote(ws, id);
  }

  @Get('tasks')
  @Permissions('contacts:read')
  tasks(@Tenant('workspaceId') ws: string, @Query('contactId') contactId?: string, @Query('status') status?: string) {
    return this.extras.listTasks(ws, { contactId, status });
  }

  @Post('tasks')
  @Permissions('contacts:write')
  createTask(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: TaskDto) {
    return this.extras.createTask(ws, dto, userId);
  }

  @Put('tasks/:id')
  @Permissions('contacts:write')
  updateTask(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TaskDto) {
    return this.extras.updateTask(ws, id, dto, userId);
  }

  @Delete('tasks/:id')
  @Permissions('contacts:write')
  deleteTask(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.extras.deleteTask(ws, id);
  }
}
