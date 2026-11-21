// End-to-end checks for community email digests.
// Usage: node scripts/smoke-digests.mjs [baseUrl]   (API must be running, non-production)
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.replace(/community\/[^/?]+/, 'community/<token>')} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 400)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);
const tokenOf = (url) => url.split('/community/')[1];

const reg = await call('POST', '/auth/register', { body: { email: `dg-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach Kim' } });
const T = { token: reg.accessToken };
const comm = await call('POST', '/communities', { ...T, body: { name: 'Founders Club' } });
check('weekly digest by default', comm.digestFrequency === 'weekly' && comm.digestHour === 9 && comm.timezone === 'UTC');
await call('PUT', `/communities/${comm.id}`, { ...T, body: { timezone: 'Mars/Olympus' }, expect: 400 });
await call('PUT', `/communities/${comm.id}`, { ...T, body: { digestHour: 25 }, expect: 400 });
await call('PUT', `/communities/${comm.id}`, { ...T, body: { timezone: 'Asia/Kolkata', digestHour: 8 } });
const [ann, general] = comm.channels;

const people = {};
for (const n of ['Ann', 'Bob', 'Cy', 'Dee']) {
  const c = await call('POST', '/crm/contacts', { ...T, body: { firstName: n, lastName: 'Test', email: `${n.toLowerCase()}-${rand}@ex.test` } });
  const m = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: c.id, notify: false } });
  people[n] = { contact: c, member: m, token: tokenOf(m.portalUrl) };
}
const P = (n) => `/public/community/${people[n].token}`;
await call('PUT', `/crm/contacts/${people.Cy.contact.id}`, { ...T, body: { dnd: true } });
const me = await call('PUT', `${P('Dee')}/me`, { body: { digest: 'off' } });
check('member can turn digests off', me.digest === 'off');
await call('PUT', `${P('Dee')}/me`, { body: { digest: 'hourly' }, expect: 400 });

await call('POST', `/communities/${comm.id}/posts`, { ...T, body: { channelId: ann.id, body: 'Live Q&A on Friday!' } });
await sleep(50);
await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'Shipped my landing page today' } });
await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'Free prize: **click** [here](https://evil.example/steal) now' } });

async function lastEmail(n) {
  const conv = (await call('GET', `/inbox/conversations?search=${encodeURIComponent(people[n].contact.email)}`, T))[0];
  if (!conv) return null;
  const msgs = (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.filter((m) => m.direction === 'outbound');
  const msg = msgs.at(-1);
  const { html } = await call('GET', `/inbox/messages/${msg.id}/html`, T);
  return { count: msgs.length, subject: conv.subject, body: msg.body, html };
}

// ---- First run ----
let run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
check('only Ann gets a digest (Bob saw everything, Cy is DND, Dee opted out)', run.sent === 1, JSON.stringify(run));
let mail = await lastEmail('Ann');
check('digest summarises the new posts', mail && /3 new posts/.test(mail.html) && mail.html.includes('Shipped my landing page') && mail.html.includes('Live Q&amp;A'), mail?.subject);
check('member text cannot inject links or bold', !mail.html.includes('href="https://evil.example') && !mail.html.includes('<strong>click</strong>'));
check('personal link and settings link', mail.html.includes(`/community/${people.Ann.token}`) && mail.html.includes(`/community/${people.Ann.token}?digest=settings`));
check('team posts are labelled', mail.html.includes('Coach Kim (team)'));
for (const n of ['Bob', 'Cy', 'Dee']) check(`${n} got no digest`, (await lastEmail(n)) === null);

run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
check('nothing new → nothing sent', run.sent === 0);

// ---- Only new posts next time ----
await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'Week two update' } });
const hiddenPost = await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'spam spam' } });
await call('PUT', `/communities/${comm.id}/posts/${hiddenPost.id}`, { ...T, body: { hidden: true } });
const preview = await call('GET', `/communities/${comm.id}/digests/preview?memberId=${people.Ann.member.id}`, T);
check('staff preview masks the personal link', !preview.empty && preview.totalPosts === 1 && !preview.html.includes(people.Ann.token) && preview.html.includes('PERSONAL-LINK'));
run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
mail = await lastEmail('Ann');
check('second digest has only the new visible post', run.sent === 1 && mail.count === 2 && /1 new post/.test(mail.html) && mail.html.includes('Week two update') && !mail.html.includes('spam spam') && !mail.html.includes('Shipped'));

// ---- Visiting resets what counts as new ----
await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'Anyone around?' } });
await sleep(1100);
await call('GET', P('Ann'));
run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
check('posts seen on a visit are not emailed', run.sent === 0, JSON.stringify(run));

// ---- Schedule respected without ignoreSchedule; community off stops everything ----
await call('POST', `${P('Bob')}/posts`, { body: { channelId: general.id, body: 'Another one' } });
run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: {} });
check('scheduled run does not resend within the period', run.sent === 0);
await call('PUT', `${P('Ann')}/me`, { body: { digest: 'off' } });
run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
check('opt-out respected', run.sent === 0);
await call('PUT', `${P('Ann')}/me`, { body: { digest: 'daily' } });
await call('PUT', `/communities/${comm.id}`, { ...T, body: { digestFrequency: 'off' } });
run = await call('POST', `/communities/${comm.id}/digests/run`, { ...T, body: { ignoreSchedule: true } });
check('community digests off overrides members', run.sent === 0);
const portal = await call('GET', P('Ann'));
check('portal reports settings', portal.me.digest === 'daily' && portal.community.digestFrequency === 'off');

// ---- Isolation ----
const other = await call('POST', '/auth/register', { body: { email: `dg-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/communities/${comm.id}/digests/preview?memberId=${people.Ann.member.id}`, { token: other.accessToken, expect: 404 });
await call('POST', `/communities/${comm.id}/digests/run`, { token: other.accessToken, body: { ignoreSchedule: true }, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
