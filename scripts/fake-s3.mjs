// A tiny in-memory S3 stand-in for tests: path-style /<bucket>/<key>, verifies AWS SigV4
// (header-signed and presigned) with its own implementation, so signing bugs can't hide.
import { createHash, createHmac } from 'crypto';
import { createServer } from 'http';

const sha = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const key = (secret, date, region) => hmac(hmac(hmac(hmac('AWS4' + secret, date), region), 's3'), 'aws4_request');
const canonQuery = (params) => [...params].filter(([k]) => k !== 'X-Amz-Signature').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

export function startFakeS3({ port, bucket, accessKeyId, secret, region = 'us-east-1' }) {
  const objects = new Map(); // key -> { body, type }
  const log = [];
  let failWrites = false;

  function verify(req, url, body) {
    const path = url.pathname; // already encoded as sent
    const q = url.searchParams;
    if (q.has('X-Amz-Signature')) {
      const [ak, date, reg] = q.get('X-Amz-Credential').split('/');
      if (ak !== accessKeyId || reg !== region) return 'bad credential';
      const stamp = q.get('X-Amz-Date');
      const t = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15));
      if (Date.now() > t + Number(q.get('X-Amz-Expires')) * 1000) return 'expired';
      const canonical = ['GET', path, canonQuery(q), `host:${req.headers.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
      const toSign = ['AWS4-HMAC-SHA256', stamp, `${date}/${region}/s3/aws4_request`, sha(canonical)].join('\n');
      return createHmac('sha256', key(secret, date, region)).update(toSign).digest('hex') === q.get('X-Amz-Signature') ? null : 'bad presign';
    }
    const auth = req.headers.authorization ?? '';
    const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/);
    if (!m || m[1] !== accessKeyId || m[3] !== region) return 'bad auth header';
    const payload = req.headers['x-amz-content-sha256'];
    if (payload !== sha(body)) return 'payload hash mismatch';
    const names = m[4].split(';');
    const canonical = [req.method, path, canonQuery(q), names.map((n) => `${n}:${String(req.headers[n]).trim()}\n`).join(''), m[4], payload].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], `${m[2]}/${region}/s3/aws4_request`, sha(canonical)].join('\n');
    return createHmac('sha256', key(secret, m[2], region)).update(toSign).digest('hex') === m[5] ? null : 'bad signature';
  }

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split('/').slice(1);
      const err = verify(req, url, body);
      log.push({ method: req.method, path: url.pathname, presigned: url.searchParams.has('X-Amz-Signature'), error: err });
      if (err) return res.writeHead(403).end(`<Error><Code>SignatureDoesNotMatch</Code><Message>${err}</Message></Error>`);
      if (parts[0] !== bucket) return res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
      const k = parts.slice(1).map(decodeURIComponent).join('/');
      if (req.method === 'PUT') {
        if (failWrites) return res.writeHead(503).end('<Error><Code>SlowDown</Code></Error>');
        objects.set(k, { body, type: req.headers['content-type'] });
        return res.writeHead(200).end();
      }
      if (req.method === 'DELETE') {
        objects.delete(k);
        return res.writeHead(204).end();
      }
      const o = objects.get(k);
      if (!o) return res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      res.writeHead(200, {
        'Content-Type': url.searchParams.get('response-content-type') ?? o.type,
        'Content-Disposition': url.searchParams.get('response-content-disposition') ?? '',
        'Cache-Control': url.searchParams.get('response-cache-control') ?? '',
      });
      res.end(o.body);
    });
  });
  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        objects,
        log,
        setFailWrites: (v) => (failWrites = v),
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}
