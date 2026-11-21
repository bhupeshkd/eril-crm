// End-to-end checks for saved smart lists (contact filters) and lists as campaign audiences.
// Usage: node scripts/smoke-smart-lists.mjs [baseUrl]   (API running, console email/SMS)
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
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `sl-${rand}@test.local`, password: 'SmokeTest123!', name: 'Owner' } });
const T = { token: reg.accessToken };
const mk = (firstName, extra) => call('POST', '/crm/contacts', { ...T, body: { firstName, email: `${firstName.toLowerCase()}-${rand}@ex.test`, ...extra } });
await mk('Ana', { status: 'lead', tags: ['vip', 'hot'], source: 'form' });
await mk('Ben', { status: 'lead', tags: ['vip'], source: 'manual' });
await mk('Cy', { status: 'customer', tags: ['vip'], source: 'form' });
await mk('Dee', { status: 'lead', tags: ['cold'], source: 'form' });
await mk('Eve', { status: 'lead', tags: ['hot'], source: 'form', phone: '+15550001234' });

// ---- Filters on the contacts list ----
const count = async (q) => (await call('GET', `/crm/contacts?${q}`, T)).total;
check('source filter', (await count('source=form')) === 4);
check('source + status + tag', (await count('source=form&status=lead&tag=vip')) === 1);
check('added recently', (await count('createdWithinDays=1')) === 5);
await call('GET', '/crm/contacts?createdWithinDays=0', { ...T, expect: 400 });
const sources = await call('GET', '/crm/contacts/sources', T);
check('sources endpoint', JSON.stringify(sources) === '["form","manual"]', JSON.stringify(sources));

// ---- Creating lists ----
await call('POST', '/crm/lists', { ...T, body: { name: 'Empty', filters: {} }, expect: 400 });
await call('POST', '/crm/lists', { ...T, body: { name: '', filters: { statuses: ['lead'] } }, expect: 400 });
const vipLeads = await call('POST', '/crm/lists', { ...T, body: { name: 'VIP leads', filters: { statuses: ['lead', 'bogus'], tags: ['VIP '], junk: 1 } } });
const f = vipLeads.filters;
check('list filters are cleaned', Object.keys(f).sort().join() === 'statuses,tags' && f.statuses.join() === 'lead' && f.tags.join() === 'vip', JSON.stringify(f));
check('list count is live', vipLeads.count === 2, String(vipLeads.count));
check('list summary', vipLeads.summary === 'Leads · tagged vip', vipLeads.summary);
await call('POST', '/crm/lists', { ...T, body: { name: 'vip LEADS', filters: { statuses: ['lead'] } }, expect: 400 }); // name taken (case-insensitive)
const hot = await call('POST', '/crm/lists', { ...T, body: { name: 'Hot or VIP from forms', filters: { tags: ['hot', 'vip'], source: 'form' } } });
check('multi-tag list matches any tag', hot.count === 3, String(hot.count));

// ---- Using a list on the contacts endpoint ----
const viaList = await call('GET', `/crm/contacts?listId=${vipLeads.id}`, T);
check('listId applies the saved filters', viaList.total === 2 && viaList.items.every((c) => c.status === 'lead' && c.tags.includes('vip')));
check('listId + extra filter narrows further', (await count(`listId=${hot.id}&status=customer`)) === 1);
await call('GET', `/crm/contacts?listId=00000000-0000-0000-0000-000000000000`, { ...T, expect: 404 });

// ---- Lists stay live ----
await mk('Fay', { status: 'lead', tags: ['vip'] });
let lists = await call('GET', '/crm/lists', T);
check('new contact appears in the list count', lists.find((l) => l.id === vipLeads.id).count === 3);

// ---- Update / rename ----
const renamed = await call('PUT', `/crm/lists/${vipLeads.id}`, { ...T, body: { name: 'VIP leads (all)' } });
check('rename keeps filters', renamed.name === 'VIP leads (all)' && renamed.count === 3);
const changed = await call('PUT', `/crm/lists/${vipLeads.id}`, { ...T, body: { filters: { statuses: ['customer'] } } });
check('update filters', changed.count === 1 && changed.summary === 'Customers');
await call('PUT', `/crm/lists/${vipLeads.id}`, { ...T, body: { filters: {} }, expect: 400 });
await call('PUT', `/crm/lists/${vipLeads.id}`, { ...T, body: { name: 'Hot or VIP from forms' }, expect: 400 });

// ---- Isolation ----
const other = await call('POST', '/auth/register', { body: { email: `sl2-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
const OT = { token: other.accessToken };
check("other workspace can't see lists", (await call('GET', '/crm/lists', OT)).length === 0);
await call('GET', `/crm/contacts?listId=${hot.id}`, { ...OT, expect: 404 });
await call('PUT', `/crm/lists/${hot.id}`, { ...OT, body: { name: 'mine' }, expect: 404 });
await call('DELETE', `/crm/lists/${hot.id}`, { ...OT, expect: 404 });
await call('POST', '/campaigns', { ...OT, body: { name: 'x', channel: 'email', subject: 's', body: 'b', audience: { listId: hot.id } }, expect: 400 });

// ---- Campaign audiences ----
check('audience size uses the list', (await call('POST', '/campaigns/audience-size', { ...T, body: { listId: hot.id, channel: 'email' } })).count === 3);
check('audience size: list + status narrows', (await call('POST', '/campaigns/audience-size', { ...T, body: { listId: hot.id, statuses: ['lead'], channel: 'email' } })).count === 2);
check('audience size: sms needs a phone', (await call('POST', '/campaigns/audience-size', { ...T, body: { listId: hot.id, channel: 'sms' } })).count === 1);
const camp = await call('POST', '/campaigns', { ...T, body: { name: 'To hot list', channel: 'email', subject: 'Hi {{contact.firstName}}', body: 'Hello', audience: { listId: hot.id } } });
check('campaign stores the list', camp.audience?.listId === hot.id);
await call('POST', `/campaigns/${camp.id}/send`, { ...T, body: {} });
let sent;
for (let i = 0; i < 20; i++) { await sleep(300); sent = await call('GET', `/campaigns/${camp.id}`, T); if (sent.status === 'sent') break; }
check('campaign sent to the list only', sent.status === 'sent' && sent.stats.sent === 3, JSON.stringify(sent.stats));

// ---- Deleting a list ----
const camp2 = await call('POST', '/campaigns', { ...T, body: { name: 'Orphan', channel: 'email', subject: 's', body: 'b', audience: { listId: hot.id } } });
await call('DELETE', `/crm/lists/${hot.id}`, T);
lists = await call('GET', '/crm/lists', T);
check('deleted list is gone', !lists.some((l) => l.id === hot.id));
await call('POST', `/campaigns/${camp2.id}/send`, { ...T, body: {}, expect: 400 });
check('campaign with a deleted list stays a draft', (await call('GET', `/campaigns/${camp2.id}`, T)).status === 'draft');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smart list checks passed');
process.exit(failures ? 1 : 0);
