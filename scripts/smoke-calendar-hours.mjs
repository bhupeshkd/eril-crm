// End-to-end checks for team members' working hours and appointment reminders.
// Usage: node scripts/smoke-calendar-hours.mjs [baseUrl]   (API running, non-production, console email/SMS)
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
const eve = await user('Eve');
const T = { token: ana.token };
await call('POST', `/workspaces/${ana.ws}/members`, { ...T, body: { email: ben.email, role: 'team_member' } });
const B = { token: (await call('POST', '/auth/switch-workspace', { token: ben.token, body: { workspaceId: ana.ws } })).accessToken };

// ---- Member hours: validation and who may edit ----
const weekdays = (start, end) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start, end }]]));
let list = await call('GET', '/calendars/member-hours', T);
check('both members listed without hours', list.length === 2 && list.every((m) => m.hours === null));
await call('PUT', `/calendars/member-hours/${ben.id}`, { ...T, body: { timezone: 'Mars/Base', weekly: weekdays('09:00', '17:00') }, expect: 400 });
await call('PUT', `/calendars/member-hours/${ben.id}`, { ...T, body: { timezone: 'UTC', weekly: { 1: [{ start: '17:00', end: '09:00' }] } }, expect: 400 });
await call('PUT', `/calendars/member-hours/${ben.id}`, { ...T, body: { timezone: 'UTC', weekly: weekdays('09:00', '17:00'), daysOff: ['soon'] }, expect: 400 });
await call('PUT', `/calendars/member-hours/${eve.id}`, { ...T, body: { timezone: 'UTC', weekly: weekdays('09:00', '17:00') }, expect: 404 });
await call('GET', '/calendars/member-hours', { token: eve.token }).then((r) => check('outsider sees only own workspace', Array.isArray(r) && !r.some((m) => m.userId === ana.id)));

// Ben works 09:00-12:00 UTC; Ana 12:00-17:00 UTC with the day after tomorrow off.
const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
const day2 = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
const at = (d, h, m = 0) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const benHours = await call('PUT', `/calendars/member-hours/${ben.id}`, { ...B, body: { timezone: 'UTC', weekly: weekdays('09:00', '12:00') } });
check('member can set own hours', benHours.hours.weekly['1'][0].end === '12:00');
await call('PUT', `/calendars/member-hours/${ana.id}`, { ...B, body: { timezone: 'UTC', weekly: weekdays('00:00', '23:00') }, expect: 403 });
await call('PUT', `/calendars/member-hours/${ana.id}`, { ...T, body: { timezone: 'Europe/London', weekly: weekdays('12:00', '17:00'), daysOff: [day2, day2] } });
list = await call('GET', '/calendars/member-hours', B);
check('hours saved, days off de-duplicated', list.find((m) => m.userId === ana.id).hours.daysOff.length === 1);

// ---- Team calendar only offers working hours ----
const cal = await call('POST', '/calendars', {
  ...T,
  body: { name: 'Consult', type: 'team', teamMemberIds: [ana.id, ben.id], durationMinutes: 60, slotIntervalMinutes: 60, timezone: 'UTC', minNoticeHours: 0, availability: weekdays('06:00', '20:00') },
});
let slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
// Ana is in London: same as UTC in winter.
check('slots are the union of members\' hours', JSON.stringify(slots) === JSON.stringify([9, 10, 11, 12, 13, 14, 15, 16].map((h) => at(day, h))), JSON.stringify(slots.map((s) => s.slice(11, 16))));
slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day2}`);
check('day off removes that member', JSON.stringify(slots) === JSON.stringify([9, 10, 11].map((h) => at(day2, h))), JSON.stringify(slots.map((s) => s.slice(11, 16))));
const b1 = await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(day, 10), name: 'Morning Lead', email: `m-${rand}@ex.test` } });
check('morning booking goes to Ben (only one working)', b1.host === 'Ben', b1.host);
const b2 = await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(day, 14), name: 'Afternoon Lead', email: `a-${rand}@ex.test` } });
check('afternoon booking goes to Ana', b2.host === 'Ana', b2.host);
await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: at(day, 7), name: 'Early', email: `e-${rand}@ex.test` }, expect: 409 });
const contact = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Walk', lastName: 'In', email: `w-${rand}@ex.test`, phone: '+15550009999' } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: contact.id, startAt: at(day, 18) }, expect: 409 });
const manual = await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: contact.id, startAt: at(day, 18), assignedUserId: ben.id } });
check('staff can still book someone outside hours explicitly', manual.assignedUserId === ben.id);
await call('DELETE', `/calendars/member-hours/${ben.id}`, B);
slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
check('clearing hours makes the member follow the calendar again', slots.includes(at(day, 7)));

// ---- Reminders ----
await call('PUT', `/calendars/${cal.id}`, { ...T, body: { reminders: [{ minutesBefore: 2, channel: 'sms' }] }, expect: 400 });
await call('PUT', `/calendars/${cal.id}`, { ...T, body: { reminders: [{ minutesBefore: 60, channel: 'fax' }] }, expect: 400 });
const withRem = await call('PUT', `/calendars/${cal.id}`, { ...T, body: { reminders: [{ minutesBefore: 60, channel: 'sms' }, { minutesBefore: 1440, channel: 'email' }] } });
check('reminders saved, longest first', withRem.reminders.length === 2 && withRem.reminders[0].minutesBefore === 1440);

const appt = await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: contact.id, startAt: at(day, 16), assignedUserId: ana.id } });
const run = (iso) => call('POST', '/calendars/reminders/run', { ...T, body: { at: iso } });
const iso = (d, h, m = 0) => at(d, h, m);
const dayBefore = new Date(Date.parse(at(day, 16)) - 1440 * 60_000).toISOString();
let r = await run(new Date(Date.parse(at(day, 10)) - 1440 * 60_000 - 60_000).toISOString());
check('nothing due early', r.sent === 0, JSON.stringify(r));
r = await run(dayBefore);
check('day-before emails for the 10:00, 14:00 and 16:00 bookings', r.sent === 3, JSON.stringify(r));
const again = await run(dayBefore);
check('never sent twice', again.sent === 0, JSON.stringify(again));
r = await run(iso(day, 15, 5));
check('16:00 hour-before SMS plus the 18:00 day-before email (earlier ones already started)', r.sent === 2, JSON.stringify(r));

async function thread(channel) {
  const convs = await call('GET', `/inbox/conversations?search=Walk`, T);
  const conv = convs.find((c) => c.contactId === contact.id && c.channel === channel);
  return conv ? (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.filter((m) => m.direction === 'outbound') : [];
}
const mails = (await thread('email')).filter((m) => m.body.includes('reminder of your appointment'));
const texts = (await thread('sms')).filter((m) => m.body.startsWith('Reminder: Consult'));
check('email reminders name the host and time', mails.length === 2 && mails.some((m) => m.body.includes('with Ana')) && mails.some((m) => m.body.includes('with Ben')) && mails.every((m) => m.body.includes('(UTC)')), String(mails.length));
check('one SMS reminder so far (16:00 booking)', texts.length === 1 && texts[0].body.includes('with Ana'), String(texts.length));

// Rescheduling gets fresh reminders; cancelled appointments get none.
await call('PUT', `/calendars/appointments/${appt.id}`, { ...T, body: { startAt: at(day, 17) } });
r = await run(iso(day, 16, 5));
check('moved appointment reminded again (email + SMS for the new time)', r.sent === 2, JSON.stringify(r));
await call('PUT', `/calendars/appointments/${manual.id}`, { ...T, body: { status: 'cancelled' } });
r = await run(iso(day, 17, 5));
check('cancelled appointment not reminded', r.sent === 0, JSON.stringify(r));

// Do-not-disturb contacts are skipped, not messaged.
const quiet = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Quiet', email: `q-${rand}@ex.test`, dnd: true } });
await call('POST', '/calendars/appointments', { ...T, body: { calendarId: cal.id, contactId: quiet.id, startAt: at(day2, 10), assignedUserId: ben.id } });
r = await run(new Date(Date.parse(at(day2, 10)) - 1440 * 60_000).toISOString());
check('DND contact skipped', r.sent === 0 && r.skipped === 1, JSON.stringify(r));

await call('POST', '/calendars/reminders/run', { token: eve.token, body: {} }).then((x) => check('other workspaces unaffected by a run', x.sent === 0));
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
