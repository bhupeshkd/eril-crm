// End-to-end checks for the GHL-parity batch: CRM extras, calendars, forms,
// payments, campaigns and the new workflow triggers/actions.
// Usage: node scripts/smoke-ghl.mjs [baseUrl]   (API must be running)
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
  try { data = text ? JSON.parse(text) : null; } catch { /* csv */ }
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

const reg = await call('POST', '/auth/register', { body: { email: `ghl-${rand}@test.local`, password: 'SmokeTest123!', name: 'GHL Tester' } });
const token = reg.accessToken;
const T = { token };

// ---- CRM extras ----
await call('POST', '/crm/custom-fields', { ...T, body: { label: 'Budget', type: 'number' } });
await call('POST', '/crm/custom-fields', { ...T, body: { label: 'Budget', type: 'number' }, expect: 409 });
const fields = await call('GET', '/crm/custom-fields', T);
check('custom field key derived', fields[0]?.key === 'budget');
const imp = await call('POST', '/crm/contacts/import', { ...T, body: {
  rows: [
    { 'First Name': 'Ann', 'Last Name': 'Lee', Email: 'ann@ex.test', Company: 'Acme', Tags: 'a;b' },
    { Name: 'Bo Diaz', email: 'bo@ex.test' },
    { Email: 'ANN@ex.test', Phone: '+15550000' },
    { Notes: 'nothing useful' },
  ], tags: ['imported'] } });
check('import created/updated/errors', imp.created === 2 && imp.updated === 1 && imp.errors.length === 1, JSON.stringify(imp));
const list = await call('GET', '/crm/contacts?tag=imported', T);
const ann = list.items.find((c) => c.email === 'ann@ex.test');
check('import merged phone onto existing', ann?.phone === '+15550000' && ann.tags.includes('a'));
const csv = await call('GET', '/crm/contacts/export', T);
check('csv export has header + rows', typeof csv === 'string' && csv.startsWith('first_name') && csv.split('\n').length === 3);
await call('POST', '/crm/contacts/bulk', { ...T, body: { ids: list.items.map((c) => c.id), action: 'add_tag', value: 'bulk' } });
const tagged = await call('GET', '/crm/contacts?tag=bulk', T);
check('bulk add tag', tagged.total === 2);
await call('PUT', `/crm/contacts/${ann.id}`, { ...T, body: { customFields: { budget: 5000 } } });
await call('POST', `/crm/contacts/${ann.id}/notes`, { ...T, body: { body: 'Called, wants a demo' } });
const notes = await call('GET', `/crm/contacts/${ann.id}/notes`, T);
check('note saved', notes.length === 1);
const task = await call('POST', '/crm/tasks', { ...T, body: { title: 'Send proposal', contactId: ann.id, dueAt: new Date(Date.now() - 3600e3).toISOString() } });
const overdue = await call('GET', '/crm/tasks?status=overdue', T);
check('overdue task listed', overdue.some((t) => t.id === task.id));

// ---- Workflows on new triggers, with wait + create_task ----
const wfForm = await call('POST', '/automation/workflows', { ...T, body: {
  name: 'Form follow-up', triggerType: 'form.submitted', isPublished: true,
  steps: [
    { type: 'add_tag', config: { tag: 'form-lead' } },
    { type: 'create_task', config: { title: 'Call {{contact.firstName}}', dueInDays: 1 } },
    { type: 'wait', config: { amount: 0, unit: 'minutes' } },
    { type: 'add_note', config: { body: 'Submitted: {{submission.message}}' } },
  ] } });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Paid thanks', triggerType: 'invoice.paid', isPublished: true,
  steps: [{ type: 'add_tag', config: { tag: 'paid-customer' } }, { type: 'update_contact', config: { field: 'status', value: 'customer' } }] } });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Booked', triggerType: 'appointment.booked', isPublished: true,
  steps: [{ type: 'add_tag', config: { tag: 'booked' } }] } });

// ---- Forms ----
const form = await call('POST', '/forms', { ...T, body: { name: 'Contact us', settings: { tags: ['website'], successMessage: 'Got it!' } } });
check('form has default fields + public url', form.fields.length === 5 && !!form.slug);
await call('POST', '/forms', { ...T, body: { name: 'bad', fields: [{ key: 'x', label: 'X', type: 'select' }] }, expect: 400 });
const pub = await call('GET', `/public/forms/${form.slug}`);
check('public form hides settings', pub.fields.length === 5 && pub.settings.tags === undefined);
const bad = await call('POST', `/public/forms/${form.slug}/submit`, { body: { data: { first_name: 'Zed', email: 'not-an-email' } }, expect: 400 });
check('form validation errors', !!bad?.errors?.email);
const ok = await call('POST', `/public/forms/${form.slug}/submit`, { body: { data: { first_name: 'Zed', last_name: 'Ray', email: 'zed@ex.test', message: 'Need SEO' } } });
check('form success message', ok.message === 'Got it!');
await sleep(16000 + 1500); // wait step resumes on the 15s scheduler tick
const zed = (await call('GET', '/crm/contacts?search=zed@ex.test', T)).items[0];
check('form created contact with tags', zed && zed.tags.includes('website') && zed.tags.includes('form-lead') && zed.source.startsWith('form'), JSON.stringify(zed?.tags));
const zedTasks = await call('GET', `/crm/tasks?contactId=${zed?.id}`, T);
check('workflow created task', zedTasks.some((t) => t.title === 'Call Zed'));
const zedNotes = await call('GET', `/crm/contacts/${zed?.id}/notes`, T);
check('note added after wait resumed', zedNotes.some((n) => n.body === 'Submitted: Need SEO'));
const runs = await call('GET', `/automation/workflows/${wfForm.id}/runs`, T);
check('run succeeded after wait', runs[0]?.status === 'succeeded', runs[0]?.status);
const subs = await call('GET', `/forms/${form.id}/submissions`, T);
check('submission stored', subs.length === 1 && subs[0].data.message === 'Need SEO');

// ---- Calendars ----
const cal = await call('POST', '/calendars', { ...T, body: {
  name: 'Discovery call', durationMinutes: 30, timezone: 'Asia/Kolkata', minNoticeHours: 0,
  availability: { 0: [{ start: '00:00', end: '23:30' }], 1: [{ start: '00:00', end: '23:30' }], 2: [{ start: '00:00', end: '23:30' }], 3: [{ start: '00:00', end: '23:30' }], 4: [{ start: '00:00', end: '23:30' }], 5: [{ start: '00:00', end: '23:30' }], 6: [{ start: '00:00', end: '23:30' }] } } });
await call('POST', '/calendars', { ...T, body: { name: 'x', timezone: 'Mars/Base' }, expect: 400 });
const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
const slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${tomorrow}`);
check('slots generated', slots.length > 10, String(slots.length));
const booking = await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: slots[0], name: 'Pat Doe', email: 'pat@ex.test' } });
check('booking returns local time', !!booking.startLocal);
await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: slots[0], name: 'Sam', email: 'sam@ex.test' }, expect: 409 });
const slots2 = await call('GET', `/public/calendars/${cal.slug}/slots?date=${tomorrow}`);
check('booked slot removed', !slots2.includes(slots[0]));
await sleep(1000);
const appts = await call('GET', `/calendars/appointments?calendarId=${cal.id}`, T);
check('appointment listed', appts.length === 1 && appts[0].source === 'booking_page');
await call('PUT', `/calendars/appointments/${appts[0].id}`, { ...T, body: { status: 'showed' } });
const pat = (await call('GET', '/crm/contacts?search=pat@ex.test', T)).items[0];
check('booking created contact + booked tag', pat?.source === 'booking' && pat.tags.includes('booked'));

// ---- Payments ----
const prod = await call('POST', '/payments/products', { ...T, body: { name: 'SEO package', price: 499.99 } });
const inv = await call('POST', '/payments/invoices', { ...T, body: { contactId: pat.id, taxRate: 10, discount: 50, items: [
  { productId: prod.id, name: prod.name, quantity: 2, unitPrice: 499.99 }, { name: 'Setup', quantity: 1, unitPrice: 100 }] } });
check('invoice totals', inv.subtotal === 1099.98 && inv.tax === 105 && inv.total === 1154.98 && inv.number === 'INV-0001', `${inv.subtotal}/${inv.tax}/${inv.total}`);
await call('GET', `/public/invoices/${inv.publicToken}`, { expect: 404 }); // drafts are private
const sent = await call('POST', `/payments/invoices/${inv.id}/send`, T);
check('invoice sent with link', sent.status === 'sent' && sent.link.includes(inv.publicToken));
const pubInv = await call('GET', `/public/invoices/${inv.publicToken}`);
check('public invoice', pubInv.total === 1154.98 && pubInv.billedTo === 'Pat Doe');
const co = await call('POST', `/public/invoices/${inv.publicToken}/checkout`);
check('checkout in test mode', co.mode === 'test');
await call('POST', `/public/invoices/${inv.publicToken}/test-pay`);
await sleep(1000);
const patAfter = await call('GET', `/crm/contacts/${pat.id}`, T);
check('invoice.paid workflow ran', patAfter.tags.includes('paid-customer') && patAfter.status === 'customer');
const summary = await call('GET', '/payments/summary', T);
check('payments summary', summary.paid === 1154.98);
await call('PUT', `/payments/invoices/${inv.id}`, { ...T, body: { notes: 'x' }, expect: 400 });

// ---- Campaigns ----
await call('PUT', `/crm/contacts/${zed.id}`, { ...T, body: { dnd: true } });
const size = await call('POST', '/campaigns/audience-size', { ...T, body: { tags: ['website', 'imported'] } });
check('audience excludes DND', size.count === 2, String(size.count)); // ann + bo; zed is DND
const camp = await call('POST', '/campaigns', { ...T, body: { name: 'Promo', subject: 'Hi {{contact.firstName}}', body: 'Big sale', audience: { tags: ['imported'] } } });
await call('POST', `/campaigns/${camp.id}/send`, { ...T, body: {} });
await sleep(1500);
const campAfter = await call('GET', `/campaigns/${camp.id}`, T);
check('campaign sent', campAfter.status === 'sent' && campAfter.stats.sent === 2, JSON.stringify(campAfter.stats));
const annThread = (await call('GET', '/inbox/conversations?search=ann@ex.test', T))[0];
const annMsgs = await call('GET', `/inbox/conversations/${annThread.id}`, T);
const unsubUrl = annMsgs.messages.at(-1).body.match(/unsubscribe\?c=([\w-]+)&t=([\w-]+)/);
check('campaign email has unsubscribe link', !!unsubUrl);
await call('POST', '/public/unsubscribe', { body: { c: unsubUrl[1], t: 'forged' }, expect: 400 });
await call('POST', '/public/unsubscribe', { body: { c: unsubUrl[1], t: unsubUrl[2] } });
check('unsubscribe sets DND', (await call('GET', `/crm/contacts/${ann.id}`, T)).dnd === true);

// ---- Webhook SSRF guard ----
const hook = await call('POST', '/automation/workflows', { ...T, body: { name: 'hook', steps: [{ type: 'webhook', config: { url: 'http://127.0.0.1:5432/' } }] } });
const hookRun = await call('POST', `/automation/workflows/${hook.id}/trigger`, { ...T, body: {} });
check('webhook to private IP blocked', hookRun.status === 'failed' && /private/.test(hookRun.error), hookRun.error);

const dash = await call('GET', '/dashboard/stats', T);
check('dashboard extras', dash.invoiceRevenue === 1154.98 && dash.openTasks >= 2, JSON.stringify({ r: dash.invoiceRevenue, t: dash.openTasks }));

// ---- Tenant isolation on public + private routes ----
const other = await call('POST', '/auth/register', { body: { email: `ghl-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/forms/${form.id}`, { token: other.accessToken, expect: 404 });
await call('GET', `/payments/invoices/${inv.id}`, { token: other.accessToken, expect: 404 });
await call('GET', `/calendars/${cal.id}`, { token: other.accessToken, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
