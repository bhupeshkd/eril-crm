import { describe, expect, it } from 'vitest';
import { locate, presignGet, s3FromEnv, signRequest, uriEncode } from './s3';

// Credentials and expected signatures from the AWS S3 Signature V4 documentation examples.
const aws = {
  bucket: 'examplebucket',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  endpoint: 'https://s3.amazonaws.com',
  forcePathStyle: false,
};
const now = new Date('2013-05-24T00:00:00Z');

describe('S3 Signature V4 (AWS published examples)', () => {
  it('GET Object with a Range header', () => {
    const s = signRequest(aws, { method: 'GET', key: 'test.txt', headers: { range: 'bytes=0-9' }, now });
    expect(s.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(s.url).toBe('https://examplebucket.s3.amazonaws.com/test.txt');
    expect(s.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
  it('presigned GET URL', () => {
    const url = presignGet(aws, 'test.txt', 86400, {}, now);
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});

describe('addressing and config', () => {
  it('uses path style for custom endpoints and virtual hosts for AWS', () => {
    expect(locate({ ...aws, endpoint: 'http://localhost:9000', forcePathStyle: undefined }, 'a/b c.png')).toEqual({ origin: 'http://localhost:9000', host: 'localhost:9000', path: '/examplebucket/a/b%20c.png' });
    expect(locate({ ...aws, endpoint: undefined, region: 'eu-west-2' }, 'k').origin).toBe('https://examplebucket.s3.eu-west-2.amazonaws.com');
  });
  it('encodes like S3 expects', () => {
    expect(uriEncode("a b!'()*~")).toBe('a%20b%21%27%28%29%2A~');
  });
  it('reads env and requires credentials', () => {
    const env = (o: Record<string, string>) => (k: string) => o[k];
    expect(s3FromEnv(env({ S3_BUCKET: 'b' }))).toBeNull();
    expect(s3FromEnv(env({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_FORCE_PATH_STYLE: 'false' }))).toEqual({
      bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', region: 'us-east-1', endpoint: undefined, forcePathStyle: false,
    });
  });
});
