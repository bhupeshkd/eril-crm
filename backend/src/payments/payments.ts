import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { Invoice, InvoiceItem, Product } from '../database/entities/payment.entity';
import { OrderForm } from '../database/entities/order-form.entity';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { publicToken } from '../common/slug';
import { round2 } from './billing-math';
import { CouponsService } from './coupons';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';

// ---- DTOs ---------------------------------------------------------------------
class ProductFieldsDto {
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsIn(['one_time', 'month', 'year']) interval?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateProductDto extends ProductFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price: number;
}
export class UpdateProductDto extends ProductFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
}

export class InvoiceItemDto {
  @IsOptional() @IsUUID() productId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @Type(() => Number) @IsNumber() @Min(0.01) quantity: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice: number;
}
class InvoiceFieldsDto {
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount?: number;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}
export class CreateInvoiceDto extends InvoiceFieldsDto {
  @IsUUID() contactId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items: InvoiceItemDto[];
}
export class UpdateInvoiceDto extends InvoiceFieldsDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items?: InvoiceItemDto[];
}


export function computeTotals(items: InvoiceItem[], taxRate = 0, discount = 0) {
  const subtotal = round2(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = round2((afterDiscount * taxRate) / 100);
  return { subtotal, tax, total: round2(afterDiscount + tax) };
}

// ---- Service --------------------------------------------------------------------
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(OrderForm) private readonly orderForms: Repository<OrderForm>,
    private readonly ds: DataSource,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly coupons: CouponsService,
  ) {}

  get appUrl() {
    return this.config.get<string>('APP_URL') || 'http://localhost:3000';
  }

  get stripeKey() {
    return this.config.get<string>('STRIPE_SECRET_KEY') || '';
  }

  /** Test-mode payments are allowed only without Stripe and outside production. */
  get testMode() {
    return !this.stripeKey && process.env.NODE_ENV !== 'production' && this.config.get('PAYMENTS_TEST_MODE') !== 'false';
  }

  // Products
  listProducts(workspaceId: string) {
    return this.products.find({ where: { workspaceId }, order: { name: 'ASC' } });
  }
  createProduct(workspaceId: string, dto: CreateProductDto) {
    return this.products.save(this.products.create({ ...dto, workspaceId, currency: (dto.currency ?? 'USD').toUpperCase() }));
  }
  async updateProduct(workspaceId: string, id: string, dto: UpdateProductDto) {
    const p = await this.products.findOne({ where: { id, workspaceId } });
    if (!p) throw new NotFoundException('Product not found');
    Object.assign(p, dto);
    if (dto.currency) p.currency = dto.currency.toUpperCase();
    return this.products.save(p);
  }
  async deleteProduct(workspaceId: string, id: string) {
    const res = await this.products.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Product not found');
    return { id };
  }

  // Invoices
  listInvoices(workspaceId: string, status?: string) {
    return this.invoices.find({
      where: status ? { workspaceId, status: status as any } : { workspaceId },
      relations: { contact: true },
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  async getInvoice(workspaceId: string, id: string) {
    const inv = await this.invoices.findOne({ where: { id, workspaceId }, relations: { contact: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  private async assertContact(workspaceId: string, id: string) {
    if (!(await this.contacts.exist({ where: { id, workspaceId } }))) throw new NotFoundException('Contact not found');
  }

  async createInvoice(
    workspaceId: string,
    dto: CreateInvoiceDto,
    userId?: string | null,
    opts: {
      subscriptionId?: string;
      presetDiscount?: { amount: number; code: string | null };
      orderFormId?: string;
      status?: 'sent';
      parentInvoiceId?: string;
      upsellIndex?: number;
      upsellKind?: 'upsell' | 'downsell';
      source?: string;
      requestChannel?: 'sms' | 'email';
    } = {},
  ) {
    await this.assertContact(workspaceId, dto.contactId);
    const items = dto.items.map((i) => ({ ...i, unitPrice: round2(i.unitPrice) }));
    const currency = (dto.currency ?? 'USD').toUpperCase();
    const subtotal = computeTotals(items).subtotal;
    const inv = await this.ds.transaction(async (tx) => {
      let discount = dto.discount ?? 0;
      let couponCode: string | null = null;
      if (opts.presetDiscount) {
        discount = opts.presetDiscount.amount;
        couponCode = opts.presetDiscount.code;
      } else if (dto.couponCode?.trim()) {
        const c = await this.coupons.redeem(workspaceId, dto.couponCode, 'invoices', currency, tx);
        discount = (await this.coupons.discountFor(workspaceId, c.code, subtotal)) || 0;
        couponCode = c.code;
      }
      const totals = computeTotals(items, dto.taxRate ?? 0, discount);
      // Serialise numbering per workspace.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice:${workspaceId}`]);
      const count = await tx.count(Invoice, { where: { workspaceId }, withDeleted: true });
      return tx.save(
        tx.create(Invoice, {
          workspaceId,
          number: `INV-${String(count + 1).padStart(4, '0')}`,
          contactId: dto.contactId,
          items,
          currency,
          taxRate: dto.taxRate ?? 0,
          discount,
          couponCode,
          subscriptionId: opts.subscriptionId ?? null,
          orderFormId: opts.orderFormId ?? null,
          parentInvoiceId: opts.parentInvoiceId ?? null,
          upsellIndex: opts.upsellIndex ?? null,
          upsellKind: opts.upsellKind ?? null,
          source: opts.source ?? null,
          requestChannel: opts.requestChannel ?? null,
          status: opts.status ?? 'draft',
          dueDate: dto.dueDate ?? null,
          notes: dto.notes ?? '',
          publicToken: publicToken(),
          ...totals,
        }),
      );
    });
    await this.activity.record(workspaceId, 'invoice.created', `Invoice ${inv.number} created (${inv.currency} ${inv.total})`, {
      entityType: 'invoice',
      entityId: inv.id,
      userId,
    });
    return this.getInvoice(workspaceId, inv.id);
  }

  async updateInvoice(workspaceId: string, id: string, dto: UpdateInvoiceDto) {
    const inv = await this.getInvoice(workspaceId, id);
    if (inv.status === 'paid' || inv.status === 'void') throw new BadRequestException(`A ${inv.status} invoice cannot be edited`);
    if (dto.contactId) await this.assertContact(workspaceId, dto.contactId);
    Object.assign(inv, {
      contactId: dto.contactId ?? inv.contactId,
      items: dto.items ?? inv.items,
      currency: (dto.currency ?? inv.currency).toUpperCase(),
      taxRate: dto.taxRate ?? inv.taxRate,
      discount: dto.discount ?? inv.discount,
      dueDate: dto.dueDate !== undefined ? dto.dueDate : inv.dueDate,
      notes: dto.notes ?? inv.notes,
    });
    if (inv.couponCode) inv.discount = await this.coupons.discountFor(workspaceId, inv.couponCode, computeTotals(inv.items).subtotal);
    Object.assign(inv, computeTotals(inv.items, inv.taxRate, inv.discount));
    const { contact, ...row } = inv;
    await this.invoices.save(row);
    return this.getInvoice(workspaceId, id);
  }

  async sendInvoice(workspaceId: string, id: string, userId?: string | null) {
    const inv = await this.getInvoice(workspaceId, id);
    if (inv.status === 'paid' || inv.status === 'void') throw new BadRequestException(`Invoice is already ${inv.status}`);
    if (!inv.contact.email) throw new BadRequestException('Contact has no email address');
    const link = `${this.appUrl}/invoice/${inv.publicToken}`;
    const msg = await this.inbox.send(
      workspaceId,
      {
        contactId: inv.contactId,
        channel: 'email',
        subject: `Invoice ${inv.number}`,
        body: `Hi ${inv.contact.firstName},\n\nYour invoice ${inv.number} for ${inv.currency} ${inv.total.toFixed(2)} is ready.${
          inv.dueDate ? ` It is due on ${inv.dueDate}.` : ''
        }\n\nView and pay online: ${link}\n\nThank you!`,
      },
      userId,
    );
    if (msg.status === 'failed') throw new BadRequestException(`Email failed: ${msg.error}`);
    await this.invoices.update({ id }, { status: 'sent' });
    return { ...inv, status: 'sent', link };
  }

  async voidInvoice(workspaceId: string, id: string) {
    const inv = await this.getInvoice(workspaceId, id);
    if (inv.status === 'paid') throw new BadRequestException('A paid invoice cannot be voided');
    await this.invoices.update({ id }, { status: 'void' });
    return { id, status: 'void' };
  }

  async deleteInvoice(workspaceId: string, id: string) {
    const inv = await this.getInvoice(workspaceId, id);
    if (inv.status !== 'draft') throw new BadRequestException('Only draft invoices can be deleted; void it instead');
    await this.invoices.softDelete({ id });
    return { id };
  }

  async markPaid(inv: Invoice, method: string, userId?: string | null) {
    if (inv.status === 'paid') return inv;
    if (inv.status === 'void') throw new BadRequestException('Invoice is void');
    await this.invoices.update({ id: inv.id }, { status: 'paid', paidAt: new Date(), paymentMethod: method });
    await this.activity.record(inv.workspaceId, 'invoice.paid', `Invoice ${inv.number} paid (${inv.currency} ${inv.total})`, {
      entityType: 'invoice',
      entityId: inv.id,
      userId,
    });
    this.events.emit({
      type: 'invoice.paid',
      workspaceId: inv.workspaceId,
      userId,
      contactId: inv.contactId,
      payload: { invoice: { id: inv.id, number: inv.number, total: inv.total, currency: inv.currency, method, subscriptionId: inv.subscriptionId } },
    });
    if (inv.orderFormId) {
      const form = await this.orderForms.findOne({ where: { id: inv.orderFormId }, withDeleted: true });
      this.events.emit({
        type: 'order.paid',
        workspaceId: inv.workspaceId,
        userId,
        contactId: inv.contactId,
        payload: {
          form: { id: inv.orderFormId, name: form?.name },
          invoice: { id: inv.id, number: inv.number, total: inv.total, currency: inv.currency, items: inv.items, method },
          upsell: inv.parentInvoiceId ? { index: inv.upsellIndex, parentInvoiceId: inv.parentInvoiceId } : null,
        },
      });
    }
    return { ...inv, status: 'paid' };
  }

  // Public pay page
  async byToken(token: string) {
    const inv = await this.invoices.findOne({ where: { publicToken: token }, relations: { contact: true } });
    if (!inv || inv.status === 'draft') throw new NotFoundException('Invoice not found');
    return inv;
  }

  async checkout(token: string) {
    const inv = await this.byToken(token);
    if (inv.status !== 'sent') throw new BadRequestException(`Invoice is ${inv.status}`);
    if (!this.stripeKey) {
      if (!this.testMode) throw new BadRequestException('Online payments are not configured');
      return { mode: 'test' as const };
    }
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: `${this.appUrl}/invoice/${token}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appUrl}/invoice/${token}`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': inv.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(inv.total * 100)),
      'line_items[0][price_data][product_data][name]': `Invoice ${inv.number}`,
      'metadata[invoice_id]': inv.id,
    });
    if (inv.contact.email) params.set('customer_email', inv.contact.email);
    if (inv.orderFormId && !inv.parentInvoiceId) {
      const form = await this.orderForms.findOne({ where: { id: inv.orderFormId } });
      if (form?.upsells?.length) {
        // Keep the card on file so post-purchase offers can be accepted with one click.
        params.set('customer_creation', 'always');
        params.set('payment_intent_data[setup_future_usage]', 'off_session');
      }
    }
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const json: any = await res.json();
    if (!res.ok) {
      this.logger.error(`Stripe error: ${json?.error?.message}`);
      throw new BadRequestException('Could not start checkout');
    }
    await this.invoices.update({ id: inv.id }, { stripeSessionId: json.id });
    return { mode: 'stripe' as const, url: json.url };
  }

  /** Verifies a completed Stripe Checkout session server-side, then marks paid. */
  async confirm(token: string, sessionId: string) {
    const inv = await this.byToken(token);
    if (inv.status === 'paid') return { status: 'paid' };
    if (!this.stripeKey || !sessionId || sessionId !== inv.stripeSessionId) throw new BadRequestException('Invalid session');
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`, {
      headers: { Authorization: `Bearer ${this.stripeKey}` },
    });
    const json: any = await res.json();
    if (res.ok && json.payment_status === 'paid' && json.metadata?.invoice_id === inv.id) {
      const customer = typeof json.customer === 'string' ? json.customer : json.customer?.id;
      const pm = json.payment_intent?.payment_method;
      if (customer && pm) {
        await this.invoices.update({ id: inv.id }, { stripeCustomerId: customer, stripePaymentMethodId: typeof pm === 'string' ? pm : pm.id });
      }
      await this.markPaid(inv, 'stripe');
      return { status: 'paid' };
    }
    return { status: inv.status };
  }

  /** Customer applies a coupon on the hosted pay page (one coupon per invoice). */
  async applyCouponPublic(token: string, code: string) {
    const inv = await this.byToken(token);
    if (inv.status !== 'sent') throw new BadRequestException(`Invoice is ${inv.status}`);
    if (inv.couponCode) throw new BadRequestException('A coupon is already applied to this invoice');
    if (inv.subscriptionId) throw new BadRequestException('Coupons for subscriptions are applied when the subscription is set up');
    if (!code?.trim()) throw new BadRequestException('Enter a coupon code');
    await this.ds.transaction(async (tx) => {
      const c = await this.coupons.redeem(inv.workspaceId, code, 'invoices', inv.currency, tx);
      const subtotal = computeTotals(inv.items).subtotal;
      const discount = await this.coupons.discountFor(inv.workspaceId, c.code, subtotal);
      await tx.update(Invoice, { id: inv.id }, { couponCode: c.code, discount, ...computeTotals(inv.items, inv.taxRate, discount) });
    });
    return { ok: true };
  }

  async testPay(token: string) {
    if (!this.testMode) throw new ForbiddenException('Test payments are disabled');
    const inv = await this.byToken(token);
    await this.markPaid(inv, 'test');
    return { status: 'paid' };
  }

  /** Offers stay open for 30 minutes after payment, so an old link can't be used to charge the card later. */
  static readonly UPSELL_WINDOW_MS = 30 * 60_000;

  async pendingOffer(inv: Invoice) {
    if (inv.status !== 'paid' || !inv.orderFormId || inv.parentInvoiceId) return null;
    if (!['test', 'stripe'].includes(inv.paymentMethod ?? '')) return null;
    if (!inv.paidAt || Date.now() - new Date(inv.paidAt).getTime() > PaymentsService.UPSELL_WINDOW_MS) return null;
    const form = await this.orderForms.findOne({ where: { id: inv.orderFormId } });
    if (!form) return null;
    // Offers whose product was switched off are skipped, without letting the buyer answer them.
    const build = async (o: { productId: string; headline: string; description: string; acceptLabel: string; declineLabel: string }, index: number, kind: 'upsell' | 'downsell') => {
      const p = await this.products.findOne({ where: { id: o.productId, workspaceId: inv.workspaceId, isActive: true } });
      if (!p) return null;
      return {
        index,
        kind,
        total: form.upsells.length,
        headline: o.headline,
        description: o.description,
        acceptLabel: o.acceptLabel || 'Yes, add it to my order',
        declineLabel: o.declineLabel || 'No thanks',
        product: { name: p.name, description: p.description, price: p.price, currency: p.currency, interval: p.interval },
        taxRate: form.taxRate,
      };
    };
    // A declined upsell's downsell comes before the next upsell.
    if (inv.pendingDownsell !== null && inv.pendingDownsell !== undefined) {
      const d = form.upsells?.[inv.pendingDownsell]?.downsell;
      const offer = d ? await build(d, inv.pendingDownsell, 'downsell') : null;
      if (offer) return offer;
    }
    for (let i = inv.upsellStep; i < (form.upsells?.length ?? 0); i++) {
      const offer = await build(form.upsells[i], i, 'upsell');
      if (offer) return offer;
    }
    return null;
  }

  /** Charges a saved card without the buyer present. Returns false when Stripe needs the buyer (e.g. 3-D Secure). */
  async chargeSaved(inv: Invoice, customer: string, paymentMethod: string): Promise<boolean> {
    if (!this.stripeKey) return false;
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Retrying the same invoice never charges twice.
        'Idempotency-Key': `upsell-${inv.id}`,
      },
      body: new URLSearchParams({
        amount: String(Math.round(inv.total * 100)),
        currency: inv.currency.toLowerCase(),
        customer,
        payment_method: paymentMethod,
        off_session: 'true',
        confirm: 'true',
        description: `Invoice ${inv.number}`,
        'metadata[invoice_id]': inv.id,
      }),
    });
    const json: any = await res.json();
    if (res.ok && json.status === 'succeeded') return true;
    this.logger.warn(`One-click charge for ${inv.number} not completed: ${json?.error?.code ?? json?.status}`);
    return false;
  }

  /** Upsells bought after an order (shown on the buyer's confirmation). */
  async addOnsOf(invoiceId: string) {
    const list = await this.invoices.find({ where: { parentInvoiceId: invoiceId }, order: { createdAt: 'ASC' } });
    return list.map((i) => ({ name: i.items.map((x) => x.name).join(', '), total: i.total, currency: i.currency, status: i.status, payUrl: i.status === 'sent' ? `/invoice/${i.publicToken}` : null }));
  }

  async thankYouFor(orderFormId: string) {
    const f = await this.orderForms.findOne({ where: { id: orderFormId }, withDeleted: true });
    return f ? { message: f.thankYouMessage, redirectUrl: f.redirectUrl || null } : null;
  }

  async summary(workspaceId: string) {
    const rows = await this.invoices
      .createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(i.total),0)', 'total')
      .where('i.workspace_id = :workspaceId', { workspaceId })
      .groupBy('i.status')
      .getRawMany();
    const by = (s: string) => rows.find((r) => r.status === s) ?? { count: 0, total: 0 };
    return {
      paid: Number(by('paid').total),
      paidCount: Number(by('paid').count),
      outstanding: Number(by('sent').total),
      outstandingCount: Number(by('sent').count),
      drafts: Number(by('draft').count),
      testMode: this.testMode,
      stripeConfigured: !!this.stripeKey,
    };
  }
}

// ---- Controllers ------------------------------------------------------------------
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get('summary')
  @Permissions('payments:read')
  summary(@Tenant('workspaceId') ws: string) {
    return this.svc.summary(ws);
  }

  @Get('products')
  @Permissions('payments:read')
  products(@Tenant('workspaceId') ws: string) {
    return this.svc.listProducts(ws);
  }

  @Post('products')
  @Permissions('payments:write')
  createProduct(@Tenant('workspaceId') ws: string, @Body() dto: CreateProductDto) {
    return this.svc.createProduct(ws, dto);
  }

  @Put('products/:id')
  @Permissions('payments:write')
  updateProduct(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.svc.updateProduct(ws, id, dto);
  }

  @Delete('products/:id')
  @Permissions('payments:write')
  deleteProduct(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteProduct(ws, id);
  }

  @Get('invoices')
  @Permissions('invoices:read')
  invoices(@Tenant('workspaceId') ws: string, @Query('status') status?: string) {
    return this.svc.listInvoices(ws, status);
  }

  @Post('invoices')
  @Permissions('invoices:write')
  createInvoice(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: CreateInvoiceDto) {
    return this.svc.createInvoice(ws, dto, userId);
  }

  @Get('invoices/:id')
  @Permissions('invoices:read')
  async getInvoice(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    const inv = await this.svc.getInvoice(ws, id);
    return { ...inv, link: `${this.svc.appUrl}/invoice/${inv.publicToken}` };
  }

  @Put('invoices/:id')
  @Permissions('invoices:write')
  updateInvoice(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.svc.updateInvoice(ws, id, dto);
  }

  @Post('invoices/:id/send')
  @Permissions('invoices:write')
  send(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.sendInvoice(ws, id, userId);
  }

  @Post('invoices/:id/mark-paid')
  @Permissions('invoices:write')
  async markPaid(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markPaid(await this.svc.getInvoice(ws, id), 'manual', userId);
  }

  @Post('invoices/:id/void')
  @Permissions('invoices:write')
  void(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.voidInvoice(ws, id);
  }

  @Delete('invoices/:id')
  @Permissions('invoices:write')
  deleteInvoice(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteInvoice(ws, id);
  }
}

@Controller('public/invoices')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicInvoicesController {
  constructor(private readonly svc: PaymentsService) {}

  @Get(':token')
  async get(@Param('token') token: string) {
    const inv = await this.svc.byToken(token);
    return {
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      items: inv.items,
      subtotal: inv.subtotal,
      discount: inv.discount,
      taxRate: inv.taxRate,
      tax: inv.tax,
      total: inv.total,
      dueDate: inv.dueDate,
      notes: inv.notes,
      paidAt: inv.paidAt,
      billedTo: `${inv.contact.firstName} ${inv.contact.lastName}`.trim(),
      couponCode: inv.couponCode,
      canApplyCoupon: inv.status === 'sent' && !inv.couponCode && !inv.subscriptionId,
      testMode: this.svc.testMode,
      // Order-form purchases show the form's thank-you message (and optional redirect) once paid.
      ...(await this.orderFinish(inv)),
    };
  }

  /** A paid order shows its next one-click offer first; the thank-you (and redirect) only once none is left. */
  private async orderFinish(inv: Invoice) {
    if (inv.status !== 'paid' || !inv.orderFormId) return { offer: null, addOns: [], thankYou: null };
    const offer = await this.svc.pendingOffer(inv);
    const addOns = inv.parentInvoiceId ? [] : await this.svc.addOnsOf(inv.id);
    return { offer, addOns, thankYou: offer ? null : await this.svc.thankYouFor(inv.orderFormId) };
  }

  @Post(':token/checkout')
  checkout(@Param('token') token: string) {
    return this.svc.checkout(token);
  }

  @Post(':token/confirm')
  confirm(@Param('token') token: string, @Body('sessionId') sessionId: string) {
    return this.svc.confirm(token, sessionId);
  }

  @Post(':token/coupon')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  applyCoupon(@Param('token') token: string, @Body('code') code: string) {
    return this.svc.applyCouponPublic(token, String(code ?? '').slice(0, 40));
  }

  @Post(':token/test-pay')
  testPay(@Param('token') token: string) {
    return this.svc.testPay(token);
  }
}
