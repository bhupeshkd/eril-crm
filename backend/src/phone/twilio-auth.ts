import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { validTwilioSignature } from './twilio';

/**
 * Checks that a webhook really came from Twilio. With TWILIO_AUTH_TOKEN set, every request must carry a valid
 * X-Twilio-Signature for the exact public URL; without it, unsigned webhooks are accepted only outside production.
 */
@Injectable()
export class TwilioAuth {
  constructor(private readonly config: ConfigService) {}

  assert(req: Request, params: Record<string, string>, signature: string | undefined) {
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!token) {
      if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Twilio webhooks are not configured');
      return;
    }
    const base = (this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`).replace(/\/$/, '');
    if (!validTwilioSignature(token, `${base}${req.originalUrl}`, params, signature)) throw new ForbiddenException('Invalid signature');
  }
}
