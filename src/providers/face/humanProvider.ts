import { config } from '@/app/config';
import { measureFrameQuality, prepareFaceCropForRecognition } from '@/lib/face-image';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type {
  DetectedFace,
  DetectionInput,
  DetectionResult,
  FaceRecognitionProvider,
} from './types';

/**
 * Human (@vladmandic/human) adapter.
 *
 * Chosen because it is MIT-licensed, runs entirely in the browser — so no face
 * image ever leaves the device for recognition — and bundles a usable
 * anti-spoof model. It is also large: roughly 1.5 MB of JavaScript plus model
 * weights, which is precisely why it is behind a dynamic import and only ever
 * loaded on the enrolment and attendance-scan screens.
 *
 * Everything unnecessary is switched off. We do not run age, gender or emotion
 * estimation — not to save milliseconds, but because profiling employees is
 * outside what this product is allowed to do.
 */

type HumanInstance = {
  load: () => Promise<void>;
  warmup: () => Promise<unknown>;
  detect: (input: unknown) => Promise<HumanResult>;
  models?: {
    list: () => Array<{ name: string; loaded: boolean }>;
  };
  tf?: { dispose?: (value?: unknown) => void };
};

interface HumanResult {
  face: Array<{
    box: [number, number, number, number];
    score?: number;
    faceScore?: number;
    embedding?: number[];
    rotation?: { angle?: { yaw?: number; pitch?: number } };
    live?: number;
    real?: number;
  }>;
  performance?: { total?: number };
}

// The suffix is not cosmetic: descriptors produced from a CLAHE-normalised
// crop are not comparable with descriptors from a raw frame, and the matcher
// downgrades a match whose model versions differ. Changing the normalisation
// therefore *must* change this string.
const MODEL_VERSION = 'human-faceres-3.3+clahe1';
const DESCRIPTOR_DIMENSIONS = 1024;

class HumanFaceProvider implements FaceRecognitionProvider {
  readonly name = 'human';
  readonly modelVersion = MODEL_VERSION;
  readonly descriptorDimensions = DESCRIPTOR_DIMENSIONS;
  readonly supportsLiveness = true;

  private instance: HumanInstance | null = null;
  private loading: Promise<void> | null = null;

  isLoaded(): boolean {
    return this.instance !== null;
  }

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.instance) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        onProgress?.(0.05);
        const module = await import('@vladmandic/human');
        onProgress?.(0.4);

        const Human = (module as unknown as { Human: new (cfg: unknown) => HumanInstance }).Human;
        const instance = new Human({
          modelBasePath: config.face.modelBasePath,
          // Human's warm-up runs a complete synthetic inference across every
          // enabled face model. On some mobile/WebView GPU combinations that
          // compile step never resolves, leaving the UI parked at 85% even
          // though all model files have loaded. The first real scan can safely
          // compile lazily, so model readiness must not depend on warm-up.
          warmup: 'none',
          cacheSensitivity: 0,
          // Equalisation ON. Human applies a histogram stretch before
          // detection, which measurably improves *detection* of an
          // under-exposed face — the common case when a driver is backlit by
          // the sky. The descriptor itself is computed separately, from a
          // CLAHE-normalised crop (see `describeFromCrop`), because a global
          // stretch is not enough for a face that is dark against a bright
          // background.
          filter: { enabled: true, equalization: true, brightness: 0 },
          face: {
            enabled: true,
            detector: { rotation: true, maxDetected: 5, minConfidence: 0.35, return: false },
            mesh: { enabled: true },
            iris: { enabled: false },
            description: { enabled: true },
            // Identity only. No demographic or affect inference, ever.
            emotion: { enabled: false },
            antispoof: { enabled: true },
            liveness: { enabled: true },
          },
          body: { enabled: false },
          hand: { enabled: false },
          object: { enabled: false },
          gesture: { enabled: false },
          segmentation: { enabled: false },
        });

        await instance.load();
        const missingModels = instance.models?.list().filter((model) => !model.loaded) ?? [];
        if (missingModels.length > 0) {
          throw new Error(
            `Face model files did not load: ${missingModels.map((model) => model.name).join(', ')}`,
          );
        }
        onProgress?.(0.85);
        await instance.warmup();
        onProgress?.(1);

        this.instance = instance;
        logger.info('Face model loaded', { provider: this.name, version: this.modelVersion });
      } catch (error) {
        this.loading = null;
        logger.error('Face model failed to load', { error });
        throw new AppError('Face model failed to load', {
          kind: 'RECOGNITION',
          messageKey: 'errors.faceModelFailed',
          retryable: true,
          cause: error,
        });
      }
    })();

    return this.loading;
  }

  async detect(input: DetectionInput): Promise<DetectionResult> {
    if (!this.instance) await this.load();
    const instance = this.instance;
    if (!instance) throw new AppError('Face provider unavailable', { kind: 'RECOGNITION' });

    const started = performance.now();
    const { width, height } = sourceDimensions(input.source);
    const result = await instance.detect(input.source);

    const faces: DetectedFace[] = (result.face ?? []).map((face) => ({
      box: { x: face.box[0], y: face.box[1], width: face.box[2], height: face.box[3] },
      detectionScore: face.faceScore ?? face.score ?? 0,
      descriptor: Array.isArray(face.embedding) ? face.embedding : null,
      normalised: false,
      yawDegrees:
        face.rotation?.angle?.yaw != null ? radiansToDegrees(face.rotation.angle.yaw) : null,
      pitchDegrees:
        face.rotation?.angle?.pitch != null ? radiansToDegrees(face.rotation.angle.pitch) : null,
      // Human reports `real` (anti-spoof) and `live` (liveness) separately;
      // the stricter of the two is the honest answer.
      livenessScore:
        face.real != null || face.live != null ? Math.min(face.real ?? 1, face.live ?? 1) : null,
    }));

    const largest = largestFace(faces);

    // Quality is measured inside the face box, never across the whole frame —
    // a bright sky behind a driver must not be mistaken for a well-lit face.
    const quality = measureFrameQuality(
      input.source,
      width,
      height,
      largest?.box ?? null,
      faces.length,
      largest?.detectionScore ?? 0,
      { yawDegrees: largest?.yawDegrees, pitchDegrees: largest?.pitchDegrees },
    );

    // Second pass on an illumination-normalised crop, for the frames that will
    // actually be compared. Enrolment and matching therefore both describe a
    // CLAHE-equalised face, which removes the lighting difference between the
    // depot office and the 7 a.m. yard.
    if (input.embed !== false && largest && width > 0 && height > 0) {
      const descriptor = await this.describeFromCrop(
        instance,
        input.source,
        width,
        height,
        largest.box,
      );
      if (descriptor) {
        largest.descriptor = descriptor;
        largest.normalised = true;
      }
    }

    return {
      faces,
      quality,
      durationMs: Math.round(performance.now() - started),
    };
  }

  /**
   * Re-describes a face from a normalised crop.
   *
   * Returns null rather than throwing if the crop yields no face: the caller
   * already has the raw descriptor, and a failed normalisation should degrade
   * to that rather than abandoning the scan.
   */
  private async describeFromCrop(
    instance: HumanInstance,
    source: DetectionInput['source'],
    width: number,
    height: number,
    box: DetectedFace['box'],
  ): Promise<number[] | null> {
    try {
      const crop = prepareFaceCropForRecognition(source, width, height, box);
      const cropped = await instance.detect(crop);
      const embedding = cropped.face?.[0]?.embedding;
      return Array.isArray(embedding) ? embedding : null;
    } catch (error) {
      logger.warn('Normalised descriptor pass failed; using raw descriptor', { error });
      return null;
    }
  }

  async dispose(): Promise<void> {
    try {
      this.instance?.tf?.dispose?.();
    } catch (error) {
      logger.warn('Face provider dispose failed', { error });
    }
    this.instance = null;
    this.loading = null;
  }
}

function radiansToDegrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI);
}

function sourceDimensions(source: DetectionInput['source']): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ('width' in source && 'height' in source) {
    return { width: Number(source.width), height: Number(source.height) };
  }
  return { width: 0, height: 0 };
}

function largestFace(faces: DetectedFace[]): DetectedFace | null {
  return faces.reduce<DetectedFace | null>(
    (best, face) =>
      !best || face.box.width * face.box.height > best.box.width * best.box.height ? face : best,
    null,
  );
}

export const humanFaceProvider: FaceRecognitionProvider = new HumanFaceProvider();
