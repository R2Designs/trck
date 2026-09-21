import { equal, ok } from 'node:assert/strict';

/** Thin aliases so the assertions below read the way Deno's own do. */
const assertEquals = <T>(actual: T, expected: T) => equal(actual, expected);
const assertDeepEquals = (actual: unknown, expected: unknown) =>
  equal(JSON.stringify(actual), JSON.stringify(expected));
const assertStringIncludes = (haystack: string, needle: string) =>
  ok(haystack.includes(needle), `expected to find ${needle}`);
import {
  amzTimestamps,
  authorizationHeader,
  canonicalQueryString,
  encodeKey,
  presignUrl,
  sha256Hex,
  uriEncode,
} from './sigv4.ts';
import type { SigV4Credentials } from './sigv4.ts';

/**
 * These tests exist because a wrong signature does not fail loudly — it
 * produces a URL that returns 403, every image in the product goes blank, and
 * nothing in the logs says why. The first case is AWS's own published vector,
 * so this file verifies the implementation against the specification rather
 * than against itself.
 */

const CREDENTIALS: SigV4Credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};

const FIXED_CLOCK = new Date('2013-05-24T00:00:00.000Z');

Deno.test('presigned GET matches the AWS published signature vector', async () => {
  const url = await presignUrl({
    credentials: CREDENTIALS,
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    canonicalUri: '/test.txt',
    expiresInSeconds: 86_400,
    now: FIXED_CLOCK,
  });

  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  assertStringIncludes(
    url,
    'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
  assertStringIncludes(
    url,
    'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
  );
  assertStringIncludes(url, 'X-Amz-Date=20130524T000000Z');
  assertStringIncludes(url, 'X-Amz-Expires=86400');
});

Deno.test('signed DELETE header matches an independently computed signature', async () => {
  const payloadHash = await sha256Hex('');
  const host = 'examplebucket.s3.amazonaws.com';
  const canonicalUri = encodeKey(
    '/trck-dashboards/organizations/11111111-1111-1111-1111-111111111111/buses/b/dashboard/x.jpg',
  );

  const { authorization, amzDate } = await authorizationHeader({
    credentials: CREDENTIALS,
    method: 'DELETE',
    canonicalUri,
    headers: { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': '20130524T000000Z' },
    payloadHash,
    now: FIXED_CLOCK,
  });

  assertEquals(amzDate, '20130524T000000Z');
  assertStringIncludes(
    authorization,
    'Signature=a903030eff7f754b4ce2c3671ee5d689cb53bb110786cbc840020fe4a4d5abf8',
  );
  assertStringIncludes(authorization, 'SignedHeaders=host;x-amz-content-sha256;x-amz-date');
});

Deno.test('uriEncode escapes the characters encodeURIComponent leaves alone', () => {
  assertEquals(uriEncode("a!b'c(d)e*f"), 'a%21b%27c%28d%29e%2Af');
  // Unreserved characters must survive untouched.
  assertEquals(uriEncode('AZaz09-_.~'), 'AZaz09-_.~');
  assertEquals(uriEncode('a/b'), 'a%2Fb');
});

Deno.test('encodeKey keeps path separators but escapes each segment', () => {
  assertEquals(
    encodeKey('organizations/abc/buses/my bus/photo (1).jpg'),
    'organizations/abc/buses/my%20bus/photo%20%281%29.jpg',
  );
});

Deno.test('canonical query string is sorted by encoded key', () => {
  assertEquals(
    canonicalQueryString({ b: '2', a: '1', 'X-Amz-Date': '20260921T000000Z' }),
    'X-Amz-Date=20260921T000000Z&a=1&b=2',
  );
});

Deno.test('amzTimestamps derives both forms from one clock', () => {
  assertDeepEquals(amzTimestamps(new Date('2026-09-21T09:30:00.000Z')), {
    amzDate: '20260921T093000Z',
    dateStamp: '20260921',
  });
});
