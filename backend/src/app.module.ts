import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PlanGuard, SaasAccessModule } from './saas/access';
import { SaasModule } from './saas/saas';
import { ChatModule } from './chat/chat';
import { BlogModule } from './sites/blog';
import { QrModule } from './qr/qr';
import { DomainsModule } from './sites/domains';
import { PhoneModule } from './phone/phone';
import { MetaModule } from './meta/meta';
import { SocialModule } from './social/social';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { EventsModule } from './events/events.module';
import { CrmModule } from './crm/crm.module';
import { SalesModule } from './sales/sales.module';
import { CommunicationModule } from './communication/communication.module';
import { AutomationModule } from './automation/automation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CalendarsModule } from './calendars/calendars';
import { FormsModule } from './forms/forms';
import { PaymentsModule } from './payments/payments.module';
import { CampaignsModule } from './campaigns/campaigns';
import { AiModule } from './ai/ai';
import { DeveloperModule } from './developer/developer';
import { ReportsModule } from './reports/reports';
import { SitesModule } from './sites/sites';
import { ReputationModule } from './reputation/reputation';
import { CoursesModule } from './courses/courses';
import { AgencyModule } from './agency/agency';
import { BrandingModule } from './agency/branding';
import { PushModule } from './push/push';
import { EmailTemplatesModule } from './email-templates/email-templates';
import { CommunitiesModule } from './communities/communities';
import { TenantGuard } from './common/guards/tenant.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { WorkspaceMember } from './database/entities/workspace-member.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'eril',
      autoLoadEntities: true,
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      logging: process.env.DB_LOGGING === 'true',
    }),
    TypeOrmModule.forFeature([WorkspaceMember]),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL_SECONDS || 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT || 120),
        },
      ],
    }),
    AuthModule,
    OrganizationsModule,
    WorkspacesModule,
    UsersModule,
    HealthModule,
    EventsModule,
    CrmModule,
    SalesModule,
    CommunicationModule,
    AutomationModule,
    DashboardModule,
    CalendarsModule,
    FormsModule,
    PaymentsModule,
    CampaignsModule,
    AiModule,
    DeveloperModule,
    ReportsModule,
    SitesModule,
    ReputationModule,
    CoursesModule,
    AgencyModule,
    BrandingModule,
    EmailTemplatesModule,
    CommunitiesModule,
    SaasAccessModule,
    SaasModule,
    ChatModule,
    BlogModule,
    QrModule,
    DomainsModule,
    PhoneModule,
    MetaModule,
    SocialModule,
    PushModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // SaaS plans: feature gating + read-only when suspended (no-op for non-SaaS workspaces).
      provide: APP_GUARD,
      useClass: PlanGuard,
    },
  ],
})
export class AppModule {}
