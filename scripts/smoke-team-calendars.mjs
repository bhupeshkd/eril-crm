// End-to-end checks for round-robin team calendars (+ workspace member permissions).
// Usage: node scripts/smoke-team-calendars.mjs [baseUrl]   (API must be running)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;

async function call(method, path, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 400)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const user = async (n) => {
  const r = await call('POST', '/auth/register', { body: { email: `${n}-${rand}@test.local`, password: 'SmokeTest123!', name: n } });
  const me = await call('GET', '/auth/me', { token: r.accessToken });
  return { token: r.accessToken, id: me.id, ws: me.currentWorkspaceId, email: `${n}-${rand}@test.local`, name: n };
};

const ana = await user('Ana');
const ben = await user('Ben');
const cy = await user('Cy');
const eve = await user('Eve'); // outsider
const T = { token: ana.token };

// ---- Workspace member permissions (security fix) ----
await call('GET', `/workspaces/${ana.ws}/members`, { token: eve.token, expect: 404 });
await call('POST', `/workspaces/${ana.ws}/members`, { token: eve.token, body: { email: eve.email, role: 'workspace_owner' }, expect: 404 });
await call('POST', `/workspaces/${ana.ws}/invite`, { token: eve.token, body: { email: eve.email, role: 'workspace_owner' }, expect: 404 });
await call('POST', `/workspaces/${ana.ws}/members`, { ...T, body: { email: ben.email, role: 'super_admin' }, expect: 400 });
await call('POST', `/workspaces/${ana.ws}/members`, { ...T, body: { email: ben.email, role: 'team_member' } });
await call('POST', `/workspaces/${ana.ws}/members`, { ...T, body: { email: cy.email, role: 'team_member' } });
await call('POST', `/workspaces/${ana.ws}/members`, { ...T, body: { email: cy.email, role: 'team_member' }, expect: 409 });
await call('POST', `/workspaces/${ana.ws}/members`, { token: ben.token, body: { email: eve.email, role: 'team_member' }, expect: 403 });
const members = await call('GET', `/workspaces/${ana.ws}/members`, { token: ben.token });
check('members visible to members', members.length === 3);

// ---- Team calendar setup ----
const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '00:00', end: '23:30' }]]));
const base = { durationMinutes: 30, slotIntervalMinutes: 30, timezone: 'UTC', minNoticeHours: 0, availability: allDay };
await call('POST', '/calendars', { ...T, body: { ...base, name: 'Empty team', type: 'team', teamMemberIds: [] }, expect: 400 });
await call('POST', '/calendars', { ...T, body: { ...base, name: 'Bad team', type: 'team', teamMemberIds: [ana.id, eve.id] }, expect: 400 });
const cal = await call('POST', '/calendars', { ...T, body: { ...base, name: 'Sales demo', type: 'team', teamMemberIds: [ana.id, ben.id, cy.id], distribution: 'round_robin', assignContactOwner: true } });
check('team calendar saved', cal.type === 'team' && cal.teamMemberIds.length === 3);
const info = await call('GET', `/public/calendars/${cal.slug}`);
check('public page says team', info.isTeam === true);

const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
const at = (h, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
let slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
check('slots generated', slots.includes(at(9)) && slots.length === 47, String(slots.length));

// ---- Rotation ----
const hosts = [];
for (const [i, h] of [9, 10, 11, 12].entries()) {
  const b = await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(h), name: `Lead ${i}`, email: `lead${i}-${rand}@ex.test` } });
  hosts.push(b.host);
}
check('round robin takes turns', JSON.stringify(hosts) === JSON.stringify(['Ana', 'Ben', 'Cy', 'Ana']), JSON.stringify(hosts));
const lead1 = (await call('GET', `/crm/contacts?search=lead1-${rand}`, T)).items[0];
check('host became contact owner', lead1?.ownerId === ben.id);

// ---- Conflicts across calendars ----
const personal = await call('POST', '/calendars', { ...T, body: { ...base, name: 'Ben personal' } });
const walkIn = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Walk', email: `walk-${rand}@ex.test` } });
// Ana and Cy busy at 14:00 elsewhere; only Ben is free
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: personal.id, contactId: walkIn.id, startAt: at(14), assignedUserId: ana.id } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: walkIn.id, startAt: at(14), assignedUserId: cy.id } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: walkIn.id, startAt: at(14), assignedUserId: cy.id }, expect: 409 });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: walkIn.id, startAt: at(14), assignedUserId: eve.id }, expect: 400 });
slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
check('slot open while one member is free', slots.includes(at(14)));
let b = await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(14), name: 'Late', email: `late-${rand}@ex.test` } });
check('only free member assigned', b.host === 'Ben', b.host);
slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
check('slot closes when everyone is busy', !slots.includes(at(14)));
await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(14), name: 'Too late', email: `tl-${rand}@ex.test` }, expect: 409 });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: walkIn.id, startAt: at(14, 30) } }); // staff auto-assign works too

// ---- Reassign / reschedule ----
let appts = await call('GET', `/calendars/appointments?calendarId=${cal.id}`, T);
const nine = appts.find((a) => a.startAt === at(9));
check('appointments carry host summary only', nine.host?.name === 'Ana' && !('passwordHash' in nine.host));
await call('PUT', `/calendars/appointments/${nine.id}`, { ...T, body: { assignedUserId: null }, expect: 400 });
await call('PUT', `/calendars/appointments/${nine.id}`, { ...T, body: { assignedUserId: eve.id }, expect: 400 });
await call('PUT', `/calendars/appointments/${nine.id}`, { ...T, body: { startAt: at(14) }, expect: 409 }); // Ana busy at 14:00
await call('PUT', `/calendars/appointments/${nine.id}`, { ...T, body: { assignedUserId: cy.id } });
const mine = await call('GET', `/calendars/appointments?assignedUserId=${cy.id}&calendarId=${cal.id}`, T);
check('filter by host', mine.length === 3 && mine.every((a) => a.assignedUserId === cy.id), String(mine.length));

// ---- Balanced distribution ----
const bal = await call('POST', '/calendars', { ...T, body: { ...base, name: 'Support', type: 'team', teamMemberIds: [ana.id, ben.id], distribution: 'balanced' } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: bal.id, contactId: walkIn.id, startAt: at(16), assignedUserId: ana.id } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: bal.id, contactId: walkIn.id, startAt: at(17), assignedUserId: ana.id } });
const r1 = await call('POST', '/calendars/appointments', { ...T, body: { calendarId: bal.id, contactId: walkIn.id, startAt: at(18) } });
const r2 = await call('POST', '/calendars/appointments', { ...T, body: { calendarId: bal.id, contactId: walkIn.id, startAt: at(19) } });
check('balanced fills the lighter member first', r1.assignedUserId === ben.id && r2.assignedUserId === ben.id);

// ---- Team stats & removed members ----
let stats = await call('GET', `/calendars/${cal.id}/team`, T);
check('team stats', stats.length === 3 && stats.find((s) => s.userId === ana.id).upcoming === 2 && stats.find((s) => s.userId === cy.id).upcoming === 3, JSON.stringify(stats.map((s) => [s.name, s.upcoming])));
await call('DELETE', `/workspaces/${ana.ws}/members/${cy.id}`, T);
stats = await call('GET', `/calendars/${cal.id}/team`, T);
check('removed member marked inactive', stats.find((s) => s.userId === cy.id).active === false);
const after = [];
for (const h of [20, 21]) after.push((await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(h), name: `After ${h}`, email: `after${h}-${rand}@ex.test` } })).host);
check('removed member gets no new bookings', !after.includes('Cy'), JSON.stringify(after));

// ---- Isolation ----
await call('GET', `/calendars/${cal.id}/team`, { token: eve.token, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
