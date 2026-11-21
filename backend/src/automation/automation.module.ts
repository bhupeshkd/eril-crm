import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workflow } from '../database/entities/workflow.entity';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { Contact } from '../database/entities/contact.entity';
import { CrmModule } from '../crm/crm.module';
import { SalesModule } from '../sales/sales.module';
import { CommunicationModule } from '../communication/communication.module';
import { ReputationModule } from '../reputation/reputation';
import { AiModule } from '../ai/ai';
import { CoursesModule } from '../courses/courses';
import { EmailTemplatesModule } from '../email-templates/email-templates';
import { EmailTemplate } from '../database/entities/email-template.entity';
import { AutomationController } from './automation.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowEngine } from './workflow-engine.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workflow, WorkflowRun, Contact, EmailTemplate]),
    EmailTemplatesModule,
    CrmModule,
    SalesModule,
    CommunicationModule,
    ReputationModule,
    AiModule,
    CoursesModule,
  ],
  controllers: [AutomationController],
  providers: [WorkflowsService, WorkflowEngine],
})
export class AutomationModule {}
