// End-to-end checks for site blogs (drafts, scheduling, tags, RSS, privacy) and dynamic QR codes (redirects, scans, SVG).
// Usage: node scripts/smoke-blog-qr.mjs [baseUrl]   (API must be running)
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;
async function call(method, path, { token, body, expect = [200, 201], raw = false, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  if (!raw) try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)); }
  return raw ? { status: res.status, text, headers: res.headers } : data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const reg = await call('POST', '/auth/register', { body: { email: `blog-${rand}@test.local`, password: 'SmokeTest123!', name: 'Nora Writer' } });
const T = { token: reg.accessToken };
const site = await call('POST', '/sites', { ...T, body: { name: `Bloom ${rand}`, template: 'blank' } });
const P = `/sites/${site.id}/posts`;
const PUB = `/public/sites/${site.slug}/blog`;

// ---- Drafts and validation ----
await call('POST', P, { ...T, body: {}, expect: 400 });
await call('POST', P, { ...T, body: { title: 'X', coverImageUrl: 'http://insecure.example/a.png' }, expect: 400 });
await call('POST', P, { ...T, body: { title: 'X', slug: 'Bad Slug!' }, expect: 400 });
await call('POST', P, { ...T, body: { title: 'X', status: 'live' }, expect: 400 });
const draft = await call('POST', P, { ...T, body: { title: 'Glazing 101: A Beginner’s Guide', body: '## Why glaze?\n\nGlaze makes pots **food safe**.\n\n- dip\n- brush', tags: [' Glaze ', 'glaze', 'Beginners'] } });
check('draft created with slug, cleaned tags', draft.slug === 'glazing-101-a-beginner-s-guide' && draft.state === 'draft' && JSON.stringify(draft.tags) === '["glaze","beginners"]' && draft.publishedAt === null, draft.slug);
const dup = await call('POST', P, { ...T, body: { title: 'Glazing 101: A Beginner’s Guide' } });
check('duplicate titles get a numbered URL', dup.slug === 'glazing-101-a-beginner-s-guide-2');
await call('PUT', `${P}/${dup.id}`, { ...T, body: { slug: draft.slug }, expect: 409 });
await call('DELETE', `${P}/${dup.id}`, T);

// Site not published → blog not public.
await call('GET', PUB, { expect: 404 });
await call('PUT', `/sites/${site.id}`, { ...T, body: { isPublished: true } });
let list = await call('GET', PUB);
check('drafts are not public', list.posts.length === 0 && list.total === 0);
await call('GET', `${PUB}/${draft.slug}`, { expect: 404 });
check('no Blog link yet', (await call('GET', `/public/sites/${site.slug}`)).hasBlog === false);

// ---- Publishing, scheduling ----
const live = await call('PUT', `${P}/${draft.id}`, { ...T, body: { status: 'published', authorName: 'Nora' } });
check('publishing sets the date to now', live.state === 'published' && live.publishedAt && Date.now() - Date.parse(live.publishedAt) < 60_000);
const older = await call('POST', P, { ...T, body: { title: 'Choosing your first clay', body: 'Stoneware or earthenware? ' + 'word '.repeat(420), status: 'published', publishedAt: new Date(Date.now() - 3 * 86400e3).toISOString(), tags: ['clay', 'beginners'], coverImageUrl: 'https://images.example/clay.jpg' } });
const future = await call('POST', P, { ...T, body: { title: 'Summer kiln party', body: 'Coming soon', status: 'published', publishedAt: new Date(Date.now() + 5 * 86400e3).toISOString() } });
check('future date = scheduled', future.state === 'scheduled');
list = await call('GET', PUB);
check('public list: published only, newest first', list.posts.map((p) => p.slug).join() === `${draft.slug},${older.slug}`, list.posts.map((p) => p.slug).join());
check('cards have excerpt, reading time, site nav', list.posts[1].readMinutes === 2 && list.posts[1].excerpt.startsWith('Stoneware or earthenware?') && list.posts[1].excerpt.endsWith('…') && list.site.name === site.name);
check('tag counts', JSON.stringify(list.tags.find((t) => t.tag === 'beginners')) === '{"tag":"beginners","count":2}');
await call('GET', `${PUB}/${future.slug}`, { expect: 404 });
check('site shows a Blog link', (await call('GET', `/public/sites/${site.slug}`)).hasBlog === true);

const byTag = await call('GET', `${PUB}?tag=clay`);
check('tag filter', byTag.posts.length === 1 && byTag.posts[0].slug === older.slug && byTag.tag === 'clay');
await call('GET', `${PUB}?page=0`, { expect: 400 });

// ---- Post page ----
const post = await call('GET', `${PUB}/${draft.slug}`);
check('post page has body, SEO fallbacks and neighbours', post.post.body.includes('food safe') && post.post.seoTitle === draft.title && post.post.seoDescription.startsWith('Why glaze?') && post.older?.slug === older.slug && post.newer === null);
await call('POST', `${PUB}/${draft.slug}/view`);
await call('POST', `${PUB}/${draft.slug}/view`);
await call('POST', `${PUB}/${future.slug}/view`);
const rows = await call('GET', P, T);
check('views counted for live posts only', rows.find((r) => r.id === draft.id).views === 2 && rows.find((r) => r.id === future.id).views === 0);
check('staff list hides bodies', rows.every((r) => r.body === undefined));

// ---- RSS ----
const rss = await call('GET', `${PUB}/rss.xml`, { raw: true });
check('RSS feed is XML with live posts only', rss.headers.get('content-type').includes('application/rss+xml') && rss.text.startsWith('<?xml') && rss.text.includes(`/blog/${draft.slug}</link>`) && !rss.text.includes(future.slug) && rss.text.includes('Beginner&apos;s') === false && rss.text.includes('<category>beginners</category>'));

// ---- Unpublishing and isolation ----
await call('PUT', `${P}/${draft.id}`, { ...T, body: { status: 'draft' } });
await call('GET', `${PUB}/${draft.slug}`, { expect: 404 });
const other = await call('POST', '/auth/register', { body: { email: `blog-o-${rand}@test.local`, password: 'SmokeTest123!', name: 'Other' } });
await call('GET', P, { token: other.accessToken, expect: 404 });
await call('PUT', `${P}/${draft.id}`, { token: other.accessToken, body: { title: 'Hijack' }, expect: 404 });
await call('PUT', `/sites/${site.id}`, { ...T, body: { isPublished: false } });
await call('GET', `${PUB}/rss.xml`, { expect: 404, raw: true });

// ---- QR codes ----
await call('POST', '/qr-codes', { ...T, body: { name: 'Bad', destination: 'javascript:alert(1)' }, expect: 400 });
await call('POST', '/qr-codes', { ...T, body: { name: 'Bad', destination: 'ftp://files.example' }, expect: 400 });
await call('POST', '/qr-codes', { ...T, body: { name: 'Bad', destination: 'https://x.io', color: 'red' }, expect: 400 });
const qr = await call('POST', '/qr-codes', { ...T, body: { name: 'Spring Flyer', destination: 'https://bloom.example/classes?ref=flyer' } });
check('QR code created with a short scan link', /^[A-Za-z0-9]{8}$/.test(qr.code) && qr.scanUrl.endsWith(`/public/qr/${qr.code}`) && qr.utm === true && qr.ecLevel === 'M');
const svg = await call('GET', `/qr-codes/${qr.id}/svg`, { ...T, raw: true });
check('SVG served', svg.headers.get('content-type').startsWith('image/svg+xml') && svg.text.startsWith('<svg') && svg.text.includes('fill="#000000"'));
const dl = await call('GET', `/qr-codes/${qr.id}/svg?download=1`, { ...T, raw: true });
check('download has a filename', (dl.headers.get('content-disposition') || '').includes('Spring-Flyer.svg'));

const S = `/public/qr/${qr.code}`;
let r = await call('GET', S, { raw: true, expect: 302, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } });
check('scan redirects with UTM tags', r.headers.get('location') === 'https://bloom.example/classes?ref=flyer&utm_source=qr&utm_medium=qr&utm_campaign=spring-flyer', r.headers.get('location'));
await call('GET', S, { raw: true, expect: 302, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' } });
await call('GET', S, { raw: true, expect: 302, headers: { 'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 17_0)' } });
let stats = await call('GET', `/qr-codes/${qr.id}/stats`, T);
check('scans counted by day and device', stats.total === 3 && stats.days.length === 30 && stats.days.at(-1).scans === 3 && stats.devices[0].device === 'ios' && stats.devices[0].scans === 2, JSON.stringify(stats.devices));

// Change destination without reprinting; turn off UTM.
await call('PUT', `/qr-codes/${qr.id}`, { ...T, body: { destination: 'https://bloom.example/summer', utm: false, color: '#1E3A8A', ecLevel: 'H' } });
r = await call('GET', S, { raw: true, expect: 302 });
check('same code, new destination', r.headers.get('location') === 'https://bloom.example/summer');
check('style applied to SVG', (await call('GET', `/qr-codes/${qr.id}/svg`, { ...T, raw: true })).text.includes('fill="#1e3a8a"'));

// Paused and unknown codes don't redirect (and don't count).
await call('PUT', `/qr-codes/${qr.id}`, { ...T, body: { isActive: false } });
r = await call('GET', S, { raw: true, expect: 404 });
check('paused code shows a friendly page', r.text.includes('no longer active'));
await call('GET', '/public/qr/zzzzzzzz', { raw: true, expect: 404 });
await call('GET', '/public/qr/../../etc', { raw: true, expect: 404 });
check('paused scans not counted', (await call('GET', `/qr-codes/${qr.id}/stats`, T)).total === 4);

await call('GET', `/qr-codes/${qr.id}/svg`, { token: other.accessToken, raw: true, expect: 404 });
await call('PUT', `/qr-codes/${qr.id}`, { token: other.accessToken, body: { destination: 'https://evil.example' }, expect: 404 });
check('other workspace sees none', (await call('GET', '/qr-codes', { token: other.accessToken })).length === 0);

await call('DELETE', `/qr-codes/${qr.id}`, T);
await call('GET', S, { raw: true, expect: 404 });
check('deleted code gone from list', (await call('GET', '/qr-codes', T)).length === 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
