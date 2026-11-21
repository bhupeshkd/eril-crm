// End-to-end checks for A/B subject tests on email campaigns.
// Usage: node scripts/smoke-ab.mjs [baseUrl]   (API must be running, non-production)
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

const reg = await call('POST', '/auth/register', { body: { email: `ab-${rand}@test.local`, password: 'SmokeTest123!', name: 'AB Tester' } });
const T = { token: reg.accessToken };

const tpl = await call('POST', '/email-templates', { ...T, body: { name: 'Promo', starter: 'promotion' } });
const contacts = [];
for (let i = 0; i < 10; i++) contacts.push(await call('POST', '/crm/contacts', { ...T, body: { firstName: `P${i}`, email: `p${i}-${rand}@ex.test`, tags: ['ab'] } }));
const small = [];
for (let i = 0; i < 4; i++) small.push(await call('POST', '/crm/contacts', { ...T, body: { firstName: `S${i}`, email: `s${i}-${rand}@ex.test`, tags: ['ab2'] } }));

// Validation
await call('POST', '/campaigns', { ...T, body: { name: 'Bad', subject: 'A', templateId: tpl.id, abTest: { subjectB: '  ' } }, expect: 400 });
await call('POST', '/campaigns', { ...T, body: { name: 'Bad', subject: 'A', templateId: tpl.id, abTest: { subjectB: 'B', testPercent: 5 } }, expect: 400 });
const plain = await call('POST', '/campaigns', { ...T, body: { name: 'Plain AB', subject: 'A', body: 'Hi', audience: { tags: ['ab'] }, abTest: { subjectB: 'B' } } });
await call('POST', `/campaigns/${plain.id}/send`, { ...T, body: {}, expect: 400 });
const tiny = await call('POST', '/campaigns', { ...T, body: { name: 'Tiny', subject: 'A', templateId: tpl.id, audience: { tags: ['nobody'] }, abTest: { subjectB: 'B' } } });
await call('POST', `/campaigns/${tiny.id}/send`, { ...T, body: {}, expect: 400 });
const sms = await call('POST', '/campaigns', { ...T, body: { name: 'SMS', channel: 'sms', body: 'Hi', abTest: { subjectB: 'B' } } });
check('SMS campaigns drop the A/B config', sms.abTest === null);

// Main test: 40% of 10 → 2 get A, 2 get B, 6 wait for the winner
const camp = await call('POST', '/campaigns', { ...T, body: {
  name: 'Black Friday', subject: `Our biggest sale ${rand}`, templateId: tpl.id, audience: { tags: ['ab'] },
  abTest: { subjectB: `Only 24 hours left ${rand}`, testPercent: 40, metric: 'opens', waitMinutes: 15 },
} });
check('A/B config saved', camp.abTest?.testPercent === 40 && camp.abTest?.metric === 'opens');
await call('POST', `/campaigns/${camp.id}/send`, { ...T, body: {} });
await sleep(2500);
let c = await call('GET', `/campaigns/${camp.id}`, T);
check('status testing after the test group is sent', c.status === 'testing' && c.stats.sent === 4, `${c.status} ${JSON.stringify(c.stats)}`);
const wait = new Date(c.abDecideAt).getTime() - Date.now();
check('winner scheduled ~15 minutes out', wait > 13 * 60_000 && wait < 16 * 60_000);
await call('PUT', `/campaigns/${camp.id}`, { ...T, body: { name: 'Edited' }, expect: 400 });
await call('DELETE', `/campaigns/${camp.id}`, { ...T, expect: 400 });

async function lastMessage(contact) {
  const conv = (await call('GET', `/inbox/conversations?search=${encodeURIComponent(contact.email)}`, T))[0];
  if (!conv) return null;
  const detail = await call('GET', `/inbox/conversations/${conv.id}`, T);
  return { conv, msgs: detail.messages, msg: detail.messages.at(-1) };
}
const got = [];
for (const p of contacts) {
  const m = await lastMessage(p);
  if (m) got.push({ p, ...m });
}
const A = got.filter((g) => g.msg.variant === 'A');
const B = got.filter((g) => g.msg.variant === 'B');
check('test group split 2 / 2, rest untouched', A.length === 2 && B.length === 2 && got.length === 4, `${A.length}/${B.length}/${got.length}`);
check('each variant got its own subject', A.every((g) => g.conv.subject === `Our biggest sale ${rand}`) && B.every((g) => g.conv.subject === `Only 24 hours left ${rand}`));

// Both B recipients open; nobody in A does
for (const g of B) {
  const { html } = await call('GET', `/inbox/messages/${g.msg.id}/delivered-html`, T);
  const pixel = unescape(html.match(/<img src="([^"]+\/t\/o\/[0-9a-f]{32}\.gif)"/)[1]);
  await fetch(pixel, { headers: { 'User-Agent': BROWSER_UA } });
}
await sleep(800);
let rep = await call('GET', `/campaigns/${camp.id}/report`, T);
const va = rep.variants.find((v) => v.variant === 'A');
const vb = rep.variants.find((v) => v.variant === 'B');
check('per-variant report', va?.sent === 2 && va.openRate === 0 && vb?.sent === 2 && vb.openRate === 100, JSON.stringify(rep.variants));
check('report carries both subjects', rep.ab?.subjectA === `Our biggest sale ${rand}` && rep.ab?.subjectB === `Only 24 hours left ${rand}`);

// End early, letting the results decide → B
await call('POST', `/campaigns/${camp.id}/ab/winner`, { ...T, body: {} });
await call('POST', `/campaigns/${camp.id}/ab/winner`, { ...T, body: {}, expect: 400 }); // already finishing
await sleep(3000);
c = await call('GET', `/campaigns/${camp.id}`, T);
check('winner B sent to the rest', c.status === 'sent' && c.abWinner === 'B' && c.stats.sent === 10 && c.stats.recipients === 10, `${c.status} ${c.abWinner} ${JSON.stringify(c.stats)}`);
const after = [];
for (const p of contacts) after.push(await lastMessage(p));
check('every contact got exactly one email', after.every((m) => m && m.msgs.filter((x) => x.direction === 'outbound').length === 1));
const rest = after.filter((m) => m.msg.variant === null);
check('the other 6 got subject B, unlabelled', rest.length === 6 && rest.every((m) => m.conv.subject === `Only 24 hours left ${rand}`));
rep = await call('GET', `/campaigns/${camp.id}/report`, T);
check('overall report counts all 10', rep.sent === 10 && rep.opened === 2, `${rep.sent}/${rep.opened}`);
const list = await call('GET', '/campaigns', T);
check('list shows the winner', list.find((x) => x.id === camp.id)?.abWinner === 'B');

// Manual override: 50% of 4 → 1 A, 1 B; force A even with no data
const c2 = await call('POST', '/campaigns', { ...T, body: { name: 'Override', subject: `Pick me ${rand}`, templateId: tpl.id, audience: { tags: ['ab2'] }, abTest: { subjectB: `Not me ${rand}`, testPercent: 50, metric: 'clicks', waitMinutes: 60 } } });
await call('POST', `/campaigns/${c2.id}/send`, { ...T, body: {} });
await sleep(2000);
const other = await call('POST', '/auth/register', { body: { email: `ab-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('POST', `/campaigns/${c2.id}/ab/winner`, { token: other.accessToken, body: { variant: 'A' }, expect: 404 });
await call('POST', `/campaigns/${c2.id}/ab/winner`, { ...T, body: { variant: 'C' }, expect: 400 });
await call('POST', `/campaigns/${c2.id}/ab/winner`, { ...T, body: { variant: 'A' } });
await sleep(2000);
const d2 = await call('GET', `/campaigns/${c2.id}`, T);
check('forced winner A', d2.status === 'sent' && d2.abWinner === 'A' && d2.stats.sent === 4, `${d2.status} ${d2.abWinner} ${JSON.stringify(d2.stats)}`);
const smallMsgs = [];
for (const p of small) smallMsgs.push(await lastMessage(p));
const nonTest = smallMsgs.filter((m) => m.msg.variant === null);
check('rest got subject A', nonTest.length === 2 && nonTest.every((m) => m.conv.subject === `Pick me ${rand}`));

await call('POST', `/campaigns/${c2.id}/ab/winner`, { ...T, body: {}, expect: 400 }); // not testing any more

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
