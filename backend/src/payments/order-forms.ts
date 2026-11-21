import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { In, Repository } from 'typeorm';
import { OrderBump, OrderForm, UpsellOffer } from '../database/entities/order-form.entity';
import { Invoice, Product } from '../database/entities/payment.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { makeSlug } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { ContactsService } from '../crm/contacts.service';
import { PaymentsService, computeTotals } from './payments';
import { CouponsService } from './coupons';
import { SubscriptionsService } from './subscriptions';
import { addInterval } from './billing-math';

class OrderFormFieldsDto {
  @IsOptional() @IsString() @MaxLength(255) headline?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) productIds?: string[];
  @IsOptional() @ValidateIf((o) => o.bump !== null) @IsObject() bump?: OrderBump | null;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsObject({ each: true }) upsells?: UpsellOffer[];
  @IsOptional() @IsBoolean() collectPhone?: boolean;
  @IsOptional() @IsBoolean() allowQuantity?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxQuantity?: number;
  @IsOptional() @IsBoolean() allowCoupons?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) buttonLabel?: string;
  @IsOptional() @IsString() @MaxLength(2000) thankYouMessage?: string;
  @IsOptional() @IsString() @MaxLength(1000) redirectUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateOrderFormDto extends OrderFormFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
}
export class UpdateOrderFormDto extends OrderFormFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}
export class PublicOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsUUID() productId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsOptional() @IsBoolean() bump?: boolean;
  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
}
export class UpsellAnswerDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(2) index: number;
  @IsBoolean() accept: boolean;
  /** Which offer at that position: the upsell or its downsell. */
  @IsOptional() @IsIn(['upsell', 'downsell']) kind?: 'upsell' | 'downsell';
}
export class PublicCouponDto {
  @IsString() @IsNotEmpty() @MaxLength(40) code: string;
  @IsUUID() productId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsOptional() @IsBoolean() bump?: boolean;
}

const INTERVAL_LABEL: Record<string, string> = { month: 'first month', year: 'first year' };

@Injectable()
export class OrderFormsService implements OnModuleInit {
  private readonly logger = new Logger(OrderFormsService.name);

  constructor(
    @InjectRepository(OrderForm) private readonly forms: Repository<OrderForm>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly payments: PaymentsService,
    private readonly coupons: CouponsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly contacts: ContactsService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit() {
    // Recurring products: the order pays the first period, then a subscription bills from the next one.
    this.events.onAny((e) => {
      if (e.type !== 'order.paid') return;
      this.startSubscriptions(e.workspaceId, e.payload?.invoice?.id).catch((err) => this.logger.error(`Order subscription failed: ${err.message}`));
    });
  }

  // ---- Admin ----
  async list(workspaceId: string) {
    const [forms, stats] = await Promise.all([
      this.forms.find({ where: { workspaceId }, order: { createdAt: 'DESC' } }),
      this.invoices.query(
        `SELECT order_form_id AS id,
                COUNT(*) FILTER (WHERE parent_invoice_id IS NULL)::int AS orders,
                COUNT(*) FILTER (WHERE status = 'paid' AND parent_invoice_id IS NULL)::int AS paid,
                COUNT(*) FILTER (WHERE status = 'paid' AND parent_invoice_id IS NOT NULL)::int AS "upsellsPaid",
                COUNT(*) FILTER (WHERE status = 'paid' AND upsell_kind = 'downsell')::int AS "downsellsPaid",
                COALESCE(SUM(total) FILTER (WHERE status = 'paid' AND parent_invoice_id IS NOT NULL), 0)::float AS "upsellRevenue",
                COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0)::float AS revenue
           FROM invoices WHERE workspace_id = $1 AND order_form_id IS NOT NULL AND deleted_at IS NULL
          GROUP BY order_form_id`,
        [workspaceId],
      ),
    ]);
    return forms.map((f) => {
      const s = stats.find((x: any) => x.id === f.id);
      return { ...f, orders: s?.orders ?? 0, paid: s?.paid ?? 0, revenue: s?.revenue ?? 0, upsellsPaid: s?.upsellsPaid ?? 0, downsellsPaid: s?.downsellsPaid ?? 0, upsellRevenue: s?.upsellRevenue ?? 0 };
    });
  }

  async get(workspaceId: string, id: string) {
    const f = await this.forms.findOne({ where: { id, workspaceId } });
    if (!f) throw new NotFoundException('Order form not found');
    return f;
  }

  /** Products must be active, in this workspace and share one currency; the bump must be one-time. */
  private async validate(workspaceId: string, f: Partial<OrderForm>) {
    const ids = [...new Set(f.productIds ?? [])];
    const bumpId = f.bump?.productId;
    const offer = (u: any, fallbackAccept: string) => ({
      productId: String(u?.productId ?? ''),
      headline: String(u?.headline ?? '').trim().slice(0, 255),
      description: String(u?.description ?? '').slice(0, 2000),
      acceptLabel: String(u?.acceptLabel ?? '').trim().slice(0, 80) || fallbackAccept,
      declineLabel: String(u?.declineLabel ?? '').trim().slice(0, 80) || 'No thanks',
    });
    const upsells = (f.upsells ?? []).map((u) => ({
      ...offer(u, 'Yes, add it to my order'),
      downsell: u?.downsell ? offer(u.downsell, 'Yes, I’ll take this instead') : null,
    }));
    if (upsells.some((u) => !u.productId || !u.headline)) throw new BadRequestException('Each upsell needs a product and a headline');
    if (upsells.some((u) => u.downsell && (!u.downsell.productId || !u.downsell.headline))) throw new BadRequestException('Each downsell needs a product and a headline');
    const upsellIds = upsells.flatMap((u) => [u.productId, ...(u.downsell ? [u.downsell.productId] : [])]);
    if (f.bump && (!bumpId || !String(f.bump.headline ?? '').trim())) throw new BadRequestException('An order bump needs a product and a headline');
    const all = await this.products.find({ where: { workspaceId, id: In([...ids, ...upsellIds, ...(bumpId ? [bumpId] : [])]) } });
    if (
      all.filter((p) => ids.includes(p.id)).length !== ids.length ||
      (bumpId && !all.some((p) => p.id === bumpId)) ||
      upsellIds.some((id) => !all.some((p) => p.id === id))
    ) {
      throw new BadRequestException('Some products were not found');
    }
    if (new Set(all.map((p) => p.currency)).size > 1) throw new BadRequestException('All products on an order form must use the same currency');
    const bumpProduct = all.find((p) => p.id === bumpId);
    if (bumpProduct && bumpProduct.interval !== 'one_time') throw new BadRequestException('The order bump must be a one-time product');
    const url = (f.redirectUrl ?? '').trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequestException('Redirect URL must start with http:// or https://');
    return {
      productIds: ids,
      bump: f.bump ? { productId: bumpId!, headline: f.bump.headline.trim().slice(0, 255), description: String(f.bump.description ?? '').slice(0, 1000) } : null,
      redirectUrl: url,
      upsells,
      tags: (f.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
    };
  }

  async create(workspaceId: string, dto: CreateOrderFormDto) {
    const clean = await this.validate(workspaceId, dto);
    return this.forms.save(this.forms.create({ ...dto, ...clean, workspaceId, slug: makeSlug(dto.name) }));
  }

  async update(workspaceId: string, id: string, dto: UpdateOrderFormDto) {
    const f = await this.get(workspaceId, id);
    Object.assign(f, dto);
    Object.assign(f, await this.validate(workspaceId, f));
    return this.forms.save(f);
  }

  async remove(workspaceId: string, id: string) {
    const f = await this.get(workspaceId, id);
    await this.forms.softRemove(f);
    return { id };
  }

  async orders(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    return this.invoices.find({ where: { workspaceId, orderFormId: id }, relations: { contact: true }, order: { createdAt: 'DESC' }, take: 500 });
  }

  // ---- Public ----
  private async publicForm(slug: string) {
    const f = await this.forms.findOne({ where: { slug, isActive: true } });
    if (!f || !f.productIds.length) throw new NotFoundException('This order form does not exist or is turned off');
    return f;
  }

  private async formProducts(f: OrderForm) {
    const ids = [...f.productIds, ...(f.bump ? [f.bump.productId] : [])];
    const list = await this.products.find({ where: { workspaceId: f.workspaceId, id: In(ids), isActive: true } });
    return {
      main: f.productIds.map((id) => list.find((p) => p.id === id)).filter(Boolean) as Product[],
      bump: f.bump ? list.find((p) => p.id === f.bump!.productId) ?? null : null,
    };
  }

  async publicInfo(slug: string) {
    const f = await this.publicForm(slug);
    await this.forms.increment({ id: f.id }, 'views', 1);
    const { main, bump } = await this.formProducts(f);
    if (!main.length) throw new NotFoundException('This order form has no products available');
    const pub = (p: Product) => ({ id: p.id, name: p.name, description: p.description, price: p.price, currency: p.currency, interval: p.interval });
    return {
      name: f.name,
      headline: f.headline || f.name,
      description: f.description,
      products: main.map(pub),
      bump: bump && f.bump ? { ...pub(bump), headline: f.bump.headline, description: f.bump.description } : null,
      collectPhone: f.collectPhone,
      allowQuantity: f.allowQuantity,
      maxQuantity: f.allowQuantity ? f.maxQuantity : 1,
      allowCoupons: f.allowCoupons,
      taxRate: f.taxRate,
      buttonLabel: f.buttonLabel,
      currency: main[0].currency,
    };
  }

  private async lineItems(f: OrderForm, productId: string, withBump?: boolean, quantity = 1) {
    const { main, bump } = await this.formProducts(f);
    const p = main.find((x) => x.id === productId);
    if (!p) throw new BadRequestException('Please choose one of the offered products');
    // Quantities apply to the main product only, and only when the form allows them.
    if (quantity !== 1 && !f.allowQuantity) throw new BadRequestException('This form sells one at a time');
    if (quantity > f.maxQuantity) throw new BadRequestException(`You can order up to ${f.maxQuantity} at a time`);
    const items = [{ productId: p.id, name: p.interval === 'one_time' ? p.name : `${p.name} (${INTERVAL_LABEL[p.interval]})`, quantity, unitPrice: p.price }];
    if (withBump && bump) items.push({ productId: bump.id, name: bump.name, quantity: 1, unitPrice: bump.price });
    return { items, currency: p.currency };
  }

  /** Coupon check for the live order summary (does not use up the coupon). */
  async publicCoupon(slug: string, dto: PublicCouponDto) {
    const f = await this.publicForm(slug);
    if (!f.allowCoupons) throw new BadRequestException('Coupons are not accepted on this form');
    const { items, currency } = await this.lineItems(f, dto.productId, dto.bump, dto.quantity ?? 1);
    const subtotal = computeTotals(items).subtotal;
    const c = await this.coupons.preview(f.workspaceId, dto.code, 'invoices', currency, subtotal);
    return { code: c.code, discount: c.discount, ...computeTotals(items, f.taxRate, c.discount) };
  }

  async publicOrder(slug: string, dto: PublicOrderDto) {
    const f = await this.publicForm(slug);
    const { items, currency } = await this.lineItems(f, dto.productId, dto.bump, dto.quantity ?? 1);
    if (dto.couponCode?.trim() && !f.allowCoupons) throw new BadRequestException('Coupons are not accepted on this form');
    const [firstName, ...rest] = dto.name.trim().split(/\s+/);
    const { contact } = await this.contacts.upsert(f.workspaceId, {
      firstName,
      lastName: rest.join(' '),
      email: dto.email,
      phone: f.collectPhone ? dto.phone || undefined : undefined,
      tags: f.tags,
      source: 'order_form',
    });
    const inv = await this.payments.createInvoice(
      f.workspaceId,
      { contactId: contact.id, items, currency, taxRate: f.taxRate, couponCode: dto.couponCode?.trim() || undefined, notes: `Order from “${f.name}”` },
      null,
      { orderFormId: f.id, status: 'sent' },
    );
    await this.activity.record(f.workspaceId, 'order.submitted', `${contact.firstName} placed an order on “${f.name}” (${inv.currency} ${inv.total})`, {
      entityType: 'contact',
      entityId: contact.id,
    });
    this.events.emit({
      type: 'order.submitted',
      workspaceId: f.workspaceId,
      contactId: contact.id,
      payload: { form: { id: f.id, name: f.name }, invoice: { id: inv.id, number: inv.number, total: inv.total, currency: inv.currency, items: inv.items }, contact },
    });
    return { token: inv.publicToken, number: inv.number, total: inv.total, currency: inv.currency };
  }

  /**
   * Buyer answers the current post-purchase offer. Each offer is answered once (atomic step claim),
   * only while the order's offer window is open. Accepting charges without re-entering card details
   * (test mode, or Stripe's saved card); if Stripe needs the buyer, they finish on the normal pay page.
   */
  async answerUpsell(token: string, dto: UpsellAnswerDto) {
    const parent = await this.invoices
      .createQueryBuilder('i')
      .addSelect(['i.stripeCustomerId', 'i.stripePaymentMethodId'])
      .where('i.public_token = :token', { token })
      .getOne();
    if (!parent || parent.status === 'draft') throw new NotFoundException('Order not found');
    const kind = dto.kind ?? 'upsell';
    const current = await this.payments.pendingOffer(parent);
    if (!current || current.index !== dto.index || current.kind !== kind) throw new ConflictException('This offer is no longer available');
    const form = await this.forms.findOneOrFail({ where: { id: parent.orderFormId! }, withDeleted: true });
    const up = form.upsells[dto.index];
    const o = kind === 'downsell' ? up.downsell! : up;
    // Declining an upsell queues its downsell (if that product is still on sale).
    const queueDownsell =
      kind === 'upsell' &&
      !dto.accept &&
      !!up.downsell &&
      (await this.products.exist({ where: { id: up.downsell.productId, workspaceId: parent.workspaceId, isActive: true } }));
    const claim = this.invoices.createQueryBuilder().update(Invoice);
    // Each claim only succeeds from the expected state, so double clicks and skipped steps are rejected.
    const claimed =
      kind === 'upsell'
        ? await claim
            .set({ upsellStep: dto.index + 1, pendingDownsell: queueDownsell ? dto.index : null })
            .where('id = :id AND upsell_step <= :i', { id: parent.id, i: dto.index })
            .execute()
        : await claim.set({ pendingDownsell: null }).where('id = :id AND pending_downsell = :i', { id: parent.id, i: dto.index }).execute();
    if (!claimed.affected) throw new ConflictException('This offer was already answered');
    const label = kind === 'downsell' ? 'Downsell' : 'Upsell';
    if (!dto.accept) {
      await this.activity.record(parent.workspaceId, `order.${kind}_declined`, `${label} “${o.headline}” declined on order ${parent.number}`, { entityType: 'contact', entityId: parent.contactId });
      return { status: 'declined' as const };
    }
    const p = await this.products.findOneOrFail({ where: { id: o.productId, workspaceId: parent.workspaceId } });
    const inv = await this.payments.createInvoice(
      parent.workspaceId,
      {
        contactId: parent.contactId,
        items: [{ productId: p.id, name: p.interval === 'one_time' ? p.name : `${p.name} (${INTERVAL_LABEL[p.interval]})`, quantity: 1, unitPrice: p.price }],
        currency: p.currency,
        taxRate: form.taxRate,
        notes: `Add-on to order ${parent.number}`,
      },
      null,
      { orderFormId: form.id, status: 'sent', parentInvoiceId: parent.id, upsellIndex: dto.index, upsellKind: kind },
    );
    let paid = false;
    if (parent.paymentMethod === 'test' && this.payments.testMode) {
      await this.payments.markPaid(inv, 'test');
      paid = true;
    } else if (parent.paymentMethod === 'stripe' && parent.stripeCustomerId && parent.stripePaymentMethodId) {
      paid = await this.payments.chargeSaved(inv, parent.stripeCustomerId, parent.stripePaymentMethodId).catch(() => false);
      if (paid) await this.payments.markPaid(inv, 'stripe');
    }
    await this.activity.record(parent.workspaceId, `order.${kind}_accepted`, `${label} “${o.headline}” accepted on order ${parent.number} (${inv.currency} ${inv.total})`, {
      entityType: 'contact',
      entityId: parent.contactId,
    });
    return paid ? { status: 'paid' as const } : { status: 'requires_payment' as const, payUrl: `/invoice/${inv.publicToken}` };
  }

  private async startSubscriptions(workspaceId: string, invoiceId?: string) {
    if (!invoiceId) return;
    const inv = await this.invoices.findOne({ where: { id: invoiceId, workspaceId } });
    if (!inv?.orderFormId) return;
    const ids = inv.items.map((i) => i.productId).filter(Boolean) as string[];
    const recurring = await this.products.find({ where: { workspaceId, id: In(ids) } });
    for (const p of recurring.filter((x) => x.interval === 'month' || x.interval === 'year')) {
      const item = inv.items.find((i) => i.productId === p.id)!;
      await this.subscriptions.create(workspaceId, {
        contactId: inv.contactId,
        productId: p.id,
        quantity: item.quantity,
        taxRate: inv.taxRate,
        startDate: addInterval(inv.paidAt ?? new Date(), p.interval as 'month' | 'year').toISOString(),
      });
    }
  }
}

@Controller('payments/order-forms')
export class OrderFormsController {
  constructor(private readonly svc: OrderFormsService) {}

  @Get()
  @Permissions('payments:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('payments:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateOrderFormDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('payments:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, id);
  }

  @Get(':id/orders')
  @Permissions('invoices:read')
  orders(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.orders(ws, id);
  }

  @Put(':id')
  @Permissions('payments:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderFormDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('payments:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }
}

@Controller('public/order-forms')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicOrderFormsController {
  constructor(private readonly svc: OrderFormsService) {}

  @Get(':slug')
  info(@Param('slug') slug: string) {
    return this.svc.publicInfo(slug);
  }

  @Post(':slug/coupon')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  coupon(@Param('slug') slug: string, @Body() dto: PublicCouponDto) {
    return this.svc.publicCoupon(slug, dto);
  }

  @Post('upsell/:token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  upsell(@Param('token') token: string, @Body() dto: UpsellAnswerDto) {
    return this.svc.answerUpsell(token, dto);
  }

  @Post(':slug/order')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  order(@Param('slug') slug: string, @Body() dto: PublicOrderDto) {
    return this.svc.publicOrder(slug, dto);
  }
}

