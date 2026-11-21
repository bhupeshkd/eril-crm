// End-to-end checks for calendar sync over iCal links: private appointment feeds (out), outside calendars whose
// busy times block team and booking calendars (in), refresh/failure handling, permissions and SSRF protection.
// Serves test .ics files from a local server and starts a second API (port 3107) allowed to read localhost
// (CALENDAR_SYNC_ALLOW_PRIVATE, tests only). Usage: node scripts/smoke-calendar-sync.mjs
import { spawn } from 'child_process';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3107;
const ICS_PORT = 5481;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const MAIN = 'http://localhost:3001/api/v1';
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
async function call(method, p, { token, body, expect = [200, 201], base = BASE } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* text */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return data;
}

// ---- A tiny iCal server whose files the test can change ----
const files = new Map();
const ics = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map(([uid, s, e]) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${s}\r\nDTEND:${e}\r\nSUMMARY:Busy\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
const srv = http.createServer((req, res) => {
  const f = files.get(req.url);
  if (f === undefined) { res.writeHead(404); return res.end(); }
  if (f === 500) { res.writeHead(500); return res.end('down'); }
  res.writeHead(200, { 'Content-Type': 'text/calendar' });
  res.end(f);
});
await new Promise((r) => srv.listen(ICS_PORT, '127.0.0.1', r));
const ICS = (name) => `http://127.0.0.1:${ICS_PORT}${name}`;

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, API_PORT: String(API_PORT), API_PUBLIC_URL: `http://localhost:${API_PORT}`, DISABLE_SCHEDULERS: 'true', CALENDAR_SYNC_ALLOW_PRIVATE: 'true' },
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
  const user = async (n) => {
    const r = await call('POST', '/auth/register', { body: { email: `${n}-${rand}@test.local`, password: 'SmokeTest123!', name: n } });
    const me = await call('GET', '/auth/me', { token: r.accessToken });
    return { token: r.accessToken, id: me.id, ws: me.currentWorkspaceId, email: `${n}-${rand}@test.local` };
  };
  const ana = await user('Ana');
  const ben = await user('Ben');
  const A = { token: ana.token };
  await call('POST', `/workspaces/${ana.ws}/members`, { ...A, body: { email: ben.email, role: 'team_member' } });
  const B = { token: (await call('POST', '/auth/switch-workspace', { token: ben.token, body: { workspaceId: ana.ws } })).accessToken };

  const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  const ymd = day.replace(/-/g, '');
  const at = (h) => `${day}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const t = (h) => `${ymd}T${String(h).padStart(2, '0')}0000Z`;
  const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '08:00', end: '18:00' }]]));
  const team = await call('POST', '/calendars', { ...A, body: { name: 'Consult', type: 'team', teamMemberIds: [ana.id, ben.id], durationMinutes: 60, slotIntervalMinutes: 60, timezone: 'UTC', minNoticeHours: 0, availability: allDay } });
  const solo = await call('POST', '/calendars', { ...A, body: { name: 'Studio room', durationMinutes: 60, slotIntervalMinutes: 60, timezone: 'UTC', minNoticeHours: 0, availability: allDay } });
  const slots = (slug) => call('GET', `/public/calendars/${slug}/slots?date=${day}`);

  // ---- SSRF protection on the real (production-like) API ----
  const main = await call('POST', '/auth/register', { base: MAIN, body: { email: `cs-main-${rand}@test.local`, password: 'SmokeTest123!', name: 'Main' } });
  for (const bad of ['http://calendar.example.com/a.ics', 'https://127.0.0.1/a.ics', 'https://169.254.169.254/latest/meta-data', 'https://localhost/a.ics', 'file:///etc/passwd']) {
    const r = await call('POST', '/calendar-sync/external', { base: MAIN, token: main.accessToken, body: { name: 'x', url: bad }, expect: 400 });
    check(`refused: ${bad}`, /https|private network|iCal/.test(r?.message ?? ''), r?.message);
  }

  // ---- Inbound: Ben's busy time blocks him on the team calendar ----
  files.set('/ben.ics', ics(['b1', t(10), t(12)]));
  files.set('/notcal', 'hello');
  await call('POST', '/calendar-sync/external', { ...B, body: { name: 'Not a calendar', url: ICS('/notcal') }, expect: 400 });
  await call('POST', '/calendar-sync/external', { ...B, body: { name: 'Studio', url: ICS('/ben.ics'), calendarId: solo.id }, expect: 403 }); // members can't block booking calendars
  const benCal = await call('POST', '/calendar-sync/external', { ...B, body: { name: 'Ben Google', url: ICS('/ben.ics') } });
  check('connected with busy times read', benCal.busyCount === 1);
  check('slot still open: Ana is free', (await slots(team.slug)).includes(at(10)));
  const b1 = await call('POST', `/public/calendars/${team.slug}/book`, { body: { startAt: at(10), name: 'Lead One', email: `l1-${rand}@ex.test` } });
  check('booking at 10:00 goes to Ana, not busy Ben', b1.host === 'Ana', b1.host);

  // Ana is busy 11–12 in her own calendar too → 11:00 has nobody free (Ben busy until 12).
  files.set('/ana.ics', ics(['a1', t(11), t(12)]));
  await call('POST', '/calendar-sync/external', { ...A, body: { name: 'Ana Outlook', url: ICS('/ana.ics') } });
  let s = await slots(team.slug);
  check('11:00 gone (everyone busy), 12:00 open', !s.includes(at(11)) && s.includes(at(12)), s.map((x) => x.slice(11, 16)).join(','));
  await call('POST', `/public/calendars/${team.slug}/book`, { body: { startAt: at(11), name: 'Lead Two', email: `l2-${rand}@ex.test` }, expect: 409 });

  // ---- Inbound for a booking calendar (managers only) ----
  files.set('/room.ics', ics(['r1', t(14), t(16)]));
  const room = await call('POST', '/calendar-sync/external', { ...A, body: { name: 'Room bookings', url: ICS('/room.ics'), calendarId: solo.id } });
  s = await slots(solo.slug);
  check('booking calendar blocked 14:00–16:00', !s.includes(at(14)) && !s.includes(at(15)) && s.includes(at(16)));

  // ---- Refresh: changes picked up; failures keep the last good copy ----
  files.set('/room.ics', ics());
  let r = await call('POST', `/calendar-sync/external/${room.id}/refresh`, A);
  check('refresh picks up the change', r.busyCount === 0 && r.lastError === null);
  check('slots open again', (await slots(solo.slug)).includes(at(14)));
  files.set('/ben.ics', 500);
  r = await call('POST', `/calendar-sync/external/${benCal.id}/refresh`, B);
  check('failed refresh keeps the last good busy times', r.busyCount === 1 && /500/.test(r.lastError ?? ''), JSON.stringify(r));

  // ---- Overview, permissions ----
  const ovA = await call('GET', '/calendar-sync', A);
  const ovB = await call('GET', '/calendar-sync', B);
  check('managers see all connected calendars, members only their own; URLs never shown', ovA.external.length === 3 && ovB.external.length === 1 && !JSON.stringify(ovA).includes('127.0.0.1'));
  await call('DELETE', `/calendar-sync/external/${room.id}`, { ...B, expect: 404 });
  await call('POST', `/calendar-sync/external/${room.id}/refresh`, { ...B, expect: 404 });

  // ---- Outbound: private feed of Ana's appointments ----
  const feed = ovA.feedUrl;
  check('feed link is private and per person', /\/public\/calendar-feed\/[\w-]{20,}\.ics$/.test(feed) && feed !== ovB.feedUrl);
  const res = await fetch(feed);
  const body = await res.text();
  check('feed is iCal with Ana’s appointment', res.headers.get('content-type').startsWith('text/calendar') && body.startsWith('BEGIN:VCALENDAR') && body.includes(`DTSTART:${t(10)}`) && body.includes('Lead One'));
  check('Ben’s feed doesn’t include it', !(await (await fetch(ovB.feedUrl)).text()).includes('Lead One'));
  const regen = await call('POST', '/calendar-sync/feed/regenerate', A);
  check('new link works, old one stops', regen.feedUrl !== feed && (await fetch(regen.feedUrl)).status === 200 && (await fetch(feed)).status === 404);
  check('random tokens are rejected', (await fetch(`${BASE}/public/calendar-feed/not-a-real-token-123456.ics`)).status === 404);

  // Disconnecting stops the blocking.
  await call('DELETE', `/calendar-sync/external/${benCal.id}`, B);
  const ovB2 = await call('GET', '/calendar-sync', B);
  check('disconnected', ovB2.external.length === 0);
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e);
  console.log(apiLog.slice(-1500));
} finally {
  api.kill();
  srv.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
