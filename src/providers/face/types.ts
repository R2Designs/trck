/**
 * Face recognition adapter.
 *
 * The boundary is drawn so that *no business logic* lives behind it. A provider
 * does exactly three things:
 *
 *   1. load its model (lazily, and only on the two screens that need it),
 *   2. detect a face in a frame and report quality signals,
 *   3. turn that face into a descriptor.
 *
 * Deciding whether a descriptor matches, whether the quality is good enough,
 * and what to do about it is `@domain/face-match.ts` — shared, pure, tested.
 * That split is what lets Human be replaced without touching attendance.
 */

import type { FrameQualitySignals } from '@domain/face-match.ts';

export interface DetectionInput {
  /** A video frame or a still. Providers must not mutate it. */
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap;
  /** Set when a still photograph is being enrolled rather than a live frame. */
  still?: boolean;
  /**
   * Whether to produce a descriptor.
   *
   * Live preview frames pass `false`: they only need "is there one face, is it
   * big enough, is it sharp enough" to drive the on-screen guidance, and
   * skipping the embedding pass roughly halves the per-frame cost on a low-end
   * phone. The frame that is actually matched, and every enrolment still,
   * passes `true`.
   */
  embed?: boolean;
}

export interface DetectedFace {
  /** Pixel box in the source's own coordinate space. */
  box: { x: number; y: number; width: number; height: number };
  /**
   * Whether the descriptor was computed from an illumination-normalised crop.
   * Descriptors are only ever compared against others with the same value —
   * see docs/FACE_RECOGNITION.md ("Performance across skin tones").
   */
  normalised?: boolean;
  detectionScore: number;
  /** Unit-length descriptor, or null when the provider could not embed. */
  descriptor: number[] | null;
  /** Head pose, when the provider reports it. */
  yawDegrees: number | null;
  pitchDegrees: number | null;
  /** Provider's own liveness/anti-spoof opinion, 0..1, or null if unsupported. */
  livenessScore: number | null;
}

export interface DetectionResult {
  faces: DetectedFace[];
  /** Quality signals for the largest face, ready for `assessFrameQuality`. */
  quality: FrameQualitySignals;
  durationMs: number;
}

export interface FaceRecognitionProvider {
  readonly name: string;
  /** Changing this invalidates existing descriptors; it is stored on every row. */
  readonly modelVersion: string;
  readonly descriptorDimensions: number;
  readonly supportsLiveness: boolean;

  /** Idempotent; safe to call on every mount. */
  load(onProgress?: (fraction: number) => void): Promise<void>;
  isLoaded(): boolean;
  detect(input: DetectionInput): Promise<DetectionResult>;
  /** Frees GPU/WASM memory when leaving the enrolment or scanning screen. */
  dispose(): Promise<void>;
}
