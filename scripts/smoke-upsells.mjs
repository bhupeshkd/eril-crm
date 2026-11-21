// End-to-end checks for one-click post-purchase upsells on order forms.
// Usage: node scripts/smoke-upsells.mjs [baseUrl]   (API running in payments test mode; needs DB access via backend/.env)
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
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 400)); }
  return Object.assign(data ?? {}, { _status: res.status });
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `up-${rand}@test.local`, password: 'SmokeTest123!', name: 'Seller' } });
const T = { token: reg.accessToken };
const prod = (body) => call('POST', '/payments/products', { ...T, body });
const course = await prod({ name: 'Course', price: 100 });
const coaching = await prod({ name: 'Coaching call', price: 200 });
const pro = await prod({ name: 'Pro plan', price: 30, interval: 'month' });

await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [course.id], upsells: [{ productId: coaching.id, headline: ' ' }] }, expect: 400 });
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [course.id], upsells: [{ productId: '00000000-0000-4000-8000-000000000000', headline: 'x' }] }, expect: 400 });
const four = Array.from({ length: 4 }, () => ({ productId: coaching.id, headline: 'x' }));
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [course.id], upsells: four }, expect: 400 });

const form = await call('POST', '/payments/order-forms', { ...T, body: {
  name: 'Course launch', productIds: [course.id], taxRate: 10, thankYouMessage: 'All done!',
  upsells: [
    { productId: coaching.id, headline: 'Add a 1:1 coaching call?', description: '60 minutes with the author' },
    { productId: pro.id, headline: 'Join Pro for ongoing updates', acceptLabel: 'Yes, start Pro' },
  ],
} });
check('upsells saved with default labels', form.upsells?.length === 2 && form.upsells[0].declineLabel === 'No thanks' && form.upsells[1].acceptLabel === 'Yes, start Pro');

async function buy(who) {
  const o = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: who, email: `${who.toLowerCase()}-${rand}@ex.test`, productId: course.id } });
  return o.token;
}

// ---- Accept path ----
const t1 = await buy('Ava');
let inv = await call('GET', `/public/invoices/${t1}`);
check('no offer before payment', inv.offer === null && inv.thankYou === null);
await call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 0, accept: true }, expect: 409 });
await call('POST', `/public/invoices/${t1}/test-pay`);
inv = await call('GET', `/public/invoices/${t1}`);
check('first offer shown instead of thank-you', inv.offer?.index === 0 && inv.offer.product.price === 200 && inv.offer.taxRate === 10 && inv.thankYou === null);
check('offer leaks no ids', !('productId' in inv.offer) && !('id' in inv.offer.product));
await call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 1, accept: true }, expect: 409 }); // can't skip ahead
let r = await call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 0, accept: true } });
check('one-click accept charges immediately', r.status === 'paid');
inv = await call('GET', `/public/invoices/${t1}`);
check('second offer next', inv.offer?.index === 1 && inv.offer.acceptLabel === 'Yes, start Pro');
// Double-click on "accept": exactly one wins
const [x, y] = await Promise.all([
  call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 1, accept: true }, expect: [201, 409] }),
  call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 1, accept: true }, expect: [201, 409] }),
]);
check('double submit charges once', [x._status, y._status].sort().join() === '201,409', `${x._status},${y._status}`);
inv = await call('GET', `/public/invoices/${t1}`);
check('thank-you after the last offer', inv.offer === null && inv.thankYou?.message === 'All done!');
await call('POST', `/public/order-forms/upsell/${t1}`, { body: { index: 1, accept: false }, expect: 409 });

await sleep(1500);
const ava = (await call('GET', `/crm/contacts?search=ava-${rand}`, T)).items[0];
const avaInvs = (await call('GET', '/payments/invoices', T)).filter((i) => i.contactId === ava.id);
check('three paid invoices: order + 2 upsells', avaInvs.length === 3 && avaInvs.every((i) => i.status === 'paid'), String(avaInvs.length));
const coach = avaInvs.find((i) => i.items[0].name === 'Coaching call');
check('upsell taxed like the form', coach?.total === 220);
const subs = await call('GET', '/payments/subscriptions', T);
check('recurring upsell started a subscription', subs.length === 1 && subs[0].contactId === ava.id && subs[0].productId === pro.id);

// ---- Decline path + inactive offer skipped ----
const t2 = await buy('Ben');
await call('POST', `/public/invoices/${t2}/test-pay`);
r = await call('POST', `/public/order-forms/upsell/${t2}`, { body: { index: 0, accept: false } });
check('decline', r.status === 'declined');
inv = await call('GET', `/public/invoices/${t2}`);
check('decline moves to next offer', inv.offer?.index === 1);
await call('PUT', `/payments/products/${coaching.id}`, { ...T, body: { isActive: false } });
const t3 = await buy('Cal');
await call('POST', `/public/invoices/${t3}/test-pay`);
inv = await call('GET', `/public/invoices/${t3}`);
check('offer with inactive product is skipped', inv.offer?.index === 1, String(inv.offer?.index));
await call('PUT', `/payments/products/${coaching.id}`, { ...T, body: { isActive: true } });

// ---- Offer window closes 30 minutes after payment ----
const db = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
await db.connect();
await db.query(`UPDATE invoices SET paid_at = now() - interval '31 minutes' WHERE public_token = $1`, [t2]);
await db.end();
inv = await call('GET', `/public/invoices/${t2}`);
check('expired offer not shown; thank-you instead', inv.offer === null && inv.thankYou?.message === 'All done!');
await call('POST', `/public/order-forms/upsell/${t2}`, { body: { index: 1, accept: true }, expect: 409 });

// ---- Stats & lists ----
const row = (await call('GET', '/payments/order-forms', T)).find((f) => f.id === form.id);
check('stats split orders and upsells', row.orders === 3 && row.paid === 3 && row.upsellsPaid === 2 && row.upsellRevenue === 253 && row.revenue === 583, JSON.stringify({ o: row.orders, p: row.paid, u: row.upsellsPaid, ur: row.upsellRevenue, r: row.revenue }));
const orders = await call('GET', `/payments/order-forms/${form.id}/orders`, T);
check('orders list marks upsells', orders.filter((o) => o.parentInvoiceId).length === 2);
await call('POST', '/public/order-forms/upsell/not-a-real-token', { body: { index: 0, accept: true }, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
