// End-to-end checks for two-way SMS and WhatsApp over Twilio Messaging webhooks (signed): incoming texts,
// STOP/START opt-out, duplicates, attachments, delivery receipts, the WhatsApp 24-hour window and isolation.
// Starts a second API (port 3105) with TWILIO_AUTH_TOKEN; SMS stays in console mode. Usage: node scripts/smoke-messaging.mjs
import { spawn } from 'child_process';
import { createHmac } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'backend', 'package.json'));
req('dotenv').config({ path: path.join(root, 'backend', '.env') });
const API_PORT = 3105;
const ORIGIN = `http://localhost:${API_PORT}`;
const BASE = `${ORIGIN}/api/v1`;
const TOKEN = 'smoke-messaging-token';
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
async function call(method, p, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* text */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return data;
}
const sign = (url, params) => createHmac('sha1', TOKEN).update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest('base64');
async function hook(p, params, { signed = true, expect = [200, 204] } = {}) {
  const url = `${BASE}${p}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signed ? { 'X-Twilio-Signature': sign(url, params) } : {}) }, body: new URLSearchParams(params) });
  const text = await res.text();
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} POST ${p} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', text.slice(0, 300)); }
  return { status: res.status, text };
}

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: ORIGIN, DISABLE_SCHEDULERS: 'true', TWILIO_AUTH_TOKEN: TOKEN, SMS_PROVIDER: 'console' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const rand = Math.random().toString(36).slice(2, 8);
  const digits = () => String(Math.floor(1e6 + Math.random() * 8.9e6));
  const BIZ = `+1415${digits()}`;
  const reg = await call('POST', '/auth/register', { body: { email: `msg-${rand}@test.local`, password: 'SmokeTest123!', name: 'Mia Owner' } });
  const T = { token: reg.accessToken };
  await call('POST', '/phone/numbers', { ...T, body: { number: BIZ, label: 'Main' } });
  check('messaging webhook URL shown', (await call('GET', '/phone/numbers', T)).webhooks.messaging === `${BASE}/public/messaging/incoming`);
  const thread = async (contactId, channel) => {
    const conv = (await call('GET', `/inbox/conversations?channel=${channel}`, T)).find((c) => c.contactId === contactId);
    return conv ? { conv, messages: (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages } : { conv: null, messages: [] };
  };

  // ---- Incoming SMS ----
  const CUST = `+1628${digits()}`;
  const m1 = { MessageSid: `SM${rand}01`, From: CUST, To: BIZ, Body: 'Hi, do you have openings Friday?', NumMedia: '0' };
  await hook('/public/messaging/incoming', m1, { signed: false, expect: 403 });
  const forged = await fetch(`${BASE}/public/messaging/incoming`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(`${BASE}/public/messaging/incoming`, m1) }, body: new URLSearchParams({ ...m1, Body: 'tampered' }) });
  check('changed body with the original signature is rejected', forged.status === 403, String(forged.status));
  let r = await hook('/public/messaging/incoming', m1);
  check('empty TwiML reply (we answer from the inbox)', r.text.includes('<Response></Response>'));
  await hook('/public/messaging/incoming', m1); // Twilio retry
  const contacts = await call('GET', `/crm/contacts?search=${encodeURIComponent(CUST.slice(-7))}`, T);
  const cust = (contacts.items ?? contacts).find((c) => c.phone === CUST);
  check('texter became a contact', cust && cust.source === 'sms');
  let t = await thread(cust.id, 'sms');
  check('one inbound SMS (retry ignored), unread', t.messages.length === 1 && t.messages[0].direction === 'inbound' && t.messages[0].body === m1.Body && t.conv.unreadCount === 1);

  // ---- Reply goes out from the business number; delivery receipts ----
  const sent = await call('POST', '/inbox/messages', { ...T, body: { conversationId: t.conv.id, body: 'Yes — 2pm or 4pm?' } });
  check('reply sent from the workspace number', sent.status === 'sent' && sent.fromAddress === BIZ && sent.providerMessageId);
  await hook('/public/messaging/status', { MessageSid: sent.providerMessageId, MessageStatus: 'delivered' });
  await hook('/public/messaging/status', { MessageSid: sent.providerMessageId, MessageStatus: 'sent' }); // late, out of order
  t = await thread(cust.id, 'sms');
  check('delivered, and a late "sent" does not undo it', t.messages.at(-1).status === 'delivered');
  const sent2 = await call('POST', '/inbox/messages', { ...T, body: { conversationId: t.conv.id, body: 'Second' } });
  await hook('/public/messaging/status', { MessageSid: sent2.providerMessageId, MessageStatus: 'undelivered', ErrorCode: '30006' });
  t = await thread(cust.id, 'sms');
  check('undelivered marked failed with the reason', t.messages.at(-1).status === 'failed' && t.messages.at(-1).error.includes('30006'));
  await hook('/public/messaging/status', { MessageSid: sent2.providerMessageId, MessageStatus: 'delivered' }, { signed: false, expect: 403 });

  // ---- Attachments ----
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}02`, From: CUST, To: BIZ, Body: 'Here is the photo', NumMedia: '2', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1', MediaContentType0: 'image/jpeg', MediaUrl1: 'javascript:alert(1)' });
  t = await thread(cust.id, 'sms');
  check('https attachment linked, unsafe one dropped', t.messages.at(-1).body.includes('/Media/ME1') && !t.messages.at(-1).body.includes('javascript'));

  // ---- STOP / START ----
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}03`, From: CUST, To: BIZ, Body: 'Stop' });
  check('STOP turns on do-not-disturb', (await call('GET', `/crm/contacts/${cust.id}`, T)).dnd === true);
  const blocked = await call('POST', '/inbox/messages', { ...T, body: { conversationId: t.conv.id, body: 'Are you sure?' }, expect: 400 });
  check('no texts after STOP', /do-not-disturb/.test(blocked?.message ?? ''));
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}04`, From: CUST, To: BIZ, Body: 'please stop sending discounts?' });
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}05`, From: CUST, To: BIZ, Body: 'START' });
  check('START turns messages back on', (await call('GET', `/crm/contacts/${cust.id}`, T)).dnd === false);
  check('keywords are kept in the thread', (await thread(cust.id, 'sms')).messages.filter((m) => m.direction === 'inbound').length === 5);

  // ---- WhatsApp ----
  const WA = `+1628${digits()}`;
  const waContact = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Wes', phone: WA } });
  await call('POST', '/inbox/messages', { ...T, body: { contactId: waContact.id, channel: 'whatsapp', body: 'Hello!' }, expect: 400 }); // can't start
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}06`, From: `whatsapp:${WA}`, To: `whatsapp:${BIZ}`, Body: 'Hi from WhatsApp', NumMedia: '0' });
  t = await thread(waContact.id, 'whatsapp');
  check('WhatsApp message lands in its own conversation on the existing contact', t.conv && t.messages.length === 1 && t.messages[0].channel === 'whatsapp');
  const wReply = await call('POST', '/inbox/messages', { ...T, body: { conversationId: t.conv.id, body: 'Hi Wes!' } });
  check('reply within 24h allowed', wReply.status === 'sent' && wReply.channel === 'whatsapp' && /\[console whatsapp\] from=whatsapp:\+1415\d+ to=whatsapp:\+1628/.test(apiLog));
  const { Client } = req('pg');
  const db = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  await db.connect();
  await db.query(`UPDATE messages SET created_at = now() - interval '25 hours' WHERE conversation_id = $1 AND direction = 'inbound'`, [t.conv.id]);
  await db.end();
  const late = await call('POST', '/inbox/messages', { ...T, body: { conversationId: t.conv.id, body: 'Still there?' }, expect: 400 });
  check('outside 24h: explains the WhatsApp rule', /24 hours/.test(late?.message ?? ''));
  await hook('/public/messaging/incoming', { MessageSid: `SM${rand}07`, From: `whatsapp:${WA}`, To: `whatsapp:${BIZ}`, Body: 'STOP' });
  check('STOP on WhatsApp is just a message (opt-out is an SMS carrier rule)', (await call('GET', `/crm/contacts/${waContact.id}`, T)).dnd === false);

  // ---- Unknown numbers and isolation ----
  r = await hook('/public/messaging/incoming', { MessageSid: `SM${rand}08`, From: CUST, To: '+15005550000', Body: 'hello?' });
  check('message to an unconnected number is ignored politely', r.text.includes('<Response></Response>'));
  const other = await call('POST', '/auth/register', { body: { email: `msg-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
  check('other workspace sees none of it', (await call('GET', '/inbox/conversations', { token: other.accessToken })).length === 0);
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-1500));
} finally {
  api.kill();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
