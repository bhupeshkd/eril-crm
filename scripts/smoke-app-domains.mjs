// End-to-end checks for agency app domains (white-label staff app on the agency's own address): adding, DNS TXT
// verification against a fake DNS server, host-based branding, CORS for verified domains, invite links on the
// domain, frontend routing, isolation between agencies and removal.
// Starts a fake DNS server and a second API instance (port 3104) that resolves through it; needs the backend built
// (dist/) and the frontend dev server on :3000.
// Usage: node scripts/smoke-app-domains.mjs
import { spawn } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { startFakeDns } from './fake-dns.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DNS_PORT = 5398;
const API_PORT = 3104;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const WEB = 'http://localhost:3000';
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
/** Raw request with headers fetch won't send (Host, Origin). */
function raw(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const preflight = (origin) => raw(`${BASE}/auth/login`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

const dns = await startFakeDns(DNS_PORT);
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: `http://localhost:${API_PORT}`, DISABLE_SCHEDULERS: 'true', DNS_SERVERS: `127.0.0.1:${DNS_PORT}`, APP_CNAME_TARGET: 'app.eril-test.io', RESERVED_DOMAINS: 'eril-test.io' },
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
  const HOST = `app.agency-${rand}.test`;
  const reg = await call('POST', '/auth/register', { body: { email: `ad-${rand}@test.local`, password: 'SmokeTest123!', name: 'Agency Owner' } });
  const T = { token: reg.accessToken };
  const { currentOrganizationId: org, currentWorkspaceId: ws } = claims(reg.accessToken);
  const D = `/agency/${org}/app-domains`;
  await call('PUT', `/agency/${org}/branding`, { ...T, body: { appName: 'Sparkle CRM', primaryColor: '#db2777' } });

  // ---- Adding ----
  for (const bad of ['localhost', '10.1.2.3', 'agency', 'app.eril-test.io']) await call('POST', D, { ...T, body: { hostname: bad }, expect: 400 });
  await call('POST', D, { ...T, body: { hostname: HOST, extra: 1 }, expect: 400 });
  const d = await call('POST', D, { ...T, body: { hostname: `https://${HOST.toUpperCase()}/login` } });
  check('hostname cleaned, pending, CNAME points at the app', d.hostname === HOST && d.status === 'pending' && d.dns.txt.name === `_eril-verify.${HOST}` && d.dns.cname.value === 'app.eril-test.io');
  await call('POST', D, { ...T, body: { hostname: HOST }, expect: 409 });
  check('listed', (await call('GET', D, T)).domains.length === 1);

  // Pending: nothing white-labelled yet.
  check('pending: host branding is the default', (await call('GET', `/public/branding/host/${HOST}`)).appName === 'ERIL');
  check('pending: CORS refuses the origin', !(await preflight(`https://${HOST}`)).headers['access-control-allow-origin']);
  let v = await call('POST', `${D}/${d.id}/verify`, T);
  check('no TXT yet → still pending', v.status === 'pending' && !!v.lastError, v.lastError);
  let inv = await call('POST', `/workspaces/${ws}/invite`, { ...T, body: { email: `p-${rand}@test.local`, role: 'team_member' } });
  check('pending: invite link uses the main app', !inv.inviteUrl.includes(HOST), inv.inviteUrl);

  // ---- Another agency can't see or touch it ----
  const other = await call('POST', '/auth/register', { body: { email: `ad-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other Agency' } });
  const O = { token: other.accessToken };
  await call('GET', D, { ...O, expect: 403 });
  await call('POST', `${D}/${d.id}/verify`, { ...O, expect: 403 });
  await call('DELETE', `${D}/${d.id}`, { ...O, expect: 403 });
  const oorg = claims(other.accessToken).currentOrganizationId;
  await call('POST', `/agency/${oorg}/app-domains/${d.id}/verify`, { ...O, expect: 404 });
  const od = await call('POST', `/agency/${oorg}/app-domains`, { ...O, body: { hostname: HOST } });
  check('rival claim allowed while unverified', od.status === 'pending');

  // ---- Verified ----
  dns.records.set(`_eril-verify.${HOST}`, { txt: [d.dns.txt.value] });
  dns.records.set(HOST, { cname: 'app.eril-test.io' });
  v = await call('POST', `${D}/${d.id}/verify`, T);
  check('verified, CNAME ok', v.status === 'verified' && v.cname === 'ok' && v.lastError === null, JSON.stringify({ s: v.status, c: v.cname, e: v.lastError }));
  check("rival's claim closed", (await call('GET', `/agency/${oorg}/app-domains`, O)).domains[0].status === 'failed');
  check('resolve says app', (await call('GET', `/public/domains/resolve?host=${HOST}`)).kind === 'app');
  const hb = await call('GET', `/public/branding/host/${HOST.toUpperCase()}`);
  check('host branding is the agency\'s', hb.appName === 'Sparkle CRM' && hb.primaryColor === '#db2777');
  let pf = await preflight(`https://${HOST}`);
  check('CORS allows the verified domain', pf.headers['access-control-allow-origin'] === `https://${HOST}` && pf.headers['access-control-allow-credentials'] === 'true', JSON.stringify(pf.headers['access-control-allow-origin']));
  pf = await preflight(`http://${HOST}`);
  check('…over https only', !pf.headers['access-control-allow-origin']);
  pf = await preflight(`https://evil-${rand}.test`);
  check('unknown origins refused', !pf.headers['access-control-allow-origin']);
  pf = await preflight('http://localhost:3000');
  check('main app origin still allowed', pf.headers['access-control-allow-origin'] === 'http://localhost:3000');
  inv = await call('POST', `/workspaces/${ws}/invite`, { ...T, body: { email: `v-${rand}@test.local`, role: 'team_member' } });
  check('invite link uses the agency domain', inv.inviteUrl.startsWith(`https://${HOST}/invite/`), inv.inviteUrl);
  const pending = await call('GET', `/workspaces/${ws}/invitations`, T);
  check('pending invitation links too', Array.isArray(pending) && pending.every((i) => i.inviteUrl.startsWith(`https://${HOST}/`)));
  check('TLS ask approves it', (await raw(`${BASE}/public/domains/allowed?domain=${HOST}`)).status === 200);
  // A site domain can't take a hostname an agency already verified.
  const site = await call('POST', '/sites', { ...O, body: { name: `S ${rand}` } });
  await call('POST', `/sites/${site.id}/domains`, { ...O, body: { hostname: HOST }, expect: 409 });

  // ---- Frontend: the staff app is served on the agency domain (main API shares the database) ----
  let page = await raw(`${WEB}/login`, { headers: { Host: HOST } });
  check('login page served on the agency domain', page.status === 200 && !page.headers['x-middleware-rewrite'], String(page.status));
  page = await raw(`${WEB}/dashboard`, { headers: { Host: HOST } });
  check('app routes are not rewritten into a site', !page.headers['x-middleware-rewrite']);
  // Installable app: the manifest and icon carry the agency's brand on its domain.
  page = await raw(`${WEB}/manifest.webmanifest`, { headers: { Host: HOST } });
  const mf = JSON.parse(page.text || '{}');
  check('manifest is white-labelled', page.status === 200 && mf.name === 'Sparkle CRM' && mf.short_name === 'Sparkle CRM' && mf.theme_color === '#db2777' && mf.display === 'standalone', `${mf.name} ${mf.theme_color}`);
  page = await raw(`${WEB}/manifest.webmanifest`, { headers: { Host: 'localhost:3000' } });
  check('main host manifest keeps the default brand', JSON.parse(page.text).name === 'ERIL');
  page = await raw(`${WEB}/app-icon/192`, { headers: { Host: HOST } });
  check('app icon served on the agency domain', page.status === 200 && page.headers['content-type'] === 'image/png');

  // ---- Limits and removal ----
  await call('POST', D, { ...T, body: { hostname: `crm.agency-${rand}.test` } });
  await call('POST', D, { ...T, body: { hostname: `portal.agency-${rand}.test` }, expect: 400 });
  await call('DELETE', `${D}/${d.id}`, T);
  check('removed: host branding back to default', (await call('GET', `/public/branding/host/${HOST}`)).appName === 'ERIL');
  check('removed: CORS refuses it again', !(await preflight(`https://${HOST}`)).headers['access-control-allow-origin']);
  await call('GET', `/public/domains/resolve?host=${HOST}`, { expect: 404 });
  inv = await call('POST', `/workspaces/${ws}/invite`, { ...T, body: { email: `r-${rand}@test.local`, role: 'team_member' } });
  check('removed: invite link back on the main app', !inv.inviteUrl.includes(HOST));
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-1500));
} finally {
  api.kill();
  await dns.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
