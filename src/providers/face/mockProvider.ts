import type { DetectionInput, DetectionResult, FaceRecognitionProvider } from './types';

/**
 * Deterministic stand-in for the face model.
 *
 * Used by unit tests, by Playwright (a headless browser has no camera and
 * cannot download 40 MB of weights per run) and by anyone developing on a
 * machine where the real model is inconvenient.
 *
 * It is *deterministic*, not random: the descriptor is derived from a seed the
 * test controls, so "this frame should match Ramesh" is a repeatable assertion
 * rather than a flaky one.
 */

const DIMENSIONS = 128;

function seededDescriptor(seed: number): number[] {
  const values: number[] = [];
  let state = seed || 1;
  for (let i = 0; i < DIMENSIONS; i += 1) {
    // xorshift32 — tiny, deterministic, good enough for fixtures.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values.push(((state >>> 0) % 2000) / 1000 - 1);
  }
  const norm = Math.hypot(...values);
  return values.map((value) => value / (norm || 1));
}

export interface MockFaceState {
  /** Faces the next `detect()` call should report. */
  faceCount: number;
  detectionScore: number;
  faceAreaRatio: number;
  sharpness: number;
  /** Mean luminance of the face region, 0..1. */
  faceBrightness: number;
  /** Luminance spread within the face region — the signal that actually gates. */
  faceContrast: number;
  backlitRatio: number | null;
  livenessScore: number | null;
  descriptorSeed: number;
}

const state: MockFaceState = {
  faceCount: 1,
  detectionScore: 0.95,
  faceAreaRatio: 0.2,
  sharpness: 0.85,
  // Defaults describe a correctly exposed *dark* face: low mean luminance with
  // healthy local contrast. That is the case the product must handle well, so
  // it is the one the fixtures default to.
  faceBrightness: 0.24,
  faceContrast: 0.42,
  backlitRatio: 1.1,
  livenessScore: 0.9,
  descriptorSeed: 42,
};

export function configureMockFaceProvider(next: Partial<MockFaceState>): void {
  Object.assign(state, next);
}

class MockFaceProvider implements FaceRecognitionProvider {
  readonly name = 'mock';
  readonly modelVersion = 'mock-1';
  readonly descriptorDimensions = DIMENSIONS;
  readonly supportsLiveness = true;

  private loaded = false;

  isLoaded(): boolean {
    return this.loaded;
  }

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    onProgress?.(1);
    this.loaded = true;
  }

  async detect(_input: DetectionInput): Promise<DetectionResult> {
    const faces = Array.from({ length: state.faceCount }, (_, index) => ({
      box: { x: 10 + index * 5, y: 10, width: 120, height: 120 },
      detectionScore: state.detectionScore,
      descriptor: seededDescriptor(state.descriptorSeed + index),
      normalised: true,
      yawDegrees: 0,
      pitchDegrees: 0,
      livenessScore: state.livenessScore,
    }));

    return {
      faces,
      quality: {
        faceCount: state.faceCount,
        detectionScore: state.detectionScore,
        faceAreaRatio: state.faceAreaRatio,
        sharpness: state.sharpness,
        faceBrightness: state.faceBrightness,
        faceContrast: state.faceContrast,
        backlitRatio: state.backlitRatio,
        yawDegrees: 0,
        pitchDegrees: 0,
      },
      durationMs: 1,
    };
  }

  async dispose(): Promise<void> {
    this.loaded = false;
  }
}

export const mockFaceProvider: FaceRecognitionProvider = new MockFaceProvider();
export { seededDescriptor };
