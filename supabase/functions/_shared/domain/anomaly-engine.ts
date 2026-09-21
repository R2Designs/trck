/**
 * The anomaly engine.
 *
 * Design rules, in order of importance:
 *
 *  1. **It never accuses anyone.** Findings describe measurements
 *     ("distance 34% above the route average"), never intent. The words
 *     "fraud" and "theft" do not appear in this file, in the database enum, or
 *     in any translation key it emits.
 *  2. **Every finding is explainable.** A finding carries the observed value,
 *     the expected value, the rule that fired and a snapshot of the thresholds
 *     in force at the time — so it can still be explained months later, after
 *     an administrator has retuned the settings.
 *  3. **Estimates are labelled as estimates.** Dashboard *range* is the
 *     vehicle's own forecast. A range anomaly is reported as a range anomaly;
 *     it is never silently converted into litres or into a fuel accusation.
 *  4. **Unknown is not zero.** A rule that lacks its inputs returns `null`
 *     instead of guessing.
 *
 * The same module runs in the browser (to explain a finding) and in the
 * `trip-finalise` Edge Function (to create it), so the two can never disagree.
 */

import type { AnomalyKind, AnomalySeverity, Baseline, TripContext, TripReadings } from './types.ts';
import { DEFAULT_THRESHOLDS, isRuleEnabled, ruleWeight } from './thresholds.ts';
import type { Thresholds } from './thresholds.ts';
import { computeTripMetrics, MAX_PLAUSIBLE_TRIP_KM } from './trip-metrics.ts';
import type { TripMetrics } from './trip-metrics.ts';

export interface ReadingSignal {
  field: 'ODOMETER' | 'RANGE_KM' | 'FUEL_PERCENT' | 'TRIP_METER';
  ocrConfidence: number | null;
  ocrValue: number | null;
  finalValue: number | null;
  wasCorrected: boolean;
}

export interface AnomalyInput {
  readings: TripReadings;
  context: TripContext;
  baseline: Baseline | null;
  thresholds: Thresholds;
  /** Per-field OCR evidence for the two captures of this trip. */
  signals?: readonly ReadingSignal[];
  /** Set when an identical image hash was already submitted for this bus. */
  duplicateCaptureOf?: string | null;
  /** True when the manager completed the trip without a required reading. */
  completedWithOverride?: boolean;
}

export interface AnomalyFinding {
  kind: AnomalyKind;
  ruleCode: string;
  ruleVersion: number;
  severity: AnomalySeverity;
  /** 0–100, comparable across rules. Used only to order the review queue. */
  score: number;
  observedValue: number | null;
  expectedValue: number | null;
  variancePct: number | null;
  unit: string | null;
  /**
   * Interpolation values for the translated explanation. Never a sentence:
   * the UI owns the wording, in the manager's chosen language.
   */
  detail: Record<string, unknown>;
  thresholdSnapshot: Record<string, unknown>;
}

interface Rule {
  kind: AnomalyKind;
  code: string;
  version: number;
  evaluate: (input: AnomalyInput, metrics: TripMetrics) => AnomalyFinding | null;
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Maps "how many times past the threshold" onto a 0–100 score and a severity.
 * Exceeding a threshold at all is meaningful; exceeding it threefold is not
 * three times as meaningful, hence the compression.
 */
function gradeExcess(excessRatio: number): { score: number; severity: AnomalySeverity } {
  const score = clamp(Math.log2(1 + Math.max(0, excessRatio)) * 55);
  const severity: AnomalySeverity = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return { score: round(score, 1), severity };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const distanceVarianceRule: Rule = {
  kind: 'DISTANCE_VARIANCE',
  code: 'distance.variance.v1',
  version: 1,
  evaluate(input, metrics) {
    const { distanceVariancePct } = metrics;
    if (distanceVariancePct == null) return null;

    const tolerance = input.context.distanceTolerancePct ?? input.thresholds.distanceTolerancePct;
    const magnitude = Math.abs(distanceVariancePct);
    if (magnitude <= tolerance) return null;

    const { score, severity } = gradeExcess((magnitude - tolerance) / Math.max(tolerance, 1));
    return {
      kind: 'DISTANCE_VARIANCE',
      ruleCode: distanceVarianceRule.code,
      ruleVersion: 1,
      severity,
      score,
      observedValue: metrics.distanceKm,
      expectedValue: input.context.expectedDistanceKm,
      variancePct: distanceVariancePct,
      unit: 'km',
      detail: {
        direction: distanceVariancePct > 0 ? 'ABOVE' : 'BELOW',
        // Possible explanations a human should consider — not conclusions.
        reasons:
          distanceVariancePct > 0
            ? ['ROUTE_DEVIATION', 'EXTRA_TRIP', 'INCORRECT_READING', 'UNSCHEDULED_OPERATION']
            : ['TRIP_CUT_SHORT', 'INCORRECT_READING', 'ROUTE_CHANGED'],
      },
      thresholdSnapshot: { tolerance_pct: tolerance },
    };
  },
};

const odometerRegressionRule: Rule = {
  kind: 'ODOMETER_REGRESSION',
  code: 'odometer.regression.v1',
  version: 1,
  evaluate(input, metrics) {
    if (!metrics.impossible.odometerRegressed) return null;
    return {
      kind: 'ODOMETER_REGRESSION',
      ruleCode: odometerRegressionRule.code,
      ruleVersion: 1,
      severity: 'HIGH',
      score: 90,
      observedValue: input.readings.endOdometerKm,
      expectedValue: input.readings.startOdometerKm,
      variancePct: null,
      unit: 'km',
      detail: { reasons: ['INCORRECT_READING', 'WRONG_BUS_SELECTED', 'CLUSTER_REPLACED'] },
      thresholdSnapshot: {},
    };
  },
};

const odometerImplausibleRule: Rule = {
  kind: 'ODOMETER_IMPLAUSIBLE',
  code: 'odometer.implausible.v1',
  version: 1,
  evaluate(input, metrics) {
    const distance = metrics.distanceKm;
    if (distance == null) return null;

    const tooFar = distance > MAX_PLAUSIBLE_TRIP_KM;
    const tooFast = metrics.impossible.implausibleSpeed;
    if (!tooFar && !tooFast) return null;

    return {
      kind: 'ODOMETER_IMPLAUSIBLE',
      ruleCode: odometerImplausibleRule.code,
      ruleVersion: 1,
      severity: 'HIGH',
      score: 85,
      observedValue: distance,
      expectedValue: input.context.expectedDistanceKm,
      variancePct: metrics.distanceVariancePct,
      unit: 'km',
      detail: {
        cause: tooFar ? 'DISTANCE_TOO_LARGE' : 'SPEED_TOO_HIGH',
        averageSpeedKmph: metrics.averageSpeedKmph,
        durationMinutes: metrics.durationMinutes,
      },
      thresholdSnapshot: { max_trip_km: MAX_PLAUSIBLE_TRIP_KM },
    };
  },
};

const rangeDropRule: Rule = {
  kind: 'RANGE_DROP',
  code: 'range.drop.v1',
  version: 1,
  evaluate(input, metrics) {
    // A range comparison is only meaningful against this bus's own history.
    const baseline = input.baseline;
    if (
      !baseline ||
      baseline.sampleSize < input.thresholds.minTripsForBaseline ||
      baseline.medianRangeDropPerKm == null ||
      metrics.rangeDropKm == null ||
      metrics.expectedRangeDropKm == null ||
      metrics.rangeDropVariancePct == null
    ) {
      return null;
    }

    const tolerance = input.thresholds.rangeDropTolerancePct;
    if (metrics.rangeDropVariancePct <= tolerance) return null;

    const { score, severity } = gradeExcess(
      (metrics.rangeDropVariancePct - tolerance) / Math.max(tolerance, 1),
    );
    return {
      kind: 'RANGE_DROP',
      ruleCode: rangeDropRule.code,
      ruleVersion: 1,
      severity,
      score,
      observedValue: metrics.rangeDropKm,
      expectedValue: metrics.expectedRangeDropKm,
      variancePct: metrics.rangeDropVariancePct,
      unit: 'km',
      detail: {
        distanceKm: metrics.distanceKm,
        rangeDropPerKm: metrics.rangeDropPerKm,
        baselineRangeDropPerKm: baseline.medianRangeDropPerKm,
        sampleSize: baseline.sampleSize,
        // Stated explicitly so the UI can caveat it in every language.
        estimateOnly: true,
      },
      thresholdSnapshot: {
        tolerance_pct: tolerance,
        baseline_range_drop_per_km: baseline.medianRangeDropPerKm,
        sample_size: baseline.sampleSize,
      },
    };
  },
};

const lowEfficiencyRule: Rule = {
  kind: 'LOW_EFFICIENCY',
  code: 'efficiency.low.v1',
  version: 1,
  evaluate(input, metrics) {
    if (metrics.efficiencyKmpl == null || metrics.efficiencyVsBaselinePct == null) return null;

    const usingLearnedBaseline =
      input.baseline != null &&
      input.baseline.sampleSize >= input.thresholds.minTripsForBaseline &&
      input.baseline.medianEfficiencyKmpl != null;

    const reference = usingLearnedBaseline
      ? (input.baseline?.medianEfficiencyKmpl ?? null)
      : input.context.nominalEfficiencyKmpl;
    if (reference == null) return null;

    const dropPct = -metrics.efficiencyVsBaselinePct;
    const tolerance = input.thresholds.efficiencyDropTolerancePct;
    if (dropPct <= tolerance) return null;

    const { score, severity } = gradeExcess((dropPct - tolerance) / Math.max(tolerance, 1));
    return {
      kind: 'LOW_EFFICIENCY',
      ruleCode: lowEfficiencyRule.code,
      ruleVersion: 1,
      // A figure derived from a configured number rather than this bus's own
      // history is weaker evidence, so it is never raised as HIGH on its own.
      severity: usingLearnedBaseline ? severity : severity === 'HIGH' ? 'MEDIUM' : severity,
      score,
      observedValue: metrics.efficiencyKmpl,
      expectedValue: round(reference, 2),
      variancePct: round(-dropPct, 2),
      unit: 'km/L',
      detail: {
        baselineSource: usingLearnedBaseline ? 'HISTORICAL_MEDIAN' : 'CONFIGURED',
        sampleSize: input.baseline?.sampleSize ?? 0,
        fuelUsedLitres: metrics.fuelUsedLitres,
        // Litres here come from a percentage gauge, not a flow meter.
        estimateOnly: input.readings.refuelLitres == null,
      },
      thresholdSnapshot: {
        tolerance_pct: tolerance,
        min_trips_for_baseline: input.thresholds.minTripsForBaseline,
      },
    };
  },
};

const fuelDropWithoutDistanceRule: Rule = {
  kind: 'FUEL_DROP_WITHOUT_DISTANCE',
  code: 'fuel.drop_without_distance.v1',
  version: 1,
  evaluate(input, metrics) {
    const { startFuelPercent, endFuelPercent } = input.readings;
    if (startFuelPercent == null || endFuelPercent == null) return null;
    if (metrics.distanceKm == null) return null;

    const fuelDropPct = startFuelPercent - endFuelPercent;
    // Ten percentage points of tank for under two kilometres is not a
    // consumption pattern any duty cycle explains — but it is equally likely to
    // be a mis-read gauge, so both possibilities are surfaced.
    if (fuelDropPct < 10 || metrics.distanceKm > 2) return null;

    return {
      kind: 'FUEL_DROP_WITHOUT_DISTANCE',
      ruleCode: fuelDropWithoutDistanceRule.code,
      ruleVersion: 1,
      severity: 'HIGH',
      score: 78,
      observedValue: round(fuelDropPct, 1),
      expectedValue: 0,
      variancePct: null,
      unit: '%',
      detail: {
        distanceKm: metrics.distanceKm,
        reasons: ['INCORRECT_READING', 'GAUGE_FAULT', 'IDLING', 'REQUIRES_REVIEW'],
        estimateOnly: true,
      },
      thresholdSnapshot: { min_fuel_drop_pct: 10, max_distance_km: 2 },
    };
  },
};

const readingConfidenceRule: Rule = {
  kind: 'READING_CONFIDENCE',
  code: 'reading.low_confidence.v1',
  version: 1,
  evaluate(input) {
    const signals = input.signals ?? [];
    const weak = signals.filter(
      (s) =>
        !s.wasCorrected &&
        s.ocrConfidence != null &&
        s.ocrConfidence < input.thresholds.ocrMediumConfidence,
    );
    if (weak.length === 0) return null;

    const worst = weak.reduce((a, b) => ((a.ocrConfidence ?? 1) <= (b.ocrConfidence ?? 1) ? a : b));
    return {
      kind: 'READING_CONFIDENCE',
      ruleCode: readingConfidenceRule.code,
      ruleVersion: 1,
      severity: 'LOW',
      score: 25,
      observedValue: worst.ocrConfidence,
      expectedValue: input.thresholds.ocrMediumConfidence,
      variancePct: null,
      unit: null,
      detail: { field: worst.field, fields: weak.map((s) => s.field) },
      thresholdSnapshot: { medium_confidence: input.thresholds.ocrMediumConfidence },
    };
  },
};

const readingCorrectionRule: Rule = {
  kind: 'READING_CORRECTION',
  code: 'reading.substantial_correction.v1',
  version: 1,
  evaluate(input) {
    const signals = input.signals ?? [];
    // A manager nudging 86,542 to 86,543 is noise. A manager replacing 8,654
    // with 86,542 says the extraction was wrong in a way worth recording.
    const substantial = signals.filter((s) => {
      if (!s.wasCorrected || s.ocrValue == null || s.finalValue == null) return false;
      const denominator = Math.max(Math.abs(s.ocrValue), 1);
      return Math.abs(s.finalValue - s.ocrValue) / denominator > 0.05;
    });
    if (substantial.length === 0) return null;

    const worst = substantial.reduce((a, b) => {
      const da =
        Math.abs((a.finalValue ?? 0) - (a.ocrValue ?? 0)) / Math.max(Math.abs(a.ocrValue ?? 1), 1);
      const db =
        Math.abs((b.finalValue ?? 0) - (b.ocrValue ?? 0)) / Math.max(Math.abs(b.ocrValue ?? 1), 1);
      return da >= db ? a : b;
    });

    return {
      kind: 'READING_CORRECTION',
      ruleCode: readingCorrectionRule.code,
      ruleVersion: 1,
      severity: 'LOW',
      score: 20,
      observedValue: worst.finalValue,
      expectedValue: worst.ocrValue,
      variancePct:
        worst.ocrValue && worst.ocrValue !== 0
          ? round((((worst.finalValue ?? 0) - worst.ocrValue) / Math.abs(worst.ocrValue)) * 100, 2)
          : null,
      unit: null,
      detail: { field: worst.field, correctedFields: substantial.map((s) => s.field) },
      thresholdSnapshot: { substantial_change_ratio: 0.05 },
    };
  },
};

const duplicateCaptureRule: Rule = {
  kind: 'DUPLICATE_CAPTURE',
  code: 'capture.duplicate.v1',
  version: 1,
  evaluate(input) {
    if (!input.duplicateCaptureOf) return null;
    return {
      kind: 'DUPLICATE_CAPTURE',
      ruleCode: duplicateCaptureRule.code,
      ruleVersion: 1,
      severity: 'MEDIUM',
      score: 55,
      observedValue: null,
      expectedValue: null,
      variancePct: null,
      unit: null,
      detail: { duplicateOfCaptureId: input.duplicateCaptureOf },
      thresholdSnapshot: {},
    };
  },
};

const durationInconsistentRule: Rule = {
  kind: 'DURATION_INCONSISTENT',
  code: 'trip.duration_inconsistent.v1',
  version: 1,
  evaluate(_input, metrics) {
    const { durationMinutes, distanceKm, averageSpeedKmph } = metrics;
    if (durationMinutes == null || distanceKm == null || averageSpeedKmph == null) return null;
    if (durationMinutes <= 0) {
      return {
        kind: 'DURATION_INCONSISTENT',
        ruleCode: durationInconsistentRule.code,
        ruleVersion: 1,
        severity: 'MEDIUM',
        score: 60,
        observedValue: durationMinutes,
        expectedValue: null,
        variancePct: null,
        unit: 'min',
        detail: { cause: 'NON_POSITIVE_DURATION', distanceKm },
        thresholdSnapshot: {},
      };
    }
    // Under 6 km/h over a meaningful distance means the trip was almost
    // certainly closed long after it actually ended.
    if (distanceKm >= 5 && averageSpeedKmph < 6) {
      return {
        kind: 'DURATION_INCONSISTENT',
        ruleCode: durationInconsistentRule.code,
        ruleVersion: 1,
        severity: 'LOW',
        score: 30,
        observedValue: averageSpeedKmph,
        expectedValue: 6,
        variancePct: null,
        unit: 'km/h',
        detail: { cause: 'IMPLAUSIBLY_SLOW', durationMinutes, distanceKm },
        thresholdSnapshot: { min_average_speed_kmph: 6 },
      };
    }
    return null;
  },
};

const missingEndReadingRule: Rule = {
  kind: 'MISSING_END_READING',
  code: 'trip.missing_end_reading.v1',
  version: 1,
  evaluate(input) {
    if (!input.completedWithOverride) return null;
    if (input.readings.endOdometerKm != null) return null;
    return {
      kind: 'MISSING_END_READING',
      ruleCode: missingEndReadingRule.code,
      ruleVersion: 1,
      severity: 'MEDIUM',
      score: 45,
      observedValue: null,
      expectedValue: null,
      variancePct: null,
      unit: null,
      detail: { completedWithOverride: true },
      thresholdSnapshot: {},
    };
  },
};

export const ANOMALY_RULES: readonly Rule[] = [
  odometerRegressionRule,
  odometerImplausibleRule,
  distanceVarianceRule,
  rangeDropRule,
  lowEfficiencyRule,
  fuelDropWithoutDistanceRule,
  durationInconsistentRule,
  duplicateCaptureRule,
  readingConfidenceRule,
  readingCorrectionRule,
  missingEndReadingRule,
];

export interface AnomalyEvaluation {
  metrics: TripMetrics;
  findings: AnomalyFinding[];
  /** Highest single finding score; drives the trip's review queue position. */
  anomalyScore: number;
  requiresReview: boolean;
  highestSeverity: AnomalySeverity | null;
}

/**
 * Runs every enabled rule and returns the findings, ordered most serious first.
 * Pure: no I/O, no clock reads beyond what the caller supplied.
 */
export function evaluateTrip(input: AnomalyInput): AnomalyEvaluation {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const metrics = computeTripMetrics(input.readings, input.context, input.baseline);

  const findings: AnomalyFinding[] = [];
  for (const rule of ANOMALY_RULES) {
    if (!isRuleEnabled(thresholds, rule.kind)) continue;
    const finding = rule.evaluate({ ...input, thresholds }, metrics);
    if (!finding) continue;
    const weighted = clamp(finding.score * ruleWeight(thresholds, rule.kind));
    findings.push({ ...finding, score: round(weighted, 1) });
  }

  const severityRank: Record<AnomalySeverity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  findings.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.score - a.score);

  const anomalyScore = findings.reduce((max, f) => Math.max(max, f.score), 0);
  const highestSeverity = findings[0]?.severity ?? null;

  return {
    metrics,
    findings,
    anomalyScore: round(anomalyScore, 1),
    // LOW-only findings are informational: they appear on the trip, but they do
    // not drag the trip into the review queue.
    requiresReview: findings.some((f) => f.severity !== 'LOW'),
    highestSeverity,
  };
}
