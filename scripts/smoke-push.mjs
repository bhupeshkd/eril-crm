// End-to-end checks for Web Push notifications: device subscription rules, delivery of real encrypted pushes
// (decrypted here with the device's keys), topics, permissions by role, the acting user being skipped,
// isolation between users, and clean-up of devices the push service says are gone.
// Starts a fake push service (HTTPS with a throwaway self-signed certificate made by openssl) and a second API
// instance (port 3105) that's allowed to post to it and trusts that certificate; needs the backend built (dist/).
// Usage: node scripts/smoke-push.mjs
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import https from 'https';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ece = createRequire(path.join(root, 'backend', 'package.json'))('http_ece');
const PUSH_PORT = 5481;
const API_PORT = 3105;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const PUSH = `https://127.0.0.1:${PUSH_PORT}`;
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
async function call(method, p, { token, body, expect = [200, 201], ua } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(ua ? { 'User-Agent': ua } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* text */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

// ---- A browser "device": its own key pair, and a mailbox on the fake push service ----
function device(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { name, ecdh, auth, endpoint: `${PUSH}/send/${name}-${crypto.randomBytes(4).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
const inbox = new Map(); // endpoint path → decoded messages
const gone = new Set(); // endpoint paths that answer 410
// web-push only speaks HTTPS: make a certificate for 127.0.0.1 that only the test API instance trusts.
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eril-push-'));
const openssl = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'].find((bin) => {
  try { execFileSync(bin, ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!openssl) { console.log('FAIL openssl not found (needed for the fake HTTPS push service)'); process.exit(1); }
// Own minimal config, so a machine-wide OPENSSL_CONF pointing somewhere odd doesn't break this.
fs.writeFileSync(path.join(certDir, 'openssl.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n');
const sslEnv = { ...process.env, OPENSSL_CONF: path.join(certDir, 'openssl.cnf') };
execFileSync(openssl, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], { stdio: 'ignore', env: sslEnv });
const tls = { key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) };
const pushServer = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (gone.has(req.url)) { res.writeHead(410); return res.end(); }
    const list = inbox.get(req.url) ?? [];
    list.push({ headers: req.headers, body: Buffer.concat(chunks) });
    inbox.set(req.url, list);
    res.writeHead(201);
    res.end();
  });
});
await new Promise((r) => pushServer.listen(PUSH_PORT, '127.0.0.1', r));
const pathOf = (d) => new URL(d.endpoint).pathname;
const received = (d) => (inbox.get(pathOf(d)) ?? []).map((m) => JSON.parse(ece.decrypt(m.body, { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth.toString('base64url') }).toString('utf8')));
const raw = (d) => inbox.get(pathOf(d)) ?? [];

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: `http://localhost:${API_PORT}`, DISABLE_SCHEDULERS: 'true', PUSH_TEST_ENDPOINT_HOSTS: `127.0.0.1:${PUSH_PORT}`, NODE_EXTRA_CA_CERTS: path.join(certDir, 'cert.pem') },
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
  const PW = 'SmokeTest123!';
  const reg = await call('POST', '/auth/register', { body: { email: `push-o-${rand}@test.local`, password: PW, name: 'Olive Owner' } });
  const O = { token: reg.accessToken };
  const ws = claims(reg.accessToken).currentWorkspaceId;
  const join = async (role, who) => {
    const inv = await call('POST', `/workspaces/${ws}/invite`, { ...O, body: { email: `push-${who}-${rand}@test.local`, role } });
    const a = await call('POST', `/auth/invitations/${inv.inviteUrl.split('/invite/')[1]}/accept`, { body: { name: who, password: PW } });
    return { token: a.accessToken };
  };
  const M = await join('manager', 'mia'); // can see payments
  const T = await join('team_member', 'tom'); // can't see payments

  // ---- Config ----
  const cfg = await call('GET', '/push/config', O);
  check('push enabled with a public key and topics', cfg.enabled && /^[A-Za-z0-9_-]{80,}$/.test(cfg.publicKey) && cfg.topics.some((t) => t.key === 'messages'));
  await call('GET', '/push/config', { expect: 401 });

  // ---- Subscribing ----
  const dO = device('olive'), dM = device('mia'), dT = device('tom'), dGone = device('gone');
  const sub = (who, d, extra = {}) => call('POST', '/push/subscriptions', { ...who, body: { endpoint: d.endpoint, keys: d.keys, ...extra }, ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36', expect: extra.expect ?? [200, 201] });
  for (const endpoint of ['https://127.0.0.1:9/x', `http://127.0.0.1:${PUSH_PORT}/x`, 'https://evil.example/push', 'https://fcm.googleapis.com.evil.example/x', 'http://fcm.googleapis.com/fcm/send/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) {
    await call('POST', '/push/subscriptions', { ...O, body: { endpoint, keys: dO.keys }, expect: 400 });
  }
  await call('POST', '/push/subscriptions', { ...O, body: { endpoint: dO.endpoint, keys: { p256dh: 'bad key!', auth: 'x' } }, expect: 400 });
  await call('POST', '/push/subscriptions', { ...O, body: { endpoint: dO.endpoint, keys: dO.keys, topics: ['everything'] }, expect: 400 });
  await call('POST', '/push/subscriptions', { ...O, body: { endpoint: dO.endpoint, keys: dO.keys, surprise: 1 }, expect: 400 });
  const so = await sub(O, dO);
  check('device saved with a label and every topic on', so.label === 'Chrome on Android' && so.topics.length === cfg.topics.length && !('endpoint' in so));
  check('endpoint never echoed, only a hash', so.endpointHash === crypto.createHash('sha256').update(dO.endpoint).digest('hex').slice(0, 16));
  const again = await sub(O, dO);
  check('re-subscribing the same device updates it', again.id === so.id && (await call('GET', '/push/subscriptions', O)).length === 1);
  const sm = await sub(M, dM);
  const st = await sub(T, dT);
  const sg = await sub(O, dGone);

  // ---- Isolation ----
  await call('PATCH', `/push/subscriptions/${so.id}`, { ...T, body: { topics: [] }, expect: 404 });
  await call('DELETE', `/push/subscriptions/${so.id}`, { ...T, expect: 404 });
  check("others' devices aren't listed", (await call('GET', '/push/subscriptions', T)).every((d) => d.id === st.id));

  // ---- Test notification ----
  const t = await call('POST', '/push/test', { ...O, body: { id: so.id } });
  check('test notification sent to that device only', t.sent === 1);
  await sleep(300);
  const [first] = received(dO);
  check('delivered encrypted (aes128gcm) with a VAPID signature', raw(dO)[0]?.headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=/.test(raw(dO)[0]?.headers.authorization ?? '') && Number(raw(dO)[0]?.headers.ttl) > 0);
  check('test payload decrypts', first?.title === 'Notifications are on' && first.url === '/dashboard', JSON.stringify(first));
  check('nothing sent to other devices', raw(dM).length === 0 && raw(dGone).length === 0);
  await call('POST', '/push/test', { ...O, body: { id: 'nope' }, expect: 400 });

  // ---- Event: public form submission → everyone with contacts access ----
  gone.add(pathOf(dGone));
  const form = await call('POST', '/forms', { ...O, body: { name: `Quote ${rand}`, kind: 'form' } });
  await call('POST', `/public/forms/${form.slug}/submit`, { body: { data: { first_name: 'Pat', email: `pat-${rand}@ex.test` } } });
  await sleep(1500);
  const fo = received(dO).at(-1), fm = received(dM).at(-1), ft = received(dT).at(-1);
  check('form submission notifies the owner', fo?.body === `Form submitted: Quote ${rand}` && fo.title === 'Main Workspace' && fo.workspaceId === ws && /^\/contacts\//.test(fo.url), JSON.stringify(fo));
  check('…and the manager and team member', fm?.body === fo?.body && ft?.body === fo?.body);
  check('device the push service reports gone is removed', (await call('GET', '/push/subscriptions', O)).every((d) => d.id !== sg.id));

  // ---- Topics ----
  await call('PATCH', `/push/subscriptions/${st.id}`, { ...T, body: { topics: ['messages'] } });
  await call('PATCH', `/push/subscriptions/${st.id}`, { ...T, body: { topics: ['bogus'] }, expect: 400 });
  const before = raw(dT).length;
  await call('POST', `/public/forms/${form.slug}/submit`, { body: { data: { first_name: 'Lee', email: `lee-${rand}@ex.test` } } });
  await sleep(1500);
  check('opted-out topic is not sent', raw(dT).length === before && received(dO).at(-1)?.body === `Form submitted: Quote ${rand}` && received(dO).length === 3);

  // ---- Permissions and the acting user: owner marks an invoice paid ----
  const contact = await call('POST', '/crm/contacts', { ...O, body: { firstName: 'Rosa', email: `rosa-${rand}@ex.test` } });
  const inv = await call('POST', '/payments/invoices', { ...O, body: { contactId: contact.id, items: [{ name: 'Clean', quantity: 1, unitPrice: 80 }] } });
  await call('PATCH', `/push/subscriptions/${st.id}`, { ...T, body: { topics: ['payments'] } });
  const counts = { o: raw(dO).length, m: raw(dM).length, t: raw(dT).length };
  await call('POST', `/payments/invoices/${inv.id}/mark-paid`, { ...O, body: {} });
  await sleep(1500);
  check('manager hears about the payment', raw(dM).length === counts.m + 1 && /^Invoice .+ paid/.test(received(dM).at(-1)?.body ?? ''), received(dM).at(-1)?.body);
  check('the owner who marked it paid is not notified', raw(dO).length === counts.o);
  check("team member without payments access isn't notified", raw(dT).length === counts.t);

  // ---- Removing ----
  await call('DELETE', `/push/subscriptions/${sm.id}`, M);
  await call('DELETE', `/push/subscriptions/${sm.id}`, { ...M, expect: 404 });
  await call('POST', '/push/test', { ...M, body: {}, expect: 404 });
  // A device handed to someone else follows whoever subscribed it last.
  const moved = await sub(M, dO);
  check('re-subscribed device moves to the new user', moved.id === so.id && (await call('GET', '/push/subscriptions', O)).length === 0 && (await call('GET', '/push/subscriptions', M)).length === 1);
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-2000));
} finally {
  api.kill();
  pushServer.close();
  fs.rmSync(certDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
