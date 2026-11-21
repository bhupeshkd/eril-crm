import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    return this.service.list(userId);
  }

  @Post()
  async create(@CurrentUser('id') userId: string, @Body('name') name: string) {
    return this.service.create(userId, name);
  }

  @Post(':id/invite')
  async invite(@Param('id') id: string, @Body('email') email: string, @Body('role') role: string, @CurrentUser('id') by: string) {
    await this.service.assertManager(id, by, role);
    return this.service.invite(id, email, role, by);
  }

  @Get(':id/invitations')
  async invitations(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.service.assertMember(id, userId);
    return this.service.pendingInvitations(id);
  }

  @Post(':id/invitations/:invitationId/resend')
  async resend(@Param('id') id: string, @Param('invitationId') invitationId: string, @CurrentUser('id') userId: string) {
    return this.service.resendInvitation(id, invitationId, userId);
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string, @Param('invitationId') invitationId: string, @CurrentUser('id') userId: string) {
    return this.service.revokeInvitation(id, invitationId, userId);
  }

  @Get(':id/members')
  async members(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.service.assertMember(id, userId);
    return this.service.membersOf(id);
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Body('email') email: string, @Body('role') role: string, @CurrentUser('id') by: string) {
    await this.service.assertManager(id, by, role);
    return this.service.addMember(id, email, role);
  }

  @Put(':id/members/:userId')
  async changeRole(@Param('id') id: string, @Param('userId') userId: string, @Body('role') role: string, @CurrentUser('id') requester: string) {
    return this.service.changeRole(id, userId, role, requester);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser('id') requester: string) {
    return this.service.removeMember(id, userId, requester);
  }
}
