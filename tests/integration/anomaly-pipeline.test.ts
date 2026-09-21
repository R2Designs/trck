import { describe, expect, it } from 'vitest';
import { evaluateTrip } from '@domain/anomaly-engine.ts';
import { DEFAULT_THRESHOLDS, thresholdsFromRow } from '@domain/thresholds.ts';
import { EMPTY_BASELINE } from '@domain/types.ts';
import type { Baseline, TripContext, TripReadings } from '@domain/types.ts';
import { parseDashboardText } from '@domain/ocr-parse.ts';

/**
 * The pipeline, end to end without a database.
 *
 * A dashboard photograph becomes OCR text, the text becomes readings, the
 * readings become a trip, and the trip becomes zero or more findings. Each
 * stage has its own unit tests; what these assert is that they *compose* —
 * that a number the parser produces is a number the engine can use, and that
 * the whole chain arrives at the conclusion a human would.
 */

const CONTEXT: TripContext = {
  expectedDistanceKm: 120,
  distanceTolerancePct: 10,
  startedAt: '2026-09-21T03:30:00.000Z',
  endedAt: '2026-09-21T08:30:00.000Z',
  tankCapacityLitres: 120,
  fuelType: 'DIESEL',
  nominalEfficiencyKmpl: 5,
};

const HEALTHY_BASELINE: Baseline = {
  sampleSize: 24,
  medianEfficiencyKmpl: 5,
  madEfficiencyKmpl: 0.3,
  medianRangeDropPerKm: 1.05,
  madRangeDropPerKm: 0.08,
  medianDistanceKm: 120,
};

function readings(overrides: Partial<TripReadings> = {}): TripReadings {
  return {
    startOdometerKm: 100_000,
    endOdometerKm: 100_120,
    startRangeKm: 400,
    endRangeKm: 274,
    startFuelPercent: 80,
    endFuelPercent: 60,
    refuelLitres: null,
    ...overrides,
  };
}

describe('an ordinary trip', () => {
  it('produces no findings and does not enter the review queue', () => {
    const result = evaluateTrip({
      readings: readings(),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
    });

    expect(result.findings).toHaveLength(0);
    expect(result.requiresReview).toBe(false);
    expect(result.anomalyScore).toBe(0);
    expect(result.metrics.distanceKm).toBe(120);
  });
});

describe('a distance well outside the route tolerance', () => {
  const result = evaluateTrip({
    // 120 km route, 190 km driven.
    readings: readings({ endOdometerKm: 100_190 }),
    context: CONTEXT,
    baseline: HEALTHY_BASELINE,
    thresholds: DEFAULT_THRESHOLDS,
  });

  it('is flagged as a distance mismatch and requires review', () => {
    expect(result.requiresReview).toBe(true);
    expect(result.findings.map((finding) => finding.kind)).toContain('DISTANCE_VARIANCE');
  });

  it('carries the numbers a reviewer needs rather than a sentence', () => {
    const finding = result.findings.find((item) => item.kind === 'DISTANCE_VARIANCE');
    expect(finding?.observedValue).toBe(190);
    expect(finding?.expectedValue).toBe(120);
    expect(finding?.variancePct).toBeGreaterThan(50);
    expect(finding?.unit).toBe('km');
    // Explanations are assembled in the UI, in the manager's language.
    expect(JSON.stringify(finding?.detail)).not.toMatch(/[A-Z][a-z]+ [a-z]+ [a-z]+/);
  });

  it('records the thresholds that were in force, so it stays explicable later', () => {
    const finding = result.findings.find((item) => item.kind === 'DISTANCE_VARIANCE');
    expect(finding?.thresholdSnapshot).toBeTruthy();
    expect(Object.keys(finding?.thresholdSnapshot ?? {}).length).toBeGreaterThan(0);
    expect(finding?.ruleVersion).toBeGreaterThanOrEqual(1);
  });
});

describe('low-confidence OCR', () => {
  it('tempers a finding rather than being taken at face value', () => {
    const confident = evaluateTrip({
      readings: readings({ endOdometerKm: 100_190 }),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
      signals: [
        {
          field: 'ODOMETER',
          ocrConfidence: 0.97,
          ocrValue: 100_190,
          finalValue: 100_190,
          wasCorrected: false,
        },
      ],
    });

    const shaky = evaluateTrip({
      readings: readings({ endOdometerKm: 100_190 }),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
      signals: [
        {
          field: 'ODOMETER',
          ocrConfidence: 0.31,
          ocrValue: 100_190,
          finalValue: 100_190,
          wasCorrected: false,
        },
      ],
    });

    const scoreOf = (result: ReturnType<typeof evaluateTrip>) =>
      result.findings.find((finding) => finding.kind === 'DISTANCE_VARIANCE')?.score ?? 0;

    // Both still surface — a doubtful reading is still worth a look — but the
    // one the machine was unsure about must not outrank the one it was sure of.
    expect(scoreOf(shaky)).toBeLessThanOrEqual(scoreOf(confident));
    expect(shaky.findings.length).toBeGreaterThan(0);
  });
});

describe('a bus with no history', () => {
  it('falls back to the configured figure instead of inventing a baseline', () => {
    const result = evaluateTrip({
      readings: readings({ endFuelPercent: 20 }),
      context: CONTEXT,
      baseline: EMPTY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
    });

    // Whatever it concludes, it must not claim a learned comparison it does not
    // have: no finding may cite a baseline sample size of zero as evidence.
    for (const finding of result.findings) {
      const detail = finding.detail as { baselineSampleSize?: number };
      expect(detail.baselineSampleSize ?? 1).toBeGreaterThan(0);
    }
  });
});

describe('an electric bus', () => {
  it('is never judged on litres it does not burn', () => {
    const result = evaluateTrip({
      readings: readings({ startFuelPercent: 95, endFuelPercent: 40 }),
      context: { ...CONTEXT, fuelType: 'ELECTRIC', tankCapacityLitres: null },
      baseline: { ...HEALTHY_BASELINE, medianEfficiencyKmpl: null, madEfficiencyKmpl: null },
      thresholds: DEFAULT_THRESHOLDS,
    });

    expect(result.metrics.fuelUsedLitres).toBeNull();
    expect(result.metrics.efficiencyKmpl).toBeNull();
    expect(result.findings.map((finding) => finding.kind)).not.toContain('LOW_EFFICIENCY');
  });
});

describe('thresholds read from an organisation row', () => {
  it('changes what is flagged, and a disabled rule stays silent', () => {
    const lenient = thresholdsFromRow({
      distance_tolerance_pct: 80,
      anomaly_rules: { DISTANCE_VARIANCE: { enabled: false, weight: 1 } },
    });

    const result = evaluateTrip({
      readings: readings({ endOdometerKm: 100_190 }),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: lenient,
    });

    expect(result.findings.map((finding) => finding.kind)).not.toContain('DISTANCE_VARIANCE');
  });

  it('degrades to the documented defaults when the row is missing or malformed', () => {
    expect(thresholdsFromRow(null)).toEqual(DEFAULT_THRESHOLDS);
    expect(thresholdsFromRow({ distance_tolerance_pct: Number.NaN }).distanceTolerancePct).toBe(
      DEFAULT_THRESHOLDS.distanceTolerancePct,
    );
  });
});

describe('OCR text feeding the engine', () => {
  it('a parsed odometer produces the same verdict as the number typed by hand', () => {
    const parsed = parseDashboardText('ODO 100190 km RANGE 274 km FUEL 60%', 0.9, {
      previousOdometerKm: 100_000,
    });

    const odometer = parsed.readings.find((reading) => reading.field === 'ODOMETER');
    expect(odometer?.value).toBe(100_190);

    const fromOcr = evaluateTrip({
      readings: readings({ endOdometerKm: odometer?.value ?? 0 }),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const fromHand = evaluateTrip({
      readings: readings({ endOdometerKm: 100_190 }),
      context: CONTEXT,
      baseline: HEALTHY_BASELINE,
      thresholds: DEFAULT_THRESHOLDS,
    });

    // The point of the shared domain module: the route a number travelled must
    // not change the conclusion drawn from it.
    expect(fromOcr.findings.map((f) => f.kind)).toEqual(fromHand.findings.map((f) => f.kind));
    expect(fromOcr.anomalyScore).toBe(fromHand.anomalyScore);
  });

  it('reports what it could not read rather than guessing a value', () => {
    const parsed = parseDashboardText('ODO 100190 km', 0.9, { previousOdometerKm: 100_000 });

    expect(parsed.readings.map((reading) => reading.field)).toContain('ODOMETER');
    // Range and fuel are absent from the photograph, so they must be reported
    // as missing — the UI asks the manager for them rather than inventing them.
    expect(parsed.missing.length).toBeGreaterThan(0);
    expect(parsed.readings.every((reading) => Number.isFinite(reading.value))).toBe(true);
  });
});
