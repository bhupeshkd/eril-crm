import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  async list() {
    return this.service.list();
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return this.service.findById(id);
  }
}
