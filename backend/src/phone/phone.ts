import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { MoreThan, Not, Repository } from 'typeorm';
import { Call, PhoneNumber } from '../database/entities/phone.entity';
import { Contact } from '../database/entities/contact.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Message } from '../database/entities/message.entity';
import { MessagingService, MessagingWebhookController } from './messaging';
import { TwilioAuth } from './twilio-auth';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { bridgeTwiml, cleanMenu, dialTwiml, hangupTwiml, menuTwiml, outcomeOf, textBackMessage, toE164, validTwilioSignature, voicemailTwiml, type RecordOpts } from './twilio';

class NumberFieldsDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @ValidateIf((o) => o.forwardTo !== null) @IsString() @MaxLength(32) forwardTo?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(60) ringSeconds?: number;
  @IsOptional() @IsBoolean() voicemailEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) greeting?: string;
  @IsOptional() @IsBoolean() textBackEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(480) textBackMessage?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(720) textBackCooldownHours?: number;
  @IsOptional() @IsBoolean() recordCalls?: boolean;
  @IsOptional() @IsString() @MaxLength(200) recordingNotice?: string;
  @IsOptional() @IsBoolean() menuEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(300) menuPrompt?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(9) menuOptions?: Array<{ digit: string; label: string; forwardTo: string }>;
}
class OutboundDto {
  @IsUUID() contactId: string;
  /** Business number to call from; defaults to the workspace's first number. */
  @IsOptional() @IsUUID() numberId?: string;
  /** Phone that rings first (yours); defaults to the number's forward-to phone. */
  @IsOptional() @IsString() @MaxLength(32) agentPhone?: string;
}
class AddNumberDto extends NumberFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(32) number: string;
}
class CallsQuery {
  @IsOptional() @IsIn(['answered', 'missed', 'voicemail']) status?: 'answered' | 'missed' | 'voicemail';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
class SimulateDto {
  @IsString() @IsNotEmpty() @MaxLength(32) from: string;
  @IsOptional() @IsIn(['answered', 'missed', 'voicemail']) outcome?: 'answered' | 'missed' | 'voicemail';
}

type Params = Record<string, string>;
const XML = 'text/xml; charset=utf-8';

@Injectable()
export class PhoneService {
  private readonly logger = new Logger(PhoneService.name);

  constructor(
    @InjectRepository(PhoneNumber) private readonly numbers: Repository<PhoneNumber>,
    @InjectRepository(Call) private readonly calls: Repository<Call>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly contacts: ContactsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
    private readonly twilioAuth: TwilioAuth,
  ) {}

  private get apiBase() {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix.replace(/^\/|\/$/g, '')}`;
  }

  /** Webhook URLs to paste into the provider's number settings. */
  webhooks() {
    return { voice: `${this.apiBase}/public/voice/incoming`, messaging: `${this.apiBase}/public/messaging/incoming`, method: 'POST' };
  }

  // ---- Webhook authenticity ----
  /**
   * With TWILIO_AUTH_TOKEN set, every webhook must carry a valid X-Twilio-Signature. Without it, unsigned
   * webhooks are accepted only outside production (local testing), so nobody can fake calls to trigger texts.
   */
  assertFromTwilio(req: Request, params: Params, signature: string | undefined) {
    this.twilioAuth.assert(req, params, signature);
  }


  // ---- Settings ----
  list(workspaceId: string) {
    return this.numbers.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
  }

  private apply(n: PhoneNumber, dto: NumberFieldsDto) {
    if (dto.label !== undefined) n.label = dto.label.trim();
    if (dto.forwardTo !== undefined) {
      if (dto.forwardTo === null || dto.forwardTo.trim() === '') n.forwardTo = null;
      else {
        const f = toE164(dto.forwardTo);
        if (!f) throw new BadRequestException('Forward-to must be a full number with country code, like +14155550100');
        if (f === n.number) throw new BadRequestException("Calls can't be forwarded to the same number");
        n.forwardTo = f;
      }
    }
    if (dto.ringSeconds !== undefined) n.ringSeconds = dto.ringSeconds;
    if (dto.voicemailEnabled !== undefined) n.voicemailEnabled = dto.voicemailEnabled;
    if (dto.greeting !== undefined) n.greeting = dto.greeting.trim();
    if (dto.textBackEnabled !== undefined) n.textBackEnabled = dto.textBackEnabled;
    if (dto.textBackMessage !== undefined) {
      if (!dto.textBackMessage.trim()) throw new BadRequestException('Write the text to send after a missed call');
      n.textBackMessage = dto.textBackMessage.trim();
    }
    if (dto.textBackCooldownHours !== undefined) n.textBackCooldownHours = dto.textBackCooldownHours;
    if (dto.recordCalls !== undefined) n.recordCalls = dto.recordCalls;
    if (dto.recordingNotice !== undefined) n.recordingNotice = dto.recordingNotice.trim();
    if (dto.menuPrompt !== undefined) n.menuPrompt = dto.menuPrompt.trim();
    if (dto.menuOptions !== undefined) {
      const m = cleanMenu(dto.menuOptions);
      if (typeof m === 'string') throw new BadRequestException(m);
      n.menuOptions = m;
    }
    if (dto.menuEnabled !== undefined) n.menuEnabled = dto.menuEnabled;
    if (n.menuEnabled && !(n.menuOptions ?? []).length) throw new BadRequestException('Add at least one menu option before turning the menu on');
  }

  /** Recording settings for a Dial, when the number records calls. */
  private record(num: PhoneNumber | null, withNotice = true): RecordOpts | null {
    if (!num?.recordCalls) return null;
    return { callback: `${this.apiBase}/public/voice/recording`, notice: withNotice ? num.recordingNotice : '' };
  }

  /** Rings one phone for this call, then reports to dial-status. */
  private ring(num: PhoneNumber, to: string) {
    return dialTwiml(to, num.ringSeconds, `${this.apiBase}/public/voice/dial-status`, num.number, this.record(num));
  }

  async add(workspaceId: string, dto: AddNumberDto) {
    const number = toE164(dto.number);
    if (!number) throw new BadRequestException('Enter the number with its country code, like +14155550100');
    if (await this.numbers.exist({ where: { number } })) throw new ConflictException('That number is already connected');
    const n = this.numbers.create({ workspaceId, number });
    this.apply(n, dto);
    return this.numbers.save(n);
  }

  async update(workspaceId: string, id: string, dto: NumberFieldsDto) {
    const n = await this.numbers.findOne({ where: { id, workspaceId } });
    if (!n) throw new NotFoundException('Number not found');
    this.apply(n, dto);
    return this.numbers.save(n);
  }

  async remove(workspaceId: string, id: string) {
    const n = await this.numbers.findOne({ where: { id, workspaceId } });
    if (!n) throw new NotFoundException('Number not found');
    await this.numbers.softRemove(n);
    return { id };
  }

  async listCalls(workspaceId: string, q: CallsQuery) {
    const rows = await this.calls.find({
      where: { workspaceId, ...(q.status ? { status: q.status } : { status: Not('ringing') }) },
      order: { createdAt: 'DESC' },
      take: q.limit ?? 50,
    });
    const ids = [...new Set(rows.map((r) => r.contactId).filter(Boolean))] as string[];
    const people = ids.length ? await this.contactRepo.find({ where: ids.map((id) => ({ id, workspaceId })), select: { id: true, firstName: true, lastName: true } }) : [];
    const nums = await this.numbers.find({ where: { workspaceId }, withDeleted: true, select: { id: true, number: true, label: true } });
    return rows.map((r) => {
      const c = people.find((p) => p.id === r.contactId);
      const n = nums.find((x) => x.id === r.phoneNumberId);
      return {
        id: r.id,
        status: r.status,
        from: r.fromNumber,
        to: n ? { number: n.number, label: n.label } : { number: r.toNumber, label: '' },
        contact: c ? { id: c.id, name: `${c.firstName} ${c.lastName}`.trim() } : null,
        direction: r.direction,
        menuChoice: r.menuChoice,
        durationSec: r.durationSec,
        recordingUrl: r.recordingUrl,
        recordingDurationSec: r.recordingDurationSec,
        textedBack: !!r.textedBackAt,
        createdAt: r.createdAt,
      };
    });
  }

  // ---- Call flow ----
  /** Incoming call: log it, find or create the caller, then ring the business's phone (or go to voicemail). */
  async incoming(p: Params): Promise<string> {
    const to = toE164(p.To);
    const num = to ? await this.numbers.findOne({ where: { number: to } }) : null;
    if (!num) return hangupTwiml('This number is not in service.');
    if (!p.CallSid) throw new BadRequestException('Missing CallSid');
    let call = await this.calls.findOne({ where: { callSid: p.CallSid } });
    if (!call) {
      const from = toE164(p.From);
      let contactId: string | null = null;
      if (from) {
        const existing = await this.contactRepo.findOne({ where: { workspaceId: num.workspaceId, phone: from } });
        contactId = existing?.id ?? (await this.contacts.upsert(num.workspaceId, { phone: from, firstName: from, source: 'phone' }).catch(() => null))?.contact.id ?? null;
      }
      call = await this.calls
        .save(this.calls.create({ workspaceId: num.workspaceId, phoneNumberId: num.id, contactId, callSid: p.CallSid, fromNumber: from ?? (p.From || 'anonymous').slice(0, 32), toNumber: to!, status: 'ringing' }))
        .catch(async () => (await this.calls.findOne({ where: { callSid: p.CallSid } }))!); // Twilio retry raced us
    }
    if (num.menuEnabled && num.menuOptions?.length) return menuTwiml(num.menuPrompt, num.menuOptions, `${this.apiBase}/public/voice/menu`, 1);
    return this.defaultRoute(call, num);
  }

  /** No menu choice: ring the main forward-to phone, or go straight to missed/voicemail. */
  private async defaultRoute(call: Call, num: PhoneNumber) {
    if (num.forwardTo) return this.ring(num, num.forwardTo);
    await this.finishMissed(call, num);
    return voicemailTwiml(num.greeting, num.voicemailEnabled ? `${this.apiBase}/public/voice/voicemail` : null);
  }

  /** Caller pressed a key (or none). Invalid keys get one more try; then the default route. */
  async menu(p: Params, attempt: number, noKey: boolean): Promise<string> {
    const call = p.CallSid ? await this.calls.findOne({ where: { callSid: p.CallSid } }) : null;
    if (!call || call.status !== 'ringing') return hangupTwiml();
    const num = await this.numbers.findOne({ where: { id: call.phoneNumberId } });
    if (!num) return hangupTwiml('This number is not in service.');
    const opt = !noKey ? (num.menuOptions ?? []).find((o) => o.digit === p.Digits) : undefined;
    if (opt) {
      await this.calls.update({ id: call.id }, { menuChoice: opt.label });
      return this.ring(num, opt.forwardTo);
    }
    if (!noKey && attempt < 2 && num.menuEnabled) return menuTwiml(`Sorry, that's not an option.`, num.menuOptions, `${this.apiBase}/public/voice/menu`, attempt + 1);
    return this.defaultRoute(call, num);
  }

  /** Recording of an answered call (inbound or outbound) is ready. */
  async recording(p: Params): Promise<string> {
    const call = p.CallSid ? await this.calls.findOne({ where: { callSid: p.CallSid } }) : null;
    if (call && call.status !== 'voicemail' && p.RecordingUrl && /^https:\/\/[^\s"'<>]+$/.test(p.RecordingUrl)) {
      await this.calls.update({ id: call.id }, { recordingUrl: p.RecordingUrl.slice(0, 500), recordingDurationSec: Math.max(0, Number(p.RecordingDuration) || 0) });
    }
    return hangupTwiml();
  }

  /** The forwarded leg ended: answered → log it; otherwise missed → text back and offer voicemail. */
  async dialStatus(p: Params): Promise<string> {
    const call = p.CallSid ? await this.calls.findOne({ where: { callSid: p.CallSid } }) : null;
    if (!call) return hangupTwiml();
    if (call.direction === 'outbound') return this.outboundStatus(call, p);
    const num = await this.numbers.findOne({ where: { id: call.phoneNumberId }, withDeleted: true });
    if (outcomeOf(p.DialCallStatus) === 'answered') {
      await this.calls.update({ id: call.id, status: 'ringing' }, { status: 'answered', durationSec: Math.max(0, Number(p.DialCallDuration) || 0), endedAt: new Date() });
      await this.activity.record(call.workspaceId, 'call.answered', `Answered call from ${call.fromNumber}`, { entityType: 'contact', entityId: call.contactId ?? undefined });
      return hangupTwiml();
    }
    await this.finishMissed(call, num);
    return num ? voicemailTwiml(num.greeting, num.voicemailEnabled ? `${this.apiBase}/public/voice/voicemail` : null) : hangupTwiml();
  }

  async voicemail(p: Params): Promise<string> {
    const call = p.CallSid ? await this.calls.findOne({ where: { callSid: p.CallSid } }) : null;
    if (call && p.RecordingUrl && /^https:\/\/[^\s"'<>]+$/.test(p.RecordingUrl)) {
      await this.calls.update({ id: call.id }, { status: 'voicemail', recordingUrl: p.RecordingUrl.slice(0, 500), recordingDurationSec: Math.max(0, Number(p.RecordingDuration) || 0), endedAt: new Date() });
      await this.activity.record(call.workspaceId, 'call.voicemail', `Voicemail from ${call.fromNumber} (${Number(p.RecordingDuration) || 0}s)`, { entityType: 'contact', entityId: call.contactId ?? undefined });
    }
    return hangupTwiml('Thank you. Goodbye.');
  }

  /** Marks the call missed (once) and runs the text-back and notifications. */
  private async finishMissed(call: Call, num: PhoneNumber | null) {
    const res = await this.calls.update({ id: call.id, status: 'ringing' }, { status: 'missed', endedAt: new Date() });
    if (!res.affected) return; // already handled (webhook retry)
    await this.activity.record(call.workspaceId, 'call.missed', `Missed call from ${call.fromNumber}`, { entityType: 'contact', entityId: call.contactId ?? undefined });
    const contact = call.contactId ? await this.contactRepo.findOne({ where: { id: call.contactId } }) : null;
    let textedBack = false;
    if (num?.textBackEnabled && contact?.phone && !contact.dnd) textedBack = await this.textBack(call, num, contact).catch((e) => { this.logger.warn(`Text-back failed: ${e.message}`); return false; });
    this.events.emit({
      type: 'call.missed',
      workspaceId: call.workspaceId,
      contactId: call.contactId,
      payload: { call: { id: call.id, from: call.fromNumber, to: call.toNumber }, contact, textedBack },
    });
  }

  private async textBack(call: Call, num: PhoneNumber, contact: Contact) {
    if (num.textBackCooldownHours > 0) {
      const recent = await this.calls.exist({
        where: { workspaceId: call.workspaceId, fromNumber: call.fromNumber, textedBackAt: MoreThan(new Date(Date.now() - num.textBackCooldownHours * 3_600_000)) },
      });
      if (recent) return false;
    }
    // Claim first, so overlapping webhooks can't text twice.
    const claim = await this.calls.createQueryBuilder().update(Call).set({ textedBackAt: () => 'now()' }).where('id = :id AND texted_back_at IS NULL', { id: call.id }).execute();
    if (!claim.affected) return false;
    const ws = await this.workspaces.findOne({ where: { id: call.workspaceId } });
    const body = textBackMessage(num.textBackMessage, { firstName: contact.firstName === contact.phone ? null : contact.firstName, business: ws?.name ?? 'us' });
    await this.inbox.send(call.workspaceId, { contactId: contact.id, channel: 'sms', body } as any);
    return true;
  }

  // ---- Click-to-call ----
  /** Rings the staff member's phone first; when they answer, Twilio fetches /bridge and connects the customer. */
  async outbound(workspaceId: string, userId: string, dto: OutboundDto) {
    const contact = await this.contactRepo.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    const to = toE164(contact.phone);
    if (!to) throw new BadRequestException('This contact has no phone number with a country code');
    if (contact.dnd) throw new BadRequestException('This contact is on do-not-disturb');
    const num = dto.numberId
      ? await this.numbers.findOne({ where: { id: dto.numberId, workspaceId } })
      : await this.numbers.findOne({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    if (!num) throw new BadRequestException('Connect a business number in Settings → Phone first');
    const agent = toE164(dto.agentPhone) ?? num.forwardTo;
    if (!agent) throw new BadRequestException('Enter the phone to ring first (yours), or set a forward-to phone on the number');
    const call = await this.calls.save(
      this.calls.create({ workspaceId, phoneNumberId: num.id, contactId: contact.id, userId, direction: 'outbound', callSid: `OUT${randomUUID().replace(/-/g, '')}`, fromNumber: num.number, toNumber: to, status: 'ringing' }),
    );
    const provider = (this.config.get<string>('VOICE_PROVIDER') || 'console').toLowerCase();
    if (provider !== 'twilio') {
      // Development: no real call; logged as connected so the flow can be followed in the app.
      this.logger.log(`[console call] ring ${agent}, then connect ${to} from ${num.number}`);
      await this.calls.update({ id: call.id }, { status: 'answered', endedAt: new Date() });
    } else {
      const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
      const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
      if (!sid || !token) throw new BadRequestException('Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: agent, From: num.number, Url: `${this.apiBase}/public/voice/bridge?call=${call.id}`, Method: 'POST' }),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok || !body.sid) {
        await this.calls.update({ id: call.id }, { status: 'missed', endedAt: new Date() });
        throw new BadRequestException(`The call could not be placed: ${body.message ?? res.statusText}`);
      }
      await this.calls.update({ id: call.id }, { callSid: body.sid });
    }
    await this.activity.record(workspaceId, 'call.outbound', `Called ${contact.firstName} ${contact.lastName}`.trim(), { entityType: 'contact', entityId: contact.id, userId });
    const saved = await this.calls.findOneByOrFail({ id: call.id });
    return { id: saved.id, status: saved.status, to, from: num.number, ringing: agent };
  }

  /** Staff member answered: connect the customer (the call id must match the call Twilio placed). */
  async bridge(p: Params, callId: string): Promise<string> {
    const call = await this.calls.findOne({ where: { id: callId, direction: 'outbound' } });
    if (!call || call.callSid !== p.CallSid || call.status !== 'ringing') return hangupTwiml();
    const num = await this.numbers.findOne({ where: { id: call.phoneNumberId }, withDeleted: true });
    if (!num) return hangupTwiml();
    return bridgeTwiml(call.toNumber, num.number, `${this.apiBase}/public/voice/dial-status`, this.record(num, false));
  }

  /** Outbound result: answered or not — never a text-back or voicemail for the customer. */
  private async outboundStatus(call: Call, p: Params) {
    const answered = outcomeOf(p.DialCallStatus) === 'answered';
    await this.calls.update(
      { id: call.id, status: 'ringing' },
      { status: answered ? 'answered' : 'missed', durationSec: answered ? Math.max(0, Number(p.DialCallDuration) || 0) : 0, endedAt: new Date() },
    );
    return hangupTwiml(answered ? '' : 'The customer did not answer.');
  }

  /** Test a number's setup from the app without a real call (not available in production). */
  async simulate(workspaceId: string, id: string, dto: SimulateDto) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Simulated calls are only available in development');
    const num = await this.numbers.findOne({ where: { id, workspaceId } });
    if (!num) throw new NotFoundException('Number not found');
    const sid = `SIM${randomUUID().replace(/-/g, '')}`;
    const twimlIn = await this.incoming({ CallSid: sid, From: dto.from, To: num.number, CallStatus: 'ringing' });
    const outcome = dto.outcome ?? 'missed';
    const steps = [twimlIn];
    if (num.forwardTo) steps.push(await this.dialStatus({ CallSid: sid, DialCallStatus: outcome === 'answered' ? 'completed' : 'no-answer', DialCallDuration: outcome === 'answered' ? '42' : '0' }));
    if (outcome === 'voicemail' && num.voicemailEnabled) steps.push(await this.voicemail({ CallSid: sid, RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/REsimulated', RecordingDuration: '17' }));
    const call = await this.calls.findOneByOrFail({ callSid: sid });
    return { callId: call.id, status: call.status, textedBack: !!call.textedBackAt, twiml: steps };
  }
}

@Controller('phone')
export class PhoneController {
  constructor(private readonly svc: PhoneService) {}

  @Get('numbers')
  @Permissions('conversations:read')
  async numbers(@Tenant('workspaceId') ws: string) {
    return { numbers: await this.svc.list(ws), webhooks: this.svc.webhooks(), signatureRequired: !!process.env.TWILIO_AUTH_TOKEN || process.env.NODE_ENV === 'production' };
  }

  @Post('numbers')
  @Permissions('workspaces:write')
  add(@Tenant('workspaceId') ws: string, @Body() dto: AddNumberDto) {
    return this.svc.add(ws, dto);
  }

  @Put('numbers/:id')
  @Permissions('workspaces:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NumberFieldsDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete('numbers/:id')
  @Permissions('workspaces:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Post('numbers/:id/simulate')
  @Permissions('workspaces:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  simulate(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateDto) {
    return this.svc.simulate(ws, id, dto);
  }

  @Post('calls/outbound')
  @Permissions('conversations:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  outbound(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: OutboundDto) {
    return this.svc.outbound(ws, userId, dto);
  }

  @Get('calls')
  @Permissions('conversations:read')
  calls(@Tenant('workspaceId') ws: string, @Query() q: CallsQuery) {
    return this.svc.listCalls(ws, q);
  }
}

/** Twilio Voice webhooks (form-encoded POSTs, TwiML responses). */
@Controller('public/voice')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class VoiceWebhookController {
  constructor(private readonly svc: PhoneService) {}

  private async reply(req: Request, res: Response, sig: string | undefined, run: (p: Params) => Promise<string>) {
    const params: Params = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
    this.svc.assertFromTwilio(req, params, sig);
    res.status(200).type(XML).send(await run(params));
  }

  @Post('incoming')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  incoming(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.incoming(p));
  }

  @Post('dial-status')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  dialStatus(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.dialStatus(p));
  }

  @Post('menu')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  menu(@Req() req: Request, @Res() res: Response, @Query('attempt') attempt: string, @Query('nokey') nokey: string, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.menu(p, Math.min(2, Math.max(1, Number(attempt) || 1)), nokey === '1'));
  }

  @Post('recording')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  recording(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.recording(p));
  }

  @Post('bridge')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  bridge(@Req() req: Request, @Res() res: Response, @Query('call', ParseUUIDPipe) callId: string, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.bridge(p, callId));
  }

  @Post('voicemail')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  voicemail(@Req() req: Request, @Res() res: Response, @Headers('x-twilio-signature') sig?: string) {
    return this.reply(req, res, sig, (p) => this.svc.voicemail(p));
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([PhoneNumber, Call, Contact, Workspace, Message]), CrmModule, CommunicationModule],
  controllers: [PhoneController, VoiceWebhookController, MessagingWebhookController],
  providers: [PhoneService, MessagingService, TwilioAuth],
})
export class PhoneModule {}
