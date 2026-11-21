/**
 * Minimal S3 client (AWS Signature V4) for put/get/delete and presigned GET links.
 * Works with AWS S3 and S3-compatible services (Cloudflare R2, DigitalOcean Spaces, MinIO).
 * Pure apart from `fetch`, so the signing is unit-tested against AWS's published examples.
 */
import { createHash, createHmac } from 'crypto';

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint, e.g. https://<account>.r2.cloudflarestorage.com or http://localhost:9000. Default: AWS. */
  endpoint?: string;
  /** bucket in the path (MinIO, most custom endpoints) instead of the hostname. */
  forcePathStyle?: boolean;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
export const EMPTY_SHA256 = sha256('');

/** RFC 3986 encoding as S3 expects it (encodeURIComponent leaves !'()* alone). */
export const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeKey = (key: string) => key.split('/').map(uriEncode).join('/');

export function amzDate(now: Date) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Where a key lives: host + path for virtual-hosted or path-style addressing. */
export function locate(cfg: S3Config, key: string) {
  const base = cfg.endpoint ? new URL(cfg.endpoint) : new URL(`https://s3.${cfg.region}.amazonaws.com`);
  const pathStyle = cfg.forcePathStyle ?? !!cfg.endpoint;
  const host = pathStyle ? base.host : `${cfg.bucket}.${base.host}`;
  const path = `${pathStyle ? `/${uriEncode(cfg.bucket)}` : ''}/${encodeKey(key)}`;
  return { origin: `${base.protocol}//${host}`, host, path };
}

function signingKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request');
}

const canonicalQuery = (q: Record<string, string>) =>
  Object.keys(q)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`)
    .join('&');

/**
 * Signs a request with headers (Authorization header style).
 * `headers` must include everything to sign except host/x-amz-date/x-amz-content-sha256, which are added.
 */
export function signRequest(
  cfg: S3Config,
  i: { method: string; key: string; headers?: Record<string, string>; payloadHash?: string; query?: Record<string, string>; now?: Date },
) {
  const now = i.now ?? new Date();
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const { origin, host, path } = locate(cfg, i.key);
  const payloadHash = i.payloadHash ?? EMPTY_SHA256;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = String(v).trim();
  headers.host = host;
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = stamp;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const query = canonicalQuery(i.query ?? {});
  const canonical = [i.method, path, query, names.map((n) => `${n}:${headers[n]}\n`).join(''), signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, date, cfg.region)).update(toSign).digest('hex');
  const { host: _h, ...sendHeaders } = headers;
  return {
    url: `${origin}${path}${query ? `?${query}` : ''}`,
    signature,
    headers: { ...sendHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}

/** A time-limited GET link (query-string signing), e.g. to redirect a browser to the object. */
export function presignGet(cfg: S3Config, key: string, expiresSeconds: number, extra: Record<string, string> = {}, now = new Date()) {
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const { origin, host, path } = locate(cfg, key);
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    ...extra,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(expiresSeconds)))),
    'X-Amz-SignedHeaders': 'host',
  };
  const q = canonicalQuery(query);
  const canonical = ['GET', path, q, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, date, cfg.region)).update(toSign).digest('hex');
  return `${origin}${path}?${q}&X-Amz-Signature=${signature}`;
}

async function s3Error(res: Response, what: string) {
  const text = await res.text().catch(() => '');
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
  return new Error(`S3 ${what} failed: ${res.status}${code ? ` ${code}` : ''}`);
}

export async function putObject(cfg: S3Config, key: string, body: Buffer, contentType: string) {
  const s = signRequest(cfg, { method: 'PUT', key, payloadHash: sha256(body), headers: { 'content-type': contentType, 'content-length': String(body.length) } });
  const res = await fetch(s.url, { method: 'PUT', headers: s.headers, body: new Uint8Array(body) });
  if (!res.ok) throw await s3Error(res, 'upload');
}

export async function getObject(cfg: S3Config, key: string): Promise<Buffer | null> {
  const s = signRequest(cfg, { method: 'GET', key });
  const res = await fetch(s.url, { headers: s.headers });
  if (res.status === 404) return null;
  if (!res.ok) throw await s3Error(res, 'download');
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(cfg: S3Config, key: string) {
  const s = signRequest(cfg, { method: 'DELETE', key });
  const res = await fetch(s.url, { method: 'DELETE', headers: s.headers });
  if (!res.ok && res.status !== 404) throw await s3Error(res, 'delete');
}

/** Reads S3 settings from the environment; null when not configured. */
export function s3FromEnv(get: (k: string) => string | undefined): S3Config | null {
  const bucket = get('S3_BUCKET');
  const accessKeyId = get('S3_ACCESS_KEY_ID');
  const secretAccessKey = get('S3_SECRET_ACCESS_KEY');
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const fps = get('S3_FORCE_PATH_STYLE');
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: get('S3_REGION') || 'us-east-1',
    endpoint: get('S3_ENDPOINT') || undefined,
    forcePathStyle: fps === undefined || fps === '' ? undefined : fps === 'true',
  };
}
