import { config } from '@/app/config';
import type { StorageProvider } from './types';
import { supabaseStorageProvider } from './supabaseStorage';
import { r2StorageProvider } from './r2Storage';

/**
 * Adapter selection.
 *
 * One place decides which implementation is live, chosen by environment
 * variable. Nothing else in the application imports a concrete provider, which
 * is what makes swapping object storage a configuration change.
 */
let override: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (override) return override;
  return config.storage.provider === 'r2' ? r2StorageProvider : supabaseStorageProvider;
}

/** Test seam — lets a spec inject an in-memory provider. */
export function __setStorageProvider(provider: StorageProvider | null): void {
  override = provider;
}

export * from './types';
