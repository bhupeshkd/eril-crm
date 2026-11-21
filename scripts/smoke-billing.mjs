// End-to-end checks for coupons and subscriptions (recurring invoices, trials,
// coupon cycles, cancel at period end, overdue reminders, past-due recovery).
// Usage: node scripts/smoke-billing.mjs [baseUrl]   (API must be running, non-production)
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
const DAY = 86400e3;
const iso = (ms) => new Date(ms).toISOString();

const reg = await call('POST', '/auth/register', { body: { email: `billing-${rand}@test.local`, password: 'SmokeTest123!', name: 'Billing Tester' } });
const T = { token: reg.accessToken };
const run = (atMs) => call('POST', '/payments/billing/run', { ...T, body: { at: iso(atMs) } });

const alice = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Alice', lastName: 'Payer', email: `alice-${rand}@ex.test` } });
const bob = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Bob', lastName: 'Trial', email: `bob-${rand}@ex.test` } });

// ---- Coupons ----
await call('POST', '/payments/coupons', { ...T, body: { code: 'WELCOME20', type: 'percent', amount: 20 } });
await call('POST', '/payments/coupons', { ...T, body: { code: 'welcome20', type: 'percent', amount: 5 }, expect: 409 }); // case-insensitive duplicate
await call('POST', '/payments/coupons', { ...T, body: { code: 'TOOBIG', type: 'percent', amount: 120 }, expect: 400 });
await call('POST', '/payments/coupons', { ...T, body: { code: 'TENOFF', type: 'fixed', amount: 10 }, expect: 400 }); // fixed needs currency
await call('POST', '/payments/coupons', { ...T, body: { code: 'TENOFF', type: 'fixed', amount: 10, currency: 'USD', maxRedemptions: 1 } });
await call('POST', '/payments/coupons', { ...T, body: { code: 'SUB3', type: 'percent', amount: 50, duration: 'repeating', durationCycles: 2, appliesTo: 'subscriptions' } });
await call('POST', '/payments/coupons', { ...T, body: { code: 'OLD', type: 'percent', amount: 10, expiresAt: '2020-01-01T00:00:00Z' } });
const preview = await call('GET', '/payments/coupons/preview?code=welcome20&subtotal=250', T);
check('coupon preview (case-insensitive)', preview.discount === 50 && preview.code === 'WELCOME20');
await call('GET', '/payments/coupons/preview?code=OLD&subtotal=10', { ...T, expect: 400 });
await call('GET', '/payments/coupons/preview?code=NOPE&subtotal=10', { ...T, expect: 404 });

// Coupon on an admin invoice + usage limit
const inv1 = await call('POST', '/payments/invoices', { ...T, body: { contactId: alice.id, couponCode: 'tenoff', items: [{ name: 'Audit', quantity: 1, unitPrice: 100 }] } });
check('fixed coupon applied to invoice', inv1.discount === 10 && inv1.total === 90 && inv1.couponCode === 'TENOFF');
await call('POST', '/payments/invoices', { ...T, body: { contactId: alice.id, couponCode: 'TENOFF', items: [{ name: 'Audit', quantity: 1, unitPrice: 100 }] }, expect: 400 }); // limit 1
await call('POST', '/payments/invoices', { ...T, body: { contactId: alice.id, couponCode: 'SUB3', items: [{ name: 'x', quantity: 1, unitPrice: 10 }] }, expect: 400 }); // subscriptions only
const updated = await call('PUT', `/payments/invoices/${inv1.id}`, { ...T, body: { items: [{ name: 'Audit', quantity: 1, unitPrice: 5 }] } });
check('fixed coupon re-capped when subtotal shrinks', updated.discount === 5 && updated.total === 0);

// Customer applies a coupon on the pay page
const inv2 = await call('POST', '/payments/invoices', { ...T, body: { contactId: alice.id, taxRate: 10, items: [{ name: 'Retainer', quantity: 2, unitPrice: 150 }] } });
await call('POST', `/payments/invoices/${inv2.id}/send`, T);
let pub = await call('GET', `/public/invoices/${inv2.publicToken}`);
check('pay page offers coupon entry', pub.canApplyCoupon === true && pub.total === 330);
await call('POST', `/public/invoices/${inv2.publicToken}/coupon`, { body: { code: 'OLD' }, expect: 400 });
await call('POST', `/public/invoices/${inv2.publicToken}/coupon`, { body: { code: 'WELCOME20' } });
pub = await call('GET', `/public/invoices/${inv2.publicToken}`);
check('public coupon applied (20% then tax)', pub.couponCode === 'WELCOME20' && pub.discount === 60 && pub.total === 264, `${pub.discount}/${pub.total}`);
await call('POST', `/public/invoices/${inv2.publicToken}/coupon`, { body: { code: 'WELCOME20' }, expect: 400 }); // one per invoice
const coupons = await call('GET', '/payments/coupons', T);
check('redemptions counted', coupons.find((c) => c.code === 'WELCOME20').redemptions === 1 && coupons.find((c) => c.code === 'TENOFF').redemptions === 1);

// ---- Subscriptions ----
await call('POST', '/automation/workflows', { ...T, body: { name: 'Overdue alert', triggerType: 'invoice.overdue', isPublished: true, steps: [{ type: 'add_tag', config: { tag: 'overdue' } }] } });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Churn', triggerType: 'subscription.canceled', isPublished: true, steps: [{ type: 'update_contact', config: { field: 'status', value: 'churned' } }] } });

const plan = await call('POST', '/payments/products', { ...T, body: { name: 'SEO Monthly', price: 200, interval: 'month' } });
const oneTime = await call('POST', '/payments/products', { ...T, body: { name: 'Setup', price: 99 } });
await call('POST', '/payments/subscriptions', { ...T, body: { contactId: alice.id, productId: oneTime.id }, expect: 400 });
await call('POST', '/payments/subscriptions', { ...T, body: { contactId: alice.id, productId: plan.id, couponCode: 'TENOFF' }, expect: 400 }); // used up

const t0 = Date.now();
const subA = await call('POST', '/payments/subscriptions', { ...T, body: { contactId: alice.id, productId: plan.id, quantity: 2, couponCode: 'SUB3', daysUntilDue: 3 } });
check('subscription active, first cycle billed now', subA.status === 'active' && subA.invoices.length === 1 && subA.cyclesBilled === 1);
check('cycle 1 discounted 50% (repeating x2)', subA.invoices[0].subtotal === 400 && subA.invoices[0].total === 200 && subA.invoices[0].status === 'sent', JSON.stringify(subA.invoices[0]));
check('next billing one month out', new Date(subA.nextBillingAt) > new Date(t0 + 27 * DAY));

const subB = await call('POST', '/payments/subscriptions', { ...T, body: { contactId: bob.id, name: 'Pro plan', price: 1200, interval: 'year', trialDays: 14 } });
check('trial subscription not billed yet', subB.status === 'trialing' && subB.invoices.length === 0);

const sum = await call('GET', '/payments/subscriptions/summary', T);
check('MRR excludes trials', sum.mrr.USD === 400 && sum.active === 1 && sum.trialing === 1, JSON.stringify(sum));

// Pay cycle 1, then convert the trial at day 15.
await call('POST', `/public/invoices/${subA.invoices[0].publicToken}/test-pay`);
await run(t0 + 15 * DAY);
const b = await call('GET', `/payments/subscriptions/${subB.id}`, T);
check('trial converted and billed yearly', b.status === 'active' && b.invoices.length === 1 && b.invoices[0].total === 1200 && b.interval === 'year', JSON.stringify({ s: b.status, n: b.invoices.length }));
await call('POST', `/payments/subscriptions/${subB.id}/cancel`, { ...T, body: { atPeriodEnd: false } });
check('immediate cancel', (await call('GET', `/payments/subscriptions/${subB.id}`, T)).status === 'canceled');
await call('POST', `/payments/invoices/${b.invoices[0].id}/void`, T); // keep it out of later overdue runs

// Jump ahead a month: cycle 2 still discounted, cycle 3 full price.
let r = await run(new Date(subA.nextBillingAt).getTime() + 1000);
check('billing run billed cycle 2', r.billed >= 1, JSON.stringify(r));
let a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('cycle 2 still 50% off', a.invoices.length === 2 && a.invoices[0].total === 200 && a.couponCyclesRemaining === 0);
await call('POST', `/public/invoices/${a.invoices[0].publicToken}/test-pay`);
r = await run(new Date(a.nextBillingAt).getTime() + 1000);
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('cycle 3 full price', a.invoices.length === 3 && a.invoices[0].total === 400 && a.invoices[0].couponCode === null);
const dueMs = new Date(a.invoices[0].dueDate + 'T00:00:00Z').getTime();
const again = await run(dueMs - DAY); // re-run before anything is due
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('no double billing, nothing overdue yet', a.invoices.length === 3 && again.billed === 0 && again.overdue === 0, JSON.stringify(again));

// Leave cycle 3 unpaid past its due date → overdue reminder, past_due, workflow tag
r = await run(dueMs + 2 * DAY);
check('overdue detected', r.overdue >= 1, JSON.stringify(r));
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('subscription past due', a.status === 'past_due');
await sleep(800);
const aliceNow = await call('GET', `/crm/contacts/${alice.id}`, T);
check('invoice.overdue workflow ran', aliceNow.tags.includes('overdue'));
r = await run(dueMs + 3 * DAY);
const thread = (await call('GET', `/inbox/conversations?search=alice-${rand}`, T))[0];
const msgs = (await call('GET', `/inbox/conversations/${thread.id}`, T)).messages;
check('exactly one overdue reminder', msgs.filter((m) => m.body.includes('was due on')).length === 1, String(msgs.filter((m) => m.body.includes('was due on')).length));
await call('POST', `/public/invoices/${a.invoices[0].publicToken}/test-pay`);
await sleep(800);
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('paying restores active', a.status === 'active');

// Cancel at period end → resume → cancel → period end finalizes + churn workflow
await call('POST', `/payments/subscriptions/${subA.id}/cancel`, { ...T, body: {} });
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('scheduled to cancel', a.cancelAtPeriodEnd === true && a.status === 'active');
await call('POST', `/payments/subscriptions/${subA.id}/resume`, T);
await call('POST', `/payments/subscriptions/${subA.id}/cancel`, { ...T, body: { atPeriodEnd: true } });
const before = (await call('GET', `/payments/subscriptions/${subA.id}`, T)).invoices.length;
await run(new Date(a.nextBillingAt).getTime() + 1000);
a = await call('GET', `/payments/subscriptions/${subA.id}`, T);
check('canceled at period end without a new invoice', a.status === 'canceled' && a.invoices.length === before);
await call('POST', `/payments/subscriptions/${subA.id}/resume`, { ...T, expect: 400 });
await sleep(800);
check('subscription.canceled workflow ran', (await call('GET', `/crm/contacts/${alice.id}`, T)).status === 'churned');


// Tenant isolation
const other = await call('POST', '/auth/register', { body: { email: `billing-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/payments/subscriptions/${subA.id}`, { token: other.accessToken, expect: 404 });
await call('GET', '/payments/coupons/preview?code=WELCOME20&subtotal=10', { token: other.accessToken, expect: 404 });
const otherRun = await call('POST', '/payments/billing/run', { token: other.accessToken, body: { at: iso(t0 + 400 * DAY) } });
check('billing run scoped to own workspace', otherRun.billed === 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
