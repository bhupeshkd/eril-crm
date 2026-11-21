// End-to-end checks for order forms (hosted checkout with order bump, coupons, subscriptions).
// Usage: node scripts/smoke-order-forms.mjs [baseUrl]   (API must be running in payments test mode)
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

const reg = await call('POST', '/auth/register', { body: { email: `of-${rand}@test.local`, password: 'SmokeTest123!', name: 'Seller' } });
const T = { token: reg.accessToken };
const prod = (body) => call('POST', '/payments/products', { ...T, body });
const course = await prod({ name: 'Course', price: 100, currency: 'USD' });
const pro = await prod({ name: 'Pro plan', price: 30, currency: 'USD', interval: 'month' });
const guide = await prod({ name: 'Guide', price: 19, currency: 'USD' });
const euro = await prod({ name: 'Euro thing', price: 10, currency: 'EUR' });

// ---- Validation ----
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Mixed', productIds: [course.id, euro.id] }, expect: 400 });
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad bump', productIds: [course.id], bump: { productId: pro.id, headline: 'Add' } }, expect: 400 });
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad url', productIds: [course.id], redirectUrl: 'javascript:alert(1)' }, expect: 400 });
const other = await call('POST', '/auth/register', { body: { email: `of-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
const foreign = await call('POST', '/payments/products', { token: other.accessToken, body: { name: 'Theirs', price: 5 } });
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Foreign', productIds: [foreign.id] }, expect: 400 });

const form = await call('POST', '/payments/order-forms', { ...T, body: {
  name: 'Launch offer', headline: 'Get the course', productIds: [course.id, pro.id],
  bump: { productId: guide.id, headline: 'Add the guide for $19', description: 'Printable checklists' },
  taxRate: 10, tags: ['Buyer'], redirectUrl: 'https://example.com/welcome', thankYouMessage: 'Check your inbox!',
} });
check('form saved with clean tags', form.slug && form.tags[0] === 'buyer' && form.bump?.productId === guide.id);

await call('POST', '/automation/workflows', { ...T, body: { name: 'Ordered', triggerType: 'order.submitted', triggerConfig: { formId: form.id }, isPublished: true, steps: [{ type: 'add_tag', config: { tag: 'ordered' } }] } });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Paid', triggerType: 'order.paid', isPublished: true, steps: [{ type: 'add_tag', config: { tag: 'paid-order' } }] } });
await call('POST', '/payments/coupons', { ...T, body: { code: `SAVE${rand}`, type: 'percent', amount: 10 } });

// ---- Public page ----
const info = await call('GET', `/public/order-forms/${form.slug}`);
check('public form: products, bump, currency', info.products.length === 2 && info.bump?.price === 19 && info.currency === 'USD' && info.headline === 'Get the course');
check('no internal ids leak beyond products', !('workspaceId' in info) && !('tags' in info));
const quote = await call('POST', `/public/order-forms/${form.slug}/coupon`, { body: { code: `save${rand}`, productId: course.id, bump: true } });
check('coupon quote: 119 - 11.90 + 10% tax', quote.subtotal === 119 && quote.discount === 11.9 && quote.tax === 10.71 && quote.total === 117.81, JSON.stringify(quote));
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'X', email: `x-${rand}@ex.test`, productId: guide.id }, expect: 400 }); // bump isn't a main option

// ---- One-time order with bump + coupon ----
const order = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'Dana Buyer', email: `dana-${rand}@ex.test`, productId: course.id, bump: true, couponCode: `SAVE${rand}` } });
let inv = await call('GET', `/public/invoices/${order.token}`);
check('order invoice open with both items', inv.status === 'sent' && inv.items.length === 2 && inv.total === 117.81 && inv.couponCode === `SAVE${rand}`.toUpperCase(), JSON.stringify({ s: inv.status, t: inv.total }));
check('no thank-you before payment', inv.thankYou === null);
const co = await call('POST', `/public/invoices/${order.token}/checkout`);
check('test-mode checkout', co.mode === 'test');
await call('POST', `/public/invoices/${order.token}/test-pay`);
inv = await call('GET', `/public/invoices/${order.token}`);
check('thank-you after payment', inv.status === 'paid' && inv.thankYou?.message === 'Check your inbox!' && inv.thankYou?.redirectUrl === 'https://example.com/welcome');
await sleep(1200);
const dana = (await call('GET', `/crm/contacts?search=dana-${rand}`, T)).items[0];
check('buyer contact tagged + workflows fired', dana?.source === 'order_form' && ['buyer', 'ordered', 'paid-order'].every((t) => dana.tags.includes(t)), JSON.stringify(dana?.tags));

// ---- Recurring product: first period now, subscription afterwards ----
const subOrder = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'Sam Sub', email: `sam-${rand}@ex.test`, productId: pro.id } });
inv = await call('GET', `/public/invoices/${subOrder.token}`);
check('recurring order charges first month', inv.total === 33 && /first month/.test(inv.items[0].name), `${inv.total} ${inv.items[0].name}`);
let subs = await call('GET', '/payments/subscriptions', T);
check('no subscription before payment', subs.length === 0);
await call('POST', `/public/invoices/${subOrder.token}/test-pay`);
await sleep(1500);
subs = await call('GET', '/payments/subscriptions', T);
const sam = (await call('GET', `/crm/contacts?search=sam-${rand}`, T)).items[0];
const days = subs[0] ? (new Date(subs[0].nextBillingAt) - Date.now()) / 864e5 : 0;
check('subscription starts after payment, next bill in ~1 month', subs.length === 1 && subs[0].contactId === sam.id && subs[0].productId === pro.id && days > 27 && days < 32, `${subs.length} ${days.toFixed(1)}`);
const invs = await call('GET', '/payments/invoices', T);
check('no duplicate invoice for the paid first period', invs.filter((i) => i.contactId === sam.id).length === 1);

// ---- Admin views ----
const list = await call('GET', '/payments/order-forms', T);
const row = list.find((f) => f.id === form.id);
check('form stats', row.orders === 2 && row.paid === 2 && row.revenue === 150.81 && row.views >= 1, JSON.stringify({ o: row.orders, p: row.paid, r: row.revenue, v: row.views }));
const orders = await call('GET', `/payments/order-forms/${form.id}/orders`, T);
check('orders list', orders.length === 2 && orders.every((o) => o.orderFormId === form.id));

// ---- Coupons off / form off / isolation ----
await call('PUT', `/payments/order-forms/${form.id}`, { ...T, body: { allowCoupons: false } });
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'C', email: `c-${rand}@ex.test`, productId: course.id, couponCode: `SAVE${rand}` }, expect: 400 });
await call('PUT', `/payments/order-forms/${form.id}`, { ...T, body: { isActive: false } });
await call('GET', `/public/order-forms/${form.slug}`, { expect: 404 });
await call('GET', `/payments/order-forms/${form.id}`, { token: other.accessToken, expect: 404 });
await call('GET', `/payments/order-forms/${form.id}/orders`, { token: other.accessToken, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
