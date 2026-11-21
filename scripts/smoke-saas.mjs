// End-to-end checks for agency SaaS mode: plans, client subscriptions, feature gating, limits,
// suspension for unpaid invoices, and monthly usage rebilling.
// Usage: node scripts/smoke-saas.mjs [baseUrl]   (API in payments test mode, non-production; needs DB access via backend/.env)
import { createRequire } from 'module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
require('dotenv').config({ path: new URL('../backend/.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
const { Client } = require('pg');

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
const rand = Math.random().toString(36).slice(2, 8);
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const db = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
await db.connect();

const reg = await call('POST', '/auth/register', { body: { email: `saas-${rand}@test.local`, password: 'SmokeTest123!', name: 'Agency Owner' } });
const A = { token: reg.accessToken };
const org = claims(reg.accessToken).currentOrganizationId;
const billingWs = claims(reg.accessToken).currentWorkspaceId;
const S = `/agency/${org}/saas`;
const sub = await call('POST', `/agency/${org}/sub-accounts`, { ...A, body: { name: `Client ${rand}` } });
const clientWs = sub.id ?? sub.workspaceId;
await call('POST', `/agency/${org}/sub-accounts/${clientWs}/join`, A);
const C = { token: (await call('POST', '/auth/switch-workspace', { ...A, body: { workspaceId: clientWs } })).accessToken };
const bust = () => call('PUT', `${S}/settings`, { ...A, body: { graceDays: 3 } }); // settings changes clear the plan cache

// ---- Setup & validation ----
let ov = await call('GET', S, A);
check('overview lists features and both workspaces', ov.features.length >= 8 && ov.workspaces.length === 2 && ov.plans.length === 0);
await call('POST', `${S}/plans`, { ...A, body: { name: 'Starter', price: 49 }, expect: 400 }); // no billing workspace yet
await call('PUT', `${S}/settings`, { ...A, body: { billingWorkspaceId: '00000000-0000-4000-8000-000000000000' }, expect: 400 });
const set = await call('PUT', `${S}/settings`, { ...A, body: { billingWorkspaceId: billingWs, emailPrice: 0.01, smsPrice: 0.05, graceDays: 3 } });
check('settings saved', set.billingWorkspaceId === billingWs && set.emailPrice === 0.01 && set.graceDays === 3);
await call('POST', `${S}/plans`, { ...A, body: { name: 'Bad', price: 10, features: ['teleport'] }, expect: 400 });
const starter = await call('POST', `${S}/plans`, {
  ...A,
  body: { name: 'Starter', price: 49, trialDays: 14, features: ['calendars', 'payments'], limits: { contacts: 3, users: 1 }, included: { emails: 2, sms: 0 } },
});
check('plan created with a recurring product', starter.productId && starter.limits.contacts === 3 && starter.included.emails === 2);
const products = await call('GET', '/payments/products', A);
check('plan product lives in the billing workspace', products.some((p) => p.id === starter.productId && p.interval === 'month' && p.price === 49));
const pro = await call('POST', `${S}/plans`, { ...A, body: { name: 'Pro', price: 99, features: ['calendars', 'payments', 'marketing'] } });

await call('POST', `${S}/accounts`, { ...A, body: { workspaceId: billingWs, planId: starter.id, billingEmail: `bill-${rand}@ex.test` }, expect: 400 });
await call('POST', `${S}/accounts`, { ...A, body: { workspaceId: clientWs, planId: starter.id, billingEmail: 'not-an-email' }, expect: 400 });
check('non-SaaS workspace has no plan', (await call('GET', '/saas/status', C)).saas === false);

// ---- Assign: trial subscription in the billing workspace ----
const assigned = await call('POST', `${S}/accounts`, { ...A, body: { workspaceId: clientWs, planId: starter.id, billingEmail: `bill-${rand}@ex.test`, billingName: 'Client Co' } });
check('client on Starter, trialing', assigned.status === 'trialing', assigned.status);
const [billContact] = (await db.query(`SELECT id, tags, source FROM contacts WHERE workspace_id = $1 AND email = $2`, [billingWs, `bill-${rand}@ex.test`])).rows;
check('client is a tagged contact in the billing workspace', billContact && (billContact.tags ?? []).includes('saas-client'));
let st = await call('GET', '/saas/status', C);
check('client sees plan, trial and features', st.saas && st.plan.name === 'Starter' && st.status === 'trialing' && st.trialEndsAt && st.plan.features.some((f) => f.key === 'payments'));
await call('PUT', `${S}/settings`, { ...A, body: { billingWorkspaceId: clientWs }, expect: 400 });

// ---- Feature gating ----
await call('GET', '/campaigns', { ...C, expect: 403 });
await call('GET', '/calendars', C);
await call('GET', '/crm/contacts', C); // core features are always on
await call('GET', '/campaigns', A); // billing workspace is not restricted

// ---- Limits ----
const people = [];
for (let i = 0; i < 3; i++) people.push(await call('POST', '/crm/contacts', { ...C, body: { firstName: `P${i}`, email: `p${i}-${rand}@ex.test` } }));
const over = await call('POST', '/crm/contacts', { ...C, body: { firstName: 'Too many' }, expect: 402 });
check('contact limit explained', over?.code === 'plan_limit' && /3 contacts/.test(over.message), over?.message);
const inv402 = await call('POST', `/workspaces/${clientWs}/invite`, { ...A, body: { email: `team-${rand}@ex.test`, role: 'team_member' }, expect: 402 });
check('seat limit applies to invites', inv402?.code === 'plan_limit');

// ---- Usage this month (3 emails, 2 included) ----
for (const p of people) await call('POST', '/payments/text-to-pay', { ...C, body: { contactId: p.id, channel: 'email', amount: 10, description: 'Visit' } });
st = await call('GET', '/saas/status', C);
check('usage counted', st.usage.emails === 3 && st.usage.contacts === 3, JSON.stringify(st.usage));

// ---- Trial ends -> invoice; unpaid -> past due -> suspended (read-only) ----
const [{ id: subId }] = (await db.query(`SELECT subscription_id AS id FROM saas_accounts WHERE workspace_id = $1`, [clientWs])).rows;
await call('POST', '/payments/billing/run', { ...A, body: { at: new Date(Date.now() + 15 * 86_400_000).toISOString() } });
const [planInv] = (await db.query(`SELECT id, public_token FROM invoices WHERE subscription_id = $1 AND status = 'sent'`, [subId])).rows;
check('trial end issued the first invoice', !!planInv);
await db.query(`UPDATE invoices SET due_date = CURRENT_DATE - 2 WHERE id = $1`, [planInv.id]);
await call('POST', '/payments/billing/run', A); // chase overdue now -> subscription past_due
await bust();
st = await call('GET', '/saas/status', C);
check('within grace: past due, still writable', st.status === 'past_due' && st.payUrl?.includes(`/invoice/${planInv.public_token}`), st.status);
await call('PUT', `/crm/contacts/${people[0].id}`, { ...C, body: { lastName: 'Ok' } });
await db.query(`UPDATE invoices SET due_date = CURRENT_DATE - 5 WHERE id = $1`, [planInv.id]);
await bust();
st = await call('GET', '/saas/status', C);
check('past grace: suspended with amount due', st.status === 'suspended' && st.amountDue === 49, `${st.status} ${st.amountDue}`);
const locked = await call('PUT', `/crm/contacts/${people[0].id}`, { ...C, body: { lastName: 'No' }, expect: 402 });
check('suspended account is read-only', locked?.code === 'account_locked');
await call('GET', '/crm/contacts', C);
await call('POST', `/public/invoices/${planInv.public_token}/test-pay`);
await bust();
st = await call('GET', '/saas/status', C);
check('paying restores access', st.status === 'active' && st.payUrl === null, st.status);
await call('PUT', `/crm/contacts/${people[0].id}`, { ...C, body: { lastName: 'Back' } });

// ---- Usage rebilling: one overage invoice per month ----
const period = new Date().toISOString().slice(0, 7);
await call('POST', `${S}/usage/bill`, { ...A, body: { period: '2026-13' }, expect: 400 });
const run1 = await call('POST', `${S}/usage/bill`, { ...A, body: { period } });
const run2 = await call('POST', `${S}/usage/bill`, { ...A, body: { period } });
check('overage billed once', run1.billed === 1 && run2.billed === 0, `${run1.billed}/${run2.billed}`);
const bills = await call('GET', `${S}/usage/bills`, A);
check('usage bill recorded', bills.length === 1 && bills[0].emails === 3 && bills[0].amount === 0.01 && bills[0].invoiceId === run1.invoices[0]);
const usageInv = (await call('GET', '/payments/invoices', A)).find((i) => i.id === run1.invoices[0]);
check('overage invoice sent to the client contact', usageInv && usageInv.total === 0.01 && usageInv.status === 'sent' && usageInv.source === 'saas_usage' && usageInv.contactId === billContact?.id);

// ---- Plan change: old subscription canceled, no second trial, features follow ----
const moved = await call('POST', `${S}/accounts`, { ...A, body: { workspaceId: clientWs, planId: pro.id, billingEmail: `bill-${rand}@ex.test` } });
check('moved to Pro without a trial', moved.status === 'active' && moved.subscriptionId !== subId, moved.status);
check('old subscription canceled', (await db.query(`SELECT status FROM subscriptions WHERE id = $1`, [subId])).rows[0].status === 'canceled');
await call('GET', '/campaigns', C);
await call('POST', '/crm/contacts', { ...C, body: { firstName: 'Unlimited now' } });
ov = await call('GET', S, A);
const row = ov.workspaces.find((w) => w.workspaceId === clientWs);
check('overview shows the account', row.account?.planName === 'Pro' && row.account.status === 'active' && ov.mrr === 99, `${row.account?.status} ${ov.mrr}`);

// ---- Access control ----
const other = await call('POST', '/auth/register', { body: { email: `saas-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', S, { token: other.accessToken, expect: 403 });
await call('POST', `${S}/plans`, { token: other.accessToken, body: { name: 'Hijack', price: 1 }, expect: 403 });
const otherOrg = claims(other.accessToken).currentOrganizationId;
await call('PUT', `/agency/${otherOrg}/saas/settings`, { token: other.accessToken, body: { billingWorkspaceId: claims(other.accessToken).currentWorkspaceId } });
const otherPlan = await call('POST', `/agency/${otherOrg}/saas/plans`, { token: other.accessToken, body: { name: 'X', price: 5 } });
await call('POST', `/agency/${otherOrg}/saas/accounts`, { token: other.accessToken, body: { workspaceId: clientWs, planId: otherPlan.id, billingEmail: `x-${rand}@ex.test` }, expect: 404 });
await call('POST', `${S}/accounts`, { ...A, body: { workspaceId: clientWs, planId: otherPlan.id, billingEmail: `x-${rand}@ex.test` }, expect: 404 });

// ---- Cancel (read-only) then remove (unrestricted) ----
await call('DELETE', `${S}/accounts/${clientWs}?mode=cancel`, A);
st = await call('GET', '/saas/status', C);
check('canceled account is read-only', st.status === 'canceled');
await call('POST', '/crm/contacts', { ...C, body: { firstName: 'Nope' }, expect: 402 });
await call('GET', '/crm/contacts', C);
await call('DELETE', `${S}/accounts/${clientWs}?mode=remove`, A);
check('removed: no plan', (await call('GET', '/saas/status', C)).saas === false);
await call('POST', '/crm/contacts', { ...C, body: { firstName: 'Free again' } });
await call('DELETE', `${S}/accounts/${clientWs}`, { ...A, expect: 404 });

await db.end();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
