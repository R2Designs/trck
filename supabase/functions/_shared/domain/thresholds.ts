/**
 * Operational thresholds.
 *
 * Every number the anomaly engine, the face matcher and the OCR reviewer
 * compare against lives here, and every one of them is administrator-editable
 * (table `app_settings`). Nothing in the rules is a magic literal, because a
 * threshold that cannot be tuned becomes a threshold that gets ignored.
 */

import type { AnomalyKind, ConfidenceBand } from './types.ts';

export interface Thresholds {
  /** Percent band around a route's expected distance that counts as normal. */
  distanceTolerancePct: number;
  /** How far below baseline efficiency is worth a manager's attention. */
  efficiencyDropTolerancePct: number;
  /** How far above the expected range drop is worth a manager's attention. */
  rangeDropTolerancePct: number;
  /** Completed trips needed before a learned baseline outranks the configured one. */
  minTripsForBaseline: number;
  baselineWindowDays: number;

  /** Cosine similarity at/above which one tap confirms the match. */
  faceAutoAcceptSimilarity: number;
  /** Below this, the result is "not verified" — never a silent match. */
  faceReviewSimilarity: number;
  /** Minimum composite image quality for an enrolment photo or a scan frame. */
  faceMinQuality: number;
  faceRequireLiveness: boolean;
  faceMinEnrolmentPhotos: number;

  ocrHighConfidence: number;
  ocrMediumConfidence: number;

  photoRetentionDays: number;
  dashboardCaptureRetentionDays: number;
  attendanceRetentionDays: number;

  /** Per-rule enable/disable and overrides, keyed by anomaly kind. */
  rules: Partial<Record<AnomalyKind, RuleConfig>>;
}

export interface RuleConfig {
  enabled?: boolean;
  /** Multiplies the rule's computed score; lets an operator de-prioritise noise. */
  weight?: number;
}

/**
 * Defaults chosen for a mixed diesel city fleet. They are conservative on
 * purpose: it is better to raise a reviewable anomaly than to quietly accept a
 * reading nobody looked at.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  distanceTolerancePct: 10,
  efficiencyDropTolerancePct: 20,
  rangeDropTolerancePct: 35,
  minTripsForBaseline: 8,
  baselineWindowDays: 90,

  faceAutoAcceptSimilarity: 0.62,
  faceReviewSimilarity: 0.5,
  faceMinQuality: 0.45,
  faceRequireLiveness: true,
  faceMinEnrolmentPhotos: 3,

  ocrHighConfidence: 0.85,
  ocrMediumConfidence: 0.6,

  photoRetentionDays: 365,
  dashboardCaptureRetentionDays: 180,
  attendanceRetentionDays: 2555,

  rules: {},
};

/** Shape of the `app_settings` row as PostgREST returns it (snake_case). */
export interface AppSettingsRow {
  distance_tolerance_pct: number;
  efficiency_drop_tolerance_pct: number;
  range_drop_tolerance_pct: number;
  min_trips_for_baseline: number;
  baseline_window_days: number;
  face_auto_accept_similarity: number;
  face_review_similarity: number;
  face_min_quality: number;
  face_require_liveness: boolean;
  face_min_enrolment_photos: number;
  ocr_high_confidence: number;
  ocr_medium_confidence: number;
  photo_retention_days: number;
  dashboard_capture_retention_days: number;
  attendance_retention_days: number;
  anomaly_rules: Partial<Record<AnomalyKind, RuleConfig>> | null;
}

/**
 * Converts a settings row into thresholds, falling back to the defaults for
 * anything missing. A malformed or partial row must never crash the app — it
 * degrades to the documented defaults instead.
 */
export function thresholdsFromRow(row: Partial<AppSettingsRow> | null | undefined): Thresholds {
  if (!row) return DEFAULT_THRESHOLDS;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return {
    distanceTolerancePct: num(row.distance_tolerance_pct, DEFAULT_THRESHOLDS.distanceTolerancePct),
    efficiencyDropTolerancePct: num(
      row.efficiency_drop_tolerance_pct,
      DEFAULT_THRESHOLDS.efficiencyDropTolerancePct,
    ),
    rangeDropTolerancePct: num(
      row.range_drop_tolerance_pct,
      DEFAULT_THRESHOLDS.rangeDropTolerancePct,
    ),
    minTripsForBaseline: num(row.min_trips_for_baseline, DEFAULT_THRESHOLDS.minTripsForBaseline),
    baselineWindowDays: num(row.baseline_window_days, DEFAULT_THRESHOLDS.baselineWindowDays),
    faceAutoAcceptSimilarity: num(
      row.face_auto_accept_similarity,
      DEFAULT_THRESHOLDS.faceAutoAcceptSimilarity,
    ),
    faceReviewSimilarity: num(row.face_review_similarity, DEFAULT_THRESHOLDS.faceReviewSimilarity),
    faceMinQuality: num(row.face_min_quality, DEFAULT_THRESHOLDS.faceMinQuality),
    faceRequireLiveness: row.face_require_liveness ?? DEFAULT_THRESHOLDS.faceRequireLiveness,
    faceMinEnrolmentPhotos: num(
      row.face_min_enrolment_photos,
      DEFAULT_THRESHOLDS.faceMinEnrolmentPhotos,
    ),
    ocrHighConfidence: num(row.ocr_high_confidence, DEFAULT_THRESHOLDS.ocrHighConfidence),
    ocrMediumConfidence: num(row.ocr_medium_confidence, DEFAULT_THRESHOLDS.ocrMediumConfidence),
    photoRetentionDays: num(row.photo_retention_days, DEFAULT_THRESHOLDS.photoRetentionDays),
    dashboardCaptureRetentionDays: num(
      row.dashboard_capture_retention_days,
      DEFAULT_THRESHOLDS.dashboardCaptureRetentionDays,
    ),
    attendanceRetentionDays: num(
      row.attendance_retention_days,
      DEFAULT_THRESHOLDS.attendanceRetentionDays,
    ),
    rules: row.anomaly_rules ?? {},
  };
}

/** Maps a raw 0..1 OCR confidence onto the band shown to the manager. */
export function confidenceBand(
  confidence: number | null | undefined,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ConfidenceBand {
  if (confidence == null || !Number.isFinite(confidence)) return 'LOW';
  if (confidence >= thresholds.ocrHighConfidence) return 'HIGH';
  if (confidence >= thresholds.ocrMediumConfidence) return 'MEDIUM';
  return 'LOW';
}

export function isRuleEnabled(thresholds: Thresholds, kind: AnomalyKind): boolean {
  return thresholds.rules[kind]?.enabled !== false;
}

export function ruleWeight(thresholds: Thresholds, kind: AnomalyKind): number {
  const weight = thresholds.rules[kind]?.weight;
  return typeof weight === 'number' && weight > 0 ? weight : 1;
}
