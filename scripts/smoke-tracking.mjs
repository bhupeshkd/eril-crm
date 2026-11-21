// End-to-end checks for email open/click tracking.
// Usage: node scripts/smoke-tracking.mjs [baseUrl]   (API must be running, non-production)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
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
const unescape = (s) => s.replace(/&amp;/g, '&');
const hit = (url, ua = BROWSER_UA) => fetch(url, { headers: { 'User-Agent': ua }, redirect: 'manual' });

const reg = await call('POST', '/auth/register', { body: { email: `trk-${rand}@test.local`, password: 'SmokeTest123!', name: 'Tracker' } });
const T = { token: reg.accessToken };

const settings = await call('GET', '/tracking/settings', T);
check('tracking on by default', settings.opens === true && settings.clicks === true);

const tpl = await call('POST', '/email-templates', { ...T, body: { name: 'Promo', starter: 'promotion' } });
await call('PUT', `/email-templates/${tpl.id}`, { ...T, body: { blocks: [
  { type: 'heading', props: { text: 'Hi {{contact.firstName}}' } },
  { type: 'text', props: { text: 'See [pricing](https://example.com/pricing?a=1&b=2) or [email us](mailto:hi@example.com).' } },
  { type: 'button', props: { label: 'Shop now', url: 'https://example.com/shop' } },
] } });
const ann = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Ann', email: `ann-${rand}@ex.test`, tags: ['vip'] } });
const bob = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Bob', email: `bob-${rand}@ex.test`, tags: ['vip'] } });
const cat = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Cat', email: `cat-${rand}@ex.test`, tags: ['vip'] } });

await call('POST', '/automation/workflows', { ...T, body: { name: 'Pricing interest', triggerType: 'email.clicked', triggerConfig: { urlContains: '/pricing' }, isPublished: true,
  steps: [{ type: 'add_tag', config: { tag: 'pricing-interest' } }] } });
await call('POST', '/automation/workflows', { ...T, body: { name: 'Opened', triggerType: 'email.opened', isPublished: true, steps: [{ type: 'add_tag', config: { tag: 'opener' } }] } });

const camp = await call('POST', '/campaigns', { ...T, body: { name: 'Nov promo', channel: 'email', subject: 'Deals', templateId: tpl.id, audience: { tags: ['vip'] } } });
await call('POST', `/campaigns/${camp.id}/send`, { ...T, body: {} });
await sleep(2500);

async function delivered(contact) {
  const conv = (await call('GET', `/inbox/conversations?search=${encodeURIComponent(contact.email)}`, T))[0];
  const msg = (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.at(-1);
  const { html } = await call('GET', `/inbox/messages/${msg.id}/delivered-html`, T);
  const stored = (await call('GET', `/inbox/messages/${msg.id}/html`, T)).html;
  const pixel = unescape(html.match(/<img src="([^"]+\/t\/o\/[0-9a-f]{32}\.gif)"/)[1]);
  const links = [...html.matchAll(/href="([^"]+\/t\/c\/[^"]+)"/g)].map((m) => unescape(m[1]));
  return { msg, html, stored, pixel, links };
}

const a = await delivered(ann);
check('pixel injected', !!a.pixel);
check('http links wrapped, mailto/unsubscribe left direct', a.links.length === 2 && a.html.includes('href="mailto:hi@example.com"') && /href="http[^"]+\/unsubscribe\?c=/.test(a.html), String(a.links.length));
check('in-app copy has no pixel or tracked links', !a.stored.includes('/t/o/') && !a.stored.includes('/t/c/'));

// Ann opens twice and clicks pricing twice
let r = await hit(a.pixel);
check('pixel served as gif', r.status === 200 && r.headers.get('content-type') === 'image/gif' && r.headers.get('cache-control')?.includes('no-store'));
await hit(a.pixel);
const pricing = a.links.find((l) => l.includes('pricing'));
r = await hit(pricing);
check('click redirects to original url', r.status === 302 && r.headers.get('location') === 'https://example.com/pricing?a=1&b=2', r.headers.get('location'));
await hit(pricing);

// Bob's mail scanner pre-clicks (ignored); Bob then clicks "Shop now" with images blocked (no pixel)
const b = await delivered(bob);
const shop = b.links.find((l) => l.includes('shop'));
await hit(shop, 'Barracuda Sentinel (EE)');
await hit(b.pixel, 'Mimecast Safe Links');
let bobMsg = (await call('GET', `/inbox/conversations/${(await call('GET', `/inbox/conversations?search=bob-${rand}`, T))[0].id}`, T)).messages.at(-1);
check('scanner traffic ignored', bobMsg.openCount === 0 && bobMsg.clickCount === 0);
await hit(shop);
// Cat never opens.

// Tampering
const forged = pricing.replace(encodeURIComponent('https://example.com/pricing?a=1&b=2'), encodeURIComponent('https://evil.example'));
r = await hit(forged);
check('forged redirect rejected (no open redirect)', r.status === 404 && !r.headers.get('location'));
r = await hit(pricing.replace(/s=[^&]+/, 's=bad'));
check('bad signature rejected', r.status === 404);
r = await hit(BASE + '/t/o/' + 'f'.repeat(32) + '.gif');
check('unknown pixel still returns a gif', r.status === 200 && r.headers.get('content-type') === 'image/gif');

await sleep(1200);
const rep = await call('GET', `/campaigns/${camp.id}/report`, T);
check('report: 3 sent, 2 unique opens, 2 unique clicks', rep.sent === 3 && rep.opened === 2 && rep.clicked === 2, JSON.stringify(rep));
check('report: rates', rep.openRate === 66.7 && rep.clickRate === 66.7);
check('report: totals', rep.totalOpens === 3 && rep.totalClicks === 3, `${rep.totalOpens}/${rep.totalClicks}`); // ann 2 opens + bob 1 (implied by click)
const pr = rep.links.find((l) => l.url.includes('pricing'));
const sh = rep.links.find((l) => l.url.includes('shop'));
check('per-link clicks exclude scanners', pr.clicks === 2 && pr.uniqueClicks === 1 && sh.clicks === 1, JSON.stringify(rep.links));
const list = await call('GET', '/campaigns', T);
check('rates on campaign list', list[0].openRate === 66.7 && list[0].clickRate === 66.7);

bobMsg = (await call('GET', `/inbox/conversations/${(await call('GET', `/inbox/conversations?search=bob-${rand}`, T))[0].id}`, T)).messages.at(-1);
check('click implies open (images blocked)', !!bobMsg.openedAt && bobMsg.clickCount === 1);
const annC = await call('GET', `/crm/contacts/${ann.id}`, T);
const bobC = await call('GET', `/crm/contacts/${bob.id}`, T);
const catC = await call('GET', `/crm/contacts/${cat.id}`, T);
check('email.clicked workflow (url filter)', annC.tags.includes('pricing-interest') && !bobC.tags.includes('pricing-interest'));
check('email.opened workflow fired once per opener', annC.tags.includes('opener') && bobC.tags.includes('opener') && !catC.tags.includes('opener'));
const runs = await call('GET', `/automation/workflows/${(await call('GET', '/automation/workflows', T)).find((w) => w.name === 'Opened').id}/runs`, T);
check('opened workflow ran exactly twice (not per pixel load)', runs.length === 2, String(runs.length));

// Turning tracking off
await call('PUT', '/tracking/settings', { ...T, body: { opens: false, clicks: false } });
await call('POST', `/email-templates/${tpl.id}/test`, { ...T, body: { contactId: cat.id } });
const conv = (await call('GET', `/inbox/conversations?search=cat-${rand}`, T))[0];
const last = (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.at(-1);
const off = (await call('GET', `/inbox/messages/${last.id}/delivered-html`, T)).html;
check('no tracking when disabled', !off.includes('/t/o/') && !off.includes('/t/c/') && off.includes('https://example.com/shop'));
await call('PUT', '/tracking/settings', { ...T, body: { clicks: true } });
check('settings persisted', JSON.stringify(await call('GET', '/tracking/settings', T)) === JSON.stringify({ opens: false, clicks: true }));

// Isolation
const other = await call('POST', '/auth/register', { body: { email: `trk-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/campaigns/${camp.id}/report`, { token: other.accessToken, expect: 404 });
await call('GET', `/inbox/messages/${a.msg.id}/delivered-html`, { token: other.accessToken, expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
