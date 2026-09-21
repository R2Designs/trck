/**
 * Object storage adapter.
 *
 * The product stores two kinds of image — enrolment photographs and dashboard
 * captures — and both are sensitive enough that they must never be served from
 * a public URL. The contract below is therefore built around *signed, expiring*
 * access rather than permanent links.
 *
 * Two implementations ship:
 *   • `supabaseStorage` — private buckets, zero extra infrastructure.
 *   • `r2Storage`       — Cloudflare R2 via a signing Edge Function, for when
 *                          egress cost starts to matter.
 *
 * Both use the *same* key layout, so migrating is a bucket copy rather than a
 * schema change.
 */

export type StorageBucketKind = 'faces' | 'dashboards';

export interface UploadRequest {
  bucket: StorageBucketKind;
  /** Full object key; build it with `buildObjectKey`. */
  path: string;
  body: Blob;
  contentType: string;
  /** Prevents an accidental overwrite of an existing object. */
  upsert?: boolean;
}

export interface UploadResult {
  bucket: string;
  path: string;
  byteSize: number;
  provider: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageProvider {
  readonly name: string;
  upload(request: UploadRequest): Promise<UploadResult>;
  /** Short-lived read URL. Never cache these beyond `expiresAt`. */
  getSignedUrl(
    bucket: StorageBucketKind,
    path: string,
    expiresInSeconds?: number,
  ): Promise<SignedUrl>;
  /** Batched signing — a list of ten dashboard photos should not cost ten requests. */
  getSignedUrls(
    bucket: StorageBucketKind,
    paths: readonly string[],
    expiresInSeconds?: number,
  ): Promise<Map<string, SignedUrl>>;
  remove(bucket: StorageBucketKind, paths: readonly string[]): Promise<void>;
}

/**
 * Canonical object keys.
 *
 *   organizations/{orgId}/employees/{employeeId}/faces/{fileId}.jpg
 *   organizations/{orgId}/buses/{busId}/trips/{tripId}/dashboard/{fileId}.jpg
 *
 * The organisation id is the *second* segment because the storage RLS policies
 * parse it from there (`fn_storage_org`). Changing this layout means changing
 * those policies too.
 */
export function buildFaceObjectKey(params: {
  organizationId: string;
  employeeId: string;
  fileId: string;
  extension?: string;
}): string {
  const extension = params.extension ?? 'jpg';
  return `organizations/${params.organizationId}/employees/${params.employeeId}/faces/${params.fileId}.${extension}`;
}

export function buildDashboardObjectKey(params: {
  organizationId: string;
  busId: string;
  tripId?: string | null;
  fileId: string;
  extension?: string;
}): string {
  const extension = params.extension ?? 'jpg';
  const tripSegment = params.tripId ? `trips/${params.tripId}` : 'ad-hoc';
  return `organizations/${params.organizationId}/buses/${params.busId}/${tripSegment}/dashboard/${params.fileId}.${extension}`;
}

/** Reads the organisation id back out of a key — used when auditing a path. */
export function organizationFromObjectKey(key: string): string | null {
  const parts = key.split('/');
  return parts[0] === 'organizations' && parts[1] ? parts[1] : null;
}
