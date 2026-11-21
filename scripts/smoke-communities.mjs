// End-to-end checks for communities: staff admin, member portal (magic links), moderation, join page, course auto-join.
// Usage: node scripts/smoke-communities.mjs [baseUrl]   (API must be running)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = Math.random().toString(36).slice(2, 8);
const tokenOf = (url) => url.split('/community/')[1];

const reg = await call('POST', '/auth/register', { body: { email: `cm-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach Kim' } });
const T = { token: reg.accessToken };
const other = await call('POST', '/auth/register', { body: { email: `cm-other-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
const otherCourse = await call('POST', '/courses', { token: other.accessToken, body: { title: 'Theirs' } });

// ---- Setup ----
await call('POST', '/communities', { ...T, body: { name: 'Bad', autoJoinCourseIds: [otherCourse.id] }, expect: 400 });
const comm = await call('POST', '/communities', { ...T, body: { name: 'Founders Club', description: 'For course students', tags: ['Community'] } });
check('default channels', comm.channels.length === 2 && comm.channels[0].name === 'Announcements' && comm.channels[0].staffOnly && !comm.channels[1].staffOnly);
const [ann, general] = comm.channels;
const rosa = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Rosa', lastName: 'diaz', email: `rosa-${rand}@ex.test` } });
const sam = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Sam', lastName: 'Lee', email: `sam-${rand}@ex.test` } });

const addR = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: rosa.id } });
const again = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: rosa.id, notify: false } });
check('adding twice is idempotent', addR.created === true && again.created === false && again.id === addR.id);
const addS = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: sam.id, role: 'moderator', notify: false } });
let R = tokenOf(addR.portalUrl);
const S = tokenOf(addS.portalUrl);
const P = (tok) => `/public/community/${tok}`;

// ---- Portal basics ----
const portal = await call('GET', P(R));
check('portal: community, channels, me', portal.community.name === 'Founders Club' && portal.channels.length === 2 && portal.me.displayName === 'Rosa D.' && portal.me.role === 'member');
check('portal shows no emails or tokens', !JSON.stringify(portal).includes('@') && !JSON.stringify(portal).includes(R));
await call('POST', `${P(R)}/posts`, { body: { channelId: ann.id, body: 'Hi' }, expect: 403 });
await call('POST', `${P(R)}/posts`, { body: { channelId: general.id, body: '  ‮\u0000  ' }, expect: 400 });
const rPost = await call('POST', `${P(R)}/posts`, { body: { channelId: general.id, body: 'Hello\u0000 everyone!\n\n\n\nExcited to be here.' } });
check('member post saved and cleaned', rPost.body === 'Hello everyone!\n\nExcited to be here.' && rPost.author.name === 'Rosa D.' && rPost.author.badge === null);
const sPost = await call('POST', `${P(S)}/posts`, { body: { channelId: ann.id, body: 'Mods can announce too' } });
check('moderator can post in team channel', sPost.author.badge === 'Moderator');
const staffPost = await call('POST', `/communities/${comm.id}/posts`, { ...T, body: { channelId: ann.id, body: 'Welcome to the club! Live Q&A on Friday.' } });
check('staff post shows as Team', staffPost.author.badge === 'Team' && staffPost.author.name === 'Coach Kim');

// ---- Pin, like, comment ----
await call('PUT', `${P(R)}/posts/${staffPost.id}`, { body: { pinned: true }, expect: 403 });
await call('PUT', `/communities/${comm.id}/posts/${staffPost.id}`, { ...T, body: { pinned: true } });
let feed = await call('GET', `${P(R)}/posts`);
check('pinned post first', feed.posts[0].id === staffPost.id && feed.posts[0].pinned && feed.posts.length === 3);
check('member feed has no hidden flag or contact ids', feed.posts.every((p) => !('hidden' in p) && !('contactId' in p.author)));
const like = await call('POST', `${P(R)}/posts/${staffPost.id}/like`);
check('like', like.liked && like.likeCount === 1);
await Promise.all([call('POST', `${P(S)}/posts/${staffPost.id}/like`), call('POST', `${P(S)}/posts/${staffPost.id}/like`, { expect: [200, 201] })]);
feed = await call('GET', `${P(R)}/posts?channelId=${ann.id}`);
const sp = feed.posts.find((p) => p.id === staffPost.id);
check('like count stays consistent under double clicks', sp.likeCount >= 1 && sp.likeCount <= 2 && sp.liked === true, String(sp.likeCount));
const unlike = await call('POST', `${P(R)}/posts/${staffPost.id}/like`);
check('unlike', unlike.liked === false);

const cm = await call('POST', `${P(R)}/posts/${staffPost.id}/comments`, { body: { body: 'Can’t wait!' } });
await call('POST', `/communities/${comm.id}/posts/${staffPost.id}/comments`, { ...T, body: { body: 'See you there' } });
let comments = await call('GET', `${P(R)}/posts/${staffPost.id}/comments`);
check('comments thread', comments.length === 2 && comments[1].author.badge === 'Team');
await call('PUT', `${P(R)}/comments/${cm.id}`, { body: { hidden: true }, expect: 403 });
await call('PUT', `${P(S)}/comments/${cm.id}`, { body: { hidden: true } });
comments = await call('GET', `${P(R)}/posts/${staffPost.id}/comments`);
const staffComments = await call('GET', `/communities/${comm.id}/posts/${staffPost.id}/comments`, T);
feed = await call('GET', `${P(R)}/posts?channelId=${ann.id}`);
check('hidden comment: gone for members, visible to staff, count updated', comments.length === 1 && staffComments.length === 2 && staffComments.some((c) => c.hidden) && feed.posts.find((p) => p.id === staffPost.id).commentCount === 1);

// ---- Moderation & ownership ----
await call('DELETE', `${P(R)}/posts/${sPost.id}`, { expect: 403 });
await call('PUT', `${P(S)}/posts/${rPost.id}`, { body: { hidden: true } });
feed = await call('GET', `${P(R)}/posts`);
check('hidden post gone for members', !feed.posts.some((p) => p.id === rPost.id));
await call('GET', `${P(R)}/posts/${rPost.id}/comments`, { expect: 404 });
const staffFeed = await call('GET', `/communities/${comm.id}/posts`, T);
check('staff still sees hidden post', staffFeed.posts.find((p) => p.id === rPost.id)?.hidden === true && staffFeed.posts.find((p) => p.id === rPost.id).author.contactId === rosa.id);
await call('PUT', `/communities/${comm.id}/posts/${rPost.id}`, { ...T, body: { hidden: false } });

await call('PUT', `${P(R)}/me`, { body: { displayName: '  Rosa\nthe Great ' } });
feed = await call('GET', `${P(R)}/posts?channelId=${general.id}`);
check('display name change shows on posts', feed.posts[0].author.name === 'Rosa the Great');

// ---- Ban, reset link ----
const members = await call('GET', `/communities/${comm.id}/members`, T);
const rosaM = members.find((m) => m.contact.id === rosa.id);
check('members list', members.length === 2 && rosaM.posts === 1 && rosaM.lastSeenAt);
await call('PUT', `/communities/${comm.id}/members/${rosaM.id}`, { ...T, body: { status: 'banned' } });
await call('GET', P(R), { expect: 403 });
await call('POST', `${P(R)}/posts`, { body: { channelId: general.id, body: 'still here?' }, expect: 403 });
await call('PUT', `/communities/${comm.id}/members/${rosaM.id}`, { ...T, body: { status: 'active' } });
const reset = await call('POST', `/communities/${comm.id}/members/${rosaM.id}/reset-link`, T);
await call('GET', P(R), { expect: 404 });
R = tokenOf(reset.portalUrl);
await call('GET', P(R));

// ---- Cross-community / cross-account isolation ----
const comm2 = await call('POST', '/communities', { ...T, body: { name: 'VIP room' } });
const vipPost = await call('POST', `/communities/${comm2.id}/posts`, { ...T, body: { channelId: comm2.channels[0].id, body: 'VIP only' } });
await call('POST', `${P(R)}/posts/${vipPost.id}/like`, { expect: 404 });
await call('GET', `${P(R)}/posts/${vipPost.id}/comments`, { expect: 404 });
await call('POST', `${P(R)}/posts`, { body: { channelId: comm2.channels[1].id, body: 'sneaky' }, expect: 404 });
feed = await call('GET', `${P(R)}/posts?channelId=${comm2.channels[0].id}`);
check('other community channel shows nothing', feed.posts.length === 0);
await call('GET', `/communities/${comm.id}`, { token: other.accessToken, expect: 404 });
await call('GET', `/communities/${comm.id}/members`, { token: other.accessToken, expect: 404 });
await call('POST', `/communities/${comm.id}/members`, { token: other.accessToken, body: { contactId: rosa.id }, expect: 404 });
await call('GET', '/public/community/not-a-real-token-at-all-xyz', { expect: 404 });

// ---- Open join page ----
await call('GET', `/public/communities/${comm.slug}`, { expect: 404 }); // invite only
await call('PUT', `/communities/${comm.id}`, { ...T, body: { joinMode: 'open' } });
const info = await call('GET', `/public/communities/${comm.slug}`);
check('join page info', info.name === 'Founders Club' && info.members === 2 && !('id' in info));
const j1 = await call('POST', `/public/communities/${comm.slug}/join`, { body: { name: 'Nia Park', email: `nia-${rand}@ex.test` } });
const j2 = await call('POST', `/public/communities/${comm.slug}/join`, { body: { name: 'Nia Park', email: `nia-${rand}@ex.test` } });
const jr = await call('POST', `/public/communities/${comm.slug}/join`, { body: { name: 'Not Rosa', email: `rosa-${rand}@ex.test` } });
check('join never returns a link (emailed only)', [j1, j2, jr].every((r) => r.ok && !JSON.stringify(r).includes('/community/')));
let list = await call('GET', `/communities/${comm.id}/members`, T);
const nia = list.find((m) => m.contact.email === `nia-${rand}@ex.test`);
check('joined once via join page, tagged', list.length === 3 && nia?.source === 'join_page');
const niaC = await call('GET', `/crm/contacts/${nia.contact.id}`, T);
check('join tags the contact', niaC.tags.includes('community'));

// ---- Course auto-join + workflow trigger ----
await call('POST', '/automation/workflows', { ...T, body: { name: 'Welcome', triggerType: 'community.member_joined', triggerConfig: { communityId: comm.id }, isPublished: true, steps: [{ type: 'add_tag', config: { tag: 'welcomed' } }] } });
const course = await call('POST', '/courses', { ...T, body: { title: 'Launch course' } });
await call('PUT', `/courses/${course.id}`, { ...T, body: { isPublished: true } });
await call('PUT', `/communities/${comm.id}`, { ...T, body: { autoJoinCourseIds: [course.id] } });
const pat = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Pat', email: `pat-${rand}@ex.test` } });
await call('POST', `/courses/${course.id}/enrollments`, { ...T, body: { contactId: pat.id, notify: false } });
await sleep(1500);
list = await call('GET', `/communities/${comm.id}/members`, T);
check('course enrollment auto-joins', list.some((m) => m.contact.id === pat.id && m.source === 'course'));
const patC = await call('GET', `/crm/contacts/${pat.id}`, T);
check('member_joined workflow ran', patC.tags.includes('welcomed'), JSON.stringify(patC.tags));

// ---- Deleting a channel hides its posts ----
await call('DELETE', `/communities/${comm.id}/channels/${general.id}`, T);
feed = await call('GET', `${P(R)}/posts`);
check('posts of a deleted channel disappear', !feed.posts.some((p) => p.channelId === general.id));
await call('DELETE', `/communities/${comm.id}/channels/${ann.id}`, { ...T, expect: 400 }); // last channel

const all = await call('GET', '/communities', T);
const row = all.find((c) => c.id === comm.id);
check('community stats', row.members === 4 && row.posts >= 3, JSON.stringify({ m: row.members, p: row.posts }));

// ---- Closing the community ----
await call('PUT', `/communities/${comm.id}`, { ...T, body: { isActive: false } });
await call('GET', P(R), { expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
