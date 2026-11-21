// End-to-end checks for community images stored in S3.
// Starts a fake S3 and a second API instance (port 3101, IMAGE_STORAGE=s3) against the same database,
// so the dev servers keep running unchanged. Needs the backend built (dist/) — the dev server keeps it current.
// Usage: node scripts/smoke-s3-images.mjs
import { spawn, execFile } from 'child_process';
import { deflateSync } from 'zlib';
import { fileURLToPath } from 'url';
import path from 'path';
import { startFakeS3 } from './fake-s3.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S3 = { port: 9555, bucket: 'eril-test', accessKeyId: 'TESTKEY', secret: 'test-secret-key', region: 'us-east-1' };
const API_PORT = 3101;
const BASE = `http://localhost:${API_PORT}/api/v1`;
const DB_API = 'http://localhost:3001/api/v1'; // the normal dev API (database storage)
let failures = 0;

function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`);
  if (!cond) failures++;
}
async function call(base, method, p, { token, body, form, expect = [200, 201] } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  const ok = [].concat(expect).includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${p.replace(/community\/[^/?]+/, 'community/<token>')} -> ${res.status}`);
  if (!ok) { failures++; console.log('   ', JSON.stringify(data).slice(0, 300)); }
  return data;
}

function crc32(b) { let c, r = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (r ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return (r ^ 0xffffffff) >>> 0; }
const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), ch('IHDR', ihdr), ch('tEXt', Buffer.from('Comment\0private-note')), ch('IDAT', deflateSync(Buffer.from([0, 9, 9, 9]))), ch('IEND', Buffer.alloc(0))]);
const fileForm = () => { const f = new FormData(); f.append('file', new Blob([png], { type: 'image/png' }), 'x.png'); return f; };

const fake = await startFakeS3(S3);
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.join(root, 'backend'),
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    API_PUBLIC_URL: `http://localhost:${API_PORT}`,
    DISABLE_SCHEDULERS: 'true',
    IMAGE_STORAGE: 's3',
    S3_BUCKET: S3.bucket,
    S3_REGION: S3.region,
    S3_ACCESS_KEY_ID: S3.accessKeyId,
    S3_SECRET_ACCESS_KEY: S3.secret,
    S3_ENDPOINT: `http://localhost:${S3.port}`,
    S3_PREFIX: 'test-images/',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => (apiLog += d));
api.stderr.on('data', (d) => (apiLog += d));
const stop = async () => { api.kill(); await fake.close(); };

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('second API instance started with S3 storage', /S3 bucket "eril-test"/.test(apiLog));

  const rand = Math.random().toString(36).slice(2, 8);
  const reg = await call(BASE, 'POST', '/auth/register', { body: { email: `s3-${rand}@test.local`, password: 'SmokeTest123!', name: 'Coach' } });
  const T = { token: reg.accessToken };
  const me = await call(BASE, 'GET', '/auth/me', T);
  const comm = await call(BASE, 'POST', '/communities', { ...T, body: { name: 'S3 club', digestFrequency: 'off' } });
  const ct = await call(BASE, 'POST', '/crm/contacts', { ...T, body: { firstName: 'Ann', email: `ann-${rand}@ex.test` } });
  const m = await call(BASE, 'POST', `/communities/${comm.id}/members`, { ...T, body: { contactId: ct.id, notify: false } });
  const portal = `/public/community/${m.portalUrl.split('/community/')[1]}`;

  // ---- Upload goes to the bucket, metadata stripped ----
  const up = await call(BASE, 'POST', `${portal}/images`, { form: fileForm() });
  const keyName = `test-images/${me.currentWorkspaceId}/${comm.id}/${up.id}.png`;
  const stored = fake.objects.get(keyName);
  check('object stored under workspace/community/id key', !!stored, [...fake.objects.keys()].join(','));
  check('stored with content type, metadata stripped', stored?.type === 'image/png' && !stored.body.toString('latin1').includes('private-note'));
  check('every S3 call passed signature checks', fake.log.every((l) => !l.error), JSON.stringify(fake.log.filter((l) => l.error)));

  // ---- Serving: our signed link → short-lived S3 link ----
  let res = await fetch(up.url, { redirect: 'manual' });
  const loc = res.headers.get('location') ?? '';
  check('our link redirects to a presigned S3 URL', res.status === 302 && loc.startsWith(`http://localhost:${S3.port}/${S3.bucket}/`) && loc.includes('X-Amz-Signature=') && res.headers.get('referrer-policy') === 'no-referrer');
  res = await fetch(loc);
  const bytes = Buffer.from(await res.arrayBuffer());
  check('S3 serves the image with the right type and caching', res.status === 200 && res.headers.get('content-type') === 'image/png' && res.headers.get('content-disposition') === 'inline' && /private, max-age=\d+/.test(res.headers.get('cache-control')) && bytes.equals(stored.body));
  check('presigned link is stable within 15 minutes (cacheable)', (await fetch(up.url, { redirect: 'manual' })).headers.get('location') === loc);
  check('tampered S3 link rejected by the bucket', (await fetch(loc.replace(/X-Amz-Signature=[0-9a-f]+/, 'X-Amz-Signature=' + '0'.repeat(64)))).status === 403);
  check('our signature still required', (await fetch(up.url.replace(/s=[^&]+/, 's=' + 'A'.repeat(32)), { redirect: 'manual' })).status === 404);

  // ---- Posts with S3 images ----
  const post = await call(BASE, 'POST', `${portal}/posts`, { body: { channelId: comm.channels[1].id, body: 'from S3', imageIds: [up.id] } });
  check('post shows the image', post.images?.[0]?.id === up.id);
  await call(BASE, 'DELETE', `${portal}/posts/${post.id}`);
  check('deleted post: image link stops working', (await fetch(up.url, { redirect: 'manual' })).status === 404);

  // ---- Storage outage: clear error, nothing half-saved ----
  fake.setFailWrites(true);
  const before = fake.objects.size;
  await call(BASE, 'POST', `${portal}/images`, { form: fileForm(), expect: 502 });
  fake.setFailWrites(false);
  check('failed upload leaves nothing behind', fake.objects.size === before);

  // ---- Moving database images to S3 (only this test's workspace) ----
  const dbUp = await call(DB_API, 'POST', `${portal}/images`, { form: fileForm() }); // dev API stores in the database
  let r = await fetch(dbUp.url.replace('localhost:3001', `localhost:${API_PORT}`));
  check('database image still served by the S3 instance', r.status === 200 && r.headers.get('content-type') === 'image/png');
  const out = await new Promise((resolve) =>
    execFile('npm', ['run', 'images:to-s3', '--', '--workspace', me.currentWorkspaceId], { cwd: path.join(root, 'backend'), shell: true, env: { ...process.env, S3_BUCKET: S3.bucket, S3_REGION: S3.region, S3_ACCESS_KEY_ID: S3.accessKeyId, S3_SECRET_ACCESS_KEY: S3.secret, S3_ENDPOINT: `http://localhost:${S3.port}`, S3_PREFIX: 'test-images/' } }, (err, stdout, stderr) => resolve({ err, text: stdout + stderr })),
  );
  check('move script moved the database image', !out.err && /Moved 1 image\(s\); 0 left/.test(out.text), out.text.trim().split('\n').slice(-2).join(' | '));
  check('object now in the bucket', fake.objects.has(`test-images/${me.currentWorkspaceId}/${comm.id}/${dbUp.id}.png`));
  r = await fetch(dbUp.url.replace('localhost:3001', `localhost:${API_PORT}`), { redirect: 'manual' });
  check('moved image now served from S3', r.status === 302);
} catch (e) {
  failures++;
  console.log('FAIL unexpected error', e.message);
} finally {
  await stop();
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
