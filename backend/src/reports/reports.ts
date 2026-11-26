import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { channelOf, type Touch } from '../crm/attribution';

class RangeDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90, 365]) days?: number;
}

/** Aggregations for the Reporting page. All queries are workspace-scoped and exclude soft-deleted rows. */
@Injectable()
export class ReportsService {
  constructor(private readonly ds: DataSource) {}

  async overview(ws: string, days = 30) {
    const q = (sql: string, params: unknown[] = []) => this.ds.query(sql, [ws, days, ...params]);
    const series = (table: string, dateCol: string, valueExpr: string, extra = '') => `
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(${valueExpr}), 0)::float AS value
      FROM generate_series(date_trunc('day', now()) - (($2::int - 1) * interval '1 day'), date_trunc('day', now()), interval '1 day') AS d(day)
      LEFT JOIN ${table} t ON t.workspace_id = $1 AND t.deleted_at IS NULL AND date_trunc('day', t.${dateCol}) = d.day ${extra}
      GROUP BY d.day ORDER BY d.day`;

    const [leads, revenue, pipeline, sources, appointments, totals, campaigns, workflows, forms] = await Promise.all([
      q(series('contacts', 'created_at', 'CASE WHEN t.id IS NULL THEN 0 ELSE 1 END')),
      q(series('invoices', 'paid_at', 't.total', "AND t.status = 'paid'")),
      q(`SELECT s.name AS stage, s.position, COUNT(o.id)::int AS count, COALESCE(SUM(o.value),0)::float AS value
         FROM pipeline_stages s
         JOIN pipelines p ON p.id = s.pipeline_id AND p.deleted_at IS NULL
         LEFT JOIN opportunities o ON o.stage_id = s.id AND o.deleted_at IS NULL
         WHERE s.workspace_id = $1 AND s.deleted_at IS NULL AND $2::int > 0
         GROUP BY s.name, s.position ORDER BY s.position`),
      q(`SELECT CASE WHEN source LIKE 'form:%' THEN 'form' ELSE source END AS source, COUNT(*)::int AS count
         FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL AND created_at > now() - ($2::int * interval '1 day')
         GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT status, COUNT(*)::int AS count FROM appointments
         WHERE workspace_id = $1 AND deleted_at IS NULL AND start_at > now() - ($2::int * interval '1 day')
         GROUP BY status`),
      q(`SELECT
           (SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL AND created_at > now() - ($2::int * interval '1 day'))::int AS "newContacts",
           (SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'customer')::int AS customers,
           (SELECT COUNT(*) FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL)::int AS contacts,
           (SELECT COALESCE(SUM(total),0) FROM invoices WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'paid' AND paid_at > now() - ($2::int * interval '1 day'))::float AS revenue,
           (SELECT COUNT(*) FROM opportunities WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'won')::int AS "wonDeals",
           (SELECT COUNT(*) FROM opportunities WHERE workspace_id = $1 AND deleted_at IS NULL AND status IN ('won','lost'))::int AS "closedDeals",
           (SELECT COUNT(*) FROM messages WHERE workspace_id = $1 AND deleted_at IS NULL AND direction = 'outbound' AND created_at > now() - ($2::int * interval '1 day'))::int AS "messagesSent",
           (SELECT COUNT(*) FROM messages WHERE workspace_id = $1 AND deleted_at IS NULL AND direction = 'inbound' AND created_at > now() - ($2::int * interval '1 day'))::int AS "messagesReceived"`),
      q(`SELECT COUNT(*)::int AS campaigns, COALESCE(SUM((stats->>'sent')::int),0)::int AS sent, COALESCE(SUM((stats->>'failed')::int),0)::int AS failed
         FROM campaigns WHERE workspace_id = $1 AND deleted_at IS NULL AND sent_at > now() - ($2::int * interval '1 day')`),
      q(`SELECT w.name, COUNT(r.id)::int AS runs,
           COUNT(r.id) FILTER (WHERE r.status = 'succeeded')::int AS succeeded,
           COUNT(r.id) FILTER (WHERE r.status = 'failed')::int AS failed
         FROM workflows w LEFT JOIN workflow_runs r ON r.workflow_id = w.id AND r.created_at > now() - ($2::int * interval '1 day')
         WHERE w.workspace_id = $1 AND w.deleted_at IS NULL GROUP BY w.id, w.name ORDER BY runs DESC LIMIT 10`),
      q(`SELECT f.name, COUNT(s.id)::int AS submissions FROM forms f
         LEFT JOIN form_submissions s ON s.form_id = f.id AND s.created_at > now() - ($2::int * interval '1 day')
         WHERE f.workspace_id = $1 AND f.deleted_at IS NULL GROUP BY f.id, f.name ORDER BY submissions DESC LIMIT 10`),
    ]);

    const t = totals[0];
    const appt = Object.fromEntries(appointments.map((a) => [a.status, a.count]));
    const attended = (appt.showed ?? 0) + (appt.noshow ?? 0);
    return {
      days,
      totals: {
        ...t,
        winRate: t.closedDeals ? Math.round((t.wonDeals / t.closedDeals) * 100) : null,
        showRate: attended ? Math.round(((appt.showed ?? 0) / attended) * 100) : null,
      },
      leadsByDay: leads,
      revenueByDay: revenue,
      pipeline,
      sources,
      appointments: appt,
      campaigns: campaigns[0],
      workflows,
      forms,
    };
  }
}

class AttributionDto extends RangeDto {
  @IsOptional() @IsIn(['first', 'last']) model?: 'first' | 'last';
}

type Row = { leads: number; customers: number; revenue: number };

/** Marketing attribution: leads, customers and revenue per channel and campaign, by first or last touch. */
@Injectable()
export class AttributionService {
  constructor(private readonly ds: DataSource) {}

  async report(ws: string, days = 30, model: 'first' | 'last' = 'first') {
    // Contacts created in the window, with the lifetime paid revenue of each.
    const rows: Array<{ status: string; touch: Touch | null; revenue: number }> = await this.ds.query(
      `SELECT c.status, ${model === 'first' ? 'c.first_touch' : 'c.last_touch'} AS touch,
              COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.contact_id = c.id AND i.workspace_id = $1 AND i.deleted_at IS NULL AND i.status = 'paid'), 0)::float AS revenue
         FROM contacts c
        WHERE c.workspace_id = $1 AND c.deleted_at IS NULL AND c.created_at > now() - ($2::int * interval '1 day')
        LIMIT 50000`,
      [ws, days],
    );
    const channels = new Map<string, Row>();
    const campaigns = new Map<string, Row & { source: string; campaign: string; channel: string }>();
    const add = (r: Row, revenue: number, customer: boolean) => {
      r.leads++;
      if (customer || revenue > 0) r.customers++;
      r.revenue += revenue;
    };
    let tracked = 0;
    for (const row of rows) {
      const channel = channelOf(row.touch);
      if (row.touch) tracked++;
      const customer = row.status === 'customer';
      add(channels.get(channel) ?? channels.set(channel, { leads: 0, customers: 0, revenue: 0 }).get(channel)!, row.revenue, customer);
      const camp = row.touch?.campaign;
      if (camp) {
        const key = `${row.touch?.source ?? ''}|${camp}`;
        const c = campaigns.get(key) ?? campaigns.set(key, { leads: 0, customers: 0, revenue: 0, source: row.touch?.source ?? '', campaign: camp, channel }).get(key)!;
        add(c, row.revenue, customer);
      }
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const withRates = <T extends Row>(r: T) => ({ ...r, revenue: round(r.revenue), conversionRate: r.leads ? Math.round((r.customers / r.leads) * 1000) / 10 : 0 });
    return {
      model,
      days,
      totals: { leads: rows.length, tracked, customers: rows.filter((r) => r.status === 'customer' || r.revenue > 0).length, revenue: round(rows.reduce((s, r) => s + r.revenue, 0)) },
      channels: [...channels].map(([channel, r]) => withRates({ channel, ...r })).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads),
      campaigns: [...campaigns.values()].map(withRates).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads).slice(0, 50),
    };
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService, private readonly attribution: AttributionService) {}

  @Get('overview')
  @Permissions('analytics:read')
  overview(@Tenant('workspaceId') ws: string, @Query() q: RangeDto) {
    return this.svc.overview(ws, q.days ?? 30);
  }

  @Get('attribution')
  @Permissions('analytics:read')
  attributionReport(@Tenant('workspaceId') ws: string, @Query() q: AttributionDto) {
    return this.attribution.report(ws, q.days ?? 30, q.model ?? 'first');
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService, AttributionService] })
export class ReportsModule {}
