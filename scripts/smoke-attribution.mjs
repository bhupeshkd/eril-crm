// End-to-end checks for marketing attribution (UTM / ad click capture and the attribution report).
// Usage: node scripts/smoke-attribution.mjs [baseUrl]   (API running, PAYMENTS_TEST_MODE / no Stripe key)
// The public booking endpoint allows 10 requests a minute per IP; wait a minute between runs.
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

const reg = await call('POST', '/auth/register', { body: { email: `at-${rand}@test.local`, password: 'SmokeTest123!', name: 'Owner' } });
const T = { token: reg.accessToken };
const form = await call('POST', '/forms', { ...T, body: { name: 'Lead form', kind: 'form' } });
const submit = (email, attribution, expect) =>
  call('POST', `/public/forms/${form.slug}/submit`, { body: { data: { first_name: email.split('@')[0], email }, ...(attribution !== undefined ? { attribution } : {}) }, expect });
const contactByEmail = async (email) => (await call('GET', `/crm/contacts?search=${encodeURIComponent(email)}`, T)).items[0];
const getContact = async (email) => call('GET', `/crm/contacts/${(await contactByEmail(email)).id}`, T);

// ---- Capture on a form ----
const ana = `ana-${rand}@ex.test`;
await submit(ana, {
  first: { source: 'Google', medium: 'CPC', campaign: 'spring-sale', gclid: 'abc123', landingPage: 'https://acme.test/offer?utm_source=google', referrer: 'javascript:alert(1)', evil: 'x' },
  last: { source: 'Google', medium: 'CPC', campaign: 'spring-sale', gclid: 'abc123' },
});
let c = await getContact(ana);
check('first touch stored and cleaned', c.firstTouch?.source === 'google' && c.firstTouch?.medium === 'cpc' && c.firstTouch?.gclid === 'abc123' && !('evil' in c.firstTouch) && !c.firstTouch.referrer, JSON.stringify(c.firstTouch));
check('landing page kept', c.firstTouch?.landingPage?.startsWith('https://acme.test/offer'));
check('last touch stored', c.lastTouch?.campaign === 'spring-sale');

// ---- A later visit updates the latest touch, keeps the first ----
await submit(ana, { first: { source: 'newsletter', medium: 'email', campaign: 'june' }, last: { source: 'newsletter', medium: 'email', campaign: 'june' } });
c = await getContact(ana);
check('first touch unchanged on return visit', c.firstTouch?.campaign === 'spring-sale');
check('latest touch updated', c.lastTouch?.campaign === 'june' && c.lastTouch?.medium === 'email');

// ---- Validation ----
await submit(`bad-${rand}@ex.test`, 'not-an-object', 400);
await submit(`none-${rand}@ex.test`);
check('no attribution → nothing stored', (await getContact(`none-${rand}@ex.test`)).firstTouch === null);
await submit(`junk-${rand}@ex.test`, { first: { evil: 'x' } });
check('junk-only attribution → nothing stored', (await getContact(`junk-${rand}@ex.test`)).firstTouch === null);
await submit(`ref-${rand}@ex.test`, { last: { referrer: 'https://www.google.com/search?q=window+cleaning' } });
const ref = await getContact(`ref-${rand}@ex.test`);
check('only "last" sent → used as first too', ref.firstTouch?.referrer?.startsWith('https://www.google.com') && ref.lastTouch?.referrer === ref.firstTouch?.referrer);

// ---- Capture on a booking ----
const cal = await call('POST', '/calendars', { ...T, body: { name: 'Intro call', durationMinutes: 30, timezone: 'UTC', minNoticeHours: 0, availability: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '00:00', end: '23:30' }]])) } });
const day = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
const slots = await call('GET', `/public/calendars/${cal.slug}/slots?date=${day}`);
const bo = `bo-${rand}@ex.test`;
await call('POST', `/public/calendars/${cal.slug}/book`, { body: { startAt: slots[0], name: 'Bo Book', email: bo, attribution: { first: { source: 'facebook', medium: 'paid', campaign: 'spring-sale', fbclid: 'fb1' } } } });
const boC = await getContact(bo);
check('booking stores attribution', boC.firstTouch?.fbclid === 'fb1' && boC.source === 'booking');

// ---- Revenue ----
const inv = await call('POST', '/payments/invoices', { ...T, body: { contactId: boC.id, items: [{ name: 'Package', quantity: 1, unitPrice: 300 }] } });
await call('POST', `/payments/invoices/${inv.id}/send`, T);
await call('POST', `/public/invoices/${inv.publicToken}/test-pay`);
await sleep(800);

// A contact added by hand counts as not tracked.
await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Manual', email: `man-${rand}@ex.test` } });

// ---- Report ----
const first = await call('GET', '/reports/attribution?days=30&model=first', T);
const ch = (name) => first.channels.find((x) => x.channel === name);
check('totals', first.totals.leads === 6 && first.totals.tracked === 3, JSON.stringify(first.totals));
check('Google Ads channel (first touch)', ch('Google Ads')?.leads === 1);
check('Meta Ads channel with revenue', ch('Meta Ads')?.leads === 1 && ch('Meta Ads')?.revenue === 300 && ch('Meta Ads')?.customers === 1, JSON.stringify(ch('Meta Ads')));
check('Organic search channel', ch('Organic search')?.leads === 1);
check('untracked contacts grouped', ch('Not tracked')?.leads === 3, JSON.stringify(ch('Not tracked')));
check('channels sorted by revenue', first.channels[0].channel === 'Meta Ads');
const spring = first.campaigns.filter((x) => x.campaign === 'spring-sale');
check('campaigns split by source', spring.length === 2 && spring.some((x) => x.source === 'google') && spring.some((x) => x.source === 'facebook'));
const last = await call('GET', '/reports/attribution?days=30&model=last', T);
check('latest-touch model credits the newsletter', last.channels.some((x) => x.channel === 'Email' && x.leads === 1) && !last.channels.some((x) => x.channel === 'Google Ads'));
await call('GET', '/reports/attribution?days=30&model=middle', { ...T, expect: 400 });
await call('GET', '/reports/attribution?days=13', { ...T, expect: 400 });

// ---- Isolation ----
const other = await call('POST', '/auth/register', { body: { email: `at2-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
check('other workspace sees none of it', (await call('GET', '/reports/attribution', { token: other.accessToken })).totals.leads === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll attribution checks passed');
process.exit(failures ? 1 : 0);
