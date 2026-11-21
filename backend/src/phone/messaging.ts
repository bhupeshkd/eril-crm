import { Controller, Headers, Injectable, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { PhoneNumber } from '../database/entities/phone.entity';
import { Contact } from '../database/entities/contact.entity';
import { Message } from '../database/entities/message.entity';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { ContactsService } from '../crm/contacts.service';
import { InboxService } from '../communication/inbox.service';
import { ActivityService } from '../events/activity.service';
import { TwilioAuth } from './twilio-auth';
import { toE164 } from './twilio';
import { keywordAction, mapStatus, mediaLines, parseAddress } from './messaging-rules';

type Params = Record<string, string>;
const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Incoming texts (SMS and WhatsApp) and delivery receipts from Twilio Messaging. */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectRepository(PhoneNumber) private readonly numbers: Repository<PhoneNumber>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    private readonly contacts: ContactsService,
    private readonly inbox: InboxService,
    private readonly activity: ActivityService,
  ) {}

  /** A customer texted one of the workspace's business numbers. */
  async incoming(p: Params): Promise<{ status: string }> {
    const from = parseAddress(p.From);
    const to = parseAddress(p.To);
    const fromNumber = toE164(from.number);
    const toNumber = toE164(to.number);
    if (!p.MessageSid || !fromNumber || !toNumber) return { status: 'ignored' };
    const num = await this.numbers.findOne({ where: { number: toNumber } });
    if (!num) {
      this.logger.warn(`Message to unconnected number ${toNumber} ignored`);
      return { status: 'unknown-number' };
    }
    // Twilio retries on timeouts: each message is stored once.
    if (await this.messages.exist({ where: { providerMessageId: p.MessageSid, workspaceId: num.workspaceId } })) return { status: 'duplicate' };

    const channel = from.channel;
    let contact = await this.contactRepo.findOne({ where: { workspaceId: num.workspaceId, phone: fromNumber } });
    if (!contact) contact = (await this.contacts.upsert(num.workspaceId, { phone: fromNumber, firstName: fromNumber, source: channel })).contact;

    const media = mediaLines(p);
    const text = String(p.Body ?? '').slice(0, 5000);
    const body = [text, ...media.map((u) => `📎 ${u}`)].filter(Boolean).join('\n') || '(empty message)';

    // Carrier keywords: STOP opts out of all messages, START opts back in.
    const kw = channel === 'sms' ? keywordAction(text) : null;
    if (kw === 'stop' && !contact.dnd) {
      await this.contactRepo.update({ id: contact.id }, { dnd: true });
      await this.activity.record(num.workspaceId, 'contact.opted_out', `${contact.firstName} ${contact.lastName}`.trim() + ' replied STOP — messages are off (do not disturb)', { entityType: 'contact', entityId: contact.id });
    } else if (kw === 'start' && contact.dnd) {
      await this.contactRepo.update({ id: contact.id }, { dnd: false });
      await this.activity.record(num.workspaceId, 'contact.opted_in', `${contact.firstName} ${contact.lastName}`.trim() + ' replied START — messages are back on', { entityType: 'contact', entityId: contact.id });
    }

    await this.inbox.receive(num.workspaceId, { contactId: contact.id, channel, body } as any, { providerMessageId: p.MessageSid, toAddress: toNumber });
    return { status: kw ?? 'received' };
  }

  /** Delivery receipt for a message we sent. */
  async status(p: Params) {
    const s = mapStatus(p.MessageStatus);
    if (!p.MessageSid || !s) return;
    await this.inbox.deliveryStatus(p.MessageSid, s, s === 'failed' ? `Not delivered${p.ErrorCode ? ` (Twilio error ${p.ErrorCode})` : ''}` : null);
  }
}

@Controller('public/messaging')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class MessagingWebhookController {
  constructor(
    private readonly svc: MessagingService,
    private readonly auth: TwilioAuth,
  ) {}

  private params(req: Request): Params {
    return Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
  }

  /** Set as the number's "A message comes in" webhook. Replies are sent from the inbox, so the TwiML is empty. */
  @Post('incoming')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async incoming(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    const p = this.params(req);
    this.auth.assert(req, p, sig);
    await this.svc.incoming(p);
    res.status(200).type('text/xml; charset=utf-8').send(EMPTY);
  }

  @Post('status')
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  async status(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    const p = this.params(req);
    this.auth.assert(req, p, sig);
    await this.svc.status(p);
    res.status(204).end();
  }
}
