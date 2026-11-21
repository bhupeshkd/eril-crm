import { BadRequestException, Body, Controller, Injectable, Logger, NotFoundException, OnModuleInit, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Repository } from 'typeorm';
import { Invoice, Product } from '../database/entities/payment.entity';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { InboxService } from '../communication/inbox.service';
import { PaymentsService } from './payments';
import { DEFAULT_RECEIPT, fillMessage, fmtMoney } from './pay-message';

export class TextToPayDto {
  @IsUUID() contactId: string;
  /** Defaults to SMS when the contact has a phone number, otherwise email. */
  @IsOptional() @IsIn(['sms', 'email']) channel?: 'sms' | 'email';
  /** Either a one-time product… */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity?: number;
  /** …or a custom amount with a description. */
  @ValidateIf((o) => !o.productId) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.5) @Max(1_000_000) amount?: number;
  @ValidateIf((o) => !o.productId) @IsString() @Length(1, 200) description?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** Optional custom text; {{name}}, {{amount}}, {{description}}, {{link}} are filled in. */
  @IsOptional() @IsString() @MaxLength(320) message?: string;
}

@Injectable()
export class TextToPayService implements OnModuleInit {
  private readonly logger = new Logger(TextToPayService.name);

  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly payments: PaymentsService,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.events.onAny((e) => {
      if (e.type !== 'invoice.paid' || !e.payload?.invoice?.id) return;
      this.sendReceipt(e.workspaceId, e.payload.invoice.id).catch((err) => this.logger.warn(`Text-to-pay receipt failed: ${err.message}`));
    });
  }

  private link(token: string) {
    return `${this.config.get<string>('APP_URL') || 'http://localhost:3000'}/invoice/${token}`;
  }

  async request(workspaceId: string, dto: TextToPayDto, userId: string) {
    const contact = await this.contacts.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    const channel = dto.channel ?? (contact.phone ? 'sms' : 'email');
    if (channel === 'sms' && !contact.phone) throw new BadRequestException(`${contact.firstName} has no phone number`);
    if (channel === 'email' && !contact.email) throw new BadRequestException(`${contact.firstName} has no email address`);
    if (contact.dnd) throw new BadRequestException(`${contact.firstName} is on do-not-disturb`);

    let item: { productId?: string; name: string; quantity: number; unitPrice: number };
    let currency: string;
    if (dto.productId) {
      const p = await this.products.findOne({ where: { id: dto.productId, workspaceId, isActive: true } });
      if (!p) throw new NotFoundException('Product not found');
      if (p.interval !== 'one_time') throw new BadRequestException('Text-to-pay is for one-time payments; use a subscription for recurring products');
      item = { productId: p.id, name: p.name, quantity: dto.quantity ?? 1, unitPrice: p.price };
      currency = p.currency;
    } else {
      item = { name: dto.description!.trim(), quantity: 1, unitPrice: dto.amount! };
      currency = (dto.currency ?? 'USD').toUpperCase();
    }
    const description = item.quantity > 1 ? `${item.quantity} × ${item.name}` : item.name;

    const inv = await this.payments.createInvoice(
      workspaceId,
      { contactId: contact.id, items: [item], currency, notes: description },
      userId,
      { status: 'sent', source: 'text_to_pay', requestChannel: channel },
    );
    const link = this.link(inv.publicToken);
    const body = fillMessage(dto.message, { name: contact.firstName || 'there', amount: fmtMoney(inv.total, inv.currency), description, link });
    const msg = await this.inbox.send(workspaceId, { contactId: contact.id, channel, subject: `Payment request: ${description}`, body }, userId);
    if (msg.status === 'failed') {
      // Don't leave a payable invoice behind for a request the customer never received.
      await this.invoices.update({ id: inv.id }, { status: 'void' });
      throw new BadRequestException(`Couldn't send the payment link: ${msg.error ?? 'delivery failed'}`);
    }
    await this.activity.record(workspaceId, 'invoice.text_to_pay', `Payment link for ${fmtMoney(inv.total, inv.currency)} sent to ${contact.firstName} by ${channel === 'sms' ? 'SMS' : 'email'} (${inv.number})`, {
      entityType: 'contact',
      entityId: contact.id,
      userId,
    });
    return { invoice: { id: inv.id, number: inv.number, total: inv.total, currency: inv.currency, link }, message: { id: msg.id, status: msg.status, channel }, conversationId: msg.conversationId };
  }

  /** "Thanks, payment received" back on the channel the request went out on (once per invoice). */
  private async sendReceipt(workspaceId: string, invoiceId: string) {
    const claimed = await this.invoices
      .createQueryBuilder()
      .update(Invoice)
      .set({ receiptSentAt: () => 'now()' })
      .where("id = :id AND workspace_id = :ws AND source = 'text_to_pay' AND status = 'paid' AND receipt_sent_at IS NULL", { id: invoiceId, ws: workspaceId })
      .execute();
    if (!claimed.affected) return;
    const inv = await this.invoices.findOneOrFail({ where: { id: invoiceId }, relations: { contact: true } });
    if (!inv.contact || inv.contact.dnd || !inv.requestChannel) return;
    const description = inv.notes || inv.items.map((i) => i.name).join(', ');
    const body = fillMessage(DEFAULT_RECEIPT, { name: inv.contact.firstName || 'there', amount: fmtMoney(inv.total, inv.currency), description, link: this.link(inv.publicToken) });
    await this.inbox.send(workspaceId, { contactId: inv.contactId, channel: inv.requestChannel, subject: `Receipt: ${description}`, body }).catch((e) => this.logger.warn(`Receipt send failed: ${e.message}`));
  }
}

@Controller('payments/text-to-pay')
export class TextToPayController {
  constructor(private readonly svc: TextToPayService) {}

  @Post()
  @Permissions('invoices:write')
  request(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Body() dto: TextToPayDto) {
    return this.svc.request(ws, dto, userId);
  }
}


