import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { Organization } from '../database/entities/organization.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, Workspace, WorkspaceMember]),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
