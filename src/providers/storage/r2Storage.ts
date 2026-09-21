import { invokeFunction } from '@/lib/supabase/client';
import { AppError } from '@/lib/errors';
import type { SignedUrl, StorageProvider, UploadRequest, UploadResult } from './types';

/**
 * Cloudflare R2 adapter.
 *
 * R2 has no free-tier egress charge, which makes it attractive once dashboard
 * photographs start accumulating. The catch is that S3 signing requires a
 * secret, and a secret cannot live in a browser bundle — so every signature is
 * produced by the `storage-sign` Edge Function, which holds the R2 credentials
 * as Supabase secrets and checks the caller's organisation before signing
 * anything.
 *
 * The browser therefore never sees an access key; it sees a URL that works for
 * five minutes, for one object, inside its own tenant.
 */

interface SignResponse {
  url: string;
  expiresInSeconds: number;
  bucket: string;
}

interface BatchSignResponse {
  urls: Array<{ path: string; url: string }>;
  expiresInSeconds: number;
}

export const r2StorageProvider: StorageProvider = {
  name: 'r2',

  async upload(request: UploadRequest): Promise<UploadResult> {
    const signed = await invokeFunction<SignResponse>('storage-sign', {
      operation: 'put',
      bucket: request.bucket,
      path: request.path,
      contentType: request.contentType,
    });

    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': request.contentType },
      body: request.body,
    });

    if (!response.ok) {
      throw new AppError(`R2 upload failed with ${response.status}`, {
        kind: 'STORAGE',
        messageKey: 'errors.uploadImage',
        retryable: response.status >= 500,
      });
    }

    return {
      bucket: signed.bucket,
      path: request.path,
      byteSize: request.body.size,
      provider: 'r2',
    };
  },

  async getSignedUrl(bucket, path, expiresInSeconds = 300): Promise<SignedUrl> {
    const signed = await invokeFunction<SignResponse>('storage-sign', {
      operation: 'get',
      bucket,
      path,
      expiresInSeconds,
    });
    return { url: signed.url, expiresAt: new Date(Date.now() + signed.expiresInSeconds * 1000) };
  },

  async getSignedUrls(bucket, paths, expiresInSeconds = 300): Promise<Map<string, SignedUrl>> {
    const result = new Map<string, SignedUrl>();
    if (paths.length === 0) return result;

    const signed = await invokeFunction<BatchSignResponse>('storage-sign', {
      operation: 'get-batch',
      bucket,
      paths: [...paths],
      expiresInSeconds,
    });

    const expiresAt = new Date(Date.now() + signed.expiresInSeconds * 1000);
    for (const entry of signed.urls) result.set(entry.path, { url: entry.url, expiresAt });
    return result;
  },

  async remove(bucket, paths): Promise<void> {
    if (paths.length === 0) return;
    await invokeFunction('storage-sign', { operation: 'delete', bucket, paths: [...paths] });
  },
};
