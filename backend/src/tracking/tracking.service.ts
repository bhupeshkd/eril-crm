import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { EmailClick, Message } from '../database/entities/message.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { injectPixel, isLikelyBot, isRedirectable, rewriteLinks, signLink, verifyLink } from './links';

export interface TrackingSettings {
  opens: boolean;
  clicks: boolean;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(EmailClick) private readonly clicks: Repository<EmailClick>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  /** Public base URL of the API (tracking links must be reachable from recipients' inboxes). */
  private get apiBase() {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix}`;
  }

  private get secret() {
    return this.config.get<string>('JWT_ACCESS_SECRET') || 'eril-dev-secret';
  }

  async settings(workspaceId: string): Promise<TrackingSettings> {
    const ws = await this.workspaces.findOne({ where: { id: workspaceId } });
    const t = (ws?.settings?.tracking ?? {}) as Partial<TrackingSettings>;
    return { opens: t.opens !== false, clicks: t.clicks !== false };
  }

  async saveSettings(workspaceId: string, s: Partial<TrackingSettings>) {
    const ws = await this.workspaces.findOneByOrFail({ id: workspaceId });
    const current = await this.settings(workspaceId);
    ws.settings = { ...(ws.settings ?? {}), tracking: { opens: s.opens ?? current.opens, clicks: s.clicks ?? current.clicks } };
    await this.workspaces.save(ws);
    return this.settings(workspaceId);
  }

  /** Adds the open pixel and wraps links. Returns the token to store on the message (or null when off). */
  async prepare(workspaceId: string, html: string): Promise<{ html: string; token: string | null }> {
    const s = await this.settings(workspaceId);
    if (!s.opens && !s.clicks) return { html, token: null };
    const token = randomBytes(16).toString('hex');
    return { html: this.apply(html, token, s), token };
  }

  /** Deterministic: the same html + token + settings always yield the same delivered html. */
  apply(html: string, token: string, s: TrackingSettings) {
    let out = html;
    if (s.clicks) {
      out = rewriteLinks(
        out,
        (url) => `${this.apiBase}/t/c/${token}?u=${encodeURIComponent(url)}&s=${signLink(this.secret, token, url)}`,
        (url) => /\/unsubscribe\?/.test(url),
      ).html;
    }
    if (s.opens) out = injectPixel(out, `${this.apiBase}/t/o/${token}.gif`);
    return out;
  }

  /** Dev/test only: rebuild the html exactly as delivered to the recipient. */
  async deliveredHtml(workspaceId: string, messageId: string) {
    const m = await this.messages
      .createQueryBuilder('m')
      .addSelect(['m.html', 'm.trackingToken'])
      .where('m.id = :messageId AND m.workspace_id = :workspaceId', { messageId, workspaceId })
      .getOne();
    if (!m?.html) throw new NotFoundException('No designed version for this message');
    return { html: m.trackingToken ? this.apply(m.html, m.trackingToken, await this.settings(workspaceId)) : m.html };
  }

  private findByToken(token: string) {
    if (!/^[0-9a-f]{32}$/.test(token)) return Promise.resolve(null);
    return this.messages
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.conversation', 'c')
      .where('m.tracking_token = :token', { token })
      .getOne();
  }

  async recordOpen(token: string, userAgent?: string) {
    const m = await this.findByToken(token);
    if (!m || isLikelyBot(userAgent)) return;
    const first = await this.messages.update({ id: m.id, openedAt: IsNull() }, { openedAt: new Date() });
    await this.messages.increment({ id: m.id }, 'openCount', 1);
    if (first.affected) await this.firstInteraction(m, 'email.opened', null);
  }

  /** Validates the signature, logs the click and returns where to redirect. */
  async recordClick(token: string, url: string, sig: string, userAgent?: string): Promise<string> {
    if (!url || !verifyLink(this.secret, token, url, sig) || !isRedirectable(url)) {
      throw new NotFoundException('This link is not valid');
    }
    const m = await this.findByToken(token);
    if (!m) return url; // message deleted: still honour a link we signed
    const bot = isLikelyBot(userAgent);
    const seenUrl = await this.clicks.exist({ where: { messageId: m.id, url, isBot: false } });
    await this.clicks.save(this.clicks.create({ workspaceId: m.workspaceId, messageId: m.id, campaignId: m.campaignId, url: url.slice(0, 2000), isBot: bot }));
    if (bot) return url;
    await this.messages.increment({ id: m.id }, 'clickCount', 1);
    const firstClick = await this.messages.update({ id: m.id, clickedAt: IsNull() }, { clickedAt: new Date() });
    // A click proves the email was opened even when images were blocked.
    const firstOpen = await this.messages.update({ id: m.id, openedAt: IsNull() }, { openedAt: new Date() });
    if (firstOpen.affected) {
      await this.messages.increment({ id: m.id }, 'openCount', 1); // keep "opened" and the open count consistent
      await this.firstInteraction(m, 'email.opened', null);
    }
    if (!seenUrl) await this.firstInteraction(m, 'email.clicked', url, !!firstClick.affected);
    return url;
  }

  private async firstInteraction(m: Message, type: 'email.opened' | 'email.clicked', url: string | null, logActivity = true) {
    const subject = m.conversation?.subject || 'email';
    if (logActivity) {
      await this.activity
        .record(m.workspaceId, type, type === 'email.opened' ? `Opened “${subject}”` : `Clicked a link in “${subject}”`, {
          entityType: 'contact',
          entityId: m.conversation.contactId,
        })
        .catch(() => {});
    }
    this.events.emit({
      type,
      workspaceId: m.workspaceId,
      contactId: m.conversation.contactId,
      payload: { message: { id: m.id, subject }, campaign: m.campaignId ? { id: m.campaignId } : null, url },
    });
  }

  /** Aggregate stats for one campaign (unique = per recipient message). */
  async campaignReport(workspaceId: string, campaignId: string) {
    const [row] = await this.messages.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE tracking_token IS NOT NULL)::int AS tracked,
              COUNT(opened_at)::int AS opened,
              COUNT(clicked_at)::int AS clicked,
              COALESCE(SUM(open_count),0)::int AS "totalOpens",
              COALESCE(SUM(click_count),0)::int AS "totalClicks"
         FROM messages WHERE workspace_id = $1 AND campaign_id = $2 AND deleted_at IS NULL`,
      [workspaceId, campaignId],
    );
    const links = await this.clicks.query(
      `SELECT url, COUNT(*)::int AS clicks, COUNT(DISTINCT message_id)::int AS "uniqueClicks"
         FROM email_clicks WHERE workspace_id = $1 AND campaign_id = $2 AND is_bot = false AND deleted_at IS NULL
         GROUP BY url ORDER BY clicks DESC LIMIT 20`,
      [workspaceId, campaignId],
    );
    const pct = (n: number) => (row.tracked ? Math.round((n / row.tracked) * 1000) / 10 : null);
    const variants = (await this.variantResults(workspaceId, campaignId)).map((v) => ({
      ...v,
      openRate: v.tracked ? Math.round((v.opened / v.tracked) * 1000) / 10 : null,
      clickRate: v.tracked ? Math.round((v.clicked / v.tracked) * 1000) / 10 : null,
    }));
    return { ...row, openRate: pct(row.opened), clickRate: pct(row.clicked), links, variants };
  }

  /** Per-variant engagement for an A/B subject test (test group only). */
  async variantResults(workspaceId: string, campaignId: string): Promise<Array<{ variant: 'A' | 'B'; sent: number; tracked: number; opened: number; clicked: number }>> {
    return this.messages.query(
      `SELECT variant, COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE tracking_token IS NOT NULL)::int AS tracked,
              COUNT(opened_at)::int AS opened, COUNT(clicked_at)::int AS clicked
         FROM messages WHERE workspace_id = $1 AND campaign_id = $2 AND variant IS NOT NULL AND deleted_at IS NULL
        GROUP BY variant ORDER BY variant`,
      [workspaceId, campaignId],
    );
  }

  /** Open/click rates for many campaigns at once (campaign list). */
  async campaignRates(workspaceId: string) {
    const rows: Array<{ campaignId: string; tracked: number; opened: number; clicked: number }> = await this.messages.query(
      `SELECT campaign_id AS "campaignId", COUNT(*) FILTER (WHERE tracking_token IS NOT NULL)::int AS tracked,
              COUNT(opened_at)::int AS opened, COUNT(clicked_at)::int AS clicked
         FROM messages WHERE workspace_id = $1 AND campaign_id IS NOT NULL AND deleted_at IS NULL GROUP BY campaign_id`,
      [workspaceId],
    );
    return new Map(rows.map((r) => [r.campaignId, r]));
  }
}
