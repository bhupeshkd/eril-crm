// End-to-end checks for phone numbers, Twilio Voice webhooks (signed), voicemail and missed-call text-back.
// Starts a second API instance (port 3104) with TWILIO_AUTH_TOKEN so signatures are enforced; SMS stays in console mode.
// Needs the backend built (dist/, kept current by the dev server). Usage: node scripts/smoke-phone.mjs
import { spawn } from 'child_process';
import { createHmac } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { createRequire } from 'module';
createRequire(path.join(root, 'backend', 'package.json'))('dotenv').config({ path: path.join(root, 'backend', '.env') });
const API_PORT = 3104;
const ORIGIN = `http://localhost:${API_PORT}`;
const BASE = `${ORIGIN}/api/v1`;
const TOKEN = 'smoke-twilio-token';
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
// Independent implementation of Twilio's request signing.
const sign = (url, params) => createHmac('sha1', TOKEN).update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], url)).digest('base64');
async function hook(p, params, { signature = 'valid', expect = 200 } = {}) {
  const url = `${BASE}${p}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (signature === 'valid') headers['X-Twilio-Signature'] = sign(url, params);
  else if (signature) headers['X-Twilio-Signature'] = signature;
  const res = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(params) });
  const text = await res.text();
  const ok = res.status === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'} POST ${p} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', text.slice(0, 300)); }
  return { status: res.status, text, type: res.headers.get('content-type') };
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
  const MOBILE = `+1415${digits()}`;
  const reg = await call('POST', '/auth/register', { body: { email: `ph-${rand}@test.local`, password: 'SmokeTest123!', name: 'Rosa Owner' } });
  const T = { token: reg.accessToken };

  // ---- Numbers ----
  await call('POST', '/phone/numbers', { ...T, body: { number: '4155550100' }, expect: 400 });
  await call('POST', '/phone/numbers', { ...T, body: { number: BIZ, forwardTo: BIZ }, expect: 400 });
  await call('POST', '/phone/numbers', { ...T, body: { number: BIZ, textBackMessage: '   ' }, expect: 400 });
  const num = await call('POST', '/phone/numbers', { ...T, body: { number: BIZ.replace('+1', '+1 ').replace(/(\d{3})(\d{7})$/, '($1) $2'), label: 'Main', forwardTo: MOBILE, ringSeconds: 15, textBackMessage: 'Hi {{first_name}}, {{business}} here — sorry we missed you!' } });
  check('number saved in E.164', num.number === BIZ && num.forwardTo === MOBILE && num.textBackEnabled === true);
  await call('POST', '/phone/numbers', { ...T, body: { number: BIZ }, expect: 409 });
  const ov = await call('GET', '/phone/numbers', T);
  check('webhook URL and signature mode shown', ov.webhooks.voice === `${BASE}/public/voice/incoming` && ov.signatureRequired === true);

  // ---- Signatures ----
  const CALLER = `+1628${digits()}`;
  const c1 = { CallSid: `CA${rand}01`, From: CALLER, To: BIZ, CallStatus: 'ringing' };
  await hook('/public/voice/incoming', c1, { signature: null, expect: 403 });
  await hook('/public/voice/incoming', c1, { signature: 'bm90LXZhbGlk', expect: 403 });
  await hook('/public/voice/incoming', { ...c1, From: '+19990000000' }, { signature: sign(`${BASE}/public/voice/incoming`, c1), expect: 403 }); // tampered
  check('rejected webhooks logged nothing', (await call('GET', '/phone/calls', T)).length === 0);

  // ---- Missed call → voicemail → text-back ----
  let r = await hook('/public/voice/incoming', c1);
  check('incoming rings the forward number', r.type.startsWith('text/xml') && r.text.includes(`<Number>${MOBILE}</Number>`) && r.text.includes('timeout="15"') && r.text.includes(`action="${BASE}/public/voice/dial-status"`) && r.text.includes(`callerId="${BIZ}"`));
  await hook('/public/voice/incoming', c1); // Twilio retry: same call
  r = await hook('/public/voice/dial-status', { CallSid: c1.CallSid, DialCallStatus: 'no-answer', DialCallDuration: '0' });
  check('no answer → greeting and recording', r.text.includes('<Say>') && r.text.includes(`<Record maxLength="120" playBeep="true" action="${BASE}/public/voice/voicemail"`));
  r = await hook('/public/voice/voicemail', { CallSid: c1.CallSid, RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1', RecordingDuration: '23' });
  check('voicemail acknowledged', r.text.includes('Goodbye'));
  let calls = await call('GET', '/phone/calls', T);
  check('one call logged as voicemail with recording', calls.length === 1 && calls[0].status === 'voicemail' && calls[0].recordingDurationSec === 23 && calls[0].recordingUrl.endsWith('/RE1') && calls[0].textedBack === true, JSON.stringify(calls[0]));
  check('caller became a contact', calls[0].contact && calls[0].from === CALLER);
  const conv = (await call('GET', '/inbox/conversations?channel=sms', T)).find((c) => c.contactId === calls[0].contact.id);
  const thread = conv ? (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages : [];
  const sms = thread[0]?.body ?? '';
  check('text-back SMS sent, business name filled, no fake first name', thread.length === 1 && thread[0].direction === 'outbound' && sms.startsWith('Hi there, ') && sms.endsWith(' here — sorry we missed you!') && !sms.includes('{{'), sms);

  // Same caller again within the cooldown: logged, but no second text.
  const c2 = { CallSid: `CA${rand}02`, From: CALLER, To: BIZ };
  await hook('/public/voice/incoming', c2);
  await hook('/public/voice/dial-status', { CallSid: c2.CallSid, DialCallStatus: 'busy' });
  calls = await call('GET', '/phone/calls?status=missed', T);
  check('second missed call: no repeat text within cooldown', calls.length === 1 && calls[0].textedBack === false);
  await hook('/public/voice/dial-status', { CallSid: c2.CallSid, DialCallStatus: 'no-answer' }); // duplicate status
  check('duplicate status webhook changes nothing', (await call('GET', '/phone/calls', T)).length === 2);

  // ---- Answered ----
  const C2 = `+1628${digits()}`;
  const c3 = { CallSid: `CA${rand}03`, From: C2, To: BIZ };
  await hook('/public/voice/incoming', c3);
  r = await hook('/public/voice/dial-status', { CallSid: c3.CallSid, DialCallStatus: 'completed', DialCallDuration: '125' });
  check('answered call hangs up cleanly', r.text.includes('<Hangup/>') && !r.text.includes('<Record'));
  calls = await call('GET', '/phone/calls?status=answered', T);
  check('answered call logged with duration, no text', calls.length === 1 && calls[0].durationSec === 125 && calls[0].textedBack === false);

  // ---- Do-not-disturb and anonymous callers aren't texted ----
  const C3 = `+1628${digits()}`;
  const dnd = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Quiet', phone: C3 } });
  await call('PUT', `/crm/contacts/${dnd.id}`, { ...T, body: { dnd: true } });
  await hook('/public/voice/incoming', { CallSid: `CA${rand}04`, From: C3, To: BIZ });
  await hook('/public/voice/dial-status', { CallSid: `CA${rand}04`, DialCallStatus: 'no-answer' });
  await hook('/public/voice/incoming', { CallSid: `CA${rand}05`, From: 'anonymous', To: BIZ });
  await hook('/public/voice/dial-status', { CallSid: `CA${rand}05`, DialCallStatus: 'no-answer' });
  calls = await call('GET', '/phone/calls?status=missed', T);
  const quiet = calls.find((c) => c.contact?.id === dnd.id);
  const anon = calls.find((c) => c.from === 'anonymous');
  check('existing contact matched; DND not texted', quiet && quiet.textedBack === false && quiet.contact.name.startsWith('Quiet'));
  check('anonymous caller logged without contact or text', anon && anon.contact === null && anon.textedBack === false);

  // ---- No forwarding: straight to voicemail; voicemail off: hang up ----
  await call('PUT', `/phone/numbers/${num.id}`, { ...T, body: { forwardTo: null, voicemailEnabled: false, textBackCooldownHours: 0 } });
  const C4 = `+1628${digits()}`;
  r = await hook('/public/voice/incoming', { CallSid: `CA${rand}06`, From: C4, To: BIZ });
  check('no forwarding + voicemail off → greeting and hang up, already missed + texted', r.text.includes('<Hangup/>') && !r.text.includes('<Dial'));
  calls = await call('GET', '/phone/calls?status=missed', T);
  check('missed straight away and texted', calls.find((c) => c.from === C4)?.textedBack === true);

  // Unknown number: polite hang-up, nothing logged.
  r = await hook('/public/voice/incoming', { CallSid: `CA${rand}07`, From: C4, To: '+15005550000' });
  check('unknown number not in service', r.text.includes('not in service'));
  check('nothing logged for unknown number', !(await call('GET', '/phone/calls', T)).some((c) => c.to.number === '+15005550000'));

  // ---- Phone menu + call recording ----
  const SALES = `+1415${digits()}`;
  const SUPPORT = `+1415${digits()}`;
  await call('PUT', `/phone/numbers/${num.id}`, { ...T, body: { menuEnabled: true, menuOptions: [] }, expect: 400 });
  await call('PUT', `/phone/numbers/${num.id}`, { ...T, body: { menuOptions: [{ digit: '1', label: 'Sales', forwardTo: SALES }, { digit: '1', label: 'Dup', forwardTo: SUPPORT }] }, expect: 400 });
  const menuNum = await call('PUT', `/phone/numbers/${num.id}`, {
    ...T,
    body: { forwardTo: MOBILE, voicemailEnabled: true, menuEnabled: true, menuPrompt: 'Thanks for calling.', menuOptions: [{ digit: '2', label: 'Support', forwardTo: SUPPORT }, { digit: '1', label: 'Sales', forwardTo: SALES }], recordCalls: true },
  });
  check('menu saved and sorted', menuNum.menuOptions.map((o) => o.digit).join() === '1,2' && menuNum.recordCalls === true);
  const C5 = `+1628${digits()}`;
  const m1 = { CallSid: `CA${rand}10`, From: C5, To: BIZ };
  r = await hook('/public/voice/incoming', m1);
  check('incoming plays the menu', r.text.includes('<Gather numDigits="1"') && r.text.includes('Thanks for calling. For Sales, press 1. For Support, press 2.') && r.text.includes(`${BASE}/public/voice/menu?attempt=1`));
  r = await hook('/public/voice/menu?attempt=1', { ...m1, Digits: '7' });
  check('wrong key: one more try', r.text.includes('not an option') && r.text.includes('attempt=2'));
  r = await hook('/public/voice/menu?attempt=2', { ...m1, Digits: '2' });
  check('key 2 rings Support, recorded, with notice', r.text.includes(`<Number>${SUPPORT}</Number>`) && r.text.includes('record="record-from-answer-dual"') && r.text.includes('<Say>This call may be recorded.</Say>'));
  await hook('/public/voice/dial-status', { CallSid: m1.CallSid, DialCallStatus: 'completed', DialCallDuration: '61' });
  await hook('/public/voice/recording', { CallSid: m1.CallSid, RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE77', RecordingDuration: '58' });
  await hook('/public/voice/recording', { CallSid: m1.CallSid, RecordingUrl: 'javascript:alert(1)', RecordingDuration: '1' }); // ignored
  let row = (await call('GET', '/phone/calls?status=answered', T)).find((c) => c.from === C5);
  check('answered via menu, choice and recording logged', row && row.menuChoice === 'Support' && row.recordingUrl.endsWith('/RE77') && row.recordingDurationSec === 58 && row.textedBack === false, JSON.stringify(row));
  // No key pressed → default phone.
  const m2 = { CallSid: `CA${rand}11`, From: C5, To: BIZ };
  await hook('/public/voice/incoming', m2);
  r = await hook('/public/voice/menu?attempt=1&nokey=1', m2);
  check('no key → rings the main phone', r.text.includes(`<Number>${MOBILE}</Number>`));
  // Tampering with the query string breaks the signature.
  const tampered = await fetch(`${BASE}/public/voice/menu?attempt=2`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(`${BASE}/public/voice/menu?attempt=1`, m2) }, body: new URLSearchParams(m2) });
  check('signature covers the query string', tampered.status === 403, String(tampered.status));
  await call('PUT', `/phone/numbers/${num.id}`, { ...T, body: { menuEnabled: false, recordCalls: false } });

  // ---- Click-to-call (console provider) ----
  const cust = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Lena', phone: `+1628${digits()}` } });
  const noPhone = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'NoPhone', email: `np-${rand}@ex.test` } });
  await call('POST', '/phone/calls/outbound', { ...T, body: { contactId: noPhone.id }, expect: 400 });
  await call('POST', '/phone/calls/outbound', { ...T, body: { contactId: dnd.id }, expect: 400 });
  const out = await call('POST', '/phone/calls/outbound', { ...T, body: { contactId: cust.id } });
  check('outbound call placed (console) ringing your phone first', out.ringing === MOBILE && out.from === BIZ && out.status === 'answered');
  row = (await call('GET', '/phone/calls', T)).find((c) => c.id === out.id);
  check('logged as outgoing', row?.direction === 'outbound' && row.contact.id === cust.id);
  // What Twilio does in production: once you answer, it asks /bridge what to do, then reports the result.
  const { Client } = (await import('module')).createRequire(new URL('../backend/package.json', import.meta.url))('pg');
  const db = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  await db.connect();
  await db.query(`UPDATE calls SET status = 'ringing', call_sid = $2, ended_at = NULL WHERE id = $1`, [out.id, `CA${rand}OUT`]);
  r = await hook(`/public/voice/bridge?call=${out.id}`, { CallSid: `CA${rand}WRONG` });
  check('bridge refuses a call it did not place', r.text.includes('<Hangup/>') && !r.text.includes('<Dial'));
  r = await hook(`/public/voice/bridge?call=${out.id}`, { CallSid: `CA${rand}OUT` });
  check('bridge connects the customer from the business number', r.text.includes(`<Number>${(await call('GET', `/crm/contacts/${cust.id}`, T)).phone}</Number>`) && r.text.includes(`callerId="${BIZ}"`));
  await hook('/public/voice/dial-status', { CallSid: `CA${rand}OUT`, DialCallStatus: 'no-answer' });
  row = (await call('GET', '/phone/calls', T)).find((c) => c.id === out.id);
  check('unanswered outbound: no text-back to the customer', row.status === 'missed' && row.textedBack === false);
  await db.end();

  // ---- Simulated calls (development) ----
  const sim = await call('POST', `/phone/numbers/${num.id}/simulate`, { ...T, body: { from: `+1628${digits()}`, outcome: 'missed' } });
  check('simulated call runs the same flow', sim.status === 'missed' && sim.textedBack === true && sim.twiml.length >= 1);

  // ---- Isolation ----
  const other = await call('POST', '/auth/register', { body: { email: `ph-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
  const O = { token: other.accessToken };
  check('other workspace sees no calls', (await call('GET', '/phone/calls', O)).length === 0);
  await call('PUT', `/phone/numbers/${num.id}`, { ...O, body: { forwardTo: '+14155550111' }, expect: 404 });
  await call('POST', `/phone/numbers/${num.id}/simulate`, { ...O, body: { from: '+14155550111' }, expect: 404 });
  await call('POST', '/phone/numbers', { ...O, body: { number: BIZ }, expect: 409 });
  await call('DELETE', `/phone/numbers/${num.id}`, T);
  r = await hook('/public/voice/incoming', { CallSid: `CA${rand}08`, From: C4, To: BIZ });
  check('removed number no longer answers', r.text.includes('not in service'));
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-1500));
} finally {
  api.kill();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
