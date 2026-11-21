import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../database/entities/contact.entity';
import { Company } from '../database/entities/company.entity';
import { ContactNote, CustomField, SmartList, Task } from '../database/entities/crm-extras.entity';
import { CrmController } from './crm.controller';
import { ContactsService } from './contacts.service';
import { CompaniesService } from './companies.service';
import { CrmExtrasController, CrmExtrasService } from './crm-extras';
import { SmartListsController, SmartListsService } from './smart-lists';

@Module({
  imports: [TypeOrmModule.forFeature([Contact, Company, CustomField, ContactNote, Task, SmartList])],
  // CrmExtrasController first so /crm/contacts/export|import|bulk|sources win over /crm/contacts/:id.
  controllers: [CrmExtrasController, SmartListsController, CrmController],
  providers: [ContactsService, CompaniesService, CrmExtrasService, SmartListsService],
  exports: [ContactsService, CompaniesService, CrmExtrasService, SmartListsService],
})
export class CrmModule {}
