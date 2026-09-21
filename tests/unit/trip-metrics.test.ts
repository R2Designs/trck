import { describe, expect, it } from 'vitest';
import {
  computeTripMetrics,
  median,
  medianAbsoluteDeviation,
  robustZScore,
} from '@domain/trip-metrics.ts';
import type { TripContext, TripReadings } from '@domain/types.ts';

const baseContext: TripContext = {
  expectedDistanceKm: 27.5,
  distanceTolerancePct: 10,
  startedAt: '2026-03-01T07:15:00.000Z',
  endedAt: '2026-03-01T08:32:00.000Z',
  tankCapacityLitres: 160,
  fuelType: 'DIESEL',
  nominalEfficiencyKmpl: 5.4,
};

const baseReadings: TripReadings = {
  startOdometerKm: 186392,
  endOdometerKm: 186420.5,
  startRangeKm: 395,
  endRangeKm: 365,
  startFuelPercent: 71,
  endFuelPercent: 67.5,
  refuelLitres: null,
};

describe('computeTripMetrics', () => {
  it('derives distance, variance and duration from the two odometer readings', () => {
    const m = computeTripMetrics(baseReadings, baseContext);
    expect(m.distanceKm).toBe(28.5);
    expect(m.distanceVarianceKm).toBe(1);
    expect(m.distanceVariancePct).toBeCloseTo(3.64, 2);
    expect(m.withinTolerance).toBe(true);
    expect(m.durationMinutes).toBe(77);
    expect(m.averageSpeedKmph).toBeCloseTo(22.2, 1);
  });

  it('treats a missing end odometer as unknown rather than zero', () => {
    const m = computeTripMetrics({ ...baseReadings, endOdometerKm: null }, baseContext);
    expect(m.distanceKm).toBeNull();
    expect(m.distanceVariancePct).toBeNull();
    expect(m.withinTolerance).toBeNull();
    expect(m.efficiencyKmpl).toBeNull();
  });

  it('flags a regressed odometer as impossible instead of returning a negative distance', () => {
    const m = computeTripMetrics({ ...baseReadings, endOdometerKm: 186000 }, baseContext);
    expect(m.impossible.odometerRegressed).toBe(true);
  });

  it('estimates litres from tank capacity and the two fuel percentages', () => {
    const m = computeTripMetrics(baseReadings, baseContext);
    // (71 - 67.5)% of 160 L = 5.6 L
    expect(m.fuelUsedLitres).toBeCloseTo(5.6, 2);
    expect(m.efficiencyKmpl).toBeCloseTo(5.09, 2);
  });

  it('adds recorded refuelling to the consumed quantity', () => {
    const m = computeTripMetrics({ ...baseReadings, refuelLitres: 40 }, baseContext);
    expect(m.fuelUsedLitres).toBeCloseTo(45.6, 2);
  });

  it('never reports litres for an electric bus', () => {
    const m = computeTripMetrics(baseReadings, {
      ...baseContext,
      fuelType: 'ELECTRIC',
      tankCapacityLitres: null,
    });
    expect(m.fuelUsedLitres).toBeNull();
    expect(m.efficiencyKmpl).toBeNull();
    // Range indicators still work — that is the whole point for an EV.
    expect(m.rangeDropKm).toBe(30);
  });

  it('never reports litres when the tank capacity is unknown', () => {
    const m = computeTripMetrics(baseReadings, { ...baseContext, tankCapacityLitres: null });
    expect(m.fuelUsedLitres).toBeNull();
  });

  it('compares range drop against the learned baseline, not against litres', () => {
    const m = computeTripMetrics(baseReadings, baseContext, {
      sampleSize: 14,
      medianEfficiencyKmpl: 5.31,
      madEfficiencyKmpl: 0.14,
      medianRangeDropPerKm: 1.05,
      madRangeDropPerKm: 0.06,
      medianDistanceKm: 27.8,
    });
    expect(m.rangeDropKm).toBe(30);
    expect(m.rangeDropPerKm).toBeCloseTo(1.053, 3);
    expect(m.expectedRangeDropKm).toBeCloseTo(29.9, 1);
    expect(m.rangeDropVariancePct).toBeLessThan(5);
  });

  it('prefers the learned baseline over the configured efficiency figure', () => {
    const withBaseline = computeTripMetrics(baseReadings, baseContext, {
      sampleSize: 20,
      medianEfficiencyKmpl: 4.0,
      madEfficiencyKmpl: 0.1,
      medianRangeDropPerKm: null,
      madRangeDropPerKm: null,
      medianDistanceKm: null,
    });
    // 5.09 km/L against a 4.0 baseline is *better* than baseline.
    expect(withBaseline.efficiencyVsBaselinePct).toBeGreaterThan(0);

    const withoutBaseline = computeTripMetrics(baseReadings, baseContext, null);
    // Against the configured 5.4 figure the same trip is slightly worse.
    expect(withoutBaseline.efficiencyVsBaselinePct).toBeLessThan(0);
  });

  it('detects an implausible average speed', () => {
    const m = computeTripMetrics(
      { ...baseReadings, endOdometerKm: 186392 + 400 },
      { ...baseContext, endedAt: '2026-03-01T08:15:00.000Z' },
    );
    expect(m.impossible.implausibleSpeed).toBe(true);
  });
});

describe('robust statistics', () => {
  it('computes a median for odd and even samples', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('is unmoved by a single wild outlier, unlike a mean', () => {
    const sample = [5.2, 5.3, 5.1, 5.4, 5.2, 5.3];
    const withOutlier = [...sample, 91];
    expect(median(withOutlier)).toBeCloseTo(5.3, 1);
    const mean = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    expect(mean).toBeGreaterThan(17);
  });

  it('computes MAD and a robust z-score', () => {
    const sample = [10, 10, 11, 9, 12, 8];
    expect(medianAbsoluteDeviation(sample)).toBe(1);
    expect(robustZScore(14, sample)).toBeCloseTo(2.698, 2);
  });

  it('returns null rather than Infinity when the sample has no spread', () => {
    // Every value identical => MAD 0. Dividing by it would produce Infinity and
    // flag a perfectly ordinary trip, so the caller gets "no opinion" instead.
    expect(robustZScore(10, [10, 10, 10])).toBeNull();
    expect(medianAbsoluteDeviation([7, 7, 7])).toBe(0);
  });
});
