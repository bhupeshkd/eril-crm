import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** A business phone number (e.g. bought in Twilio) whose calls are forwarded, recorded and texted back. */
@Entity('phone_numbers')
@Index(['number'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['workspaceId'])
export class PhoneNumber extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  /** E.164, e.g. +14155550100 */
  @Column({ length: 20 })
  number: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  label: string;

  /** Where calls ring (a staff mobile or desk phone). Null = straight to voicemail/missed. */
  @Column({ name: 'forward_to', type: 'varchar', length: 20, nullable: true })
  forwardTo: string | null;

  @Column({ name: 'ring_seconds', type: 'int', default: 20 })
  ringSeconds: number;

  @Column({ name: 'voicemail_enabled', default: true })
  voicemailEnabled: boolean;

  @Column({ type: 'varchar', length: 500, default: "Sorry, we cannot take your call right now. Please leave a message after the tone." })
  greeting: string;

  /** Missed-call text-back. */
  @Column({ name: 'text_back_enabled', default: true })
  textBackEnabled: boolean;

  @Column({ name: 'text_back_message', type: 'varchar', length: 480, default: 'Hi {{first_name}}, sorry we missed your call! This is {{business}} — how can we help?' })
  textBackMessage: string;

  /** Don't text the same caller again within this many hours. */
  @Column({ name: 'text_back_cooldown_hours', type: 'int', default: 24 })
  textBackCooldownHours: number;

  /** Record answered calls (both sides). */
  @Column({ name: 'record_calls', default: false })
  recordCalls: boolean;

  /** Said before connecting when recording is on. */
  @Column({ name: 'recording_notice', type: 'varchar', length: 200, default: 'This call may be recorded.' })
  recordingNotice: string;

  /** Phone menu ("For Sales, press 1"). */
  @Column({ name: 'menu_enabled', default: false })
  menuEnabled: boolean;

  @Column({ name: 'menu_prompt', type: 'varchar', length: 300, default: '' })
  menuPrompt: string;

  @Column({ name: 'menu_options', type: 'jsonb', default: () => "'[]'" })
  menuOptions: Array<{ digit: string; label: string; forwardTo: string }>;
}

/** One inbound call. */
@Entity('calls')
@Index(['callSid'], { unique: true })
@Index(['workspaceId', 'createdAt'])
@Index(['workspaceId', 'fromNumber', 'textedBackAt'])
export class Call extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'phone_number_id', type: 'uuid' })
  phoneNumberId: string;

  /** Null for withheld/anonymous callers. */
  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'call_sid', length: 64 })
  callSid: string;

  @Column({ name: 'from_number', type: 'varchar', length: 32 })
  fromNumber: string;

  @Column({ name: 'to_number', type: 'varchar', length: 32 })
  toNumber: string;

  /** ringing | answered | missed | voicemail */
  @Column({ type: 'varchar', length: 12, default: 'ringing' })
  status: 'ringing' | 'answered' | 'missed' | 'voicemail';

  /** inbound (customer called) | outbound (click-to-call from the app) */
  @Column({ type: 'varchar', length: 8, default: 'inbound' })
  direction: 'inbound' | 'outbound';

  /** Menu option the caller picked, if any. */
  @Column({ name: 'menu_choice', type: 'varchar', length: 40, nullable: true })
  menuChoice: string | null;

  /** Staff member who placed an outbound call. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'duration_sec', type: 'int', default: 0 })
  durationSec: number;

  @Column({ name: 'recording_url', type: 'varchar', length: 500, nullable: true })
  recordingUrl: string | null;

  @Column({ name: 'recording_duration_sec', type: 'int', nullable: true })
  recordingDurationSec: number | null;

  @Column({ name: 'texted_back_at', type: 'timestamptz', nullable: true })
  textedBackAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
