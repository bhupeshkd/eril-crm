import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pipeline } from '../database/entities/pipeline.entity';
import { PipelineStage } from '../database/entities/pipeline-stage.entity';
import { Opportunity } from '../database/entities/opportunity.entity';
import { Contact } from '../database/entities/contact.entity';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pipeline, PipelineStage, Opportunity, Contact])],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
