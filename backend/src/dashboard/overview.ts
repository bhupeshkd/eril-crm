import { BadRequestException, Body, Controller, Get, Injectable, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { Workspace } from '../database/entities/workspace.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class TargetDto {
  /** Monthly revenue target; null clears it. */
  @IsOptional() @ValidateIf((o) => o.monthlyTarget !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) monthlyTarget: number | null;
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Everything the Overview dashboard shows, in one request. */
@Injectable()
export class OverviewService {
  constructor(
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly ds: DataSource,
  ) {}

  async overview(workspaceId: string, userId: string) {
    const q = <T = any>(sql: string, params: unknown[]) => this.ds.query(sql, params) as Promise<T[]>;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const ws = await this.workspaces.findOne({ where: { id: workspaceId } });
    const target = typeof ws?.settings?.monthlyTarget === 'number' ? (ws.settings.monthlyTarget as number) : null;

    const [won, open, closed, monthly, stages, next, tasks, leaders, counts, currencyRow] = await Promise.all([
      q(
        `SELECT COALESCE(SUM(value) FILTER (WHERE closed_at >= $2), 0)::float AS this_month,
                COALESCE(SUM(value) FILTER (WHERE closed_at >= $3 AND closed_at < $2), 0)::float AS last_month,
                COUNT(*) FILTER (WHERE closed_at >= $2)::int AS deals_this_month
           FROM opportunities WHERE workspace_id = $1 AND status = 'won' AND deleted_at IS NULL`,
        [workspaceId, monthStart, lastMonthStart],
      ),
      q(
        `SELECT COUNT(*)::int AS deals, COALESCE(SUM(o.value), 0)::float AS value,
                COALESCE(SUM(o.value * COALESCE(o.probability, s.probability, 0) / 100.0), 0)::float AS weighted
           FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
          WHERE o.workspace_id = $1 AND o.status = 'open' AND o.deleted_at IS NULL`,
        [workspaceId],
      ),
      q(`SELECT COUNT(*) FILTER (WHERE status = 'won')::int AS won, COUNT(*)::int AS closed FROM opportunities WHERE workspace_id = $1 AND status IN ('won', 'lost') AND deleted_at IS NULL`, [workspaceId]),
      q(
        `SELECT to_char(date_trunc('month', closed_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, COALESCE(SUM(value), 0)::float AS won
           FROM opportunities WHERE workspace_id = $1 AND status = 'won' AND closed_at >= $2 AND deleted_at IS NULL GROUP BY 1`,
        [workspaceId, yearStart],
      ),
      // Stages of the workspace's main (first) pipeline, open deals in each; Won shows deals won this month.
      q(
        `WITH p AS (SELECT id FROM pipelines WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1)
         SELECT s.id, s.name, s.position,
                COUNT(o.id) FILTER (WHERE o.status = 'open' OR (o.status = 'won' AND o.closed_at >= $2))::int AS deals,
                COALESCE(SUM(o.value) FILTER (WHERE o.status = 'open' OR (o.status = 'won' AND o.closed_at >= $2)), 0)::float AS value
           FROM pipeline_stages s JOIN p ON p.id = s.pipeline_id
           LEFT JOIN opportunities o ON o.stage_id = s.id AND o.deleted_at IS NULL
          WHERE s.deleted_at IS NULL AND lower(s.name) NOT IN ('lost', 'closed lost')
          GROUP BY s.id, s.name, s.position ORDER BY s.position`,
        [workspaceId, monthStart],
      ),
      // Next best move: the open deal with the most expected value, sooner closes first among equals.
      q(
        `SELECT o.id, o.title, o.value::float AS value, o.expected_close_date AS "closeDate", s.name AS stage,
                COALESCE(o.probability, s.probability, 0)::int AS probability,
                TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact, co.name AS company
           FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
           LEFT JOIN contacts c ON c.id = o.contact_id
           LEFT JOIN companies co ON co.id = c.company_id
          WHERE o.workspace_id = $1 AND o.status = 'open' AND o.deleted_at IS NULL
          ORDER BY o.value * COALESCE(o.probability, s.probability, 0) DESC, o.expected_close_date ASC NULLS LAST LIMIT 1`,
        [workspaceId],
      ),
      // Today: incomplete tasks due by the end of today (overdue first), for everyone or assigned to me.
      q(
        `SELECT t.id, t.title, t.due_at AS "dueAt", t.completed, t.assignee_id = $2 AS mine,
                TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact, t.contact_id AS "contactId"
           FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
          WHERE t.workspace_id = $1 AND t.deleted_at IS NULL AND t.completed = false AND t.due_at < (date_trunc('day', now()) + interval '1 day')
          ORDER BY t.due_at ASC LIMIT 8`,
        [workspaceId, userId],
      ),
      // Leaderboard: won this month by the contact's owner.
      q(
        `SELECT u.id, u.name, COUNT(*)::int AS deals, COALESCE(SUM(o.value), 0)::float AS won
           FROM opportunities o JOIN contacts c ON c.id = o.contact_id JOIN users u ON u.id = c.owner_id
          WHERE o.workspace_id = $1 AND o.status = 'won' AND o.closed_at >= $2 AND o.deleted_at IS NULL
          GROUP BY u.id, u.name ORDER BY won DESC LIMIT 5`,
        [workspaceId, monthStart],
      ),
      q(
        `SELECT (SELECT COUNT(*)::int FROM tasks WHERE workspace_id = $1 AND deleted_at IS NULL AND completed = false AND due_at < date_trunc('day', now())) AS overdue,
                (SELECT COUNT(*)::int FROM tasks WHERE workspace_id = $1 AND deleted_at IS NULL AND due_at >= date_trunc('day', now()) AND due_at < date_trunc('day', now()) + interval '1 day') AS tasks_today,
                (SELECT COUNT(*)::int FROM appointments WHERE workspace_id = $1 AND deleted_at IS NULL AND status <> 'cancelled' AND start_at >= date_trunc('day', now()) AND start_at < date_trunc('day', now()) + interval '1 day') AS appointments_today`,
        [workspaceId],
      ),
      q(`SELECT currency FROM invoices WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [workspaceId]),
    ]);

    const months: Array<{ month: string; won: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
      months.push({ month: key, won: monthly.find((m) => m.month === key)?.won ?? 0 });
    }
    const w = won[0];
    const teamTotal = leaders.reduce((t, l) => t + l.won, 0);
    return {
      currency: currencyRow[0]?.currency ?? 'USD',
      target,
      won: {
        thisMonth: w.this_month,
        lastMonth: w.last_month,
        deals: w.deals_this_month,
        changePct: w.last_month > 0 ? Math.round(((w.this_month - w.last_month) / w.last_month) * 100) : null,
        targetPct: target ? Math.round((w.this_month / target) * 100) : null,
      },
      pipeline: { value: open[0].value, deals: open[0].deals, weighted: Math.round(open[0].weighted * 100) / 100 },
      winRate: { won: closed[0].won, closed: closed[0].closed, pct: closed[0].closed ? Math.round((closed[0].won / closed[0].closed) * 100) : null },
      months,
      stages: stages.map((s) => ({ id: s.id, name: s.name, deals: s.deals, value: s.value })),
      nextBestMove: next[0] ?? null,
      today: tasks,
      counts: { overdue: counts[0].overdue, tasksToday: counts[0].tasks_today, appointmentsToday: counts[0].appointments_today },
      leaderboard: leaders.map((l) => ({ ...l, sharePct: teamTotal ? Math.round((l.won / teamTotal) * 100) : 0 })),
    };
  }

  async setTarget(workspaceId: string, value: number | null) {
    const ws = await this.workspaces.findOne({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');
    ws.settings = { ...(ws.settings ?? {}), monthlyTarget: value };
    await this.workspaces.save(ws);
    return { monthlyTarget: value };
  }
}

@Controller('dashboard')
export class OverviewController {
  constructor(private readonly svc: OverviewService) {}

  @Get('overview')
  @Permissions('contacts:read')
  overview(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string) {
    return this.svc.overview(ws, me);
  }

  @Put('target')
  @Permissions('workspaces:write')
  target(@Tenant('workspaceId') ws: string, @Body() dto: TargetDto) {
    return this.svc.setTarget(ws, dto.monthlyTarget ?? null);
  }
}
