import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { DataSource, In, Repository } from 'typeorm';
import { SaasAccount, SaasPlan, SaasSettings, SaasUsageBill } from '../database/entities/saas.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Invoice, Product, Subscription } from '../database/entities/payment.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { AgencyModule, AgencyService } from '../agency/agency';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments';
import { SubscriptionsService } from '../payments/subscriptions';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';
import { ActivityService } from '../events/activity.service';
import { SaasAccessService } from './access';
import { ALL_FEATURES, SAAS_FEATURES, featureLabel, isPeriod, overageLines, periodOf, periodRange, previousPeriod } from './rules';

// ---- DTOs -----------------------------------------------------------------------
class SettingsDto {
  @IsOptional() @IsUUID() billingWorkspaceId?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) emailPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) smsPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(90) graceDays?: number;
}
class PlanDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) price?: number;
  @IsOptional() @IsIn(['month', 'year']) interval?: 'month' | 'year';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) trialDays?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(ALL_FEATURES, { each: true }) features?: string[];
  @IsOptional() @IsObject() limits?: { contacts?: number | null; users?: number | null };
  @IsOptional() @IsObject() included?: { emails?: number; sms?: number };
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class CreatePlanDto extends PlanDto {
  @IsString() @IsNotEmpty() @MaxLength(120) declare name: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) declare price: number;
}
class AssignDto {
  @IsUUID() workspaceId: string;
  @IsUUID() planId: string;
  /** Who receives the client's invoices. */
  @IsEmail() billingEmail: string;
  @IsOptional() @IsString() @MaxLength(120) billingName?: string;
  /** Skip the plan's free trial (e.g. moving an existing client onto a plan). */
  @IsOptional() @IsBoolean() skipTrial?: boolean;
}
class BillUsageDto {
  /** 'YYYY-MM'; defaults to last month. */
  @IsOptional() @IsString() period?: string;
}

const cleanLimit = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.floor(Number(v))));
const cleanCount = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

@Injectable()
export class SaasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SaasService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(SaasSettings) private readonly settingsRepo: Repository<SaasSettings>,
    @InjectRepository(SaasPlan) private readonly plans: Repository<SaasPlan>,
    @InjectRepository(SaasAccount) private readonly accounts: Repository<SaasAccount>,
    @InjectRepository(SaasUsageBill) private readonly bills: Repository<SaasUsageBill>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly ds: DataSource,
    private readonly agency: AgencyService,
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly contacts: ContactsService,
    private readonly access: SaasAccessService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    // Hourly: bill last month's usage for any account not yet billed (idempotent per account+month).
    this.timer = setInterval(() => this.billAllPrevious().catch((e) => this.logger.error(`Usage billing failed: ${e.message}`)), 60 * 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Settings --------------------------------------------------------------------
  private async settingsFor(orgId: string) {
    return (await this.settingsRepo.findOne({ where: { organizationId: orgId } })) ?? this.settingsRepo.create({ organizationId: orgId, billingWorkspaceId: null, currency: 'USD', emailPrice: 0, smsPrice: 0, graceDays: 7 });
  }

  private async requireBilling(orgId: string) {
    const s = await this.settingsFor(orgId);
    if (!s.billingWorkspaceId) throw new BadRequestException('Choose the workspace that bills your clients first (SaaS settings).');
    return s as SaasSettings & { billingWorkspaceId: string };
  }

  async updateSettings(userId: string, orgId: string, dto: SettingsDto) {
    await this.agency.assertAccess(userId, orgId);
    const s = await this.settingsFor(orgId);
    if (dto.billingWorkspaceId && dto.billingWorkspaceId !== s.billingWorkspaceId) {
      if (!(await this.workspaces.exist({ where: { id: dto.billingWorkspaceId, organizationId: orgId } }))) throw new BadRequestException('Billing workspace must belong to this agency');
      if (await this.accounts.exist({ where: { organizationId: orgId } })) throw new BadRequestException("The billing workspace can't change while clients are on plans");
      if (await this.accounts.exist({ where: { workspaceId: dto.billingWorkspaceId } })) throw new BadRequestException("A client account on a plan can't be the billing workspace");
      s.billingWorkspaceId = dto.billingWorkspaceId;
    }
    if (dto.currency) {
      if (s.currency !== dto.currency.toUpperCase() && (await this.plans.exist({ where: { organizationId: orgId } }))) throw new BadRequestException("Currency can't change once plans exist");
      s.currency = dto.currency.toUpperCase();
    }
    if (dto.emailPrice !== undefined) s.emailPrice = dto.emailPrice;
    if (dto.smsPrice !== undefined) s.smsPrice = dto.smsPrice;
    if (dto.graceDays !== undefined) s.graceDays = dto.graceDays;
    await this.settingsRepo.save(s);
    this.access.invalidate();
    return s;
  }

  // ---- Plans -----------------------------------------------------------------------
  private applyPlan(p: SaasPlan, dto: PlanDto) {
    if (dto.name !== undefined) p.name = dto.name.trim();
    if (dto.description !== undefined) p.description = dto.description;
    if (dto.price !== undefined) p.price = dto.price;
    if (dto.interval) p.interval = dto.interval;
    if (dto.trialDays !== undefined) p.trialDays = dto.trialDays;
    if (dto.features) p.features = [...new Set(dto.features)];
    if (dto.limits) p.limits = { contacts: cleanLimit(dto.limits.contacts), users: cleanLimit(dto.limits.users) };
    if (dto.included) p.included = { emails: cleanCount(dto.included.emails), sms: cleanCount(dto.included.sms) };
    if (dto.isActive !== undefined) p.isActive = dto.isActive;
  }

  async createPlan(userId: string, orgId: string, dto: CreatePlanDto) {
    await this.agency.assertAccess(userId, orgId);
    const s = await this.requireBilling(orgId);
    const p = this.plans.create({ organizationId: orgId, description: '', interval: 'month', trialDays: 0, isActive: true, features: [...ALL_FEATURES], limits: { contacts: null, users: null }, included: { emails: 0, sms: 0 } });
    this.applyPlan(p, dto);
    // Each plan is sold as a recurring product in the billing workspace, so the normal subscription engine bills it.
    const product = await this.payments.createProduct(s.billingWorkspaceId, { name: `${p.name} plan`, description: p.description || 'SaaS plan', price: p.price, currency: s.currency, interval: p.interval } as any);
    p.productId = product.id;
    return this.plans.save(p);
  }

  async updatePlan(userId: string, orgId: string, id: string, dto: PlanDto) {
    await this.agency.assertAccess(userId, orgId);
    const p = await this.plans.findOne({ where: { id, organizationId: orgId } });
    if (!p) throw new NotFoundException('Plan not found');
    this.applyPlan(p, dto);
    await this.plans.save(p);
    if (p.productId) {
      // New subscriptions use the new price; existing clients keep theirs until moved to a plan again.
      await this.products.update({ id: p.productId }, { name: `${p.name} plan`, price: p.price, interval: p.interval, isActive: p.isActive });
    }
    this.access.invalidate();
    return p;
  }

  async archivePlan(userId: string, orgId: string, id: string) {
    return this.updatePlan(userId, orgId, id, { isActive: false });
  }

  // ---- Accounts ----------------------------------------------------------------------
  /** Outbound emails/SMS actually sent from a workspace in [start, end). */
  async usage(workspaceIds: string[], start: Date, end: Date) {
    if (!workspaceIds.length) return new Map<string, { emails: number; sms: number }>();
    const rows: Array<{ ws: string; channel: string; n: number }> = await this.ds.query(
      `SELECT workspace_id AS ws, channel, COUNT(*)::int AS n FROM messages
        WHERE workspace_id = ANY($1) AND direction = 'outbound' AND status = 'sent' AND deleted_at IS NULL
          AND created_at >= $2 AND created_at < $3
        GROUP BY 1, 2`,
      [workspaceIds, start, end],
    );
    const out = new Map<string, { emails: number; sms: number }>();
    for (const id of workspaceIds) out.set(id, { emails: 0, sms: 0 });
    for (const r of rows) {
      const u = out.get(r.ws)!;
      if (r.channel === 'email') u.emails += r.n;
      else if (r.channel === 'sms') u.sms += r.n;
    }
    return out;
  }

  async overview(userId: string, orgId: string) {
    await this.agency.assertAccess(userId, orgId);
    const [settings, plans, accounts, workspaces] = await Promise.all([
      this.settingsFor(orgId),
      this.plans.find({ where: { organizationId: orgId }, order: { price: 'ASC' } }),
      this.accounts.find({ where: { organizationId: orgId } }),
      this.workspaces.find({ where: { organizationId: orgId }, order: { createdAt: 'ASC' } }),
    ]);
    const { start, end } = periodRange(periodOf(new Date()));
    const usage = await this.usage(accounts.map((a) => a.workspaceId), start, end);
    const subs = accounts.length ? await this.subs.find({ where: { id: In(accounts.map((a) => a.subscriptionId).filter(Boolean) as string[]) } }) : [];
    const counts: Array<{ ws: string; contacts: number }> = workspaces.length
      ? await this.ds.query(`SELECT workspace_id AS ws, COUNT(*)::int AS contacts FROM contacts WHERE workspace_id = ANY($1) AND deleted_at IS NULL GROUP BY 1`, [workspaces.map((w) => w.id)])
      : [];
    const rows = await Promise.all(
      workspaces.map(async (w) => {
        const acc = accounts.find((a) => a.workspaceId === w.id);
        if (!acc) return { workspaceId: w.id, name: w.name, isBilling: w.id === settings.billingWorkspaceId, account: null };
        const a = await this.access.get(w.id);
        const sub = subs.find((s) => s.id === acc.subscriptionId);
        const plan = plans.find((p) => p.id === acc.planId);
        return {
          workspaceId: w.id,
          name: w.name,
          isBilling: false,
          account: {
            planId: acc.planId,
            planName: plan?.name ?? 'Plan',
            status: a?.status ?? 'canceled',
            price: sub?.price ?? plan?.price ?? 0,
            interval: sub?.interval ?? plan?.interval ?? 'month',
            nextBillingAt: sub?.nextBillingAt ?? null,
            trialEndsAt: sub?.status === 'trialing' ? sub.currentPeriodEnd : null,
            usage: { ...(usage.get(w.id) ?? { emails: 0, sms: 0 }), contacts: counts.find((c) => c.ws === w.id)?.contacts ?? 0 },
            included: plan?.included ?? { emails: 0, sms: 0 },
            limits: plan?.limits ?? { contacts: null, users: null },
          },
        };
      }),
    );
    const mrr = rows.reduce((t, r) => (r.account && ['active', 'past_due', 'trialing'].includes(r.account.status) && r.account.status !== 'trialing' ? t + (r.account.interval === 'year' ? r.account.price / 12 : r.account.price) : t), 0);
    return { settings, plans, workspaces: rows, features: SAAS_FEATURES, mrr: Math.round(mrr * 100) / 100, currency: settings.currency };
  }

  /** Put a client sub-account on a plan (or move it to another plan). */
  async assign(userId: string, orgId: string, dto: AssignDto) {
    await this.agency.assertAccess(userId, orgId);
    const s = await this.requireBilling(orgId);
    if (dto.workspaceId === s.billingWorkspaceId) throw new BadRequestException("Your billing workspace can't be put on a client plan");
    const ws = await this.workspaces.findOne({ where: { id: dto.workspaceId, organizationId: orgId } });
    if (!ws) throw new NotFoundException('Sub-account not found in this agency');
    const plan = await this.plans.findOne({ where: { id: dto.planId, organizationId: orgId, isActive: true } });
    if (!plan || !plan.productId) throw new NotFoundException('Plan not found');

    const { contact } = await this.contacts.upsert(s.billingWorkspaceId, { firstName: dto.billingName?.trim() || ws.name, email: dto.billingEmail, tags: ['saas-client'], source: 'saas' }, userId);
    const existing = await this.accounts.findOne({ where: { workspaceId: ws.id } });
    if (existing?.subscriptionId) {
      const old = await this.subs.findOne({ where: { id: existing.subscriptionId } });
      if (old && old.status !== 'canceled') await this.subscriptions.cancel(s.billingWorkspaceId, old.id, { atPeriodEnd: false }, userId);
    }
    // Trials only for brand-new clients, never when switching plans.
    const trialDays = existing || dto.skipTrial ? 0 : plan.trialDays;
    const sub = await this.subscriptions.create(s.billingWorkspaceId, { contactId: contact.id, productId: plan.productId, trialDays }, userId);
    const acc = existing ?? this.accounts.create({ organizationId: orgId, workspaceId: ws.id });
    Object.assign(acc, { planId: plan.id, subscriptionId: sub.id, billingContactId: contact.id });
    await this.accounts.save(acc);
    this.access.invalidate(ws.id);
    await this.activity.record(ws.id, 'saas.plan_assigned', `${existing ? 'Moved to' : 'Started'} the ${plan.name} plan${trialDays ? ` with a ${trialDays}-day trial` : ''}`, { userId });
    return { workspaceId: ws.id, planId: plan.id, subscriptionId: sub.id, status: (await this.access.get(ws.id))?.status };
  }

  /** cancel: stop billing and make the account read-only. remove: stop billing and lift all plan restrictions. */
  async endAccount(userId: string, orgId: string, workspaceId: string, mode: 'cancel' | 'remove') {
    await this.agency.assertAccess(userId, orgId);
    const acc = await this.accounts.findOne({ where: { workspaceId, organizationId: orgId } });
    if (!acc) throw new NotFoundException('This sub-account is not on a plan');
    const s = await this.requireBilling(orgId);
    if (acc.subscriptionId) {
      const sub = await this.subs.findOne({ where: { id: acc.subscriptionId } });
      if (sub && sub.status !== 'canceled') await this.subscriptions.cancel(s.billingWorkspaceId, sub.id, { atPeriodEnd: false }, userId);
    }
    if (mode === 'remove') await this.accounts.softRemove(acc);
    this.access.invalidate(workspaceId);
    await this.activity.record(workspaceId, `saas.${mode === 'remove' ? 'removed' : 'canceled'}`, mode === 'remove' ? 'Removed from SaaS billing (no plan restrictions)' : 'Plan canceled; account is read-only', { userId });
    return { workspaceId, mode };
  }

  // ---- Usage billing ---------------------------------------------------------------------
  /** Bill overage for one period. Each account+period is claimed once, so re-running never double-bills. */
  async billUsage(orgId: string, period: string) {
    if (!isPeriod(period)) throw new BadRequestException('Period must look like 2026-10');
    const s = await this.settingsFor(orgId);
    if (!s.billingWorkspaceId) return { period, billed: 0, invoices: [] as string[] };
    const { start, end } = periodRange(period);
    const accounts = (await this.accounts.find({ where: { organizationId: orgId } })).filter((a) => a.createdAt < end);
    const usage = await this.usage(accounts.map((a) => a.workspaceId), start, end);
    const invoices: string[] = [];
    for (const acc of accounts) {
      const claimed = await this.bills
        .createQueryBuilder()
        .insert()
        .into(SaasUsageBill)
        .values({ organizationId: orgId, workspaceId: acc.workspaceId, period })
        .orIgnore()
        .returning('id')
        .execute();
      if (!claimed.identifiers.length || !claimed.identifiers[0]?.id) continue; // already billed
      const billId = claimed.identifiers[0].id as string;
      const plan = await this.plans.findOne({ where: { id: acc.planId }, withDeleted: true });
      const used = usage.get(acc.workspaceId) ?? { emails: 0, sms: 0 };
      const lines = overageLines(used, plan?.included ?? { emails: 0, sms: 0 }, { emailPrice: Number(s.emailPrice), smsPrice: Number(s.smsPrice) });
      const amount = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100;
      let invoiceId: string | null = null;
      if (amount > 0) {
        const ws = await this.workspaces.findOne({ where: { id: acc.workspaceId }, withDeleted: true });
        // Per-message prices can be fractions of a cent, so each line is one total ("500 × $0.002").
        const inv = await this.payments.createInvoice(
          s.billingWorkspaceId,
          {
            contactId: acc.billingContactId,
            currency: s.currency,
            items: lines.map((l) => ({ name: `${l.name}: ${l.quantity.toLocaleString('en-US')} × ${l.unitPrice}`, quantity: 1, unitPrice: l.amount })),
            notes: `Usage for ${period}${ws ? ` · ${ws.name}` : ''}`,
            dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
          } as any,
          null,
          { status: 'sent', source: 'saas_usage' },
        );
        invoiceId = inv.id;
        invoices.push(inv.id);
        await this.payments.sendInvoice(s.billingWorkspaceId, inv.id).catch((e) => this.logger.warn(`Usage invoice email failed: ${e.message}`));
      }
      await this.bills.update({ id: billId }, { emails: used.emails, sms: used.sms, amount, invoiceId });
    }
    return { period, billed: invoices.length, invoices };
  }

  private async billAllPrevious() {
    const period = previousPeriod(new Date());
    const orgs = await this.settingsRepo.find();
    for (const o of orgs) if (o.billingWorkspaceId) await this.billUsage(o.organizationId, period);
  }

  async billUsageNow(userId: string, orgId: string, dto: BillUsageDto) {
    await this.agency.assertAccess(userId, orgId);
    const period = dto.period ?? previousPeriod(new Date());
    // Billing a month that hasn't ended would miss its remaining usage (and the month can only be billed once).
    if (period >= periodOf(new Date()) && process.env.NODE_ENV === 'production') throw new BadRequestException('Only completed months can be billed');
    return this.billUsage(orgId, period);
  }

  async usageBills(userId: string, orgId: string) {
    await this.agency.assertAccess(userId, orgId);
    return this.bills.find({ where: { organizationId: orgId }, order: { period: 'DESC', createdAt: 'DESC' }, take: 200 });
  }

  // ---- Client view -------------------------------------------------------------------------
  /** For the client's own workspace: plan, standing, usage and a link to pay what's owed. */
  async status(workspaceId: string) {
    const a = await this.access.get(workspaceId);
    if (!a) return { saas: false };
    const { start, end } = periodRange(periodOf(new Date()));
    const [usage, [{ contacts }], [{ users }], sub] = await Promise.all([
      this.usage([workspaceId], start, end).then((m) => m.get(workspaceId)!),
      this.ds.query(`SELECT COUNT(*)::int AS contacts FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL`, [workspaceId]),
      this.ds.query(`SELECT COUNT(*)::int AS users FROM workspace_members WHERE workspace_id = $1 AND deleted_at IS NULL AND role <> ALL($2)`, [workspaceId, ['super_admin', 'agency_owner', 'agency_admin']]),
      a.subscriptionId ? this.subs.findOne({ where: { id: a.subscriptionId } }) : Promise.resolve(null),
    ]);
    const open = a.subscriptionId
      ? await this.invoices.findOne({ where: { subscriptionId: a.subscriptionId, status: 'sent' }, order: { dueDate: 'ASC' } })
      : null;
    const app = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    return {
      saas: true,
      plan: { name: a.planName, features: a.features.map((f) => ({ key: f, label: featureLabel(f) })), limits: a.limits, included: a.included },
      status: a.status,
      price: sub?.price ?? null,
      currency: sub?.currency ?? null,
      interval: sub?.interval ?? null,
      trialEndsAt: sub?.status === 'trialing' ? sub.currentPeriodEnd : null,
      nextBillingAt: sub?.nextBillingAt ?? null,
      usage: { ...usage, contacts, users },
      payUrl: open ? `${app}/invoice/${open.publicToken}` : null,
      amountDue: open ? open.total : null,
    };
  }
}

// ---- Controllers --------------------------------------------------------------------------
@Controller('agency/:orgId/saas')
@SkipTenant()
export class SaasAgencyController {
  constructor(private readonly svc: SaasService) {}

  @Get()
  overview(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.svc.overview(userId, orgId);
  }

  @Put('settings')
  settings(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: SettingsDto) {
    return this.svc.updateSettings(userId, orgId, dto);
  }

  @Post('plans')
  createPlan(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreatePlanDto) {
    return this.svc.createPlan(userId, orgId, dto);
  }

  @Put('plans/:id')
  updatePlan(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanDto) {
    return this.svc.updatePlan(userId, orgId, id, dto);
  }

  @Delete('plans/:id')
  archivePlan(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archivePlan(userId, orgId, id);
  }

  @Post('accounts')
  assign(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: AssignDto) {
    return this.svc.assign(userId, orgId, dto);
  }

  @Delete('accounts/:workspaceId')
  end(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('workspaceId', ParseUUIDPipe) workspaceId: string, @Query('mode') mode?: string) {
    return this.svc.endAccount(userId, orgId, workspaceId, mode === 'remove' ? 'remove' : 'cancel');
  }

  @Post('usage/bill')
  bill(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: BillUsageDto) {
    return this.svc.billUsageNow(userId, orgId, dto);
  }

  @Get('usage/bills')
  bills(@CurrentUser('id') userId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.svc.usageBills(userId, orgId);
  }
}

/** The client's own view of its plan (any member of the workspace). */
@Controller('saas')
export class SaasStatusController {
  constructor(private readonly svc: SaasService) {}

  @Get('status')
  status(@Tenant('workspaceId') ws: string) {
    return this.svc.status(ws);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([SaasSettings, SaasPlan, SaasAccount, SaasUsageBill, Workspace, Product, Subscription, Invoice]), AgencyModule, PaymentsModule, CrmModule],
  controllers: [SaasAgencyController, SaasStatusController],
  providers: [SaasService],
})
export class SaasModule {}
