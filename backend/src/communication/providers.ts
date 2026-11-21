import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface SendResult {
  providerMessageId: string;
  provider: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /** Optional HTML version (sent as multipart text + html). */
  html?: string;
  from?: string;
}

/**
 * Email delivery. EMAIL_PROVIDER=sendgrid sends through the SendGrid v3 API
 * (requires SENDGRID_API_KEY); anything else logs to the console (dev).
 */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger('EmailProvider');

  constructor(private readonly config: ConfigService) {}

  get fromAddress() {
    return this.config.get<string>('EMAIL_FROM') || 'noreply@eril.local';
  }

  async send(msg: OutboundEmail): Promise<SendResult> {
    const provider = (this.config.get<string>('EMAIL_PROVIDER') || 'console').toLowerCase();
    if (provider !== 'sendgrid') {
      this.logger.log(`[console email] to=${msg.to} subject="${msg.subject}"${msg.html ? ' [html]' : ''}\n${msg.body}`);
      return { provider: 'console', providerMessageId: `console-${randomUUID()}` };
    }

    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (!apiKey) throw new Error('SENDGRID_API_KEY is not configured');
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: msg.from || this.fromAddress },
        subject: msg.subject || '(no subject)',
        content: [{ type: 'text/plain', value: msg.body }, ...(msg.html ? [{ type: 'text/html', value: msg.html }] : [])],
      }),
    });
    if (!res.ok) {
      throw new Error(`SendGrid error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return {
      provider: 'sendgrid',
      providerMessageId: res.headers.get('x-message-id') || `sendgrid-${randomUUID()}`,
    };
  }
}

/**
 * Facebook Messenger / Instagram replies via the Graph Send API (META_PROVIDER=meta); default logs to console.
 */
@Injectable()
export class MetaProvider {
  private readonly logger = new Logger('MetaProvider');

  constructor(private readonly config: ConfigService) {}

  async send(pageToken: string, recipientId: string, text: string, platform: string): Promise<SendResult> {
    const provider = (this.config.get<string>('META_PROVIDER') || 'console').toLowerCase();
    if (provider !== 'meta') {
      this.logger.log(`[console ${platform}] to=${recipientId}: ${text}`);
      return { provider: 'console', providerMessageId: `console-${randomUUID()}` };
    }
    const version = this.config.get<string>('META_GRAPH_VERSION') || 'v19.0';
    const res = await fetch(`https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 2000) } }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Meta error ${res.status}: ${json?.error?.message ?? ''}`);
    return { provider: 'meta', providerMessageId: json.message_id ?? null };
  }
}

/**
 * SMS delivery. SMS_PROVIDER=twilio uses the Twilio REST API
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM); default logs to console.
 */
@Injectable()
export class SmsProvider {
  private readonly logger = new Logger('SmsProvider');

  constructor(private readonly config: ConfigService) {}

  get fromNumber() {
    return this.config.get<string>('TWILIO_FROM') || '+10000000000';
  }

  /** Public URL Twilio reports delivery to (only useful when the API is reachable from the internet). */
  get statusCallback() {
    const base = this.config.get<string>('API_PUBLIC_URL');
    if (!base) return null;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix.replace(/^\/|\/$/g, '')}/public/messaging/status`;
  }

  /** `to`/`from` may be "whatsapp:+1…" for WhatsApp. `from` defaults to TWILIO_FROM. */
  async send(to: string, body: string, opts: { from?: string } = {}): Promise<SendResult> {
    const provider = (this.config.get<string>('SMS_PROVIDER') || 'console').toLowerCase();
    if (provider !== 'twilio') {
      this.logger.log(`[console ${to.startsWith('whatsapp:') ? 'whatsapp' : 'sms'}] from=${opts.from ?? this.fromNumber} to=${to}: ${body}`);
      return { provider: 'console', providerMessageId: `console-${randomUUID()}` };
    }
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!sid || !token) throw new Error('Twilio credentials are not configured');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: opts.from ?? this.fromNumber, Body: body, ...(this.statusCallback ? { StatusCallback: this.statusCallback } : {}) }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio error ${res.status}: ${json?.message ?? ''}`);
    return { provider: 'twilio', providerMessageId: json.sid };
  }
}
