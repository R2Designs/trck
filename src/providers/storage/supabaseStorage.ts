import { supabase } from '@/lib/supabase/client';
import { config } from '@/app/config';
import { AppError } from '@/lib/errors';
import type {
  SignedUrl,
  StorageBucketKind,
  StorageProvider,
  UploadRequest,
  UploadResult,
} from './types';

/**
 * Supabase Storage adapter.
 *
 * Both buckets are created private by migration 0014, and the policies there
 * restrict every object to staff of the owning organisation. Nothing in this
 * file can widen that: `getPublicUrl` is deliberately never called.
 */
const BUCKETS: Record<StorageBucketKind, string> = {
  faces: config.storage.faceBucket,
  dashboards: config.storage.dashboardBucket,
};

const DEFAULT_TTL_SECONDS = 300;

export const supabaseStorageProvider: StorageProvider = {
  name: 'supabase',

  async upload(request: UploadRequest): Promise<UploadResult> {
    const bucket = BUCKETS[request.bucket];
    const { error } = await supabase.storage.from(bucket).upload(request.path, request.body, {
      contentType: request.contentType,
      upsert: request.upsert ?? false,
      cacheControl: 'private, max-age=0, no-store',
    });

    if (error) {
      throw new AppError(error.message, {
        kind: 'STORAGE',
        messageKey: 'errors.uploadImage',
        retryable: true,
        cause: error,
      });
    }

    return {
      bucket,
      path: request.path,
      byteSize: request.body.size,
      provider: 'supabase',
    };
  },

  async getSignedUrl(
    bucket: StorageBucketKind,
    path: string,
    expiresInSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<SignedUrl> {
    const { data, error } = await supabase.storage
      .from(BUCKETS[bucket])
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data) {
      throw new AppError(error?.message ?? 'Could not sign URL', {
        kind: 'STORAGE',
        messageKey: 'errors.unknown',
        cause: error,
      });
    }

    return { url: data.signedUrl, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  },

  async getSignedUrls(
    bucket: StorageBucketKind,
    paths: readonly string[],
    expiresInSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<Map<string, SignedUrl>> {
    const result = new Map<string, SignedUrl>();
    if (paths.length === 0) return result;

    const { data, error } = await supabase.storage
      .from(BUCKETS[bucket])
      .createSignedUrls([...paths], expiresInSeconds);

    if (error) {
      throw new AppError(error.message, {
        kind: 'STORAGE',
        messageKey: 'errors.unknown',
        cause: error,
      });
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path)
        result.set(entry.path, { url: entry.signedUrl, expiresAt });
    }
    return result;
  },

  async remove(bucket: StorageBucketKind, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await supabase.storage.from(BUCKETS[bucket]).remove([...paths]);
    if (error) {
      throw new AppError(error.message, {
        kind: 'STORAGE',
        messageKey: 'errors.unknown',
        cause: error,
      });
    }
  },
};
