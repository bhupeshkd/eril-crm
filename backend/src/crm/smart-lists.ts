import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Contact } from '../database/entities/contact.entity';
import { ContactFilters, SmartList } from '../database/entities/crm-extras.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { applyContactFilters, cleanFilters, describeFilters, isEmptyFilter } from './contact-filters';

const MAX_LISTS = 100;

export class SmartListDto {
  @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsObject() filters: ContactFilters;
}
export class UpdateSmartListDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() filters?: ContactFilters;
}

/** Saved contact filters. Counts are computed live each time lists are read. */
@Injectable()
export class SmartListsService {
  constructor(
    @InjectRepository(SmartList) private readonly lists: Repository<SmartList>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
  ) {}

  private count(workspaceId: string, f: ContactFilters) {
    const qb = this.contacts.createQueryBuilder('c').leftJoin('c.company', 'co').where('c.workspace_id = :workspaceId', { workspaceId });
    return applyContactFilters(qb, f).getCount();
  }

  private view(l: SmartList, count: number) {
    return { id: l.id, name: l.name, filters: l.filters, summary: describeFilters(l.filters), count, createdAt: l.createdAt, updatedAt: l.updatedAt };
  }

  async list(workspaceId: string) {
    const rows = await this.lists.find({ where: { workspaceId }, order: { name: 'ASC' } });
    return Promise.all(rows.map(async (l) => this.view(l, await this.count(workspaceId, cleanFilters(l.filters)))));
  }

  async get(workspaceId: string, id: string) {
    const l = await this.lists.findOne({ where: { id, workspaceId } });
    if (!l) throw new NotFoundException('List not found');
    return l;
  }

  private async assertNameFree(workspaceId: string, name: string, exceptId?: string) {
    const clash = await this.lists
      .createQueryBuilder('l')
      .where('l.workspace_id = :workspaceId AND lower(l.name) = lower(:name)', { workspaceId, name })
      .andWhere(exceptId ? 'l.id <> :exceptId' : '1=1', { exceptId })
      .getExists();
    if (clash) throw new BadRequestException(`You already have a list called “${name}”`);
  }

  async create(workspaceId: string, dto: SmartListDto, userId: string) {
    const name = dto.name.trim();
    const filters = cleanFilters(dto.filters);
    if (isEmptyFilter(filters)) throw new BadRequestException('Add at least one filter before saving a list');
    if ((await this.lists.count({ where: { workspaceId } })) >= MAX_LISTS) throw new BadRequestException(`A workspace can have up to ${MAX_LISTS} lists`);
    await this.assertNameFree(workspaceId, name);
    const l = await this.lists.save(this.lists.create({ workspaceId, name, filters, createdById: userId }));
    return this.view(l, await this.count(workspaceId, filters));
  }

  async update(workspaceId: string, id: string, dto: UpdateSmartListDto) {
    const l = await this.get(workspaceId, id);
    if (dto.name !== undefined) {
      await this.assertNameFree(workspaceId, dto.name.trim(), id);
      l.name = dto.name.trim();
    }
    if (dto.filters !== undefined) {
      const filters = cleanFilters(dto.filters);
      if (isEmptyFilter(filters)) throw new BadRequestException('A list needs at least one filter');
      l.filters = filters;
    }
    await this.lists.save(l);
    return this.view(l, await this.count(workspaceId, cleanFilters(l.filters)));
  }

  async remove(workspaceId: string, id: string) {
    const l = await this.get(workspaceId, id);
    await this.lists.softRemove(l);
    return { id };
  }
}

@Controller('crm/lists')
export class SmartListsController {
  constructor(private readonly svc: SmartListsService) {}

  @Get()
  @Permissions('contacts:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('contacts:write')
  create(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: SmartListDto) {
    return this.svc.create(ws, dto, userId);
  }

  @Put(':id')
  @Permissions('contacts:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSmartListDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('contacts:write')
  @HttpCode(HttpStatus.OK)
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }
}
