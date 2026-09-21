import { describe, expect, it } from 'vitest';
import { evaluateTrip } from '@domain/anomaly-engine.ts';
import type { AnomalyInput } from '@domain/anomaly-engine.ts';
import { DEFAULT_THRESHOLDS } from '@domain/thresholds.ts';
import type { Baseline, TripContext, TripReadings } from '@domain/types.ts';

const context: TripContext = {
  expectedDistanceKm: 50,
  distanceTolerancePct: 10,
  startedAt: '2026-03-01T07:00:00.000Z',
  endedAt: '2026-03-01T09:00:00.000Z',
  tankCapacityLitres: 160,
  fuelType: 'DIESEL',
  nominalEfficiencyKmpl: 5.2,
};

const normalReadings: TripReadings = {
  startOdometerKm: 100_000,
  endOdometerKm: 100_050,
  startRangeKm: 400,
  endRangeKm: 348,
  startFuelPercent: 80,
  endFuelPercent: 74,
  refuelLitres: null,
};

const baseline: Baseline = {
  sampleSize: 14,
  medianEfficiencyKmpl: 5.2,
  madEfficiencyKmpl: 0.15,
  medianRangeDropPerKm: 1.05,
  madRangeDropPerKm: 0.06,
  medianDistanceKm: 50,
};

const input = (overrides: Partial<AnomalyInput> = {}): AnomalyInput => ({
  readings: normalReadings,
  context,
  baseline,
  thresholds: DEFAULT_THRESHOLDS,
  ...overrides,
});

describe('evaluateTrip', () => {
  it('raises nothing for an ordinary trip', () => {
    const result = evaluateTrip(input());
    expect(result.findings).toHaveLength(0);
    expect(result.requiresReview).toBe(false);
    expect(result.anomalyScore).toBe(0);
  });

  it('flags a distance well outside the route tolerance', () => {
    const result = evaluateTrip(input({ readings: { ...normalReadings, endOdometerKm: 100_067 } }));
    const finding = result.findings.find((f) => f.kind === 'DISTANCE_VARIANCE');
    expect(finding).toBeDefined();
    expect(finding?.observedValue).toBe(67);
    expect(finding?.expectedValue).toBe(50);
    expect(finding?.variancePct).toBe(34);
    expect(finding?.detail.direction).toBe('ABOVE');
    expect(result.requiresReview).toBe(true);
  });

  it('stays quiet inside the tolerance band', () => {
    const result = evaluateTrip(input({ readings: { ...normalReadings, endOdometerKm: 100_054 } }));
    expect(result.findings.find((f) => f.kind === 'DISTANCE_VARIANCE')).toBeUndefined();
  });

  it('honours the route tolerance rather than the global default', () => {
    const strict = evaluateTrip(
      input({
        readings: { ...normalReadings, endOdometerKm: 100_056 },
        context: { ...context, distanceTolerancePct: 5 },
      }),
    );
    expect(strict.findings.some((f) => f.kind === 'DISTANCE_VARIANCE')).toBe(true);
  });

  it('treats a regressed odometer as high severity', () => {
    const result = evaluateTrip(input({ readings: { ...normalReadings, endOdometerKm: 99_900 } }));
    const finding = result.findings.find((f) => f.kind === 'ODOMETER_REGRESSION');
    expect(finding?.severity).toBe('HIGH');
    expect(result.highestSeverity).toBe('HIGH');
  });

  it('reports an unusual range drop as a RANGE anomaly, never as a fuel quantity', () => {
    const result = evaluateTrip(
      input({
        readings: {
          ...normalReadings,
          endOdometerKm: 100_032,
          startRangeKm: 340,
          endRangeKm: 255,
        },
        context: { ...context, expectedDistanceKm: 32 },
        baseline: { ...baseline, medianRangeDropPerKm: 1.2, sampleSize: 11 },
      }),
    );
    const finding = result.findings.find((f) => f.kind === 'RANGE_DROP');
    expect(finding).toBeDefined();
    expect(finding?.unit).toBe('km');
    expect(finding?.observedValue).toBe(85);
    expect(finding?.expectedValue).toBeCloseTo(38.4, 1);
    // The engine must mark this as an estimate so the UI can caveat it.
    expect(finding?.detail.estimateOnly).toBe(true);
    expect(JSON.stringify(finding)).not.toMatch(/fraud|theft|stole/i);
  });

  it('will not raise a range anomaly without enough history to compare against', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, startRangeKm: 340, endRangeKm: 255 },
        baseline: { ...baseline, sampleSize: 2 },
      }),
    );
    expect(result.findings.some((f) => f.kind === 'RANGE_DROP')).toBe(false);
  });

  it('flags low efficiency against the learned median', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, endFuelPercent: 68 },
        baseline: { ...baseline, medianEfficiencyKmpl: 5.2, sampleSize: 20 },
      }),
    );
    const finding = result.findings.find((f) => f.kind === 'LOW_EFFICIENCY');
    expect(finding).toBeDefined();
    expect(finding?.detail.baselineSource).toBe('HISTORICAL_MEDIAN');
  });

  it('downgrades a low-efficiency finding that rests on a configured figure', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, endFuelPercent: 60 },
        baseline: null,
      }),
    );
    const finding = result.findings.find((f) => f.kind === 'LOW_EFFICIENCY');
    expect(finding).toBeDefined();
    expect(finding?.detail.baselineSource).toBe('CONFIGURED');
    expect(finding?.severity).not.toBe('HIGH');
  });

  it('notices fuel disappearing without distance', () => {
    const result = evaluateTrip(
      input({
        readings: {
          ...normalReadings,
          endOdometerKm: 100_001,
          startFuelPercent: 80,
          endFuelPercent: 62,
        },
        context: { ...context, expectedDistanceKm: 1 },
      }),
    );
    const finding = result.findings.find((f) => f.kind === 'FUEL_DROP_WITHOUT_DISTANCE');
    expect(finding?.severity).toBe('HIGH');
    expect(finding?.detail.reasons).toContain('REQUIRES_REVIEW');
  });

  it('records low OCR confidence as informational only', () => {
    const result = evaluateTrip(
      input({
        signals: [
          {
            field: 'RANGE_KM',
            ocrConfidence: 0.31,
            ocrValue: 348,
            finalValue: 348,
            wasCorrected: false,
          },
        ],
      }),
    );
    const finding = result.findings.find((f) => f.kind === 'READING_CONFIDENCE');
    expect(finding?.severity).toBe('LOW');
    // LOW-only findings must not drag the trip into the review queue.
    expect(result.requiresReview).toBe(false);
  });

  it('ignores a trivial manager correction but records a substantial one', () => {
    const trivial = evaluateTrip(
      input({
        signals: [
          {
            field: 'ODOMETER',
            ocrConfidence: 0.9,
            ocrValue: 100_050,
            finalValue: 100_051,
            wasCorrected: true,
          },
        ],
      }),
    );
    expect(trivial.findings.some((f) => f.kind === 'READING_CORRECTION')).toBe(false);

    const substantial = evaluateTrip(
      input({
        signals: [
          {
            field: 'ODOMETER',
            ocrConfidence: 0.4,
            ocrValue: 10_050,
            finalValue: 100_050,
            wasCorrected: true,
          },
        ],
      }),
    );
    expect(substantial.findings.some((f) => f.kind === 'READING_CORRECTION')).toBe(true);
  });

  it('flags a duplicate dashboard photograph', () => {
    const result = evaluateTrip(input({ duplicateCaptureOf: 'capture-123' }));
    const finding = result.findings.find((f) => f.kind === 'DUPLICATE_CAPTURE');
    expect(finding?.detail.duplicateOfCaptureId).toBe('capture-123');
  });

  it('flags a trip completed without its end reading', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, endOdometerKm: null },
        completedWithOverride: true,
      }),
    );
    expect(result.findings.some((f) => f.kind === 'MISSING_END_READING')).toBe(true);
  });

  it('can be switched off per rule by an administrator', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, endOdometerKm: 100_067 },
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          rules: { DISTANCE_VARIANCE: { enabled: false } },
        },
      }),
    );
    expect(result.findings.some((f) => f.kind === 'DISTANCE_VARIANCE')).toBe(false);
  });

  it('orders findings by severity then score', () => {
    const result = evaluateTrip(
      input({
        readings: { ...normalReadings, endOdometerKm: 99_900 },
        signals: [
          {
            field: 'RANGE_KM',
            ocrConfidence: 0.2,
            ocrValue: 1,
            finalValue: 1,
            wasCorrected: false,
          },
        ],
      }),
    );
    expect(result.findings[0]?.severity).toBe('HIGH');
    expect(result.findings.at(-1)?.severity).toBe('LOW');
  });

  it('never emits accusatory vocabulary in any finding', () => {
    const result = evaluateTrip(
      input({
        readings: {
          ...normalReadings,
          endOdometerKm: 100_120,
          startFuelPercent: 90,
          endFuelPercent: 40,
          startRangeKm: 500,
          endRangeKm: 120,
        },
      }),
    );
    const serialised = JSON.stringify(result).toLowerCase();
    for (const word of ['fraud', 'theft', 'thief', 'stealing', 'stole', 'guilty']) {
      expect(serialised).not.toContain(word);
    }
  });
});
