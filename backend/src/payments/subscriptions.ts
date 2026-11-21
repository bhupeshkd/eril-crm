import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { DataSource, In, IsNull, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { Invoice, Product, Subscription } from '../database/entities/payment.entity';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { InboxService } from '../communication/inbox.service';
import { PaymentsService, computeTotals } from './payments';
import { CouponsService, CreateCouponDto, UpdateCouponDto } from './coupons';
import { addInterval, couponDiscount, monthlyValue, round2 } from './billing-math';

export class CreateSubscriptionDto {
  @IsUUID() contactId: string;
  /** Either a recurring product… */
  @IsOptional() @IsUUID() productId?: string;
  /** …or a custom plan */
  @ValidateIf((o) => !o.productId) @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @ValidateIf((o) => !o.productId) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @ValidateIf((o) => !o.productId) @IsIn(['month', 'year']) interval?: 'month' | 'year';
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) trialDays?: number;
  /** First billing date (defaults to now / end of trial). */
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsInt() @Min(0) @Max(90) daysUntilDue?: number;
}
export class CancelSubscriptionDto {
  /** true = keep access until the paid period ends (default); false = cancel now */
  @IsOptional() @IsBoolean() atPeriodEnd?: boolean;
}
class PreviewCouponQuery {
  @IsString() code: string;
  @IsOptional() @IsIn(['invoices', 'subscriptions']) use?: 'invoices' | 'subscriptions';
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) subtotal?: number;
}

const DAY = 86_400_000;

@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly ds: DataSource,
    private readonly payments: PaymentsService,
    private readonly coupons: CouponsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    // A paid subscription invoice brings a past-due subscription back to active.
    this.events.onAny(async (e) => {
      if (e.type !== 'invoice.paid' || !e.payload?.invoice?.subscriptionId) return;
      await this.subs.update({ id: e.payload.invoice.subscriptionId, status: 'past_due' }, { status: 'active' });
    });
    if (process.env.DISABLE_SCHEDULERS !== 'true') {
      this.timer = setInterval(() => this.tick().catch((err) => this.logger.error(err.message)), 30_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One scheduler pass: bill due subscriptions, then chase overdue invoices. Exposed for tests/ops. */
  async tick(now = new Date(), workspaceId?: string) {
    if (this.running) return { billed: 0, overdue: 0 };
    this.running = true;
    try {
      let billed = 0;
      const due = await this.subs.find({
        where: { status: In(['trialing', 'active', 'past_due']), nextBillingAt: LessThanOrEqual(now), ...(workspaceId ? { workspaceId } : {}) },
        take: 50,
      });
      for (const s of due) {
        try {
          if (await this.billCycle(s.id, now)) billed++;
        } catch (err) {
          this.logger.error(`Billing ${s.id} failed: ${err.message}`);
        }
      }
      const overdue = await this.chaseOverdue(now, workspaceId);
      return { billed, overdue };
    } finally {
      this.running = false;
    }
  }

  // ---- CRUD ----
  async list(workspaceId: string, status?: string) {
    return this.subs.find({
      where: status ? { workspaceId, status: status as any } : { workspaceId },
      relations: { contact: true },
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  async get(workspaceId: string, id: string) {
    const s = await this.subs.findOne({ where: { id, workspaceId }, relations: { contact: true } });
    if (!s) throw new NotFoundException('Subscription not found');
    const invoices = await this.invoices.find({ where: { workspaceId, subscriptionId: id }, order: { createdAt: 'DESC' } });
    const coupon = s.couponId ? await this.coupons.getById(s.couponId) : null;
    return { ...s, invoices, coupon: coupon ? { code: coupon.code, type: coupon.type, amount: coupon.amount, duration: coupon.duration } : null };
  }

  async create(workspaceId: string, dto: CreateSubscriptionDto, userId?: string | null) {
    const contact = await this.contacts.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    let plan: { name: string; price: number; interval: 'month' | 'year'; currency: string; productId: string | null };
    if (dto.productId) {
      const p = await this.products.findOne({ where: { id: dto.productId, workspaceId } });
      if (!p) throw new NotFoundException('Product not found');
      if (p.interval === 'one_time') throw new BadRequestException('Choose a monthly or yearly product for a subscription');
      plan = { name: p.name, price: p.price, interval: p.interval as 'month' | 'year', currency: p.currency, productId: p.id };
    } else {
      plan = { name: dto.name!, price: dto.price!, interval: dto.interval!, currency: (dto.currency ?? 'USD').toUpperCase(), productId: null };
    }
    const start = dto.startDate ? new Date(dto.startDate) : new Date();
    const trialDays = dto.trialDays ?? 0;
    const firstBill = new Date(start.getTime() + trialDays * DAY);

    const sub = await this.ds.transaction(async (tx) => {
      let couponId: string | null = null;
      let couponCycles: number | null = null;
      if (dto.couponCode?.trim()) {
        const c = await this.coupons.redeem(workspaceId, dto.couponCode, 'subscriptions', plan.currency, tx);
        couponId = c.id;
        couponCycles = c.duration === 'forever' ? null : c.duration === 'once' ? 1 : c.durationCycles ?? 1;
      }
      return tx.save(
        tx.create(Subscription, {
          workspaceId,
          contactId: contact.id,
          productId: plan.productId,
          name: plan.name,
          price: plan.price,
          interval: plan.interval,
          currency: plan.currency,
          quantity: dto.quantity ?? 1,
          taxRate: dto.taxRate ?? 0,
          couponId,
          couponCyclesRemaining: couponCycles,
          daysUntilDue: dto.daysUntilDue ?? 7,
          anchorDay: firstBill.getUTCDate(),
          status: trialDays > 0 ? 'trialing' : 'active',
          currentPeriodStart: trialDays > 0 ? start : null,
          currentPeriodEnd: trialDays > 0 ? firstBill : null,
          nextBillingAt: firstBill,
        }),
      );
    });
    await this.activity.record(workspaceId, 'subscription.created', `${contact.firstName} subscribed to ${plan.name} (${plan.currency} ${plan.price}/${plan.interval})`, {
      entityType: 'contact',
      entityId: contact.id,
      userId,
    });
    this.events.emit({ type: 'subscription.created', workspaceId, userId, contactId: contact.id, payload: { subscription: this.summaryOf(sub), contact } });
    // Bill the first cycle right away when it is due now.
    if (firstBill.getTime() <= Date.now()) await this.billCycle(sub.id, new Date());
    return this.get(workspaceId, sub.id);
  }

  async cancel(workspaceId: string, id: string, dto: CancelSubscriptionDto, userId?: string | null) {
    const s = await this.subs.findOne({ where: { id, workspaceId }, relations: { contact: true } });
    if (!s) throw new NotFoundException('Subscription not found');
    if (s.status === 'canceled') throw new BadRequestException('Subscription is already canceled');
    const atPeriodEnd = dto.atPeriodEnd !== false && s.status !== 'trialing' && !!s.currentPeriodEnd;
    if (atPeriodEnd) {
      await this.subs.update({ id }, { cancelAtPeriodEnd: true });
    } else {
      await this.finalizeCancel(s, userId);
    }
    return this.get(workspaceId, id);
  }

  async resume(workspaceId: string, id: string) {
    const s = await this.subs.findOne({ where: { id, workspaceId } });
    if (!s) throw new NotFoundException('Subscription not found');
    if (s.status === 'canceled') throw new BadRequestException('A canceled subscription cannot be resumed; create a new one');
    if (!s.cancelAtPeriodEnd) throw new BadRequestException('Subscription is not scheduled to cancel');
    await this.subs.update({ id }, { cancelAtPeriodEnd: false });
    return this.get(workspaceId, id);
  }

  private async finalizeCancel(s: Subscription, userId?: string | null) {
    await this.subs.update({ id: s.id }, { status: 'canceled', canceledAt: new Date(), nextBillingAt: null, cancelAtPeriodEnd: false });
    await this.activity.record(s.workspaceId, 'subscription.canceled', `Subscription ${s.name} canceled`, { entityType: 'contact', entityId: s.contactId, userId });
    this.events.emit({ type: 'subscription.canceled', workspaceId: s.workspaceId, userId, contactId: s.contactId, payload: { subscription: this.summaryOf(s) } });
  }

  /**
   * Issues the invoice for the period starting at nextBillingAt and advances the schedule.
   * Claims the row by moving nextBillingAt first, so concurrent ticks can't double-bill.
   */
  async billCycle(id: string, now: Date): Promise<boolean> {
    const s = await this.subs.findOne({ where: { id }, relations: { contact: true } });
    if (!s || s.status === 'canceled' || !s.nextBillingAt || s.nextBillingAt.getTime() > now.getTime()) return false;
    if (s.cancelAtPeriodEnd) {
      await this.finalizeCancel(s);
      return false;
    }
    const periodStart = s.nextBillingAt;
    const periodEnd = addInterval(periodStart, s.interval, s.anchorDay);
    const claim = await this.subs.update({ id, nextBillingAt: periodStart }, { nextBillingAt: periodEnd });
    if (!claim.affected) return false;

    const items = [{ name: `${s.name} — ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`, quantity: s.quantity, unitPrice: s.price }];
    let preset: { amount: number; code: string | null } = { amount: 0, code: null };
    let cyclesLeft = s.couponCyclesRemaining;
    if (s.couponId && (cyclesLeft === null || cyclesLeft > 0)) {
      const c = await this.coupons.getById(s.couponId);
      if (c) preset = { amount: couponDiscount(c, computeTotals(items).subtotal), code: c.code };
      if (cyclesLeft !== null) cyclesLeft -= 1;
    }
    const inv = await this.payments.createInvoice(
      s.workspaceId,
      {
        contactId: s.contactId,
        items,
        currency: s.currency,
        taxRate: s.taxRate,
        dueDate: new Date(now.getTime() + s.daysUntilDue * DAY).toISOString().slice(0, 10),
        notes: `Subscription: ${s.name} (${s.interval}ly)`,
      },
      null,
      { subscriptionId: s.id, presetDiscount: preset },
    );
    await this.subs.update(
      { id },
      { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cyclesBilled: s.cyclesBilled + 1, couponCyclesRemaining: cyclesLeft, status: s.status === 'trialing' ? 'active' : s.status },
    );
    if (inv.total <= 0) {
      await this.payments.markPaid(inv, 'free'); // 100% coupon: nothing to collect
    } else if (s.contact.email && !s.contact.dnd) {
      await this.payments.sendInvoice(s.workspaceId, inv.id).catch((err) => this.logger.warn(`Could not email ${inv.number}: ${err.message}`));
    } else {
      await this.invoices.update({ id: inv.id }, { status: 'sent' }); // pay link still works; send manually
    }
    return true;
  }

  /** Reminds once per overdue invoice; subscription invoices also mark the subscription past due. */
  private async chaseOverdue(now: Date, workspaceId?: string) {
    const today = now.toISOString().slice(0, 10);
    const overdue = await this.invoices.find({
      where: { status: 'sent', dueDate: LessThan(today), overdueNotifiedAt: IsNull(), ...(workspaceId ? { workspaceId } : {}) },
      relations: { contact: true },
      take: 50,
    });
    for (const inv of overdue) {
      const claimed = await this.invoices.update({ id: inv.id, overdueNotifiedAt: IsNull() }, { overdueNotifiedAt: now });
      if (!claimed.affected) continue;
      if (inv.subscriptionId) await this.subs.update({ id: inv.subscriptionId, status: 'active' }, { status: 'past_due' });
      if (inv.contact.email && !inv.contact.dnd) {
        await this.inbox
          .send(inv.workspaceId, {
            contactId: inv.contactId,
            channel: 'email',
            subject: `Reminder: invoice ${inv.number} is overdue`,
            body: `Hi ${inv.contact.firstName},\n\nA friendly reminder that invoice ${inv.number} for ${inv.currency} ${inv.total.toFixed(2)} was due on ${inv.dueDate}.\n\nPay online: ${this.payments.appUrl}/invoice/${inv.publicToken}\n\nThank you!`,
          })
          .catch(() => {});
      }
      await this.activity.record(inv.workspaceId, 'invoice.overdue', `Invoice ${inv.number} is overdue`, { entityType: 'invoice', entityId: inv.id });
      this.events.emit({
        type: 'invoice.overdue',
        workspaceId: inv.workspaceId,
        contactId: inv.contactId,
        payload: { invoice: { id: inv.id, number: inv.number, total: inv.total, currency: inv.currency, dueDate: inv.dueDate, subscriptionId: inv.subscriptionId } },
      });
    }
    return overdue.length;
  }

  async summary(workspaceId: string) {
    const live = await this.subs.find({ where: { workspaceId, status: In(['active', 'past_due', 'trialing']) } });
    const byCurrency: Record<string, number> = {};
    for (const s of live.filter((x) => x.status !== 'trialing')) byCurrency[s.currency] = round2((byCurrency[s.currency] ?? 0) + monthlyValue(s.price, s.quantity, s.interval));
    const canceled30 = await this.subs.count({ where: { workspaceId, status: 'canceled', canceledAt: LessThanOrEqual(new Date()) } });
    return {
      mrr: byCurrency,
      active: live.filter((s) => s.status === 'active').length,
      trialing: live.filter((s) => s.status === 'trialing').length,
      pastDue: live.filter((s) => s.status === 'past_due').length,
      canceled: canceled30,
    };
  }

  private summaryOf(s: Subscription) {
    return { id: s.id, name: s.name, price: s.price, interval: s.interval, currency: s.currency, quantity: s.quantity, status: s.status };
  }
}

@Controller('payments')
export class BillingController {
  constructor(private readonly subs: SubscriptionsService, private readonly coupons: CouponsService) {}

  // Subscriptions
  @Get('subscriptions/summary')
  @Permissions('payments:read')
  summary(@Tenant('workspaceId') ws: string) {
    return this.subs.summary(ws);
  }

  @Get('subscriptions')
  @Permissions('payments:read')
  list(@Tenant('workspaceId') ws: string, @Query('status') status?: string) {
    return this.subs.list(ws, status);
  }

  @Post('subscriptions')
  @Permissions('payments:write')
  create(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subs.create(ws, dto, userId);
  }

  @Get('subscriptions/:id')
  @Permissions('payments:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.get(ws, id);
  }

  @Post('subscriptions/:id/cancel')
  @Permissions('payments:write')
  cancel(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSubscriptionDto) {
    return this.subs.cancel(ws, id, dto, userId);
  }

  @Post('subscriptions/:id/resume')
  @Permissions('payments:write')
  resume(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.resume(ws, id);
  }

  // Coupons
  @Get('coupons')
  @Permissions('payments:read')
  coupons_(@Tenant('workspaceId') ws: string) {
    return this.coupons.list(ws);
  }

  @Get('coupons/preview')
  @Permissions('payments:read')
  preview(@Tenant('workspaceId') ws: string, @Query() q: PreviewCouponQuery) {
    return this.coupons.preview(ws, q.code, q.use ?? 'invoices', q.currency ?? 'USD', q.subtotal ?? 0);
  }

  @Post('coupons')
  @Permissions('payments:write')
  createCoupon(@Tenant('workspaceId') ws: string, @Body() dto: CreateCouponDto) {
    return this.coupons.create(ws, dto);
  }

  @Put('coupons/:id')
  @Permissions('payments:write')
  updateCoupon(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(ws, id, dto);
  }

  @Delete('coupons/:id')
  @Permissions('payments:write')
  deleteCoupon(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.remove(ws, id);
  }
}

/** Dev/ops hook: run one billing pass on demand (used by the smoke test). Not exposed in production. */
@Controller('payments/billing')
export class BillingOpsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Post('run')
  @Permissions('payments:write')
  run(@Tenant('workspaceId') ws: string, @Body('at') at?: string) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid date');
    return this.subs.tick(when, ws);
  }
}
