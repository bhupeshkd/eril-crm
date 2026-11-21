import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';
import { Contact } from '../database/entities/contact.entity';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { EmailProvider, MetaProvider, SmsProvider } from './providers';
import { TrackingService } from '../tracking/tracking.service';
import { Channel, InboundMessageDto, SendMessageDto } from './dto';

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', sms: 'SMS', chat: 'Chat message', whatsapp: 'WhatsApp message', facebook: 'Messenger message', instagram: 'Instagram message' };
/** Channels where the customer has to write first and replies are limited to 24 hours after their last message. */
const WINDOWED = ['whatsapp', 'facebook', 'instagram'];
const NAME: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Messenger', instagram: 'Instagram' };
/** WhatsApp allows free-form business messages only within 24h of the customer's last message. */
const WHATSAPP_WINDOW_MS = 24 * 3_600_000;

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly meta: MetaProvider,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly tracking: TrackingService,
  ) {}

  async list(workspaceId: string, opts: { channel?: string; search?: string } = {}) {
    const qb = this.conversations
      .createQueryBuilder('cv')
      .innerJoinAndSelect('cv.contact', 'c')
      .where('cv.workspace_id = :workspaceId', { workspaceId })
      .orderBy('cv.lastMessageAt', 'DESC')
      .take(200);
    if (opts.channel) qb.andWhere('cv.channel = :channel', { channel: opts.channel });
    if (opts.search?.trim()) {
      qb.andWhere(
        `(cv.subject ILIKE :t OR c.first_name ILIKE :t OR c.last_name ILIKE :t OR c.email ILIKE :t)`,
        { t: `%${opts.search.trim()}%` },
      );
    }
    return qb.getMany();
  }

  async get(workspaceId: string, id: string) {
    const conversation = await this.conversations.findOne({
      where: { id, workspaceId },
      relations: { contact: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const messages = await this.messages.find({
      where: { conversationId: id, workspaceId },
      order: { createdAt: 'ASC' },
    });
    const designed: Array<{ id: string }> = await this.messages.query(
      'SELECT id FROM messages WHERE conversation_id = $1 AND workspace_id = $2 AND html IS NOT NULL AND deleted_at IS NULL',
      [id, workspaceId],
    );
    const ids = new Set(designed.map((r) => r.id));
    return { ...conversation, messages: messages.map((m) => ({ ...m, hasHtml: ids.has(m.id) })) };
  }

  async messageHtml(workspaceId: string, id: string) {
    const m = await this.messages.createQueryBuilder('m').addSelect('m.html').where('m.id = :id AND m.workspace_id = :workspaceId', { id, workspaceId }).getOne();
    if (!m || !m.html) throw new NotFoundException('No designed version for this message');
    return { html: m.html };
  }

  /** Pause (with a reason) or resume the AI assistant in one conversation. Resuming resets its reply budget. */
  async setBot(workspaceId: string, id: string, paused: boolean, reason?: string | null) {
    const conv = await this.conversations.findOne({ where: { id, workspaceId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    await this.conversations.update(
      { id },
      paused
        ? { botPaused: true, botHandoffReason: (reason ?? 'Paused by a teammate').slice(0, 255), botPausedAt: new Date() }
        : { botPaused: false, botHandoffReason: null, botPausedAt: null, botReplyCount: 0 },
    );
    return { id, botPaused: paused };
  }

  /** A teammate replied by hand: the assistant steps back from this conversation. */
  async pauseBotForHuman(workspaceId: string, conversationId: string) {
    await this.conversations.update(
      { id: conversationId, workspaceId, botPaused: false },
      { botPaused: true, botHandoffReason: 'A teammate replied', botPausedAt: new Date() },
    );
  }

  async markRead(workspaceId: string, id: string) {
    const res = await this.conversations.update({ id, workspaceId }, { unreadCount: 0 });
    if (!res.affected) throw new NotFoundException('Conversation not found');
    return { id, unreadCount: 0 };
  }

  async unreadTotal(workspaceId: string): Promise<number> {
    const row = await this.conversations
      .createQueryBuilder('cv')
      .select('COALESCE(SUM(cv.unread_count), 0)', 'n')
      .where('cv.workspace_id = :workspaceId', { workspaceId })
      .getRawOne();
    return Number(row?.n ?? 0);
  }

  /** Sends an outbound email/SMS and stores it in the conversation thread. */
  async send(workspaceId: string, dto: SendMessageDto, userId?: string | null, opts: { html?: string; campaignId?: string; variant?: 'A' | 'B'; bot?: boolean } = {}) {
    let conversation: Conversation;
    let contact: Contact;
    if (dto.conversationId) {
      conversation = await this.conversations.findOne({
        where: { id: dto.conversationId, workspaceId },
        relations: { contact: true },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      contact = conversation.contact;
    } else {
      contact = await this.getContact(workspaceId, dto.contactId);
      const channel = dto.channel ?? 'email';
      if (channel === 'chat' || WINDOWED.includes(channel)) {
        // Web chats, WhatsApp and Meta DMs can only be answered, not started: the customer has to message first.
        const existing = await this.conversations.findOne({ where: { workspaceId, contactId: contact.id, channel }, relations: { contact: true } });
        if (!existing) throw new BadRequestException(channel === 'chat' ? "This contact hasn't started a web chat" : `This contact hasn't messaged you on ${NAME[channel]} yet`);
        conversation = existing;
      } else {
        conversation = await this.findOrCreate(workspaceId, contact, channel, dto.subject);
      }
    }
    const channel = conversation.channel as Channel;
    // Messenger/Instagram replies go to the person's page-scoped id through the page they wrote to.
    const metaRoute = channel === 'facebook' || channel === 'instagram' ? await this.metaRoute(contact.id, channel) : null;
    if ((channel === 'facebook' || channel === 'instagram') && !metaRoute) throw new BadRequestException(`The ${NAME[channel]} page this contact wrote to is no longer connected`);
    const to = channel === 'chat' ? 'web chat' : metaRoute ? metaRoute.psid : channel === 'email' ? contact.email : contact.phone;
    if (!to) {
      throw new BadRequestException(
        `Contact has no ${channel === 'email' ? 'email address' : 'phone number'}`,
      );
    }
    const subject = dto.subject || conversation.subject || '';
    // Opted out (e.g. replied STOP): no more texts, by hand or automatically.
    if ((channel === 'sms' || channel === 'whatsapp') && contact.dnd) {
      throw new BadRequestException(`${contact.firstName || 'This contact'} is on do-not-disturb, so texts can't be sent`);
    }
    if (WINDOWED.includes(channel)) {
      const [last] = await this.messages.find({ where: { conversationId: conversation.id, direction: 'inbound' }, order: { createdAt: 'DESC' }, take: 1 });
      if (!last || Date.now() - last.createdAt.getTime() >= WHATSAPP_WINDOW_MS) {
        throw new BadRequestException(`${NAME[channel]} only allows replies within 24 hours of the customer's last message. Ask them to message you, or use SMS or email.`);
      }
    }
    // Texts go out from the workspace's own business number when it has one.
    const sender = channel === 'sms' || channel === 'whatsapp' ? await this.senderNumber(workspaceId) : null;

    const message = this.messages.create({
      workspaceId,
      conversationId: conversation.id,
      direction: 'outbound',
      channel,
      body: dto.body,
      fromAddress: channel === 'chat' ? 'web chat' : metaRoute ? metaRoute.pageName : channel === 'email' ? this.email.fromAddress : sender!,
      toAddress: to,
      status: 'queued',
      sentBy: userId ?? null,
      sentByBot: !!opts.bot,
      html: null,
      campaignId: opts.campaignId ?? null,
      variant: opts.variant ?? null,
    });
    // Designed emails get an open pixel and tracked links (per workspace settings).
    let html = channel === 'email' ? opts.html : undefined;
    if (html) {
      const prepared = await this.tracking.prepare(workspaceId, html);
      // Keep the untracked copy for viewing in the app, so staff previews never count as opens.
      message.html = html;
      message.trackingToken = prepared.token;
      html = prepared.html;
    }
    try {
      const result =
        channel === 'chat'
          ? { providerMessageId: null } // the visitor's widget picks it up
          : channel === 'email'
            ? await this.email.send({ to, subject, body: dto.body, html })
            : metaRoute
              ? await this.meta.send(metaRoute.token, metaRoute.psid, dto.body, channel)
              : channel === 'whatsapp'
              ? await this.sms.send(`whatsapp:${to}`, dto.body, { from: `whatsapp:${sender}` })
              : await this.sms.send(to, dto.body, { from: sender! });
      message.status = 'sent';
      message.providerMessageId = result.providerMessageId;
    } catch (err) {
      message.status = 'failed';
      message.error = String(err?.message ?? err);
    }
    await this.messages.save(message);
    await this.touch(conversation, dto.body, 0);
    await this.activity.record(
      workspaceId,
      `message.${message.status}`,
      `${CHANNEL_LABEL[channel]} ${message.status === 'sent' ? 'sent to' : 'failed for'} ${contact.firstName} ${contact.lastName}`.trim(),
      { entityType: 'conversation', entityId: conversation.id, userId },
    );
    return message;
  }

  /** Where to send a Messenger/Instagram reply: the person's id on the (still connected) page they last wrote to. */
  private async metaRoute(contactId: string, platform: string): Promise<{ psid: string; token: string; pageName: string } | null> {
    const [row] = await this.messages.query(
      `SELECT i.psid, p.access_token AS token, p.name AS "pageName"
         FROM meta_identities i
         JOIN meta_pages p ON p.platform = i.platform AND p.page_id = i.page_id AND p.workspace_id = i.workspace_id AND p.deleted_at IS NULL
        WHERE i.contact_id = $1 AND i.platform = $2 AND i.deleted_at IS NULL
        ORDER BY i.last_inbound_at DESC NULLS LAST LIMIT 1`,
      [contactId, platform],
    );
    return row ?? null;
  }

  /** First connected business number of the workspace, else the global TWILIO_FROM. */
  private async senderNumber(workspaceId: string): Promise<string> {
    const [row] = await this.messages.query(
      `SELECT number FROM phone_numbers WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [workspaceId],
    );
    return row?.number ?? this.sms.fromNumber;
  }

  /** Delivery receipt from the provider; statuses only move forward. */
  async deliveryStatus(providerMessageId: string, status: 'sent' | 'delivered' | 'failed', error?: string | null) {
    const order = `CASE status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END`;
    const rank = status === 'sent' ? 1 : 2;
    await this.messages.query(
      `UPDATE messages SET status = $2, error = COALESCE($3, error), updated_at = now()
        WHERE provider_message_id = $1 AND direction = 'outbound' AND deleted_at IS NULL AND ${order} < $4`,
      [providerMessageId, status, error ?? null, rank],
    );
  }

  async receive(workspaceId: string, dto: InboundMessageDto, extras: { providerMessageId?: string; toAddress?: string } = {}) {
    const contact = await this.getContact(workspaceId, dto.contactId);
    const conversation = await this.findOrCreate(workspaceId, contact, dto.channel, dto.subject);
    const message = await this.messages.save(
      this.messages.create({
        workspaceId,
        conversationId: conversation.id,
        direction: 'inbound',
        channel: dto.channel,
        body: dto.body,
        fromAddress: dto.channel === 'chat' ? 'web chat' : ((dto.channel === 'email' ? contact.email : contact.phone) ?? ''),
        toAddress: extras.toAddress ?? (dto.channel === 'chat' ? '' : dto.channel === 'email' ? this.email.fromAddress : this.sms.fromNumber),
        status: 'received',
        providerMessageId: extras.providerMessageId ?? null,
      }),
    );
    await this.touch(conversation, dto.body, 1);
    await this.activity.record(
      workspaceId,
      'message.received',
      `New ${dto.channel === 'chat' ? 'web chat message' : NAME[dto.channel] ? `${NAME[dto.channel]} message` : dto.channel} from ${contact.firstName} ${contact.lastName}`.trim(),
      { entityType: 'conversation', entityId: conversation.id },
    );
    this.events.emit({
      type: 'message.received',
      workspaceId,
      contactId: contact.id,
      payload: { message, conversationId: conversation.id, contact },
    });
    return message;
  }

  private async getContact(workspaceId: string, id: string) {
    const contact = await this.contacts.findOne({ where: { id, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  private async findOrCreate(workspaceId: string, contact: Contact, channel: string, subject?: string) {
    const existing = await this.conversations.findOne({
      where: { workspaceId, contactId: contact.id, channel },
      relations: { contact: true },
    });
    if (existing) return existing;
    const created = await this.conversations.save(
      this.conversations.create({
        workspaceId,
        contactId: contact.id,
        channel,
        subject: subject ?? (channel === 'sms' ? 'SMS' : channel === 'chat' ? 'Web chat' : NAME[channel] ?? ''),
      }),
    );
    created.contact = contact;
    return created;
  }

  private async touch(conversation: Conversation, body: string, unreadDelta: number) {
    await this.conversations.update(
      { id: conversation.id },
      {
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 250),
        unreadCount: unreadDelta ? () => `unread_count + ${unreadDelta}` : conversation.unreadCount,
      },
    );
  }
}
