// End-to-end checks for text-to-pay (payment links by SMS/email, with receipts).
// Usage: node scripts/smoke-text-to-pay.mjs [baseUrl]   (API running in payments test mode, console SMS/email)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);

const reg = await call('POST', '/auth/register', { body: { email: `tp-${rand}@test.local`, password: 'SmokeTest123!', name: 'Owner' } });
const T = { token: reg.accessToken };
const rosa = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Rosa', email: `rosa-${rand}@ex.test`, phone: '+15550001111' } });
const sam = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Sam', email: `sam-${rand}@ex.test` } });
const dee = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Dee', phone: '+15550002222' } });
await call('PUT', `/crm/contacts/${dee.id}`, { ...T, body: { dnd: true } });
const clean = await call('POST', '/payments/products', { ...T, body: { name: 'Window clean', price: 45 } });
const monthly = await call('POST', '/payments/products', { ...T, body: { name: 'Monthly plan', price: 30, interval: 'month' } });

async function thread(contact, channel) {
  const convs = await call('GET', `/inbox/conversations?search=${encodeURIComponent(contact.firstName)}`, T);
  const conv = convs.find((c) => c.contactId === contact.id && c.channel === channel);
  return conv ? (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.filter((m) => m.direction === 'outbound') : [];
}

// ---- Validation ----
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: rosa.id, amount: 0, description: 'x' }, expect: 400 });
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: rosa.id, amount: 20 }, expect: 400 });
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: sam.id, channel: 'sms', amount: 20, description: 'x' }, expect: 400 });
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: dee.id, amount: 20, description: 'x' }, expect: 400 });
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: rosa.id, productId: monthly.id }, expect: 400 });
const other = await call('POST', '/auth/register', { body: { email: `tp-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('POST', '/payments/text-to-pay', { token: other.accessToken, body: { contactId: rosa.id, amount: 20, description: 'x' }, expect: 404 });
const theirs = await call('POST', '/payments/products', { token: other.accessToken, body: { name: 'Theirs', price: 5 } });
await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: rosa.id, productId: theirs.id }, expect: 404 });
check('failed requests left no invoices', (await call('GET', '/payments/invoices', T)).length === 0);

// ---- Custom amount by SMS (default channel when there is a phone) ----
const r1 = await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: rosa.id, amount: 120, description: 'Deep clean, 14 Nov' } });
check('invoice created and sent by SMS', r1.invoice.total === 120 && r1.message.channel === 'sms' && r1.message.status === 'sent');
let sms = await thread(rosa, 'sms');
const token = r1.invoice.link.split('/invoice/')[1];
check('SMS has amount, description and the pay link', sms.length === 1 && sms[0].body.includes('$120.00') && sms[0].body.includes('Deep clean, 14 Nov') && sms[0].body.includes(`/invoice/${token}`), sms[0]?.body);
let pub = await call('GET', `/public/invoices/${token}`);
check('pay page is open', pub.status === 'sent' && pub.total === 120);

// ---- Receipt on payment, once ----
await call('POST', `/public/invoices/${token}/test-pay`);
await call('POST', `/public/invoices/${token}/test-pay`);
await sleep(1200);
sms = await thread(rosa, 'sms');
const receipts = sms.filter((m) => m.body.includes('We received your payment'));
check('one receipt by SMS', receipts.length === 1 && receipts[0].body.includes('$120.00') && receipts[0].body.includes(`/invoice/${token}`), String(receipts.length));

// ---- Product by email (default when no phone), custom message without a link ----
const r2 = await call('POST', '/payments/text-to-pay', { ...T, body: { contactId: sam.id, productId: clean.id, quantity: 2, message: 'Hi {{name}}! Your {{description}} total is {{amount}}.' } });
check('product x2 by email', r2.invoice.total === 90 && r2.message.channel === 'email');
const mail = await thread(sam, 'email');
check('custom message filled; link appended', mail[0]?.body.startsWith('Hi Sam! Your 2 × Window clean total is $90.00.') && mail[0].body.includes('/invoice/'), mail[0]?.body);

// ---- Listed with its source ----
const invs = await call('GET', '/payments/invoices', T);
check('invoices marked text-to-pay', invs.length === 2 && invs.every((i) => i.source === 'text_to_pay') && invs.find((i) => i.id === r1.invoice.id).requestChannel === 'sms' && invs.find((i) => i.id === r1.invoice.id).status === 'paid');

// ---- A manually paid text-to-pay invoice also gets a receipt ----
await call('POST', `/payments/invoices/${r2.invoice.id}/mark-paid`, { ...T, body: {} });
await sleep(1200);
check('receipt by email after marking paid', (await thread(sam, 'email')).some((m) => m.body.includes('We received your payment of $90.00')));

// ---- Regular invoices get no text-to-pay receipt ----
const plain = await call('POST', '/payments/invoices', { ...T, body: { contactId: rosa.id, items: [{ name: 'Misc', quantity: 1, unitPrice: 10 }] } });
await call('POST', `/payments/invoices/${plain.id}/mark-paid`, { ...T, body: {} });
await sleep(1000);
check('no receipt for ordinary invoices', (await thread(rosa, 'sms')).filter((m) => m.body.includes('We received your payment')).length === 1);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
