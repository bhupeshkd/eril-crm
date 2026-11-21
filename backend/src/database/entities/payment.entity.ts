import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

const money = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('products')
@Index(['workspaceId'])
export class Product extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, transformer: money })
  price: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  /** one_time | month | year */
  @Column({ type: 'varchar', length: 10, default: 'one_time' })
  interval: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

export interface InvoiceItem {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;

@Entity('invoices')
@Index(['workspaceId', 'number'], { unique: true })
@Index(['publicToken'], { unique: true })
export class Invoice extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 30 })
  number: string;

  @ManyToOne(() => Contact, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  items: InvoiceItem[];

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, transformer: money })
  subtotal: number;

  /** Percentage, e.g. 18 for 18% */
  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0, transformer: money })
  taxRate: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, transformer: money })
  tax: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, transformer: money })
  discount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0, transformer: money })
  total: number;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: (typeof INVOICE_STATUSES)[number];

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ name: 'public_token', length: 64 })
  publicToken: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** stripe | manual | test */
  @Column({ name: 'payment_method', type: 'varchar', length: 20, nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'stripe_session_id', type: 'varchar', length: 255, nullable: true })
  stripeSessionId: string | null;

  @Column({ name: 'coupon_code', type: 'varchar', length: 40, nullable: true })
  couponCode: string | null;

  /** Set when the invoice was issued by a subscription billing cycle. */
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ name: 'overdue_notified_at', type: 'timestamptz', nullable: true })
  overdueNotifiedAt: Date | null;

  /** How the invoice came about: null (manual), text_to_pay, ... */
  @Column({ type: 'varchar', length: 20, nullable: true })
  source: string | null;

  /** Text-to-pay: the channel the payment link went out on (receipt goes back the same way). */
  @Column({ name: 'request_channel', type: 'varchar', length: 5, nullable: true })
  requestChannel: 'sms' | 'email' | null;

  @Column({ name: 'receipt_sent_at', type: 'timestamptz', nullable: true })
  receiptSentAt: Date | null;

  /** Set when the invoice is an order placed through an order form. */
  @Index()
  @Column({ name: 'order_form_id', type: 'uuid', nullable: true })
  orderFormId: string | null;

  /** Upsell invoices point at the order they were bought after. */
  @Column({ name: 'parent_invoice_id', type: 'uuid', nullable: true })
  parentInvoiceId: string | null;

  /** Which offer (0-based) of the form this upsell invoice is for. */
  @Column({ name: 'upsell_index', type: 'int', nullable: true })
  upsellIndex: number | null;

  /** Main orders: index of the next offer to show (equals the number of offers answered). */
  @Column({ name: 'upsell_step', type: 'int', default: 0 })
  upsellStep: number;

  /** Main orders: the upsell (index) whose downsell is waiting for an answer, if any. */
  @Column({ name: 'pending_downsell', type: 'int', nullable: true })
  pendingDownsell: number | null;

  /** Add-on invoices: whether this was the upsell or its downsell. */
  @Column({ name: 'upsell_kind', type: 'varchar', length: 10, nullable: true })
  upsellKind: 'upsell' | 'downsell' | null;

  /** Saved card for one-click upsells (Stripe); never sent to the browser. */
  @Column({ name: 'stripe_customer_id', type: 'varchar', length: 255, nullable: true, select: false })
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_payment_method_id', type: 'varchar', length: 255, nullable: true, select: false })
  stripePaymentMethodId: string | null;
}

@Entity('coupons')
@Index(['workspaceId', 'code'], { unique: true, where: '"deleted_at" IS NULL' })
export class Coupon extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** Upper-case code customers type, e.g. SPRING20 */
  @Column({ length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 10 })
  type: 'percent' | 'fixed';

  /** Percent (0-100) or fixed amount in `currency`. */
  @Column({ type: 'decimal', precision: 15, scale: 2, transformer: money })
  amount: number;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  /** once = first invoice only; forever = every cycle; repeating = `durationCycles` cycles */
  @Column({ type: 'varchar', length: 10, default: 'once' })
  duration: 'once' | 'forever' | 'repeating';

  @Column({ name: 'duration_cycles', type: 'int', nullable: true })
  durationCycles: number | null;

  @Column({ name: 'applies_to', type: 'varchar', length: 15, default: 'all' })
  appliesTo: 'all' | 'invoices' | 'subscriptions';

  @Column({ name: 'max_redemptions', type: 'int', nullable: true })
  maxRedemptions: number | null;

  @Column({ type: 'int', default: 0 })
  redemptions: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;

@Entity('subscriptions')
@Index(['workspaceId', 'status'])
@Index(['status', 'nextBillingAt'])
export class Subscription extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Contact, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ length: 255 })
  name: string;

  /** Price per unit per interval. */
  @Column({ type: 'decimal', precision: 15, scale: 2, transformer: money })
  price: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 5 })
  interval: 'month' | 'year';

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0, transformer: money })
  taxRate: number;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: (typeof SUBSCRIPTION_STATUSES)[number];

  @Column({ name: 'coupon_id', type: 'uuid', nullable: true })
  couponId: string | null;

  /** Billing cycles the coupon still applies to; null = forever (when couponId set). */
  @Column({ name: 'coupon_cycles_remaining', type: 'int', nullable: true })
  couponCyclesRemaining: number | null;

  @Column({ name: 'days_until_due', type: 'int', default: 7 })
  daysUntilDue: number;

  /** Day of month billing anchors to (keeps Jan 31 → Feb 28 → Mar 31). */
  @Column({ name: 'anchor_day', type: 'int' })
  anchorDay: number;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'next_billing_at', type: 'timestamptz', nullable: true })
  nextBillingAt: Date | null;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @Column({ name: 'cycles_billed', type: 'int', default: 0 })
  cyclesBilled: number;
}
