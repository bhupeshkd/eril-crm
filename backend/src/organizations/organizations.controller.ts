import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    return this.service.listForUser(userId);
  }

  @Post()
  async create(@CurrentUser('id') userId: string, @Body('name') name: string) {
    return this.service.create(userId, name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.delete(userId, id);
  }
}
