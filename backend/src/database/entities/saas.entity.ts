import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

const money = { to: (v: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

/** Agency-wide SaaS settings: where client billing lives and what usage costs. */
@Entity('saas_settings')
@Index(['organizationId'], { unique: true })
export class SaasSettings extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The agency's own workspace that issues invoices to clients (each client is a contact there). */
  @Column({ name: 'billing_workspace_id', type: 'uuid', nullable: true })
  billingWorkspaceId: string | null;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  /** Resell price per email / SMS beyond a plan's allowance. */
  @Column({ name: 'email_price', type: 'decimal', precision: 10, scale: 4, default: 0, transformer: money })
  emailPrice: number;

  @Column({ name: 'sms_price', type: 'decimal', precision: 10, scale: 4, default: 0, transformer: money })
  smsPrice: number;

  /** Days an unpaid account keeps working after its invoice falls due, before becoming read-only. */
  @Column({ name: 'grace_days', type: 'int', default: 7 })
  graceDays: number;
}

export interface PlanLimits {
  /** null = unlimited */
  contacts: number | null;
  users: number | null;
}
export interface PlanIncluded {
  emails: number;
  sms: number;
}

/** A plan an agency sells to its client sub-accounts. */
@Entity('saas_plans')
@Index(['organizationId'])
export class SaasPlan extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: money })
  price: number;

  @Column({ type: 'varchar', length: 5, default: 'month' })
  interval: 'month' | 'year';

  @Column({ name: 'trial_days', type: 'int', default: 0 })
  trialDays: number;

  /** Feature areas included (see saas/rules.ts SAAS_FEATURES). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  features: string[];

  @Column({ type: 'jsonb', default: () => `'{"contacts":null,"users":null}'` })
  limits: PlanLimits;

  /** Messages per month included before overage is billed. */
  @Column({ type: 'jsonb', default: () => `'{"emails":0,"sms":0}'` })
  included: PlanIncluded;

  /** Recurring product in the billing workspace that subscriptions to this plan use. */
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/** A client sub-account on a SaaS plan. */
@Entity('saas_accounts')
@Index(['workspaceId'], { unique: true })
@Index(['organizationId'])
export class SaasAccount extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The client's sub-account. */
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  /** Subscription in the agency's billing workspace. */
  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId: string | null;

  /** The client as a contact in the billing workspace. */
  @Column({ name: 'billing_contact_id', type: 'uuid' })
  billingContactId: string;
}

/** One usage (overage) bill per client per month; the unique index prevents billing a month twice. */
@Entity('saas_usage_bills')
@Index(['workspaceId', 'period'], { unique: true })
export class SaasUsageBill extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** 'YYYY-MM' */
  @Column({ length: 7 })
  period: string;

  @Column({ type: 'int', default: 0 })
  emails: number;

  @Column({ type: 'int', default: 0 })
  sms: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0, transformer: money })
  amount: number;

  /** null when nothing was owed. */
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;
}
