import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity } from '../database/entities/activity.entity';
import { ActivityService } from './activity.service';
import { EventsService } from './events.service';
import { RealtimeController } from './realtime.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Activity])],
  controllers: [RealtimeController],
  providers: [EventsService, ActivityService],
  exports: [EventsService, ActivityService],
})
export class EventsModule {}
