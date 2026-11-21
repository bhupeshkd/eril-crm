import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from '../database/entities/workspace.entity';
import { OverviewController, OverviewService } from './overview';
import { Repository } from 'typeorm';
import { Contact } from '../database/entities/contact.entity';
import { Opportunity } from '../database/entities/opportunity.entity';
import { Workflow } from '../database/entities/workflow.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { ActivityService } from '../events/activity.service';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Opportunity) private readonly opps: Repository<Opportunity>,
    @InjectRepository(Workflow) private readonly workflows: Repository<Workflow>,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    private readonly activity: ActivityService,
  ) {}

  async stats(workspaceId: string) {
    const [leads, customers, totalContacts, activeWorkflows] = await Promise.all([
      this.contacts.count({ where: { workspaceId, status: 'lead' } }),
      this.contacts.count({ where: { workspaceId, status: 'customer' } }),
      this.contacts.count({ where: { workspaceId } }),
      this.workflows.count({ where: { workspaceId, isPublished: true } }),
    ]);
    const deals = await this.opps
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(o.value), 0)', 'value')
      .where('o.workspace_id = :workspaceId', { workspaceId })
      .groupBy('o.status')
      .getRawMany();
    const by = (s: string) => deals.find((d) => d.status === s) ?? { count: 0, value: 0 };
    const unread = await this.conversations
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.unread_count), 0)', 'n')
      .where('c.workspace_id = :workspaceId', { workspaceId })
      .getRawOne();

    const [invoiceRow, upcomingAppointments, openTasks] = await Promise.all([
      this.opps.manager
        .createQueryBuilder()
        .select('COALESCE(SUM(i.total),0)', 'paid')
        .from('invoices', 'i')
        .where('i.workspace_id = :workspaceId AND i.status = :s AND i.deleted_at IS NULL', { workspaceId, s: 'paid' })
        .getRawOne(),
      this.opps.manager
        .createQueryBuilder()
        .from('appointments', 'a')
        .where("a.workspace_id = :workspaceId AND a.start_at > now() AND a.status NOT IN ('cancelled') AND a.deleted_at IS NULL", { workspaceId })
        .getCount(),
      this.opps.manager
        .createQueryBuilder()
        .from('tasks', 't')
        .where('t.workspace_id = :workspaceId AND t.completed = false AND t.deleted_at IS NULL', { workspaceId })
        .getCount(),
    ]);

    return {
      invoiceRevenue: Number(invoiceRow?.paid ?? 0),
      upcomingAppointments,
      openTasks,
      totalRevenue: Number(by('won').value),
      wonDeals: Number(by('won').count),
      openPipelineValue: Number(by('open').value),
      openDeals: Number(by('open').count),
      activeLeads: leads,
      customers,
      totalContacts,
      activeWorkflows,
      unreadMessages: Number(unread?.n ?? 0),
      recentActivity: await this.activity.recent(workspaceId, 15),
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  @Permissions('contacts:read')
  stats(@Tenant('workspaceId') ws: string) {
    return this.dashboard.stats(ws);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Contact, Opportunity, Workflow, Conversation, Workspace])],
  controllers: [DashboardController, OverviewController],
  providers: [DashboardService, OverviewService],
})
export class DashboardModule {}
