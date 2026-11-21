// End-to-end checks for downsells (cheaper fallback offered when an upsell is declined).
// Usage: node scripts/smoke-downsells.mjs [baseUrl]   (API running in payments test mode)
// Takes ~1 minute: it waits out the 10-requests-a-minute limit on the offer endpoint halfway through.
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

const reg = await call('POST', '/auth/register', { body: { email: `dn-${rand}@test.local`, password: 'SmokeTest123!', name: 'Seller' } });
const T = { token: reg.accessToken };
const prod = (body) => call('POST', '/payments/products', { ...T, body });
const course = await prod({ name: 'Course', price: 100 });
const coaching = await prod({ name: 'Coaching call', price: 200 });
const group = await prod({ name: 'Group coaching', price: 50 });
const pro = await prod({ name: 'Pro plan', price: 30, interval: 'month' });

await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [course.id], upsells: [{ productId: coaching.id, headline: 'x', downsell: { productId: group.id, headline: ' ' } }] }, expect: 400 });
await call('POST', '/payments/order-forms', { ...T, body: { name: 'Bad', productIds: [course.id], upsells: [{ productId: coaching.id, headline: 'x', downsell: { productId: '00000000-0000-4000-8000-000000000000', headline: 'y' } }] }, expect: 400 });
const form = await call('POST', '/payments/order-forms', { ...T, body: {
  name: 'Launch', productIds: [course.id], taxRate: 10, thankYouMessage: 'Done!',
  upsells: [
    { productId: coaching.id, headline: '1:1 coaching?', downsell: { productId: group.id, headline: 'Join group coaching instead?' } },
    { productId: pro.id, headline: 'Go Pro?' },
  ],
} });
check('downsell saved with default labels', form.upsells[0].downsell?.acceptLabel === 'Yes, I’ll take this instead' && form.upsells[1].downsell === null);

async function paidOrder(who) {
  const o = await call('POST', `/public/order-forms/${form.slug}/order`, { body: { name: who, email: `${who.toLowerCase()}-${rand}@ex.test`, productId: course.id } });
  await call('POST', `/public/invoices/${o.token}/test-pay`);
  return o.token;
}
const offerOf = async (t) => (await call('GET', `/public/invoices/${t}`)).offer;
const answer = (t, body, expect) => call('POST', `/public/order-forms/upsell/${t}`, { body, expect });

// ---- A: decline upsell → downsell → accept; then next upsell ----
const a = await paidOrder('Ava');
let o = await offerOf(a);
check('first offer is the upsell', o.kind === 'upsell' && o.index === 0);
await answer(a, { index: 0, kind: 'downsell', accept: true }, 409); // no downsell before declining
await answer(a, { index: 0, accept: false });
o = await offerOf(a);
check('declining shows the downsell', o?.kind === 'downsell' && o.index === 0 && o.product.price === 50 && o.headline === 'Join group coaching instead?');
await answer(a, { index: 1, accept: true }, 409); // can't skip past the downsell
let r = await answer(a, { index: 0, kind: 'downsell', accept: true });
check('downsell charged in one click', r.status === 'paid');
await answer(a, { index: 0, kind: 'downsell', accept: true }, 409);
o = await offerOf(a);
check('then the next upsell', o?.kind === 'upsell' && o.index === 1);
await answer(a, { index: 1, accept: false });
let inv = await call('GET', `/public/invoices/${a}`);
check('no downsell for an offer without one; thank-you', inv.offer === null && inv.thankYou?.message === 'Done!' && inv.addOns.length === 1 && inv.addOns[0].name === 'Group coaching' && inv.addOns[0].total === 55);

// ---- B: accepting the upsell skips its downsell ----
const b = await paidOrder('Ben');
await answer(b, { index: 0, accept: true });
o = await offerOf(b);
check('accepted upsell: no downsell', o?.kind === 'upsell' && o.index === 1);

await sleep(61_000); // offer endpoint allows 10 requests a minute per IP

// ---- C: decline both ----
const c = await paidOrder('Cal');
await answer(c, { index: 0, accept: false });
r = await answer(c, { index: 0, kind: 'downsell', accept: false });
o = await offerOf(c);
check('declined downsell moves on', r.status === 'declined' && o?.kind === 'upsell' && o.index === 1);

// ---- D: inactive downsell product is skipped ----
await call('PUT', `/payments/products/${group.id}`, { ...T, body: { isActive: false } });
const d = await paidOrder('Dee');
await answer(d, { index: 0, accept: false });
o = await offerOf(d);
check('inactive downsell skipped', o?.kind === 'upsell' && o.index === 1, JSON.stringify(o && { k: o.kind, i: o.index }));
await call('PUT', `/payments/products/${group.id}`, { ...T, body: { isActive: true } });

// ---- E: double-click on decline ----
const e = await paidOrder('Eve');
const [x, y] = await Promise.all([answer(e, { index: 0, accept: false }, [201, 409]), answer(e, { index: 0, accept: false }, [201, 409])]);
check('double decline: exactly one wins', [x._status, y._status].sort().join() === '201,409', `${x._status},${y._status}`);
o = await offerOf(e);
check('downsell shown once', o?.kind === 'downsell');

// ---- Stats & orders list ----
const row = (await call('GET', '/payments/order-forms', T)).find((f) => f.id === form.id);
check('stats count downsells', row.upsellsPaid === 2 && row.downsellsPaid === 1, JSON.stringify({ u: row.upsellsPaid, d: row.downsellsPaid }));
const orders = await call('GET', `/payments/order-forms/${form.id}/orders`, T);
check('orders list marks the downsell', orders.filter((x) => x.upsellKind === 'downsell').length === 1 && orders.filter((x) => x.upsellKind === 'upsell').length === 1);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
