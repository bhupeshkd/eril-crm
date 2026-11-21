// End-to-end checks for the social planner: validation, drafts, post now, scheduled publishing by the background
// scheduler, editing rules, partial failures, double-publish protection and isolation. Uses the main dev API
// (console publishing, scheduler on). Usage: node scripts/smoke-social.mjs
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;
async function call(method, p, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* text */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const num = () => String(Math.floor(1e14 + Math.random() * 8.9e14));
const IMG = 'https://images.example/mug.jpg';

const reg = await call('POST', '/auth/register', { body: { email: `soc-${rand}@test.local`, password: 'SmokeTest123!', name: 'Sky Owner' } });
const T = { token: reg.accessToken };
await call('POST', '/social/posts', { ...T, body: { body: 'Hi', pageIds: [] }, expect: 400 });
const fb = await call('POST', '/meta/pages', { ...T, body: { platform: 'facebook', pageId: num(), name: 'Bloom FB', accessToken: 'fb-token' } });
const ig = await call('POST', '/meta/pages', { ...T, body: { platform: 'instagram', pageId: num(), name: 'bloom.ig', accessToken: 'ig-token' } });
const accounts = await call('GET', '/social/accounts', T);
check('connected accounts listed without tokens', accounts.length === 2 && !JSON.stringify(accounts).includes('token'));

// ---- Validation ----
let e = await call('POST', '/social/posts', { ...T, body: { body: 'No image', pageIds: [ig.id] }, expect: 400 });
check('Instagram needs an image', /Instagram posts need an image/.test(e?.message ?? ''));
await call('POST', '/social/posts', { ...T, body: { body: 'x', pageIds: [fb.id], link: 'javascript:alert(1)' }, expect: 400 });
await call('POST', '/social/posts', { ...T, body: { body: 'x', pageIds: [fb.id], scheduledAt: new Date(Date.now() - 3_600_000).toISOString() }, expect: 400 });
await call('POST', '/social/posts', { ...T, body: { body: 'x', pageIds: ['00000000-0000-4000-8000-000000000000'] }, expect: 400 });

// ---- Draft, then post now ----
const draft = await call('POST', '/social/posts', { ...T, body: { body: 'Spring workshop dates are out!', link: 'https://bloom.example/spring', pageIds: [fb.id] } });
check('saved as draft', draft.status === 'draft' && draft.scheduledAt === null && draft.targets[0].status === 'pending');
const now = await call('POST', `/social/posts/${draft.id}/publish`, T);
check('published now', now.status === 'published' && now.targets[0].status === 'published' && /^console-/.test(now.targets[0].externalId) && now.publishedAt);
await call('POST', `/social/posts/${draft.id}/publish`, { ...T, expect: 409 });
await call('PUT', `/social/posts/${draft.id}`, { ...T, body: { body: 'edit after publish' }, expect: 409 });

// Post-now straight from the composer, to both platforms.
const both = await call('POST', '/social/posts', { ...T, body: { body: 'New mugs in the shop', imageUrl: IMG, link: 'https://bloom.example/shop', pageIds: [fb.id, ig.id], publishNow: true } });
check('posted to Facebook and Instagram', both.status === 'published' && both.targets.every((t) => t.status === 'published'));

// ---- Scheduled publishing by the background scheduler ----
const at = new Date(Date.now() + 4000).toISOString();
let sched = await call('POST', '/social/posts', { ...T, body: { body: 'Scheduled hello', pageIds: [fb.id], scheduledAt: at } });
check('scheduled', sched.status === 'scheduled' && sched.scheduledAt === at);
sched = await call('PUT', `/social/posts/${sched.id}`, { ...T, body: { body: 'Scheduled hello (edited)' } });
check('scheduled posts can be edited, keeping the time', sched.body === 'Scheduled hello (edited)' && sched.status === 'scheduled' && sched.scheduledAt === at);
let done = null;
for (let i = 0; i < 40 && !done; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const p = (await (await fetch(`${BASE}/social/posts`, { headers: { Authorization: `Bearer ${T.token}` } })).json()).find((x) => x.id === sched.id);
  if (p?.status === 'published') done = p;
}
check('the scheduler published it on time (within 30s)', !!done && done.targets[0].status === 'published', done ? '' : 'still not published');

// ---- Partial failure: a page disconnected before publishing ----
const later = await call('POST', '/social/posts', { ...T, body: { body: 'Two places', imageUrl: IMG, pageIds: [fb.id, ig.id], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() } });
await call('DELETE', `/meta/pages/${ig.id}`, T);
await call('POST', `/social/posts/${later.id}/publish`, { ...T, expect: 400 }); // can't publish to a page that's gone (checked up front)
await call('PUT', `/social/posts/${later.id}`, { ...T, body: { pageIds: [fb.id] } });
const ok = await call('POST', `/social/posts/${later.id}/publish`, T);
check('after removing the disconnected account it publishes', ok.status === 'published' && ok.targets.length === 1);

// ---- Double-publish protection ----
const race = await call('POST', '/social/posts', { ...T, body: { body: 'Only once', pageIds: [fb.id] } });
const [r1, r2] = await Promise.all([
  fetch(`${BASE}/social/posts/${race.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${T.token}` } }),
  fetch(`${BASE}/social/posts/${race.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${T.token}` } }),
]);
const bodies = await Promise.all([r1.json(), r2.json()]);
const published = bodies.filter((b) => b.targets);
check('two simultaneous "post now" clicks publish once', published.length >= 1 && new Set(published.map((b) => b.targets[0].externalId)).size === 1, `${r1.status}/${r2.status}`);

// ---- Listing, deleting, isolation ----
const list = await call('GET', '/social/posts', T);
check('planner lists drafts, scheduled and published', list.length >= 5 && list.some((p) => p.status === 'published'));
await call('DELETE', `/social/posts/${both.id}`, T);
check('removed from the planner', !(await call('GET', '/social/posts', T)).some((p) => p.id === both.id));
const other = await call('POST', '/auth/register', { body: { email: `soc-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
const O = { token: other.accessToken };
check('other workspace sees nothing', (await call('GET', '/social/posts', O)).length === 0);
await call('POST', '/social/posts', { ...O, body: { body: 'steal', pageIds: [fb.id] }, expect: 400 });
await call('DELETE', `/social/posts/${race.id}`, { ...O, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
