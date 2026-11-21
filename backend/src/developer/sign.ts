import { createHmac } from 'crypto';

/** Webhook signature: hex HMAC-SHA256 of `${timestamp}.${body}` with the subscription secret. */
export function signPayload(secret: string, timestamp: string, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
