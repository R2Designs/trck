/**
 * Face matching maths and decision bands.
 *
 * What this module deliberately does NOT do:
 *   • It never returns a bare "this is person X". It returns a *decision* —
 *     AUTO_ACCEPT, REVIEW or NOT_VERIFIED — with the score that produced it.
 *   • It never compares against an unbounded population. Callers pass a
 *     candidate set already narrowed to a depot or a route.
 *   • It never infers age, gender or emotion. Only identity, only for
 *     attendance.
 *
 * The provider (Human, or a future replacement) is responsible for producing
 * descriptors; everything after that is this pure, testable module.
 */

import { DEFAULT_THRESHOLDS } from './thresholds.ts';
import type { Thresholds } from './thresholds.ts';

export interface EnrolledDescriptor {
  employeeId: string;
  embeddingId: string;
  employeeCode: string;
  fullName: string;
  /** True when this driver is scheduled on the selected route or bus. */
  isAssigned: boolean;
  modelVersion: string;
  provider: string;
  embedding: readonly number[];
  qualityScore: number | null;
}

export type MatchDecision = 'AUTO_ACCEPT' | 'REVIEW' | 'NOT_VERIFIED';

export interface CandidateScore {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  embeddingId: string;
  /** Best cosine similarity across all of that employee's enrolled photos. */
  similarity: number;
  isAssigned: boolean;
}

export interface MatchResult {
  decision: MatchDecision;
  best: CandidateScore | null;
  runnerUp: CandidateScore | null;
  /**
   * Gap between the best and second-best candidate. A tiny margin between two
   * different people is a reason to ask a human, even when both score well.
   */
  margin: number | null;
  ranked: CandidateScore[];
  thresholds: { autoAccept: number; review: number };
  /** Set when the decision was downgraded for a reason other than the score. */
  downgradeReason: 'AMBIGUOUS_MARGIN' | 'MODEL_VERSION_MISMATCH' | null;
}

/** Minimum separation between the top two candidates for a one-tap accept. */
export const MIN_DECISION_MARGIN = 0.06;

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Guard against floating point drift pushing the value outside [-1, 1].
  return Math.min(1, Math.max(-1, value));
}

export function euclideanDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Scores a probe descriptor against every enrolled descriptor, keeping only the
 * best photo per employee, then applies the configured decision bands.
 */
export function matchFace(
  probe: readonly number[],
  candidates: readonly EnrolledDescriptor[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  probeModelVersion?: string,
): MatchResult {
  const bands = {
    autoAccept: thresholds.faceAutoAcceptSimilarity,
    review: thresholds.faceReviewSimilarity,
  };

  const bestByEmployee = new Map<string, CandidateScore>();
  let sawVersionMismatch = false;

  for (const candidate of candidates) {
    // Descriptors from different model versions are not comparable. Rather than
    // silently producing a meaningless number, we score them and flag it.
    if (probeModelVersion && candidate.modelVersion !== probeModelVersion) {
      sawVersionMismatch = true;
    }
    if (candidate.embedding.length !== probe.length) continue;

    const similarity = cosineSimilarity(probe, candidate.embedding);
    const existing = bestByEmployee.get(candidate.employeeId);
    if (!existing || similarity > existing.similarity) {
      bestByEmployee.set(candidate.employeeId, {
        employeeId: candidate.employeeId,
        employeeCode: candidate.employeeCode,
        fullName: candidate.fullName,
        embeddingId: candidate.embeddingId,
        similarity,
        isAssigned: candidate.isAssigned,
      });
    }
  }

  const ranked = [...bestByEmployee.values()].sort((a, b) => b.similarity - a.similarity);
  const best = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  const margin = best && runnerUp ? best.similarity - runnerUp.similarity : null;

  let decision: MatchDecision = 'NOT_VERIFIED';
  let downgradeReason: MatchResult['downgradeReason'] = null;

  if (best) {
    if (best.similarity >= bands.autoAccept) decision = 'AUTO_ACCEPT';
    else if (best.similarity >= bands.review) decision = 'REVIEW';
  }

  if (decision === 'AUTO_ACCEPT' && margin != null && margin < MIN_DECISION_MARGIN) {
    decision = 'REVIEW';
    downgradeReason = 'AMBIGUOUS_MARGIN';
  }

  if (decision === 'AUTO_ACCEPT' && sawVersionMismatch) {
    decision = 'REVIEW';
    downgradeReason = 'MODEL_VERSION_MISMATCH';
  }

  return {
    decision,
    best,
    runnerUp,
    margin: margin == null ? null : Math.round(margin * 10000) / 10000,
    ranked: ranked.slice(0, 5),
    thresholds: bands,
    downgradeReason,
  };
}

// ---------------------------------------------------------------------------
// Frame quality
// ---------------------------------------------------------------------------

/**
 * Signals measured from a frame before it is embedded.
 *
 * IMPORTANT — why brightness is split into three numbers.
 *
 * Face recognition is well documented to perform worse on darker skin, and the
 * dominant cause in a product like this one is *exposure*, not the model: a
 * phone pointed at a driver standing in front of a bright sky meters for the
 * sky, and the face lands in the bottom few values of the sensor's range where
 * there is almost no texture left to describe.
 *
 * A quality gate that simply rejects "mean luminance below X" therefore fails
 * dark-skinned drivers twice: once by rejecting well-exposed faces that are
 * legitimately dark, and once by *accepting* nothing at all when the real
 * problem was the backlight. So we measure:
 *
 *   faceBrightness  — mean luma inside the face box (not the whole frame)
 *   faceContrast    — spread of luma inside the face box: *this* is what the
 *                     descriptor actually needs, and it is skin-tone neutral
 *   backlitRatio    — background luma ÷ face luma; > ~2 means the camera is
 *                     metering for the background
 *
 * Only `faceContrast` blocks a capture. Brightness and backlight produce
 * actionable guidance ("move so the light is on their face") rather than a
 * refusal, because a correctly exposed dark face is a good photograph.
 */
export interface FrameQualitySignals {
  /** Number of faces the detector found in the frame. */
  faceCount: number;
  /** Detector's own confidence that the largest box is a face, 0..1. */
  detectionScore: number;
  /** Face box area as a fraction of the frame. */
  faceAreaRatio: number;
  /** Variance-of-Laplacian style sharpness, already normalised to 0..1. */
  sharpness: number;
  /** Mean luminance *of the face region*, 0..1. */
  faceBrightness: number;
  /**
   * Luminance spread within the face region, 0..1 (roughly std-dev × 4).
   * A well-exposed face has detail regardless of skin tone; a crushed one
   * does not.
   */
  faceContrast: number;
  /** Background luma ÷ face luma. 1 is even; above 2 is strong backlight. */
  backlitRatio?: number | null;
  /** Absolute yaw/pitch in degrees, when the provider reports them. */
  yawDegrees?: number | null;
  pitchDegrees?: number | null;
}

export type QualityIssue =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'TOO_BLURRY'
  | 'LOW_FACE_DETAIL'
  | 'BACKLIT'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'EXTREME_ANGLE'
  | 'LOW_DETECTION_CONFIDENCE';

/** Issues that make a capture unusable, as opposed to merely improvable. */
const BLOCKING_ISSUES: readonly QualityIssue[] = [
  'NO_FACE',
  'MULTIPLE_FACES',
  'FACE_TOO_SMALL',
  'TOO_BLURRY',
  'LOW_FACE_DETAIL',
];

export interface QualityAssessment {
  /** 0..1 composite. Stored alongside the photo for later audit. */
  score: number;
  acceptable: boolean;
  issues: QualityIssue[];
  /** Issues that only warn. Surfaced as guidance, never as a rejection. */
  warnings: QualityIssue[];
}

/** Minimum luminance spread inside the face box for a usable descriptor. */
export const MIN_FACE_CONTRAST = 0.16;
/** Above this, the camera is clearly metering for the background. */
export const BACKLIT_RATIO_THRESHOLD = 2.0;

/**
 * Gates every enrolment photo and every attendance frame.
 *
 * Tuned to be forgiving of a phone held at arm's length in a depot yard and
 * unforgiving of the three things that actually break recognition later: a
 * tiny face, motion blur, and a face with no tonal detail left in it.
 */
export function assessFrameQuality(
  signals: FrameQualitySignals,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): QualityAssessment {
  const issues: QualityIssue[] = [];
  const warnings: QualityIssue[] = [];

  if (signals.faceCount === 0) {
    return { score: 0, acceptable: false, issues: ['NO_FACE'], warnings: [] };
  }
  if (signals.faceCount > 1) issues.push('MULTIPLE_FACES');
  if (signals.detectionScore < 0.5) warnings.push('LOW_DETECTION_CONFIDENCE');
  if (signals.faceAreaRatio < 0.045) issues.push('FACE_TOO_SMALL');
  if (signals.sharpness < 0.35) issues.push('TOO_BLURRY');

  // The skin-tone-neutral test: is there any tonal information to describe?
  if (signals.faceContrast < MIN_FACE_CONTRAST) issues.push('LOW_FACE_DETAIL');

  // Guidance, not rejection. A correctly exposed dark face is a good photo.
  if (signals.backlitRatio != null && signals.backlitRatio > BACKLIT_RATIO_THRESHOLD) {
    warnings.push('BACKLIT');
  }
  if (signals.faceBrightness < 0.18) warnings.push('TOO_DARK');
  if (signals.faceBrightness > 0.92) warnings.push('TOO_BRIGHT');

  if (
    (signals.yawDegrees != null && Math.abs(signals.yawDegrees) > 35) ||
    (signals.pitchDegrees != null && Math.abs(signals.pitchDegrees) > 30)
  ) {
    warnings.push('EXTREME_ANGLE');
  }

  // Composite. Note what is *absent*: mean brightness contributes nothing on
  // its own. Detail, size and sharpness are what the descriptor consumes, and
  // all three are independent of skin tone.
  const sizeScore = Math.min(1, signals.faceAreaRatio / 0.18);
  const contrastScore = Math.min(1, signals.faceContrast / 0.35);
  // Exposure is scored only as a penalty for genuinely clipped extremes —
  // crushed blacks or blown highlights destroy information; "dark" does not.
  const clipping =
    signals.faceBrightness < 0.08 || signals.faceBrightness > 0.97
      ? 0.35
      : signals.faceBrightness < 0.14 || signals.faceBrightness > 0.93
        ? 0.75
        : 1;

  const score =
    (0.32 * signals.sharpness +
      0.28 * contrastScore +
      0.24 * sizeScore +
      0.16 * signals.detectionScore) *
    clipping;

  const blocking = issues.some((issue) => BLOCKING_ISSUES.includes(issue));

  return {
    score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000,
    acceptable: !blocking && score >= thresholds.faceMinQuality,
    issues,
    warnings,
  };
}

/**
 * Whether a set of enrolment photos is good enough to save.
 *
 * A manager must not be able to save an enrolment that will fail every scan
 * afterwards — that turns into "the face scanner is broken" a week later.
 */
export function canCompleteEnrolment(
  assessments: readonly QualityAssessment[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { ok: boolean; usable: number; required: number } {
  const usable = assessments.filter((a) => a.acceptable).length;
  return {
    ok: usable >= thresholds.faceMinEnrolmentPhotos,
    usable,
    required: thresholds.faceMinEnrolmentPhotos,
  };
}

/** Averages several descriptors into one L2-normalised centroid. */
export function averageDescriptors(descriptors: readonly (readonly number[])[]): number[] {
  const usable = descriptors.filter((d) => d.length > 0);
  if (usable.length === 0) return [];
  const length = (usable[0] as readonly number[]).length;
  const sum = new Array<number>(length).fill(0);

  for (const descriptor of usable) {
    if (descriptor.length !== length) continue;
    for (let i = 0; i < length; i += 1) sum[i] = (sum[i] as number) + (descriptor[i] as number);
  }

  let norm = 0;
  for (let i = 0; i < length; i += 1) {
    sum[i] = (sum[i] as number) / usable.length;
    norm += (sum[i] as number) ** 2;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return sum;
  return sum.map((v) => v / norm);
}
