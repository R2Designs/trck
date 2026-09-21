import { describe, expect, it } from 'vitest';
import {
  assessFrameQuality,
  averageDescriptors,
  canCompleteEnrolment,
  cosineSimilarity,
  euclideanDistance,
  matchFace,
} from '@domain/face-match.ts';
import type { EnrolledDescriptor, FrameQualitySignals } from '@domain/face-match.ts';
import { DEFAULT_THRESHOLDS } from '@domain/thresholds.ts';

const descriptor = (
  employeeId: string,
  embedding: number[],
  overrides: Partial<EnrolledDescriptor> = {},
): EnrolledDescriptor => ({
  employeeId,
  embeddingId: `${employeeId}-e1`,
  employeeCode: `EMP-${employeeId}`,
  fullName: `Driver ${employeeId}`,
  isAssigned: false,
  modelVersion: 'faceres-3.3.5',
  provider: 'human',
  embedding,
  qualityScore: 0.8,
  ...overrides,
});

describe('vector maths', () => {
  it('computes cosine similarity and clamps floating point drift', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('computes euclidean distance', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
    expect(euclideanDistance([1], [1, 2])).toBe(Number.POSITIVE_INFINITY);
  });

  it('averages descriptors into a normalised centroid', () => {
    const centroid = averageDescriptors([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const norm = Math.hypot(...centroid);
    expect(norm).toBeCloseTo(1, 6);
    expect(averageDescriptors([])).toEqual([]);
  });
});

describe('matchFace', () => {
  const probe = [1, 0, 0, 0];

  it('auto-accepts a clear match', () => {
    const result = matchFace(probe, [
      descriptor('A', [0.99, 0.1, 0, 0]),
      descriptor('B', [0, 1, 0, 0]),
    ]);
    expect(result.decision).toBe('AUTO_ACCEPT');
    expect(result.best?.employeeId).toBe('A');
    expect(result.margin).toBeGreaterThan(0);
  });

  it('asks for review when the score lands between the two bands', () => {
    const result = matchFace(probe, [descriptor('A', [0.55, 0.83, 0, 0])]);
    expect(result.decision).toBe('REVIEW');
  });

  it('refuses to verify below the review band', () => {
    const result = matchFace(probe, [descriptor('A', [0.2, 0.98, 0, 0])]);
    expect(result.decision).toBe('NOT_VERIFIED');
    expect(result.best?.similarity).toBeLessThan(DEFAULT_THRESHOLDS.faceReviewSimilarity);
  });

  it('downgrades a strong match when two people score almost identically', () => {
    const result = matchFace(probe, [
      descriptor('A', [0.98, 0.19, 0, 0]),
      descriptor('B', [0.97, 0.24, 0, 0]),
    ]);
    expect(result.decision).toBe('REVIEW');
    expect(result.downgradeReason).toBe('AMBIGUOUS_MARGIN');
  });

  it('downgrades when the probe came from a different model version', () => {
    const result = matchFace(
      probe,
      [descriptor('A', [1, 0, 0, 0], { modelVersion: 'faceres-2.0.0' })],
      DEFAULT_THRESHOLDS,
      'faceres-3.3.5',
    );
    expect(result.decision).toBe('REVIEW');
    expect(result.downgradeReason).toBe('MODEL_VERSION_MISMATCH');
  });

  it('keeps only the best photo per employee', () => {
    const result = matchFace(probe, [
      descriptor('A', [0.5, 0.86, 0, 0], { embeddingId: 'A-e1' }),
      descriptor('A', [0.99, 0.1, 0, 0], { embeddingId: 'A-e2' }),
    ]);
    expect(result.ranked).toHaveLength(1);
    expect(result.best?.embeddingId).toBe('A-e2');
  });

  it('returns a NOT_VERIFIED result rather than throwing on an empty candidate set', () => {
    const result = matchFace(probe, []);
    expect(result.decision).toBe('NOT_VERIFIED');
    expect(result.best).toBeNull();
    expect(result.margin).toBeNull();
  });

  it('respects administrator-tuned thresholds', () => {
    const strict = matchFace(probe, [descriptor('A', [0.9, 0.44, 0, 0])], {
      ...DEFAULT_THRESHOLDS,
      faceAutoAcceptSimilarity: 0.95,
      faceReviewSimilarity: 0.9,
    });
    expect(strict.decision).toBe('NOT_VERIFIED');
  });
});

describe('assessFrameQuality', () => {
  // A correctly exposed *dark-skinned* face: low mean luminance, healthy local
  // contrast. This is the reference case — the product's users are largely
  // South Indian drivers, and a quality gate that rejects this is a broken
  // quality gate, not a cautious one.
  const wellExposedDarkFace: FrameQualitySignals = {
    faceCount: 1,
    detectionScore: 0.93,
    faceAreaRatio: 0.2,
    sharpness: 0.8,
    faceBrightness: 0.22,
    faceContrast: 0.4,
    backlitRatio: 1.1,
    yawDegrees: 5,
    pitchDegrees: 2,
  };

  const wellExposedLightFace: FrameQualitySignals = {
    ...wellExposedDarkFace,
    faceBrightness: 0.62,
    faceContrast: 0.42,
  };

  it('accepts a well-exposed dark-skinned face', () => {
    const result = assessFrameQuality(wellExposedDarkFace);
    expect(result.acceptable).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.score).toBeGreaterThan(0.6);
  });

  it('scores a dark and a light face within a few points of each other', () => {
    // Identical detail, size and sharpness must produce near-identical scores.
    // Any meaningful gap here is the pipeline penalising skin tone directly.
    const dark = assessFrameQuality(wellExposedDarkFace).score;
    const light = assessFrameQuality(wellExposedLightFace).score;
    expect(Math.abs(dark - light)).toBeLessThan(0.05);
  });

  it('never blocks a capture on low brightness alone', () => {
    const dim = assessFrameQuality({ ...wellExposedDarkFace, faceBrightness: 0.15 });
    expect(dim.acceptable).toBe(true);
    expect(dim.warnings).toContain('TOO_DARK');
    expect(dim.issues).not.toContain('TOO_DARK');
  });

  it('blocks when the face has no tonal detail left, whatever its brightness', () => {
    // Crushed shadows: the exposure destroyed the information the descriptor
    // needs. This is the real failure, and it is skin-tone neutral.
    const crushed = assessFrameQuality({ ...wellExposedDarkFace, faceContrast: 0.05 });
    expect(crushed.acceptable).toBe(false);
    expect(crushed.issues).toContain('LOW_FACE_DETAIL');

    const blownOut = assessFrameQuality({
      ...wellExposedLightFace,
      faceBrightness: 0.99,
      faceContrast: 0.04,
    });
    expect(blownOut.acceptable).toBe(false);
    expect(blownOut.issues).toContain('LOW_FACE_DETAIL');
  });

  it('warns about backlight, which is the usual cause of a dark face', () => {
    const backlit = assessFrameQuality({ ...wellExposedDarkFace, backlitRatio: 3.4 });
    expect(backlit.warnings).toContain('BACKLIT');
    // Still usable if the face itself has detail — guidance, not rejection.
    expect(backlit.acceptable).toBe(true);
  });

  it('penalises a clipped face without rejecting it outright', () => {
    const clipped = assessFrameQuality({ ...wellExposedDarkFace, faceBrightness: 0.06 });
    expect(clipped.score).toBeLessThan(assessFrameQuality(wellExposedDarkFace).score);
  });

  it('rejects an empty frame outright', () => {
    const result = assessFrameQuality({ ...wellExposedDarkFace, faceCount: 0 });
    expect(result.acceptable).toBe(false);
    expect(result.issues).toEqual(['NO_FACE']);
    expect(result.score).toBe(0);
  });

  it('rejects more than one face in frame', () => {
    const result = assessFrameQuality({ ...wellExposedDarkFace, faceCount: 2 });
    expect(result.issues).toContain('MULTIPLE_FACES');
    expect(result.acceptable).toBe(false);
  });

  it('rejects a face that is too small or too blurry', () => {
    expect(assessFrameQuality({ ...wellExposedDarkFace, faceAreaRatio: 0.01 }).issues).toContain(
      'FACE_TOO_SMALL',
    );
    expect(assessFrameQuality({ ...wellExposedDarkFace, sharpness: 0.1 }).issues).toContain(
      'TOO_BLURRY',
    );
  });

  it('warns about an extreme head angle without blocking', () => {
    const angled = assessFrameQuality({ ...wellExposedDarkFace, yawDegrees: 55 });
    expect(angled.warnings).toContain('EXTREME_ANGLE');
    expect(angled.acceptable).toBe(true);
  });

  it('warns rather than blocks on a weak detection score', () => {
    const weak = assessFrameQuality({ ...wellExposedDarkFace, detectionScore: 0.4 });
    expect(weak.warnings).toContain('LOW_DETECTION_CONFIDENCE');
  });
});

describe('canCompleteEnrolment', () => {
  const ok = { score: 0.8, acceptable: true, issues: [], warnings: [] };
  const bad = { score: 0.2, acceptable: false, issues: [], warnings: [] };

  it('requires the configured number of usable photos', () => {
    expect(canCompleteEnrolment([ok, ok, ok]).ok).toBe(true);
    expect(canCompleteEnrolment([ok, ok, bad]).ok).toBe(false);
    expect(canCompleteEnrolment([ok, ok, bad]).usable).toBe(2);
    expect(canCompleteEnrolment([ok, ok, bad]).required).toBe(3);
  });

  it('honours an administrator raising the bar', () => {
    const result = canCompleteEnrolment([ok, ok, ok, ok], {
      ...DEFAULT_THRESHOLDS,
      faceMinEnrolmentPhotos: 5,
    });
    expect(result.ok).toBe(false);
  });
});
