// End-to-end checks for file attachments on community posts and for points, levels and the leaderboard.
// Usage: node scripts/smoke-community-files.mjs [baseUrl]   (API must be running)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;
async function call(method, path, { token, body, form, expect = [200, 201], raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf.toString('utf8');
  if (!raw) try { data = data ? JSON.parse(data) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.replace(/community\/[^/?]+/, 'community/<token>').split('?')[0]} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return raw ? { status: res.status, buf, headers: res.headers } : data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const tokenOf = (url) => url.split('/community/')[1];
const fileForm = (buf, name, type = 'application/octet-stream') => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return f; };
const apiPath = (url) => url.slice(url.indexOf('/api/v1') + '/api/v1'.length);

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml fake zip body')]);
const csv = Buffer.from('name,email\nAna,ana@example.test\n');

// ---- Setup ----
const reg = await call('POST', '/auth/register', { body: { email: `cf-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach Kim' } });
const T = { token: reg.accessToken };
const comm = await call('POST', '/communities', { ...T, body: { name: 'Makers', digestFrequency: 'off' } });
const comm2 = await call('POST', '/communities', { ...T, body: { name: 'Other', digestFrequency: 'off' } });
const general = comm.channels[1];
const P = {};
for (const n of ['Ann', 'Bob', 'Cat', 'Eve']) {
  const c = await call('POST', '/crm/contacts', { ...T, body: { firstName: n, email: `${n.toLowerCase()}-${rand}@ex.test` } });
  const m = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: c.id, notify: false } });
  P[n] = { id: m.id, path: `/public/community/${tokenOf(m.portalUrl)}` };
}
const c2 = await call('POST', '/crm/contacts', { ...T, body: { firstName: 'Zed', email: `zed-${rand}@ex.test` } });
const z = await call('POST', `/communities/${comm2.id}/members`, { ...T, body: { contactId: c2.id, notify: false } });
const Z = `/public/community/${tokenOf(z.portalUrl)}`;

// ---- Uploads: allowed types by content, safe names ----
await call('POST', `${P.Ann.path}/files`, { expect: 400 });
const exe = await call('POST', `${P.Ann.path}/files`, { form: fileForm(Buffer.from('MZ\x90\x00\x03'), 'setup.exe'), expect: 400 });
check('executables refused', /Only PDF/.test(exe?.message ?? ''));
await call('POST', `${P.Ann.path}/files`, { form: fileForm(Buffer.from('<!doctype html><script>alert(1)</script>'), 'notes.txt', 'text/plain'), expect: 400 });
await call('POST', `${P.Ann.path}/files`, { form: fileForm(Buffer.from('MZ fake'), 'report.pdf', 'application/pdf'), expect: 400 }); // name lies
await call('POST', `${P.Ann.path}/files`, { form: fileForm(docx, 'payload.jar'), expect: 400 });
await call('POST', `${P.Ann.path}/files`, { form: fileForm(Buffer.alloc(10 * 1024 * 1024 + 10, 0x41), 'big.txt'), expect: [400, 413] });
const f1 = await call('POST', `${P.Ann.path}/files`, { form: fileForm(pdf, '../../Q3 "plan".PDF', 'application/pdf') });
check('PDF accepted with a cleaned name', f1.name === 'Q3 plan.pdf' && f1.mime === 'application/pdf' && f1.size === pdf.length, f1.name);
const f2 = await call('POST', `${P.Ann.path}/files`, { form: fileForm(docx, 'Résumé.docx') });
check('Word document accepted, UTF-8 name kept', f2.name === 'Résumé.docx', f2.name);
const f3 = await call('POST', `${P.Ann.path}/files`, { form: fileForm(csv, 'list.csv', 'text/csv') });
const f4 = await call('POST', `${P.Ann.path}/files`, { form: fileForm(csv, 'extra.csv', 'text/csv') });
const img = await call('POST', `${P.Ann.path}/files`, { form: fileForm(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'pic.png', 'image/png'), expect: 400 });
check('images go through the image uploader', /Only PDF/.test(img?.message ?? ''));

// ---- Attaching ----
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'too many', fileIds: [f1.id, f2.id, f3.id, f4.id] }, expect: 400 });
const bobFile = await call('POST', `${P.Bob.path}/files`, { form: fileForm(pdf, 'bob.pdf') });
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'stealing', fileIds: [bobFile.id] }, expect: 400 });
const zf = await call('POST', `${Z}/files`, { form: fileForm(pdf, 'z.pdf') });
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'cross-community', fileIds: [zf.id] }, expect: 400 });
const post = await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: '', fileIds: [f1.id, f2.id, f3.id] } });
check('post with only files, in order', post.files?.length === 3 && post.files.map((f) => f.name).join('|') === 'Q3 plan.pdf|Résumé.docx|list.csv' && post.images.length === 0);
await call('POST', `${P.Bob.path}/posts`, { body: { channelId: general.id, body: 'reuse', fileIds: [f1.id] }, expect: 400 });

// ---- Downloads: signed, always attachments, exact bytes ----
const dl = await call('GET', apiPath(post.files[0].url), { raw: true });
check('download is the same bytes', dl.buf.equals(pdf));
check('download is forced (never rendered)', (dl.headers.get('content-disposition') || '').startsWith('attachment;') && dl.headers.get('x-content-type-options') === 'nosniff', dl.headers.get('content-disposition'));
const dl2 = await call('GET', apiPath(post.files[1].url), { raw: true });
check('UTF-8 file name in the header', (dl2.headers.get('content-disposition') || '').includes("filename*=UTF-8''R%C3%A9sum%C3%A9.docx"));
await call('GET', apiPath(post.files[0].url).replace(/s=[^&]+/, 's=bad'), { raw: true, expect: 404 });
const feed = await call('GET', `${P.Bob.path}/posts?channelId=${general.id}`);
check('other members see the files', feed.posts.find((p) => p.id === post.id)?.files.length === 3);
check('staff feed shows files too', (await call('GET', `/communities/${comm.id}/posts?channelId=${general.id}`, T)).posts.find((p) => p.id === post.id)?.files.length === 3);
await call('DELETE', `${P.Ann.path}/posts/${post.id}`);
await call('GET', apiPath(post.files[0].url), { raw: true, expect: 404 });

// ---- Points, levels, leaderboard ----
const a1 = await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'Ann post 1' } });
const a2 = await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'Ann post 2' } });
const b1 = await call('POST', `${P.Bob.path}/posts`, { body: { channelId: general.id, body: 'Bob post' } });
for (const who of ['Bob', 'Cat', 'Eve']) for (const p of [a1, a2]) await call('POST', `${P[who].path}/posts/${p.id}/like`);
await call('POST', `${P.Ann.path}/posts/${a1.id}/like`); // liking your own post earns nothing
await call('POST', `/communities/${comm.id}/posts/${b1.id}/like`, T); // likes from the team count
await call('POST', `${P.Cat.path}/posts/${b1.id}/like`);
let board = await call('GET', `${P.Ann.path}/leaderboard?period=30d`);
check('leaderboard ranks by likes from others', board.top[0].name === 'Ann' && board.top[0].points === 6 && board.top[1].name === 'Bob' && board.top[1].points === 2, JSON.stringify(board.top));
check('my level and progress', board.me.rank === 1 && board.me.points === 6 && board.me.level === 2 && board.me.nextLevelAt === 20 && board.me.toNext === 14, JSON.stringify(board.me));
check('leaderboard shows names, not ids', board.top.every((r) => !('id' in r)) && board.top.find((r) => r.name === 'Ann').isMe === true);
board = await call('GET', `${P.Cat.path}/leaderboard?period=all`);
check('member with no points has no rank', board.me.rank === null && board.me.level === 1 && board.me.points === 0);
await call('GET', `${P.Ann.path}/leaderboard?period=year`, { expect: 400 });
// Unliking takes the point back.
await call('POST', `${P.Eve.path}/posts/${a1.id}/like`);
check('unlike removes the point', (await call('GET', `${P.Ann.path}/leaderboard?period=all`)).me.points === 5);
// Levels show next to names in the feed.
const f = await call('GET', `${P.Cat.path}/posts?channelId=${general.id}`);
check('feed authors carry their level', f.posts.find((p) => p.id === a1.id).author.level === 2 && f.posts.find((p) => p.id === b1.id).author.level === 1);
check('portal shows my level', (await call('GET', P.Ann.path)).me.level === 2);
const staffBoard = await call('GET', `/communities/${comm.id}/leaderboard?period=7d`, T);
check('staff leaderboard (no "me")', staffBoard.me === null && staffBoard.top.length === 2);
check('other community unaffected', (await call('GET', `${Z}/leaderboard`)).top.length === 0);
// Banned members drop off the leaderboard.
await call('PUT', `/communities/${comm.id}/members/${P.Bob.id}`, { ...T, body: { status: 'banned' } });
check('banned member hidden', !(await call('GET', `/communities/${comm.id}/leaderboard`, T)).top.some((r) => r.name === 'Bob'));

const other = await call('POST', '/auth/register', { body: { email: `cf-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', `/communities/${comm.id}/leaderboard`, { token: other.accessToken, expect: 404 });
await call('POST', `/communities/${comm.id}/files`, { token: other.accessToken, form: fileForm(pdf, 'x.pdf'), expect: 404 });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
