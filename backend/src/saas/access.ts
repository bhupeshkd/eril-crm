import { CanActivate, ExecutionContext, ForbiddenException, Global, HttpException, Injectable, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SaasAccount, SaasPlan, SaasSettings } from '../database/entities/saas.entity';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { SKIP_TENANT_KEY } from '../common/decorators/skip-tenant.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { featureLabel, featuresFor, isLocked, standing, type SaasStatus } from './rules';

export interface SaasAccess {
  accountId: string;
  organizationId: string;
  planId: string;
  planName: string;
  features: string[];
  limits: SaasPlan['limits'];
  included: SaasPlan['included'];
  status: SaasStatus;
  subscriptionId: string | null;
  billingWorkspaceId: string | null;
}

/** Agency-level roles don't count towards a client's user limit (they're the agency's staff). */
const AGENCY_ROLES = ['super_admin', 'agency_owner', 'agency_admin'];
const TTL_MS = 30_000;

/** Lightweight, dependency-free view of a workspace's SaaS plan and standing (used by the guard and by limit checks). */
@Injectable()
export class SaasAccessService {
  private cache = new Map<string, { at: number; value: SaasAccess | null }>();

  constructor(
    @InjectRepository(SaasAccount) private readonly accounts: Repository<SaasAccount>,
    @InjectRepository(SaasPlan) private readonly plans: Repository<SaasPlan>,
    @InjectRepository(SaasSettings) private readonly settings: Repository<SaasSettings>,
    private readonly ds: DataSource,
  ) {}

  invalidate(workspaceId?: string) {
    if (workspaceId) this.cache.delete(workspaceId);
    else this.cache.clear();
  }

  async get(workspaceId: string): Promise<SaasAccess | null> {
    const hit = this.cache.get(workspaceId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.load(workspaceId);
    this.cache.set(workspaceId, { at: Date.now(), value });
    return value;
  }

  private async load(workspaceId: string): Promise<SaasAccess | null> {
    const acc = await this.accounts.findOne({ where: { workspaceId } });
    if (!acc) return null;
    const [plan, settings] = await Promise.all([
      this.plans.findOne({ where: { id: acc.planId }, withDeleted: true }),
      this.settings.findOne({ where: { organizationId: acc.organizationId } }),
    ]);
    let subStatus: string | null = null;
    let overdueDays: number | null = null;
    if (acc.subscriptionId) {
      const [row] = await this.ds.query(
        `SELECT s.status,
                (SELECT EXTRACT(DAY FROM now() - MIN(i.due_date)::timestamptz)::int
                   FROM invoices i
                  WHERE i.subscription_id = s.id AND i.status = 'sent' AND i.due_date < CURRENT_DATE AND i.deleted_at IS NULL) AS overdue
           FROM subscriptions s WHERE s.id = $1`,
        [acc.subscriptionId],
      );
      subStatus = row?.status ?? null;
      overdueDays = row?.overdue ?? null;
    }
    return {
      accountId: acc.id,
      organizationId: acc.organizationId,
      planId: acc.planId,
      planName: plan?.name ?? 'Plan',
      features: plan?.features ?? [],
      limits: plan?.limits ?? { contacts: null, users: null },
      included: plan?.included ?? { emails: 0, sms: 0 },
      status: standing(subStatus, overdueDays, settings?.graceDays ?? 7),
      subscriptionId: acc.subscriptionId,
      billingWorkspaceId: settings?.billingWorkspaceId ?? null,
    };
  }

  private payment(message: string, code: string) {
    return new HttpException({ statusCode: 402, error: 'Payment Required', code, message }, 402);
  }

  lockedMessage(status: SaasStatus) {
    return status === 'canceled'
      ? "This account's plan has been canceled, so it's read-only. Ask your agency to reactivate it."
      : "This account is read-only because an invoice is overdue. Pay it to restore full access.";
  }

  /** Throws when adding `n` contacts/users would exceed the plan (or the account is locked). */
  async assertCapacity(workspaceId: string, kind: 'contacts' | 'users', n = 1) {
    const a = await this.get(workspaceId);
    if (!a) return;
    if (isLocked(a.status)) throw this.payment(this.lockedMessage(a.status), 'account_locked');
    const limit = a.limits?.[kind];
    if (limit === null || limit === undefined) return;
    const [{ count }] =
      kind === 'contacts'
        ? await this.ds.query(`SELECT COUNT(*)::int AS count FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL`, [workspaceId])
        : await this.ds.query(`SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1 AND deleted_at IS NULL AND role <> ALL($2)`, [workspaceId, AGENCY_ROLES]);
    if (count + n > limit) {
      throw this.payment(`Your ${a.planName} plan allows up to ${limit.toLocaleString('en-US')} ${kind}. Ask your agency to upgrade.`, 'plan_limit');
    }
  }
}

/**
 * Runs after the tenant/permission guards. For sub-accounts on a SaaS plan it blocks features the plan
 * doesn't include and makes suspended/canceled accounts read-only. Non-SaaS workspaces are unaffected.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: SaasAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets) || this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const workspaceId: string | undefined = req.tenant?.workspaceId;
    if (!workspaceId) return true;
    // Signing in/out and switching workspace must always work, even for locked accounts.
    const url: string = req.originalUrl ?? req.url ?? '';
    if (/\/auth\//.test(url) || /\/saas\/status/.test(url)) return true;
    const a = await this.access.get(workspaceId);
    if (!a) return true;
    if (isLocked(a.status) && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      throw new HttpException({ statusCode: 402, error: 'Payment Required', code: 'account_locked', message: this.access.lockedMessage(a.status) }, 402);
    }
    const missing = featuresFor(this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets)).filter((f) => !a.features.includes(f));
    if (missing.length) {
      throw new ForbiddenException(`Your ${a.planName} plan doesn't include ${missing.map(featureLabel).join(', ')}. Ask your agency to upgrade.`);
    }
    return true;
  }
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SaasAccount, SaasPlan, SaasSettings])],
  providers: [SaasAccessService, PlanGuard],
  exports: [SaasAccessService, PlanGuard],
})
export class SaasAccessModule {}
