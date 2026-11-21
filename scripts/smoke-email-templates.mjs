// End-to-end checks for the email template builder: starters, CRUD, sanitising,
// previews with merge fields, test sends, campaigns and workflows using templates.
// Usage: node scripts/smoke-email-templates.mjs [baseUrl]   (API must be running)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `tpl-${rand}@test.local`, password: 'SmokeTest123!', name: 'Tpl Tester', organizationName: `Bright Co ${rand}` } });
const T = { token: reg.accessToken };

const starters = await call('GET', '/email-templates/starters', T);
check('starter gallery', ['newsletter', 'promotion', 'welcome', 'blank'].every((k) => starters.some((s) => s.key === k)));
const tpl = await call('POST', '/email-templates', { ...T, body: { name: 'Monthly news', starter: 'newsletter' } });
check('created from starter', tpl.blocks.length === 6 && tpl.subject.includes('{{business.name}}'));
await call('POST', '/email-templates', { ...T, body: { name: 'x', starter: 'nope' }, expect: 400 });
await call('PUT', `/email-templates/${tpl.id}`, { ...T, body: { blocks: [{ type: 'script', props: {} }] }, expect: 400 });

// Theme colours are validated; block props limited to strings/numbers
const upd = await call('PUT', `/email-templates/${tpl.id}`, { ...T, body: {
  theme: { primaryColor: '#ff0066', background: 'red;x:url(evil)' },
  blocks: [...tpl.blocks, { type: 'button', props: { label: 'Danger', url: 'javascript:alert(1)', nested: { x: 1 } } }],
} });
check('theme sanitised', upd.theme.primaryColor === '#ff0066' && upd.theme.background === undefined);
check('nested props dropped', upd.blocks.at(-1).props.nested === undefined);

const ann = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Ann<script>', lastName: 'Lee', email: `ann-${rand}@ex.test`, tags: ['news'] } });
const bob = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Bob', email: `bob-${rand}@ex.test`, tags: ['news'] } });

const prev = await call('POST', `/email-templates/${tpl.id}/preview`, { ...T, body: { contactId: ann.id } });
check('preview merges contact + business', prev.subject === `This month at Bright Co ${rand}` && prev.html.includes('Hi Ann&lt;script&gt;'), prev.subject);
check('preview escapes contact data', !prev.html.includes('<script>'));
check('unsafe button link neutralised', prev.html.includes('href="#"') && !prev.html.includes('javascript:'));
const sample = await call('POST', `/email-templates/${tpl.id}/preview`, { ...T, body: {} });
check('sample contact preview', sample.html.includes('Hi Alex'));
const unsaved = await call('POST', '/email-templates/preview', { ...T, body: { subject: 'Draft {{contact.firstName}}', blocks: [{ type: 'heading', props: { text: 'Live edit' } }] } });
check('unsaved preview (live builder)', unsaved.subject === 'Draft Alex' && unsaved.html.includes('Live edit'));

// Test send stores html; inbox exposes it
const sent = await call('POST', `/email-templates/${tpl.id}/test`, { ...T, body: { contactId: bob.id } });
check('test send', sent.ok && sent.to === `bob-${rand}@ex.test`);
const conv = (await call('GET', `/inbox/conversations?search=bob-${rand}`, T))[0];
const thread = await call('GET', `/inbox/conversations/${conv.id}`, T);
const m = thread.messages.at(-1);
check('message flagged as designed', m.hasHtml === true && m.body.includes('HI BOB'), m.body.slice(0, 60));
const html = await call('GET', `/inbox/messages/${m.id}/html`, T);
check('designed html retrievable', html.html.startsWith('<!doctype html>') && html.html.includes('Hi Bob'));

// Campaign using the template: per-contact merge + unsubscribe link in html
const camp = await call('POST', '/campaigns', { ...T, body: { name: 'Nov news', channel: 'email', subject: '', templateId: tpl.id, audience: { tags: ['news'] } } });
await call('POST', `/campaigns/${camp.id}/send`, { ...T, body: {} });
await sleep(2000);
const after = await call('GET', `/campaigns/${camp.id}`, T);
check('template campaign delivered', after.status === 'sent' && after.stats.sent === 2, JSON.stringify(after.stats));
const annConv = (await call('GET', `/inbox/conversations?search=ann-${rand}`, T))[0];
const annMsg = (await call('GET', `/inbox/conversations/${annConv.id}`, T)).messages.at(-1);
const annHtml = (await call('GET', `/inbox/messages/${annMsg.id}/html`, T)).html;
check('campaign subject from template', annMsg.body && annHtml.includes(`This month at Bright Co ${rand}`));
check('campaign html has unsubscribe', /href="http[^"]*\/unsubscribe\?c=[\w-]+&amp;t=/.test(annHtml));
await call('POST', '/campaigns', { ...T, body: { name: 'bad', templateId: '00000000-0000-0000-0000-000000000000' }, expect: 400 });

// Workflow send_email with a template
const wf = await call('POST', '/automation/workflows', { ...T, body: { name: 'Welcome designed', steps: [{ type: 'send_email', config: { templateId: tpl.id, subject: 'Welcome {{contact.firstName}}' } }] } });
const run = await call('POST', `/automation/workflows/${wf.id}/trigger`, { ...T, body: { contactId: bob.id } });
check('workflow sends designed email', run.status === 'succeeded' && run.log[0].result.includes('Monthly news'), JSON.stringify(run.log));
const bobLast = (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.at(-1);
check('workflow subject override + html', bobLast.hasHtml && (await call('GET', `/inbox/messages/${bobLast.id}/html`, T)).html.includes('<title>Welcome Bob</title>'));

// Duplicate, delete, isolation
const dup = await call('POST', `/email-templates/${tpl.id}/duplicate`, T);
check('duplicate', dup.name === 'Monthly news (copy)' && dup.id !== tpl.id && dup.blocks.length === upd.blocks.length);
await call('DELETE', `/email-templates/${dup.id}`, T);
check('list after delete', (await call('GET', '/email-templates', T)).length === 1);
const other = await call('POST', '/auth/register', { body: { email: `tpl-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/email-templates/${tpl.id}`, { token: other.accessToken, expect: 404 });
await call('GET', `/inbox/messages/${m.id}/html`, { token: other.accessToken, expect: 404 });
await call('POST', `/email-templates/${tpl.id}/test`, { token: other.accessToken, body: { contactId: bob.id }, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
