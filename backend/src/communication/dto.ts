import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** chat = the website chat widget (replies are delivered when the visitor's widget polls). */
export const CHANNELS = ['email', 'sms', 'chat', 'whatsapp', 'facebook', 'instagram'] as const;
export type Channel = (typeof CHANNELS)[number];

export class SendMessageDto {
  /** Reply in an existing conversation… */
  @ValidateIf((o) => !o.contactId)
  @IsUUID()
  conversationId?: string;

  /** …or start/continue one with a contact. */
  @ValidateIf((o) => !o.conversationId)
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsIn(CHANNELS as unknown as string[])
  channel?: Channel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body: string;
}

/** Records a message received from a contact (provider webhooks / testing). */
export class InboundMessageDto {
  @IsUUID()
  contactId: string;

  @IsIn(CHANNELS as unknown as string[])
  channel: Channel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body: string;
}
