// End-to-end checks for the "advanced" batch: real-time stream, AI endpoints,
// reporting, API keys + webhooks, sites/funnels, reputation.
// Usage: node scripts/smoke-advanced.mjs [baseUrl]   (API must be running)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;

async function call(method, path, { token, apiKey, body, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `adv-${rand}@test.local`, password: 'SmokeTest123!', name: 'Adv Tester' } });
const token = reg.accessToken;
const T = { token };

// ---- Real-time stream ----
const ctrl = new AbortController();
const events = [];
const streamRes = await fetch(BASE + '/realtime/stream', { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
check('stream opens as SSE', streamRes.ok && streamRes.headers.get('content-type')?.includes('text/event-stream'));
(async () => {
  const reader = streamRes.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (chunk.includes('event: domain') && data) events.push(JSON.parse(data.slice(6)));
      }
    }
  } catch { /* aborted */ }
})();
await call('GET', '/realtime/stream', { expect: 401 });
const contact = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Rita', lastName: 'Moreno', email: `rita-${rand}@ex.test` } });
await sleep(800);
check('live event received', events.some((e) => e.type === 'contact.created' && e.title === 'New contact: Rita Moreno' && e.href === `/contacts/${contact.id}`), JSON.stringify(events));
// Another workspace's events must not leak into this stream.
const other = await call('POST', '/auth/register', { body: { email: `adv-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('POST', '/crm/contacts', { token: other.accessToken, body: { firstName: 'Leak', email: `leak-${rand}@ex.test` } });
await sleep(800);
check('no cross-tenant live events', !events.some((e) => e.title?.includes('Leak')));

// ---- AI (works with or without ANTHROPIC_API_KEY) ----
const ai = await call('GET', '/ai/status', T);
check('ai status reports model', ai.model === 'claude-opus-5-5');
if (ai.enabled) {
  const d = await call('POST', '/ai/draft', { ...T, body: { channel: 'email', goal: 'Invite them to a free strategy call next week', contactId: contact.id } });
  check('ai email draft has subject + body', !!d.subject && d.body.length > 20);
  const s = await call('POST', '/ai/summarize-contact', { ...T, body: { contactId: contact.id } });
  check('ai summary returned', s.summary.length > 10);
} else {
  await call('POST', '/ai/draft', { ...T, body: { channel: 'email', goal: 'x' }, expect: 503 });
  console.log('INFO  AI disabled (no ANTHROPIC_API_KEY) — checked graceful 503 instead');
}
await call('POST', '/ai/draft', { ...T, body: { channel: 'fax', goal: 'x' }, expect: 400 });

// ---- API keys (public REST API) ----
const key = await call('POST', '/developer/api-keys', { ...T, body: { name: 'Zapier', role: 'manager' } });
check('api key returned once', key.key?.startsWith('eril_') && key.keyPrefix === key.key.slice(0, 12));
const listed = await call('GET', '/developer/api-keys', T);
check('listed keys never include secret', listed.length === 1 && !('key' in listed[0]) && !('keyHash' in listed[0]));
const viaKey = await call('GET', '/crm/contacts', { apiKey: key.key });
check('api key reads its workspace', viaKey.total === 1 && viaKey.items[0].id === contact.id);
await call('POST', '/crm/contacts', { apiKey: key.key, body: { firstName: 'From', lastName: 'API', email: `api-${rand}@ex.test` } });
await call('POST', '/developer/api-keys', { apiKey: key.key, body: { name: 'escalate' }, expect: 403 }); // manager lacks integrations:write
await call('GET', '/crm/contacts', { apiKey: 'eril_bogus', expect: 401 });
await call('GET', '/crm/contacts', { apiKey: key.key, token: other.accessToken }); // key wins, still scoped to its own workspace
await call('DELETE', `/developer/api-keys/${key.id}`, T);
await call('GET', '/crm/contacts', { apiKey: key.key, expect: 401 });

// ---- Webhooks ----
const evTypes = await call('GET', '/developer/events', T);
check('webhook event catalog', evTypes.includes('contact.created') && evTypes.includes('review.received'));
const hook = await call('POST', '/developer/webhooks', { ...T, body: { url: 'http://127.0.0.1:9/hook', events: ['contact.created'] } });
check('webhook secret shown on create', hook.secret?.startsWith('whsec_'));
const hooks = await call('GET', '/developer/webhooks', T);
check('webhook secret hidden on list', hooks.length === 1 && !('secret' in hooks[0]));
const t = await call('POST', `/developer/webhooks/${hook.id}/test`, { ...T, expect: 400 });
check('private webhook target blocked', /private/.test(t.message), t.message);
await call('POST', '/developer/webhooks', { ...T, body: { url: 'ftp://x', events: [] }, expect: 400 });
await call('POST', '/developer/webhooks', { ...T, body: { url: 'https://example.com', events: ['nope'] }, expect: 400 });

// ---- Sites & funnels ----
const form = await call('POST', '/forms', { ...T, body: { name: 'Lead form' } });
const cal = await call('POST', '/calendars', { ...T, body: { name: 'Intro call', minNoticeHours: 0 } });
const site = await call('POST', '/sites', { ...T, body: { name: 'Audit funnel', template: 'lead-funnel' } });
check('funnel template has 3 steps', site.kind === 'funnel' && site.pages.length === 3);
site.pages[1].blocks.find((b) => b.type === 'booking').props.calendarId = cal.id;
site.pages[0].blocks.push({ type: 'form', props: { formId: form.id } });
site.pages[0].blocks.push({ type: 'cta', props: { heading: 'x', buttonLink: 'javascript:alert(1)' } });
const saved = await call('PUT', `/sites/${site.id}`, { ...T, body: { pages: site.pages, theme: { primaryColor: '#ff0000', font: 'serif' } } });
check('unsafe link stripped on save', saved.pages[0].blocks.at(-1).props.buttonLink === undefined);
await call('PUT', `/sites/${site.id}`, { ...T, body: { pages: [{ title: 'x', path: '', blocks: [{ type: 'form', props: { formId: other.accessToken ? '00000000-0000-0000-0000-000000000000' : '' } }] }] }, expect: 400 });
await call('GET', `/public/sites/${site.slug}`, { expect: 404 }); // not published yet
await call('PUT', `/sites/${site.id}`, { ...T, body: { isPublished: true } });
const pub = await call('GET', `/public/sites/${site.slug}`);
check('public site resolves embeds', pub.pages.length === 3 && pub.embeds.forms.some((f) => f.id === form.id) && pub.embeds.calendars.some((c) => c.id === cal.id));
check('public site theme sanitised', pub.theme.primaryColor === '#ff0000' && pub.theme.font === 'serif');
await call('POST', `/public/sites/${site.slug}/view`, { body: { path: '' } });
await call('POST', `/public/sites/${site.slug}/view`, { body: { path: 'book' } });
await call('POST', `/public/sites/${site.slug}/view`, { body: { path: 'book' } });
const afterViews = await call('GET', `/sites/${site.id}`, T);
check('page views counted', afterViews.stats['/'] === 1 && afterViews.stats.book === 2, JSON.stringify(afterViews.stats));
await call('GET', `/sites/${site.id}`, { token: other.accessToken, expect: 404 });

// ---- Reputation ----
await call('PUT', '/reputation/settings', { ...T, body: { publicReviewUrl: 'https://g.page/r/example/review', minPublicRating: 4, autoPublishMinRating: 5 } });
await call('PUT', '/reputation/settings', { ...T, body: { publicReviewUrl: 'http://insecure' }, expect: 400 });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Low rating alert', triggerType: 'review.received', isPublished: true,
  steps: [{ type: 'condition', config: { field: 'review.rating', operator: 'lt', value: 3 }, then: [{ type: 'create_task', config: { title: 'Call {{contact.firstName}} about their {{review.rating}}★ review' } }], else: [] }] } });
const r1 = await call('POST', '/reputation/requests', { ...T, body: { contactId: contact.id } });
const tok1 = r1.link.split('/review/')[1];
const info = await call('GET', `/public/reviews/${tok1}`);
check('review page knows contact', info.firstName === 'Rita' && info.completed === false);
const sub1 = await call('POST', `/public/reviews/${tok1}`, { body: { rating: 5, comment: 'Fantastic team!' } });
check('happy customer sent to public review site', sub1.publicReviewUrl === 'https://g.page/r/example/review');
await call('POST', `/public/reviews/${tok1}`, { body: { rating: 1 }, expect: 400 }); // one review per request
const apiContact = (await call('GET', `/crm/contacts?search=api-${rand}`, T)).items[0];
const r2 = await call('POST', '/reputation/requests', { ...T, body: { contactId: apiContact.id } });
const sub2 = await call('POST', `/public/reviews/${r2.link.split('/review/')[1]}`, { body: { rating: 2, comment: 'Slow replies' } });
check('unhappy customer kept private', sub2.publicReviewUrl === null);
await sleep(1000);
const sum = await call('GET', '/reputation/summary', T);
check('review summary', sum.count === 2 && sum.average === 3.5 && sum.responseRate === 100, JSON.stringify(sum));
const reviews = await call('GET', '/reputation/reviews', T);
check('5★ auto-published, 2★ private', reviews.find((r) => r.rating === 5).isPublic && !reviews.find((r) => r.rating === 2).isPublic);
const tasks = await call('GET', `/crm/tasks?contactId=${apiContact.id}`, T);
check('review.received workflow created follow-up task', tasks.some((x) => x.title === 'Call From about their 2★ review'), JSON.stringify(tasks.map((x) => x.title)));
check('review event streamed live', events.some((e) => e.type === 'review.received'));
const pub2 = await call('GET', `/public/sites/${site.slug}`);
check('public reviews feed sites', pub2.embeds.reviews.length === 1 && pub2.embeds.reviews[0].author === 'Rita M.');

// ---- Reporting ----
const rep = await call('GET', '/reports/overview?days=30', T);
check('report series length', rep.leadsByDay.length === 30 && rep.revenueByDay.length === 30);
check('report counts new contacts', rep.totals.newContacts === 2 && rep.leadsByDay.at(-1).value === 2, JSON.stringify(rep.totals));
check('report pipeline stages', rep.pipeline.length >= 6 || rep.pipeline.length === 0);
check('report sources', rep.sources.some((s) => s.source === 'manual'));
await call('GET', '/reports/overview?days=13', { ...T, expect: 400 });

ctrl.abort();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
