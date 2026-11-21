import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { ContactsService } from './contacts.service';
import { CompaniesService } from './companies.service';
import {
  ContactQueryDto,
  CreateCompanyDto,
  CreateContactDto,
  UpdateCompanyDto,
  UpdateContactDto,
} from './dto';

@Controller('crm')
export class CrmController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
  ) {}

  // ---- Contacts ------------------------------------------------------------
  @Get('contacts')
  @Permissions('contacts:read')
  listContacts(@Tenant('workspaceId') ws: string, @Query() q: ContactQueryDto) {
    return this.contacts.list(ws, q);
  }

  @Get('contacts/tags')
  @Permissions('contacts:read')
  tags(@Tenant('workspaceId') ws: string) {
    return this.contacts.tags(ws);
  }

  @Post('contacts')
  @Permissions('contacts:write')
  createContact(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(ws, dto, userId);
  }

  @Get('contacts/:id')
  @Permissions('contacts:read')
  getContact(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.get(ws, id);
  }

  @Put('contacts/:id')
  @Permissions('contacts:write')
  updateContact(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(ws, id, dto, userId);
  }

  @Delete('contacts/:id')
  @Permissions('contacts:delete')
  deleteContact(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contacts.remove(ws, id, userId);
  }

  // ---- Companies -----------------------------------------------------------
  @Get('companies')
  @Permissions('companies:read')
  listCompanies(@Tenant('workspaceId') ws: string, @Query('search') search?: string) {
    return this.companies.list(ws, search);
  }

  @Post('companies')
  @Permissions('companies:write')
  createCompany(@Tenant('workspaceId') ws: string, @Body() dto: CreateCompanyDto) {
    return this.companies.create(ws, dto);
  }

  @Get('companies/:id')
  @Permissions('companies:read')
  getCompany(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(ws, id);
  }

  @Put('companies/:id')
  @Permissions('companies:write')
  updateCompany(
    @Tenant('workspaceId') ws: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(ws, id, dto);
  }

  @Delete('companies/:id')
  @Permissions('companies:delete')
  deleteCompany(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.remove(ws, id);
  }
}
