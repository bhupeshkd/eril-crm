// End-to-end checks for quantities on order forms.
// Usage: node scripts/smoke-quantities.mjs [baseUrl]   (API running in payments test mode)
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

const reg = await call('POST', '/auth/register', { body: { email: `qt-${rand}@test.local`, password: 'SmokeTest123!', name: 'Seller' } });
const T = { token: reg.accessToken };
const prod = (body) => call('POST', '/payments/products', { ...T, body });
const tickets = await prod({ name: 'Workshop ticket', price: 100 });
const guide = await prod({ name: 'Guide', price: 19 });
const seats = await prod({ name: 'Team seat', price: 30, interval: 'month' });
await call('POST', '/payments/coupons', { ...T, body: { code: `Q${rand}`, type: 'percent', amount: 10 } });

// ---- Quantities off by default ----
const single = await call('POST', '/payments/order-forms', { ...T, body: { name: 'Single', productIds: [tickets.id] } });
check('quantity off by default', single.allowQuantity === false && single.maxQuantity === 10);
const sInfo = await call('GET', `/public/order-forms/${single.slug}`);
check('public form reports max 1 when off', sInfo.allowQuantity === false && sInfo.maxQuantity === 1);
await call('POST', `/public/order-forms/${single.slug}/order`, { body: { name: 'A', email: `a-${rand}@ex.test`, productId: tickets.id, quantity: 2 }, expect: 400 });

// ---- Quantities on ----
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [tickets.id], allowQuantity: true, maxQuantity: 101 }, expect: 400 });
const form = await call('POST', '/payments/order-forms', { ...T, body: {
  name: 'Workshop', productIds: [tickets.id, seats.id], allowQuantity: true, maxQuantity: 5, taxRate: 10,
  bump: { productId: guide.id, headline: 'Add the guide' },
} });
const info = await call('GET', `/public/order-forms/${form.slug}`);
check('public form reports the limit', info.allowQuantity === true && info.maxQuantity === 5);
const quote = await call('POST', `/public/order-forms/${form.slug}/coupon`, { body: { code: `Q${rand}`, productId: tickets.id, quantity: 3, bump: true } });
check('coupon quote uses quantity: 3x100 + 19, -10%, +10% tax', quote.subtotal === 319 && quote.discount === 31.9 && quote.tax === 28.71 && quote.total === 315.81, JSON.stringify(quote));
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'B', email: `b-${rand}@ex.test`, productId: tickets.id, quantity: 6 }, expect: 400 });
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'B', email: `b-${rand}@ex.test`, productId: tickets.id, quantity: 0 }, expect: 400 });
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'B', email: `b-${rand}@ex.test`, productId: tickets.id, quantity: 1.5 }, expect: 400 });
const order = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'Bea Buyer', email: `bea-${rand}@ex.test`, productId: tickets.id, quantity: 3, bump: true, couponCode: `Q${rand}` } });
let inv = await call('GET', `/public/invoices/${order.token}`);
check('invoice has the quantity; bump stays at 1', inv.items[0].quantity === 3 && inv.items[1].quantity === 1 && inv.total === 315.81, JSON.stringify(inv.items.map((i) => i.quantity)));

// ---- Recurring product: subscription quantity ----
const sub = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'Team Lead', email: `lead-${rand}@ex.test`, productId: seats.id, quantity: 4 } });
inv = await call('GET', `/public/invoices/${sub.token}`);
check('first month for 4 seats', inv.items[0].quantity === 4 && inv.total === 132, String(inv.total));
await call('POST', `/public/invoices/${sub.token}/test-pay`);
await sleep(1500);
const subs = await call('GET', '/payments/subscriptions', T);
check('subscription carries the quantity', subs.length === 1 && subs[0].quantity === 4 && subs[0].productId === seats.id, JSON.stringify(subs.map((s) => s.quantity)));

// ---- Turning quantities off again ----
await call('PUT', `/payments/order-forms/${form.id}`, { ...T, body: { allowQuantity: false } });
await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: 'C', email: `c-${rand}@ex.test`, productId: tickets.id, quantity: 2 }, expect: 400 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
