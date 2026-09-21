/**
 * Dashboard reading adapter.
 *
 * Same split as face recognition: the provider produces *text with
 * confidences*, and `@domain/ocr-parse.ts` decides what that text means. An
 * engine swap therefore cannot change which number ends up in the odometer
 * field — only how well the characters were recognised.
 */

import type { DashboardParseResult, OcrParseHints } from '@domain/ocr-parse.ts';
import type { PreprocessOptions } from '@/lib/image';

export interface DashboardReadRequest {
  image: Blob;
  hints?: OcrParseHints;
  /** Applied before recognition; see `preprocessForOcr`. */
  preprocess?: PreprocessOptions;
  onProgress?: (fraction: number) => void;
}

export interface DashboardReadResult {
  parsed: DashboardParseResult;
  /** Kept verbatim for the audit trail; never shown to the manager. */
  raw: unknown;
  engine: string;
  engineVersion: string;
  durationMs: number;
  /** SUCCEEDED when something was read, PARTIAL when some fields were missed. */
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
}

export interface DashboardReadingProvider {
  readonly name: string;
  readonly version: string;
  load(onProgress?: (fraction: number) => void): Promise<void>;
  isLoaded(): boolean;
  read(request: DashboardReadRequest): Promise<DashboardReadResult>;
  dispose(): Promise<void>;
}
