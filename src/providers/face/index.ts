import { config } from '@/app/config';
import type { FaceRecognitionProvider } from './types';
import { humanFaceProvider } from './humanProvider';
import { mockFaceProvider } from './mockProvider';

/**
 * Adapter selection for face recognition.
 *
 * Note that this module imports both implementations, but `humanProvider` only
 * pulls the heavy dependency inside `load()` via a dynamic import — so merely
 * resolving the provider costs nothing.
 */
let override: FaceRecognitionProvider | null = null;

export function getFaceProvider(): FaceRecognitionProvider {
  if (override) return override;
  return config.face.provider === 'mock' ? mockFaceProvider : humanFaceProvider;
}

export function __setFaceProvider(provider: FaceRecognitionProvider | null): void {
  override = provider;
}

export * from './types';
