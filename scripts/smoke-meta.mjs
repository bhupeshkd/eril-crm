// End-to-end checks for Facebook Messenger / Instagram DMs: page connection, the webhook handshake, signed events
// (HMAC-SHA256 over the raw body), contacts, retries, echoes, replies, the 24-hour window and disconnection.
// Starts a second API (port 3106) with META_APP_SECRET/META_VERIFY_TOKEN; replies stay in console mode.
// Usage: node scripts/smoke-meta.mjs
import { spawn } from 'child_process';
import { createHmac } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'backend', 'package.json'));
req('dotenv').config({ path: path.join(root, 'backend', '.env') });
const API_PORT = 3106;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const SECRET = 'smoke-meta-app-secret';
const VERIFY = 'smoke-verify-token';
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
/** Posts a webhook exactly as Meta does: the signature covers the raw bytes sent. */
async function event(payload, { sig = 'valid', expect = 200, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (sig === 'valid') headers['X-Hub-Signature-256'] = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  else if (sig) headers['X-Hub-Signature-256'] = sig;
  const res = await fetch(`${BASE}/public/meta/webhook`, { method: 'POST', headers, body });
  const text = await res.text();
  const ok = res.status === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'} POST /public/meta/webhook -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', text.slice(0, 200)); }
  return text;
}
const fb = (pageId, psid, mid, text, extra = {}) => ({ object: 'page', entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text, ...extra } }] }] });

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: `http://localhost:${API_PORT}`, DISABLE_SCHEDULERS: 'true', META_APP_SECRET: SECRET, META_VERIFY_TOKEN: VERIFY, META_PROVIDER: 'console' },
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
  const num = () => String(Math.floor(1e14 + Math.random() * 8.9e14));
  const PAGE = num();
  const IG = num();
  const reg = await call('POST', '/auth/register', { body: { email: `meta-${rand}@test.local`, password: 'SmokeTest123!', name: 'Fay Owner' } });
  const T = { token: reg.accessToken };

  // ---- Connecting pages ----
  await call('POST', '/meta/pages', { ...T, body: { platform: 'facebook', pageId: 'not-a-number', name: 'X', accessToken: 't' }, expect: 400 });
  await call('POST', '/meta/pages', { ...T, body: { platform: 'tiktok', pageId: PAGE, name: 'X', accessToken: 't' }, expect: 400 });
  const page = await call('POST', '/meta/pages', { ...T, body: { platform: 'facebook', pageId: PAGE, name: 'Bloom Studio', accessToken: 'EAAG-secret-page-token' } });
  check('page connected, token never returned', page.pageId === PAGE && !('accessToken' in page) && !JSON.stringify(page).includes('EAAG'));
  await call('POST', '/meta/pages', { ...T, body: { platform: 'facebook', pageId: PAGE, name: 'Dup', accessToken: 't' }, expect: 409 });
  await call('POST', '/meta/pages', { ...T, body: { platform: 'instagram', pageId: IG, name: 'bloom.studio', accessToken: 'IG-token' } });
  const list = await call('GET', '/meta/pages', T);
  check('setup shows webhook URL and signature mode', list.pages.length === 2 && list.setup.webhookUrl === `${BASE}/public/meta/webhook` && list.setup.appSecretSet && list.setup.verifyTokenSet && !JSON.stringify(list).includes('EAAG'));

  // ---- Handshake ----
  const hs = (q) => fetch(`${BASE}/public/meta/webhook?${new URLSearchParams(q)}`).then(async (r) => ({ status: r.status, text: await r.text() }));
  let h = await hs({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' });
  check('handshake with wrong token refused', h.status === 403);
  h = await hs({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '1158201444' });
  check('handshake echoes the challenge', h.status === 200 && h.text === '1158201444');
  h = await hs({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '<script>' });
  check('odd challenge values are not echoed', h.status === 403);

  // ---- Signed events ----
  const PSID = num();
  const m1 = fb(PAGE, PSID, `m_${rand}1`, 'Hi! Are you open Sunday?');
  await event(m1, { sig: null, expect: 403 });
  await event(m1, { sig: 'sha256=' + '0'.repeat(64), expect: 403 });
  const raw = JSON.stringify(m1);
  await event(null, { raw: raw.replace('Sunday', 'Monday'), sig: `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`, expect: 403 });
  check('rejected events stored nothing', (await call('GET', '/inbox/conversations?channel=facebook', T)).length === 0);
  check('acknowledged as Meta expects', (await event(m1)) === 'EVENT_RECEIVED');
  await event(m1); // retry
  await event({ object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PAGE }, recipient: { id: PSID }, message: { mid: `m_${rand}echo`, text: 'our own reply', is_echo: true } }] }] });
  await event(fb(PAGE, PSID, `m_${rand}2`, '', { attachments: [{ type: 'image', payload: { url: 'https://scontent.example/p.jpg' } }] }));
  let convs = await call('GET', '/inbox/conversations?channel=facebook', T);
  check('one Messenger conversation', convs.length === 1 && convs[0].contact.firstName === 'Facebook user' && convs[0].contact.source === 'facebook');
  let thread = (await call('GET', `/inbox/conversations/${convs[0].id}`, T)).messages;
  check('message stored once, echo skipped, photo linked', thread.length === 2 && thread[0].body === 'Hi! Are you open Sunday?' && thread[1].body.includes('https://scontent.example/p.jpg'));
  const contactId = convs[0].contactId;

  // ---- Replying ----
  const reply = await call('POST', '/inbox/messages', { ...T, body: { conversationId: convs[0].id, body: 'Yes, 10–4!' } });
  check('reply sent from the page to the person', reply.status === 'sent' && reply.fromAddress === 'Bloom Studio' && reply.toAddress === PSID && apiLog.includes(`[console facebook] to=${PSID}: Yes, 10–4!`));
  const later = fb(PAGE, PSID, `m_${rand}3`, 'Great, thanks');
  await event(later);
  check('same person → same contact', (await call('GET', '/inbox/conversations?channel=facebook', T)).length === 1);

  // ---- Instagram ----
  const IGSID = num();
  await event({ object: 'instagram', entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: IGSID }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: `ig_${rand}1`, text: 'Love your mugs 😍' } }] }] });
  convs = await call('GET', '/inbox/conversations?channel=instagram', T);
  check('Instagram DM in its own conversation', convs.length === 1 && convs[0].contact.firstName === 'Instagram user');
  const igReply = await call('POST', '/inbox/messages', { ...T, body: { conversationId: convs[0].id, body: 'Thank you!' } });
  check('Instagram reply goes out', igReply.status === 'sent' && apiLog.includes(`[console instagram] to=${IGSID}`));

  // ---- Rules ----
  const cold = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Cold' } });
  await call('POST', '/inbox/messages', { ...T, body: { contactId: cold.id, channel: 'facebook', body: 'Hi' }, expect: 400 });
  const { Client } = req('pg');
  const db = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  await db.connect();
  const fbConv = (await call('GET', '/inbox/conversations?channel=facebook', T))[0];
  await db.query(`UPDATE messages SET created_at = now() - interval '25 hours' WHERE conversation_id = $1 AND direction = 'inbound'`, [fbConv.id]);
  await db.end();
  const late = await call('POST', '/inbox/messages', { ...T, body: { conversationId: fbConv.id, body: 'Still there?' }, expect: 400 });
  check('outside 24 hours: explained', /Messenger only allows replies within 24 hours/.test(late?.message ?? ''));

  // ---- Unknown pages, disconnection, isolation ----
  await event(fb(num(), num(), `m_${rand}x`, 'to some other page'));
  check('messages to unconnected pages are ignored', (await call('GET', '/inbox/conversations?channel=facebook', T)).length === 1);
  await call('DELETE', `/meta/pages/${page.id}`, T);
  await event(fb(PAGE, PSID, `m_${rand}4`, 'hello again'));
  const after = await call('POST', '/inbox/messages', { ...T, body: { conversationId: fbConv.id, body: 'Hi' }, expect: 400 });
  check('after disconnecting: nothing new arrives and replies explain why', /no longer connected/.test(after?.message ?? ''));
  const other = await call('POST', '/auth/register', { body: { email: `meta-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
  const O = { token: other.accessToken };
  check('other workspace sees none', (await call('GET', '/meta/pages', O)).pages.length === 0 && (await call('GET', '/inbox/conversations', O)).length === 0);
  await call('DELETE', `/meta/pages/${page.id}`, { ...O, expect: 404 });
  check('reconnect by another workspace is allowed after disconnect', !!(await call('POST', '/meta/pages', { ...O, body: { platform: 'facebook', pageId: PAGE, name: 'New owner', accessToken: 't2' } })).id);
  void contactId;
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-1500));
} finally {
  api.kill();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
