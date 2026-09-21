/**
 * AWS Signature Version 4, the small part of it this product needs.
 *
 * Written out rather than pulled from an SDK for two reasons: the whole of
 * what is required is a query presigner and one signed DELETE, and this
 * function runs on every image view, where a multi-megabyte dependency is a
 * real cost.
 *
 * Everything here is pure apart from `crypto.subtle`, and the clock is a
 * parameter — which is what makes it testable against AWS's published
 * signature vectors. `sigv4_test.ts` does exactly that.
 */

const encoder = new TextEncoder();

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * RFC 3986 percent-encoding.
 *
 * `encodeURIComponent` leaves `!'()*` alone, and SigV4's canonical request
 * requires them encoded. A single unescaped `(` in an object key is enough to
 * make every signature for that object wrong.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Object keys keep their separators; each segment is encoded individually. */
export function encodeKey(key: string): string {
  return key.split('/').map(uriEncode).join('/');
}

/** `20260921T093000Z` and `20260921` from a Date. */
export function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function credentialScope(credentials: SigV4Credentials, dateStamp: string): string {
  return `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
}

export async function signingKey(
  credentials: SigV4Credentials,
  dateStamp: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, credentials.region);
  const kService = await hmac(kRegion, credentials.service);
  return hmac(kService, 'aws4_request');
}

/** Sorted by key, RFC 3986 encoded, `&`-joined — the canonical query string. */
export function canonicalQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

export interface CanonicalRequest {
  method: string;
  canonicalUri: string;
  canonicalQuery: string;
  /** Lower-cased header names mapped to trimmed values. */
  headers: Record<string, string>;
  payloadHash: string;
}

export function buildCanonicalRequest(request: CanonicalRequest): {
  canonical: string;
  signedHeaders: string;
} {
  const names = Object.keys(request.headers)
    .map((name) => name.toLowerCase())
    .sort();
  const headerBlock = names
    .map((name) => `${name}:${request.headers[name]?.trim() ?? ''}\n`)
    .join('');
  const signedHeaders = names.join(';');

  return {
    canonical: [
      request.method,
      request.canonicalUri,
      request.canonicalQuery,
      headerBlock,
      signedHeaders,
      request.payloadHash,
    ].join('\n'),
    signedHeaders,
  };
}

export async function signatureFor(
  credentials: SigV4Credentials,
  amzDate: string,
  dateStamp: string,
  canonicalRequest: string,
): Promise<string> {
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope(credentials, dateStamp),
    await sha256Hex(canonicalRequest),
  ].join('\n');
  return toHex(await hmac(await signingKey(credentials, dateStamp), stringToSign));
}

/**
 * A presigned URL. The payload is `UNSIGNED-PAYLOAD` because the body is
 * streamed straight from a camera capture and is not hashed client-side.
 */
export async function presignUrl(params: {
  credentials: SigV4Credentials;
  method: 'GET' | 'PUT';
  host: string;
  canonicalUri: string;
  expiresInSeconds: number;
  now: Date;
}): Promise<string> {
  const { amzDate, dateStamp } = amzTimestamps(params.now);
  const canonicalQuery = canonicalQueryString({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${params.credentials.accessKeyId}/${credentialScope(params.credentials, dateStamp)}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(params.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  });

  const { canonical } = buildCanonicalRequest({
    method: params.method,
    canonicalUri: params.canonicalUri,
    canonicalQuery,
    headers: { host: params.host },
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const signature = await signatureFor(params.credentials, amzDate, dateStamp, canonical);
  return `https://${params.host}${params.canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** An `Authorization` header for a request sent from this function itself. */
export async function authorizationHeader(params: {
  credentials: SigV4Credentials;
  method: string;
  canonicalUri: string;
  headers: Record<string, string>;
  payloadHash: string;
  now: Date;
}): Promise<{ authorization: string; amzDate: string }> {
  const { amzDate, dateStamp } = amzTimestamps(params.now);
  const { canonical, signedHeaders } = buildCanonicalRequest({
    method: params.method,
    canonicalUri: params.canonicalUri,
    canonicalQuery: '',
    headers: params.headers,
    payloadHash: params.payloadHash,
  });

  const signature = await signatureFor(params.credentials, amzDate, dateStamp, canonical);
  const scope = credentialScope(params.credentials, dateStamp);

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${params.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
  };
}
