import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../database/entities/conversation.entity';
import { EmailClick, Message } from '../database/entities/message.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingPublicController, TrackingSettingsController } from '../tracking/tracking.controller';
import { Contact } from '../database/entities/contact.entity';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { EmailProvider, MetaProvider, SmsProvider } from './providers';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message, Contact, EmailClick, Workspace])],
  controllers: [InboxController, TrackingPublicController, TrackingSettingsController],
  providers: [InboxService, EmailProvider, SmsProvider, MetaProvider, TrackingService],
  exports: [InboxService, TrackingService],
})
export class CommunicationModule {}
