// End-to-end checks for custom domains: DNS TXT verification (against a fake DNS server), routing through the
// frontend by Host header, the on-demand TLS "ask" endpoint, conflicts and isolation.
// Starts a fake DNS server and a second API instance (port 3103) that resolves through it; needs the backend built
// (dist/, kept current by the dev server) and the frontend dev server on :3000.
// Usage: node scripts/smoke-domains.mjs
import { spawn } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { startFakeDns } from './fake-dns.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DNS_PORT = 5397;
const API_PORT = 3103;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const WEB = 'http://localhost:3000';
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
async function call(method, p, { token, body, expect = [200, 201], raw = false } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  if (!raw) try { data = text ? JSON.parse(text) : null; } catch { /* text */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return data;
}
/** Requests the frontend as if the browser were on `host` (fetch drops custom Host headers, so use node:http). */
function web(host, p) {
  return new Promise((resolve, reject) => {
    const req = http.request(WEB + p, { headers: { Host: host } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const dns = await startFakeDns(DNS_PORT);
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: `http://localhost:${API_PORT}`, DISABLE_SCHEDULERS: 'true', DNS_SERVERS: `127.0.0.1:${DNS_PORT}`, DOMAIN_CNAME_TARGET: 'sites.eril-test.io', RESERVED_DOMAINS: 'eril-test.io' },
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
  const HOST = `www.shop-${rand}.test`;
  const reg = await call('POST', '/auth/register', { body: { email: `dom-${rand}@test.local`, password: 'SmokeTest123!', name: 'Shop Owner' } });
  const T = { token: reg.accessToken };
  const site = await call('POST', '/sites', { ...T, body: { name: `Shop ${rand}`, template: 'agency-website' } });
  const D = `/sites/${site.id}/domains`;

  // ---- Adding ----
  for (const bad of ['localhost', '10.1.2.3', 'shop', '*.shop.test', 'app.eril-test.io']) await call('POST', D, { ...T, body: { hostname: bad }, expect: 400 });
  const d = await call('POST', D, { ...T, body: { hostname: `https://${HOST.toUpperCase()}/home` } });
  check('hostname cleaned, pending, with DNS instructions', d.hostname === HOST && d.status === 'pending' && d.dns.txt.name === `_eril-verify.${HOST}` && /^eril-verify=[0-9a-f]{32}$/.test(d.dns.txt.value) && d.dns.cname.value === 'sites.eril-test.io');
  await call('POST', D, { ...T, body: { hostname: HOST }, expect: 409 });
  const list = await call('GET', D, T);
  check('listed', list.domains.length === 1 && list.target === 'sites.eril-test.io');

  // ---- Not verified yet: no routing ----
  let v = await call('POST', `${D}/${d.id}/verify`, T);
  check('no TXT yet → still pending with a hint', v.status === 'pending' && /not found yet/.test(v.lastError ?? ''), v.lastError);
  await call('GET', `/public/domains/resolve?host=${HOST}`, { expect: 404 });
  await call('GET', `/public/domains/allowed?domain=${HOST}`, { expect: 404, raw: true });

  // Wrong token doesn't count.
  dns.records.set(`_eril-verify.${HOST}`, { txt: ['eril-verify=wrong'] });
  check('wrong token rejected', (await call('POST', `${D}/${d.id}/verify`, T)).status === 'pending');

  // Someone else claims the same name (allowed while pending)…
  const other = await call('POST', '/auth/register', { body: { email: `dom-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Squatter' } });
  const O = { token: other.accessToken };
  const osite = await call('POST', '/sites', { ...O, body: { name: `Squat ${rand}` } });
  const od = await call('POST', `/sites/${osite.id}/domains`, { ...O, body: { hostname: HOST } });
  check('second claim allowed while unverified', od.status === 'pending');

  // ---- Correct TXT (split into chunks, next to an SPF record) → verified ----
  dns.records.set(`_eril-verify.${HOST}`, { txt: ['v=spf1 -all', ['eril-verify=', d.dns.txt.value.slice('eril-verify='.length)]] });
  dns.records.set(HOST, { cname: 'sites.eril-test.io' });
  v = await call('POST', `${D}/${d.id}/verify`, T);
  check('verified, CNAME detected', v.status === 'verified' && v.verifiedAt && v.cname === 'ok' && v.lastError === null);
  check('DNS was queried for the TXT name', dns.queries.some((q) => q.name === `_eril-verify.${HOST}` && q.qtype === 16));
  const theirs = (await call('GET', `/sites/${osite.id}/domains`, O)).domains[0];
  check("the other account's claim is closed", theirs.status === 'failed' && theirs.lastError === 'Verified by another account');
  await call('POST', `/sites/${osite.id}/domains/${od.id}/verify`, { ...O, expect: [200, 201, 409] });
  check('…and cannot take it over', (await call('GET', `/sites/${osite.id}/domains`, O)).domains[0].status !== 'verified');
  await call('POST', `/sites/${osite.id}/domains`, { ...O, body: { hostname: HOST }, expect: 409 });

  // ---- TLS ask + routing ----
  const ask = await call('GET', `/public/domains/allowed?domain=${HOST}`, { raw: true });
  check('TLS ask approves verified domain', ask === 'ok');
  await call('GET', `/public/domains/resolve?host=${HOST}`, { expect: 404 }); // site not published yet
  await call('PUT', `/sites/${site.id}`, { ...T, body: { isPublished: true } });
  const r = await call('GET', `/public/domains/resolve?host=${HOST.toUpperCase()}`);
  check('resolves to the published site', r.slug === site.slug);

  // Frontend middleware (dev server on :3000, which uses the main API on the same database).
  let page = await web(HOST, '/');
  check('frontend serves the site on the custom domain', page.status === 200, String(page.status));
  page = await web(HOST, '/contact');
  check('site sub-pages work (rewritten to the site path)', page.status === 200 && String(page.headers['x-middleware-rewrite'] ?? '').endsWith(`/s/${site.slug}/contact`), String(page.headers['x-middleware-rewrite']));
  page = await web(HOST, '/dashboard');
  console.log('   rewrite header:', page.headers['x-middleware-rewrite']);
  check('staff app is not exposed on customer domains (rewritten into the site)', String(page.headers['x-middleware-rewrite'] ?? '').endsWith(`/s/${site.slug}/dashboard`), String(page.headers['x-middleware-rewrite']));
  const app = await web('localhost:3000', '/dashboard');
  check('…while the app host is not rewritten', app.status === 200 && !app.headers['x-middleware-rewrite']);
  page = await web(`unknown-${rand}.test`, '/');
  check('unknown domains get a 404', page.status === 404 && page.text.includes('not connected'));
  check('app host unaffected', (await web('localhost:3000', '/login')).status === 200);

  // ---- Isolation and removal ----
  await call('POST', `${D}/${d.id}/verify`, { ...O, expect: 404 });
  await call('DELETE', `${D}/${d.id}`, { ...O, expect: 404 });
  await call('DELETE', `${D}/${d.id}`, T);
  await call('GET', `/public/domains/resolve?host=${HOST}`, { expect: 404 });
  await call('GET', `/public/domains/allowed?domain=${HOST}`, { expect: 404, raw: true });
  // Once released, the other account can connect it.
  const again = await call('POST', `/sites/${osite.id}/domains`, { ...O, body: { hostname: HOST } });
  dns.records.set(`_eril-verify.${HOST}`, { txt: [again.dns.txt.value] });
  check('released domain can be verified by someone else', (await call('POST', `/sites/${osite.id}/domains/${again.id}/verify`, O)).status === 'verified');
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
