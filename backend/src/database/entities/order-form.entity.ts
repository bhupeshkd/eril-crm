import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export interface OrderBump {
  productId: string;
  /** e.g. "Yes! Add the quick-start guide for just $19" */
  headline: string;
  description: string;
}

/** One-click offer shown after the main order is paid (charged without re-entering card details). */
export interface UpsellOffer {
  productId: string;
  headline: string;
  description: string;
  acceptLabel: string;
  declineLabel: string;
  /** Cheaper fallback shown only if this offer is declined. */
  downsell?: DownsellOffer | null;
}

export type DownsellOffer = Omit<UpsellOffer, 'downsell'>;

/** A hosted checkout page: pick a product, optional order bump, pay. Orders are invoices. */
@Entity('order_forms')
@Index(['slug'], { unique: true })
@Index(['workspaceId'])
export class OrderForm extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  /** Public URL segment: /order/<slug> */
  @Column({ length: 120 })
  slug: string;

  @Column({ length: 255, default: '' })
  headline: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /** Products the buyer chooses from (one per order). */
  @Column({ name: 'product_ids', type: 'uuid', array: true, default: () => "'{}'" })
  productIds: string[];

  @Column({ type: 'jsonb', nullable: true })
  bump: OrderBump | null;

  /** Post-purchase offers, shown in order; each is accepted or declined once. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  upsells: UpsellOffer[];

  @Column({ name: 'collect_phone', default: false })
  collectPhone: boolean;

  /** Let buyers choose how many of the main product they want. */
  @Column({ name: 'allow_quantity', default: false })
  allowQuantity: boolean;

  /** Upper limit per order when quantities are allowed (1-100). */
  @Column({ name: 'max_quantity', type: 'int', default: 10 })
  maxQuantity: number;

  @Column({ name: 'allow_coupons', default: true })
  allowCoupons: boolean;

  /** Percentage applied to every order. */
  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  taxRate: number;

  /** Added to the buyer's contact when they submit an order. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ name: 'button_label', length: 60, default: 'Complete order' })
  buttonLabel: string;

  @Column({ name: 'thank_you_message', type: 'text', default: 'Thank you for your order!' })
  thankYouMessage: string;

  /** Optional http(s) page to send buyers to after paying. */
  @Column({ name: 'redirect_url', type: 'varchar', length: 1000, default: '' })
  redirectUrl: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Page views (approximate; counted when the public page loads its data). */
  @Column({ type: 'int', default: 0 })
  views: number;
}
