import { authenticate } from '../_shared/auth.ts';
import { errorResponse, json, preflight, PublicError, readJson } from '../_shared/http.ts';
import {
  amzTimestamps,
  authorizationHeader,
  encodeKey,
  presignUrl,
  sha256Hex,
} from '../_shared/sigv4.ts';
import type { SigV4Credentials } from '../_shared/sigv4.ts';
import { assertOwnedObjectKey } from '../_shared/object-keys.ts';

/**
 * S3-compatible signing for the Cloudflare R2 storage adapter.
 *
 * R2 charges nothing for egress, which makes it the sensible home for
 * dashboard photographs once there are a lot of them. The cost is that S3
 * signing needs a secret key, and a secret key cannot live in a browser
 * bundle — so the browser asks this function for a URL that works for a few
 * minutes, for one object, and only inside its own tenant.
 *
 * The tenant check is not a formality. Every object key in this product starts
 * `organizations/{orgId}/…`, and this function refuses to sign anything whose
 * second segment is not the caller's organisation — so a manipulated path in a
 * request body signs nothing rather than signing another operator's photos.
 *
 * Signatures are computed here with AWS SigV4 rather than with an SDK: the
 * whole of what is needed is about sixty lines, and it avoids pulling a large
 * dependency into a function that runs on every image view.
 */

type Operation = 'put' | 'get' | 'get-batch' | 'delete';

interface RequestBody {
  operation?: Operation;
  bucket?: 'faces' | 'dashboards';
  path?: string;
  paths?: string[];
  contentType?: string;
  expiresInSeconds?: number;
}

const MAX_EXPIRY_SECONDS = 3600;
const DEFAULT_EXPIRY_SECONDS = 300;
const MAX_BATCH = 50;

const BUCKET_ENV: Record<'faces' | 'dashboards', string> = {
  faces: 'R2_BUCKET_FACES',
  dashboards: 'R2_BUCKET_DASHBOARDS',
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const body = await readJson<RequestBody>(request);
    const caller = await authenticate(request);

    const bucketKind = body.bucket;
    if (bucketKind !== 'faces' && bucketKind !== 'dashboards') {
      throw new PublicError('INVALID_BUCKET', 400);
    }
    const bucket = requireEnv(BUCKET_ENV[bucketKind]);
    const expiresIn = clampExpiry(body.expiresInSeconds);

    switch (body.operation) {
      case 'put': {
        const path = assertOwnedObjectKey(caller.organizationId, body.path);
        const url = await presign('PUT', bucket, path, expiresIn);
        return json(request, { url, bucket, expiresInSeconds: expiresIn });
      }
      case 'get': {
        const path = assertOwnedObjectKey(caller.organizationId, body.path);
        const url = await presign('GET', bucket, path, expiresIn);
        return json(request, { url, bucket, expiresInSeconds: expiresIn });
      }
      case 'get-batch': {
        const paths = body.paths ?? [];
        if (paths.length === 0) return json(request, { urls: [], expiresInSeconds: expiresIn });
        if (paths.length > MAX_BATCH) throw new PublicError('BATCH_TOO_LARGE', 400);

        const urls = await Promise.all(
          paths.map(async (path) => ({
            path,
            url: await presign(
              'GET',
              bucket,
              assertOwnedObjectKey(caller.organizationId, path),
              expiresIn,
            ),
          })),
        );
        return json(request, { urls, expiresInSeconds: expiresIn });
      }
      case 'delete': {
        // Deletion happens here rather than through a signed URL handed to the
        // browser: a DELETE URL that leaks is far worse than a GET one, and
        // this is the only place that needs it (media retention purging).
        const paths = (body.paths ?? []).map((path) =>
          assertOwnedObjectKey(caller.organizationId, path),
        );
        if (paths.length > MAX_BATCH) throw new PublicError('BATCH_TOO_LARGE', 400);
        for (const path of paths) await deleteObject(bucket, path);
        return json(request, { deleted: paths.length });
      }
      default:
        throw new PublicError('UNKNOWN_OPERATION', 400);
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function clampExpiry(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_EXPIRY_SECONDS;
  return Math.min(Math.max(Math.round(requested), 60), MAX_EXPIRY_SECONDS);
}

// ---------------------------------------------------------------------------
// R2 wiring
// ---------------------------------------------------------------------------

function r2Credentials(): SigV4Credentials {
  return {
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    // R2 accepts — and expects — `auto`.
    region: Deno.env.get('R2_REGION') ?? 'auto',
    service: 's3',
  };
}

function r2Host(): string {
  return `${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
}

async function presign(
  method: 'GET' | 'PUT',
  bucket: string,
  key: string,
  expiresIn: number,
): Promise<string> {
  return presignUrl({
    credentials: r2Credentials(),
    method,
    host: r2Host(),
    canonicalUri: `/${bucket}/${encodeKey(key)}`,
    expiresInSeconds: expiresIn,
    now: new Date(),
  });
}

async function deleteObject(bucket: string, key: string): Promise<void> {
  const host = r2Host();
  const canonicalUri = `/${bucket}/${encodeKey(key)}`;
  const payloadHash = await sha256Hex('');
  const now = new Date();
  const { amzDate } = amzTimestamps(now);

  const { authorization } = await authorizationHeader({
    credentials: r2Credentials(),
    method: 'DELETE',
    canonicalUri,
    headers: { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
    payloadHash,
    now,
  });

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: 'DELETE',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
  });

  // 404 counts as success: the object is not there, which is the state the
  // caller asked for.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed with ${response.status}`);
  }
}
