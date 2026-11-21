// End-to-end checks for the AI conversation assistant (auto-replies and hand-offs).
// Starts a second API instance (port 3102, AI_SIMULATE=true, short reply delay) against the same
// database, so no Anthropic key is needed. Build the backend first (dist/main.js).
// Usage: node scripts/smoke-ai-assistant.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3102;
const BASE = `http://localhost:${API_PORT}/api/v1`;
let failures = 0;
async function call(method, p, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), DISABLE_SCHEDULERS: 'true', AI_SIMULATE: 'true', ANTHROPIC_API_KEY: '', AI_BOT_DELAY_MS: '150' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await sleep(500);
  }
  const rand = Math.random().toString(36).slice(2, 8);
  const reg = await call('POST', '/auth/register', { body: { email: `ai-${rand}@test.local`, password: 'SmokeTest123!', name: 'Owner' } });
  const T = { token: reg.accessToken };

  // ---- Settings ----
  const initial = await call('GET', '/ai/assistant', T);
  check('assistant is off by default, AI simulated', initial.enabled === false && initial.aiEnabled === true && initial.simulated === true);
  await call('PUT', '/ai/assistant', { ...T, body: { enabled: true }, expect: 400 }); // no business info
  await call('PUT', '/ai/assistant', { ...T, body: { calendarId: '00000000-0000-0000-0000-000000000000' }, expect: 400 });
  await call('PUT', '/ai/assistant', { ...T, body: { maxReplies: 0 }, expect: 400 });
  await call('PUT', '/ai/assistant', { ...T, body: { channels: ['fax'] }, expect: 400 });
  const saved = await call('PUT', '/ai/assistant', { ...T, body: { enabled: true, channels: ['sms'], businessInfo: 'Open 9-5 Mon-Fri. Window cleaning from $45.', maxReplies: 2 } });
  check('settings saved', saved.enabled && saved.maxReplies === 2 && saved.channels.join() === 'sms');

  // ---- Preview (nothing sent) ----
  const p1 = await call('POST', '/ai/assistant/preview', { ...T, body: { message: 'What are your hours?' } });
  check('preview replies', p1.action === 'reply' && p1.message.includes('What are your hours'));
  const p2 = await call('POST', '/ai/assistant/preview', { ...T, body: { message: 'Can I talk to a human please' } });
  check('preview hands off', p2.action === 'handoff' && !!p2.reason);

  const sam = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Sam', phone: '+15550009991', email: `sam-${rand}@ex.test` } });
  const inbound = (contactId, body, channel = 'sms') => call('POST', '/inbox/inbound', { ...T, body: { contactId, channel, body } });
  const thread = async (contactId, channel = 'sms') => {
    const convs = await call('GET', `/inbox/conversations?search=${encodeURIComponent('Sam')}`, T);
    const c = convs.find((x) => x.contactId === contactId && x.channel === channel);
    return c ? call('GET', `/inbox/conversations/${c.id}`, T) : null;
  };

  // ---- Auto-reply ----
  await inbound(sam.id, 'Hi, what are your hours?');
  await sleep(1200);
  let conv = await thread(sam.id);
  let bot = conv.messages.filter((m) => m.sentByBot);
  check('assistant replied once', bot.length === 1 && bot[0].direction === 'outbound' && bot[0].status === 'sent', String(bot.length));
  check('reply counter', conv.botReplyCount === 1 && conv.botPaused === false);

  // ---- Burst: two quick messages get one reply, to the newest ----
  await inbound(sam.id, 'Also');
  await inbound(sam.id, 'do you clean gutters?');
  await sleep(1500);
  conv = await thread(sam.id);
  bot = conv.messages.filter((m) => m.sentByBot);
  check('burst answered once', bot.length === 2, String(bot.length));
  check('burst reply is to the newest message', bot[1].body.includes('gutters'));

  // ---- Reply limit -> hand-off ----
  await inbound(sam.id, 'And windows on Saturday?');
  await sleep(1200);
  conv = await thread(sam.id);
  check('limit reached: paused with reason', conv.botPaused === true && /limit of 2/.test(conv.botHandoffReason ?? ''), conv.botHandoffReason);
  const last = conv.messages[conv.messages.length - 1];
  check('hand-off message sent to customer', last.sentByBot && /team will get back/.test(last.body));
  let tasks = await call('GET', '/crm/tasks?status=open', T);
  check('hand-off task created', tasks.some((t) => t.title.includes('Sam') && t.title.includes('handed off')));

  // ---- Paused: no more replies ----
  const before = conv.messages.length;
  await inbound(sam.id, 'Hello?');
  await sleep(800);
  conv = await thread(sam.id);
  check('no reply while paused', conv.messages.length === before + 1);

  // ---- Resume, then customer asks for a person ----
  await call('PUT', `/inbox/conversations/${conv.id}/bot`, { ...T, body: { paused: false } });
  conv = await thread(sam.id);
  check('resume resets the counter', conv.botPaused === false && conv.botReplyCount === 0);
  await inbound(sam.id, 'I want to speak to a person about a refund');
  await sleep(1200);
  conv = await thread(sam.id);
  check('asking for a person hands off', conv.botPaused === true && /simulated/.test(conv.botHandoffReason ?? ''), conv.botHandoffReason);
  tasks = await call('GET', '/crm/tasks?status=open', T);
  check('second hand-off task', tasks.filter((t) => t.title.includes('handed off')).length === 2);

  // ---- A teammate replying pauses the assistant ----
  await call('PUT', `/inbox/conversations/${conv.id}/bot`, { ...T, body: { paused: false } });
  await call('POST', '/inbox/messages', { ...T, body: { conversationId: conv.id, body: 'Hi Sam, Jo here — I can help.' } });
  conv = await thread(sam.id);
  check('manual reply pauses the assistant', conv.botPaused === true && conv.botHandoffReason === 'A teammate replied');
  const n = conv.messages.length;
  await inbound(sam.id, 'Thanks Jo');
  await sleep(800);
  check('assistant stays quiet after a teammate replied', (await thread(sam.id)).messages.length === n + 1);

  // ---- Channel not enabled ----
  await inbound(sam.id, 'Email question', 'email');
  await sleep(800);
  const emailConv = await thread(sam.id, 'email');
  check('email ignored when only SMS is enabled', emailConv.messages.every((m) => !m.sentByBot));

  // ---- Do-not-disturb contact ----
  const dee = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Dee', phone: '+15550009992' } });
  await call('PUT', `/crm/contacts/${dee.id}`, { ...T, body: { dnd: true } });
  await inbound(dee.id, 'What are your hours?');
  await sleep(800);
  const convs = await call('GET', '/inbox/conversations?search=Dee', T);
  const deeConv = await call('GET', `/inbox/conversations/${convs.find((c) => c.contactId === dee.id).id}`, T);
  check('no reply to do-not-disturb contacts', deeConv.messages.every((m) => !m.sentByBot));

  // ---- Turned off ----
  await call('PUT', '/ai/assistant', { ...T, body: { enabled: false } });
  const ola = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Ola', phone: '+15550009993' } });
  await inbound(ola.id, 'What are your hours?');
  await sleep(800);
  const olaConvs = await call('GET', '/inbox/conversations?search=Ola', T);
  const olaConv = await call('GET', `/inbox/conversations/${olaConvs.find((c) => c.contactId === ola.id).id}`, T);
  check('no replies when the assistant is off', olaConv.messages.every((m) => !m.sentByBot));

  // ---- Isolation ----
  const other = await call('POST', '/auth/register', { body: { email: `ai2-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
  check("other workspace doesn't share settings", (await call('GET', '/ai/assistant', { token: other.accessToken })).businessInfo === '');
  await call('PUT', `/inbox/conversations/${conv.id}/bot`, { token: other.accessToken, body: { paused: false }, expect: 404 });
} finally {
  api.kill();
  if (failures) console.log(apiLog.split('\n').filter((l) => /error|Assistant/i.test(l)).slice(-15).join('\n'));
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll AI assistant checks passed');
process.exit(failures ? 1 : 0);
