import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { Workspace } from '../database/entities/workspace.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { User } from '../database/entities/user.entity';
import { Invitation } from '../database/entities/invitation.entity';
import { Organization } from '../database/entities/organization.entity';
import { EmailProvider } from '../communication/providers';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, User, Invitation, Organization]),
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, EmailProvider],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
