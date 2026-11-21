// End-to-end checks for images on community posts.
// Usage: node scripts/smoke-community-images.mjs [baseUrl]   (API must be running)
import { deflateSync } from 'zlib';
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3001/api/v1';
let failures = 0;

async function call(method, path, { token, body, form, expect = [200, 201] } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.replace(/community\/[^/?]+/, 'community/<token>')} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
const rand = Math.random().toString(36).slice(2, 8);
const tokenOf = (url) => url.split('/community/')[1];

// ---- Test files ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('tEXt', Buffer.from('Comment\0secret-author-note')),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const seg = (marker, payload) => { const h = Buffer.from([0xff, marker, 0, 0]); h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]); };
const jpegWithGps = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01')), seg(0xe1, Buffer.from('Exif\0\0GPSLatitude 37.7749 GPSLongitude -122.4194')), Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script></svg>');
const fileForm = (buf, name, type) => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return f; };

// ---- Setup ----
const reg = await call('POST', '/auth/register', { body: { email: `ci-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach Kim' } });
const T = { token: reg.accessToken };
const comm = await call('POST', '/communities', { ...T, body: { name: 'Photo club', digestFrequency: 'off' } });
const comm2 = await call('POST', '/communities', { ...T, body: { name: 'Other club', digestFrequency: 'off' } });
const general = comm.channels[1];
const P = {};
for (const n of ['Ann', 'Bob', 'Eve']) {
  const c = await call('POST', '/crm/contacts', { ...T, body: { firstName: n, email: `${n.toLowerCase()}-${rand}@ex.test` } });
  const m = await call('POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: c.id, notify: false } });
  P[n] = { id: m.id, path: `/public/community/${tokenOf(m.portalUrl)}` };
}
await call('PUT', `/communities/${comm.id}/members/${P.Eve.id}`, { ...T, body: { status: 'banned' } });

// ---- Upload validation ----
await call('POST', `${P.Ann.path}/images`, { form: fileForm(svg, 'cat.svg', 'image/svg+xml'), expect: 400 });
await call('POST', `${P.Ann.path}/images`, { form: fileForm(svg, 'cat.png', 'image/png'), expect: 400 }); // lies about its type
await call('POST', `${P.Ann.path}/images`, { form: fileForm(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'broken.jpg', 'image/jpeg'), expect: 400 });
await call('POST', `${P.Ann.path}/images`, { form: fileForm(Buffer.alloc(5 * 1024 * 1024 + 10, 1), 'huge.png', 'image/png'), expect: [400, 413] });
await call('POST', `${P.Ann.path}/images`, { form: new FormData(), expect: 400 });
await call('POST', `${P.Eve.path}/images`, { form: fileForm(png, 'x.png', 'image/png'), expect: 403 });

const up1 = await call('POST', `${P.Ann.path}/images`, { form: fileForm(png, 'dot.png', 'image/png') });
const up2 = await call('POST', `${P.Ann.path}/images`, { form: fileForm(jpegWithGps, 'beach.jpg', 'image/jpeg') });
check('upload returns id and signed link', up1.id && /\/public\/community-images\/[0-9a-f-]+\?e=\d+&s=/.test(up1.url));

// ---- Serving ----
let res = await fetch(up1.url);
let bytes = Buffer.from(await res.arrayBuffer());
check('served as PNG with safe headers', res.status === 200 && res.headers.get('content-type') === 'image/png' && res.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(res.headers.get('content-security-policy') ?? ''));
check('PNG text metadata stripped, pixels kept', !bytes.toString('latin1').includes('secret-author-note') && bytes.includes(Buffer.from('IDAT')));
res = await fetch(up2.url);
bytes = Buffer.from(await res.arrayBuffer());
check('JPEG GPS location stripped', res.status === 200 && !bytes.toString('latin1').includes('GPSLatitude') && bytes.toString('latin1').includes('JFIF'));
const u = new URL(up1.url);
check('tampered signature rejected', (await fetch(up1.url.replace(/s=[^&]+/, 's=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status === 404);
check('expired link rejected', (await fetch(`${u.origin}${u.pathname}?e=${Date.now() - 1000}&s=${u.searchParams.get('s')}`)).status === 404);
check('link for another image rejected', (await fetch(up2.url.replace(up2.id, up1.id))).status === 404);

// ---- Attaching ----
const bobUp = await call('POST', `${P.Bob.path}/images`, { form: fileForm(png, 'bob.png', 'image/png') });
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'stealing', imageIds: [bobUp.id] }, expect: 400 });
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: '' }, expect: 400 });
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'too many', imageIds: [up1.id, up2.id, bobUp.id, up1.id, up2.id] }, expect: 400 });
const post = await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: '', imageIds: [up2.id, up1.id] } });
check('photo-only post with images in order', post.body === '' && post.images.map((i) => i.id).join() === `${up2.id},${up1.id}`);
await call('POST', `${P.Ann.path}/posts`, { body: { channelId: general.id, body: 'again', imageIds: [up1.id] }, expect: 400 }); // already used
const feed = await call('GET', `${P.Bob.path}/posts`);
const seen = feed.posts.find((p) => p.id === post.id);
check('other members get working links', seen?.images.length === 2 && (await fetch(seen.images[0].url)).status === 200);

// Staff can upload; uploads can't cross communities
const staffUp = await call('POST', `/communities/${comm.id}/images`, { ...T, form: fileForm(png, 'team.png', 'image/png') });
await call('POST', `/communities/${comm2.id}/posts`, { ...T, body: { channelId: comm2.channels[0].id, body: 'wrong club', imageIds: [staffUp.id] }, expect: 400 });
const staffPost = await call('POST', `/communities/${comm.id}/posts`, { ...T, body: { channelId: comm.channels[0].id, body: 'Team photo', imageIds: [staffUp.id] } });
check('staff post with image', staffPost.images.length === 1);
const stranger = await call('POST', '/auth/register', { body: { email: `ci-x-${rand}@test.local`, password: 'SmokeTest123!', name: 'X' } });
await call('POST', `/communities/${comm.id}/images`, { token: stranger.accessToken, form: fileForm(png, 'x.png', 'image/png'), expect: 404 });

// ---- Deleting a post takes its images ----
await call('DELETE', `${P.Ann.path}/posts/${post.id}`);
check('images of a deleted post stop loading', (await fetch(seen.images[0].url)).status === 404);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
