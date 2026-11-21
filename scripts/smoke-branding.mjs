// End-to-end checks for agency white-label branding (settings, app lookup, public page lookups).
// Usage: node scripts/smoke-branding.mjs [baseUrl]   (API running, payments test mode)
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
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const rand = Math.random().toString(36).slice(2, 8);
const DEFAULT = { appName: 'ERIL', logoUrl: '', primaryColor: '#5847d7', hidePoweredBy: false };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const reg = await call('POST', '/auth/register', { body: { email: `br-${rand}@test.local`, password: 'SmokeTest123!', name: 'Agency Owner' } });
const T = { token: reg.accessToken };
const org = claims(reg.accessToken).currentOrganizationId;

// ---- Defaults ----
check('new org has default branding', same(await call('GET', `/agency/${org}/branding`, T), DEFAULT));
check('app lookup defaults', same(await call('GET', '/branding', T), DEFAULT));

// ---- Validation ----
await call('PUT', `/agency/${org}/branding`, { ...T, body: { primaryColor: 'red' }, expect: 400 });
await call('PUT', `/agency/${org}/branding`, { ...T, body: { logoUrl: 'javascript:alert(1)' }, expect: 400 });
await call('PUT', `/agency/${org}/branding`, { ...T, body: { logoUrl: 'http://insecure.example/logo.png' }, expect: 400 });
await call('PUT', `/agency/${org}/branding`, { ...T, body: { appName: 'x'.repeat(41) }, expect: 400 });
await call('PUT', `/agency/${org}/branding`, { ...T, body: { surprise: true }, expect: 400 });

// ---- Saving ----
const saved = await call('PUT', `/agency/${org}/branding`, { ...T, body: { appName: 'Sparkle CRM', primaryColor: '#DB2777', logoUrl: 'https://example.com/logo.png', hidePoweredBy: true } });
check('saved, colour lower-cased', saved.appName === 'Sparkle CRM' && saved.primaryColor === '#db2777' && saved.hidePoweredBy === true);
const partial = await call('PUT', `/agency/${org}/branding`, { ...T, body: { hidePoweredBy: false } });
check('partial update keeps other fields', partial.appName === 'Sparkle CRM' && partial.hidePoweredBy === false);
const blankName = await call('PUT', `/agency/${org}/branding`, { ...T, body: { appName: '   ' } });
check('blank name falls back to ERIL', blankName.appName === 'ERIL');
await call('PUT', `/agency/${org}/branding`, { ...T, body: { appName: 'Sparkle CRM' } });
check('app lookup sees the branding', (await call('GET', '/branding', T)).appName === 'Sparkle CRM');

// ---- Sub-accounts in the same organization share it ----
const sub = await call('POST', `/agency/${org}/sub-accounts`, { ...T, body: { name: `Client ${rand}` } });
await call('POST', `/agency/${org}/sub-accounts/${sub.id ?? sub.workspaceId}/join`, T);
const switched = await call('POST', '/auth/switch-workspace', { ...T, body: { workspaceId: sub.id ?? sub.workspaceId } });
check('sub-account shows agency branding', (await call('GET', '/branding', { token: switched.accessToken })).appName === 'Sparkle CRM');

// ---- Access control ----
const other = await call('POST', '/auth/register', { body: { email: `br2-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/agency/${org}/branding`, { token: other.accessToken, expect: 403 });
await call('PUT', `/agency/${org}/branding`, { token: other.accessToken, body: { appName: 'Hijack' }, expect: 403 });
check("other org's app still default", same(await call('GET', '/branding', { token: other.accessToken }), DEFAULT));
await call('GET', `/agency/${org}/branding`, { expect: 401 });

// ---- Public pages ----
const cal = await call('POST', '/calendars', { ...T, body: { name: 'Intro call' } });
check('public: calendar', (await call('GET', `/public/branding/calendar/${cal.slug}`)).appName === 'Sparkle CRM');
const form = await call('POST', '/forms', { ...T, body: { name: 'Lead form', kind: 'form' } });
check('public: form', (await call('GET', `/public/branding/form/${form.slug}`)).primaryColor === '#db2777');
const contact = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Ivy', email: `ivy-${rand}@ex.test` } });
const inv = await call('POST', '/payments/invoices', { ...T, body: { contactId: contact.id, items: [{ name: 'Clean', quantity: 1, unitPrice: 50 }] } });
const token = inv.publicToken ?? (inv.publicUrl ?? '').split('/').pop();
if (token) check('public: invoice', (await call('GET', `/public/branding/invoice/${token}`)).appName === 'Sparkle CRM');
check('public: contact (unsubscribe link)', (await call('GET', `/public/branding/contact/${contact.id}`)).appName === 'Sparkle CRM');
check('public: unknown key gets defaults', same(await call('GET', `/public/branding/calendar/no-such-slug-${rand}`), DEFAULT));
check('public: unknown kind gets defaults', same(await call('GET', `/public/branding/bogus/${cal.slug}`), DEFAULT));
check("public: other org's calendar is unbranded", same(await call('GET', `/public/branding/calendar/${(await call('POST', '/calendars', { token: other.accessToken, body: { name: 'Theirs' } })).slug}`), DEFAULT));

// ---- Reset ----
await call('PUT', `/agency/${org}/branding`, { ...T, body: DEFAULT });
check('reset to defaults', same(await call('GET', '/branding', T), DEFAULT));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll branding checks passed');
process.exit(failures ? 1 : 0);
