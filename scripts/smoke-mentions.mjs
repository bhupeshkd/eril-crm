// End-to-end checks for community @mentions.
// Usage: node scripts/smoke-mentions.mjs [baseUrl]   (API must be running)
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.replace(/community\/[^/?]+/, 'community/<token>')} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 400)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const tokenOf = (url) => url.split('/community/')[1];

const reg = await call('POST', '/auth/register', { body: { email: `mn-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach Kim' } });
const T = { token: reg.accessToken };
const comm = await call('POST', '/communities', { ...T, body: { name: 'Club', digestFrequency: 'off' } });
const general = comm.channels[1];
const P = {};
for (const n of ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay']) {
  const c = await call('POST', '/crm/contacts', { ...T, body: { firstName: n, lastName: 'Test', email: `${n.toLowerCase()}-${rand}@ex.test` } });
  const m = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: c.id, notify: false } });
  P[n] = { contact: c, id: m.id, token: tokenOf(m.portalUrl), path: `/public/community/${tokenOf(m.portalUrl)}` };
}
const other = await call('POST', '/communities', { ...T, body: { name: 'Other club' } });
const outsiderC = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Out', email: `out-${rand}@ex.test` } });
const outsider = await call('POST', `/communities/${other.id}/members`, { ...T, body: { contactId: outsiderC.id, notify: false } });
await call('PUT', `${P.Cy.path}/me`, { body: { mentionEmails: false } });
await call('PUT', `/crm/contacts/${P.Dee.contact.id}`, { ...T, body: { dnd: true } });
await call('PUT', `/communities/${comm.id}/members/${P.Eve.id}`, { ...T, body: { status: 'banned' } });

// ---- Autocomplete ----
const found = await call('GET', `${P.Bob.path}/mention-search?q=an`);
check('search finds by name, names only', found.length === 1 && found[0].displayName === 'Ann T.' && Object.keys(found[0]).sort().join() === 'displayName,id');
const self = await call('GET', `${P.Bob.path}/mention-search?q=bob`);
check('search excludes yourself and banned members', self.length === 0 && (await call('GET', `${P.Bob.path}/mention-search?q=eve`)).length === 0);
check('search treats % literally', (await call('GET', `${P.Bob.path}/mention-search?q=%25`)).length === 0);

// ---- Who actually gets mentioned ----
const post = await call('POST', `${P.Bob.path}/posts`, { body: {
  channelId: general.id,
  body: 'Great call today @Ann T. @cy t. and @Dee T.! Also @Eve T. and @Bob T. and @Out',
  mentions: [P.Ann.id, P.Cy.id, P.Dee.id, P.Eve.id, P.Bob.id, P.Fay.id, outsider.id, '00000000-0000-4000-8000-000000000000'],
} });
check('only visible, active, other members of this community count', JSON.stringify(post.mentions.map((m) => m.name)) === JSON.stringify(['Ann T.', 'Cy T.', 'Dee T.']), JSON.stringify(post.mentions));
check('no member ids in output', !JSON.stringify(post.mentions).includes(P.Ann.id));

async function emails(n, needle) {
  const conv = (await call('GET', `/inbox/conversations?search=${encodeURIComponent(P[n].contact.email)}`, T))[0];
  if (!conv) return [];
  return (await call('GET', `/inbox/conversations/${conv.id}`, T)).messages.filter((m) => m.direction === 'outbound' && m.body.includes(needle));
}
const annMail = await emails('Ann', 'mentioned you');
check('Ann emailed with a deep link to the post', annMail.length === 1 && annMail[0].body.includes(`/community/${P.Ann.token}?post=${post.id}`) && annMail[0].body.includes('Bob T. mentioned you in #General'));
check('opted-out and DND members not emailed', (await emails('Cy', 'mentioned you')).length === 0 && (await emails('Dee', 'mentioned you')).length === 0);
check('unpicked / banned / foreign members not emailed', (await emails('Fay', 'mentioned you')).length === 0 && (await emails('Eve', 'mentioned you')).length === 0);

// ---- Inbox + highlighting ----
let me = await call('GET', P.Ann.path);
check('unread count', me.me.unreadMentions === 1 && me.me.mentionEmails === true);
let list = await call('GET', `${P.Ann.path}/mentions`);
check('mentions inbox', list.length === 1 && list[0].postId === post.id && list[0].unread && list[0].author.name === 'Bob T.' && !list[0].inComment);
const feed = await call('GET', `${P.Ann.path}/posts`);
check('isMe flag for your own name only', feed.posts[0].mentions.find((m) => m.name === 'Ann T.').isMe === true && feed.posts[0].mentions.find((m) => m.name === 'Cy T.').isMe === false);
await call('POST', `${P.Ann.path}/mentions/read`);
me = await call('GET', P.Ann.path);
check('mark read', me.me.unreadMentions === 0);
const single = await call('GET', `${P.Ann.path}/posts?postId=${post.id}`);
check('deep link returns just that post', single.posts.length === 1 && single.posts[0].id === post.id);

// ---- Comment mentions ----
const cm = await call('POST', `${P.Ann.path}/posts/${post.id}/comments`, { body: { body: 'Thanks @Bob T.!', mentions: [P.Bob.id] } });
check('comment mention stored', cm.mentions?.[0]?.name === 'Bob T.');
list = await call('GET', `${P.Bob.path}/mentions`);
check('comment mention in Bob\'s inbox', list.length === 1 && list[0].inComment && list[0].excerpt === 'Thanks @Bob T.!');
const comments = await call('GET', `${P.Bob.path}/posts/${post.id}/comments`);
check('comment shows the highlight for Bob', comments[0].mentions[0].isMe === true);

// ---- Hidden content disappears from the inbox ----
await call('PUT', `/communities/${comm.id}/posts/${post.id}`, { ...T, body: { hidden: true } });
list = await call('GET', `${P.Ann.path}/mentions`);
check('mention of hidden post removed from inbox', list.length === 0);
check('deep link to hidden post shows nothing', (await call('GET', `${P.Ann.path}/posts?postId=${post.id}`)).posts.length === 0);

// ---- Staff mentions + hourly email cap ----
for (let i = 0; i < 11; i++) {
  await call('POST', `/communities/${comm.id}/posts`, { ...T, body: { channelId: general.id, body: `Round ${i}: @Ann T. @Bob T. @Fay T.`, mentions: [P.Ann.id, P.Bob.id, P.Fay.id] } });
}
let staffMails = 0;
for (const n of ['Ann', 'Bob', 'Fay']) staffMails += (await emails(n, 'Coach Kim mentioned you')).length;
list = await call('GET', `${P.Fay.path}/mentions`);
check('staff mentions: all 33 recorded, at most 30 emailed per hour', list.length === 11 && staffMails === 30 && list[0].author.badge === 'Team', `${list.length} / ${staffMails}`);

// ---- Settings + isolation ----
const off = await call('PUT', `${P.Ann.path}/me`, { body: { mentionEmails: false } });
check('turn mention emails off', off.mentionEmails === false);
const staffSearch = await call('GET', `/communities/${comm.id}/mention-search?q=t`, T);
check('staff search works', staffSearch.length >= 4);
const stranger = await call('POST', '/auth/register', { body: { email: `mn-x-${rand}@test.local`, password: 'SmokeTest123!', name: 'X' } });
await call('GET', `/communities/${comm.id}/mention-search?q=a`, { token: stranger.accessToken, expect: 404 });
await call('GET', `/public/community/${P.Eve.token}/mentions`, { expect: 403 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
