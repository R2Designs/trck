/**
 * Trip arithmetic.
 *
 * Deliberately separate from the anomaly rules: this module answers "what
 * happened?", the rules answer "is that worth a manager's time?".
 *
 * A recurring theme — `null` means *unknown*, and unknown never silently
 * becomes zero. A trip with no end odometer has an unknown distance, not a
 * distance of 0 km, and every downstream calculation must propagate that.
 */

import type { Baseline, TripContext, TripReadings } from './types.ts';

export interface TripMetrics {
  /** Odometer delta. `null` when either reading is missing. */
  distanceKm: number | null;
  distanceVarianceKm: number | null;
  distanceVariancePct: number | null;
  /** True when the distance sits inside the route's configured tolerance band. */
  withinTolerance: boolean | null;

  durationMinutes: number | null;
  averageSpeedKmph: number | null;

  /**
   * Litres consumed. Only produced when litres are actually knowable — i.e. the
   * bus has a stated tank capacity and both fuel percentages were read. Fuel
   * percentage is itself a coarse gauge reading, so this is an estimate and is
   * labelled as such everywhere it is shown.
   */
  fuelUsedLitres: number | null;
  efficiencyKmpl: number | null;
  efficiencyVsBaselinePct: number | null;

  /** Kilometres of displayed range lost per kilometre actually driven. */
  rangeDropKm: number | null;
  rangeDropPerKm: number | null;
  expectedRangeDropKm: number | null;
  rangeDropVariancePct: number | null;

  /** Hard impossibilities, as opposed to merely unusual values. */
  impossible: {
    odometerRegressed: boolean;
    negativeDuration: boolean;
    implausibleSpeed: boolean;
  };
}

/** Above this the odometer delta cannot have been driven by a city bus. */
export const MAX_PLAUSIBLE_SPEED_KMPH = 110;
/** A single city-bus trip longer than this is almost certainly a reading error. */
export const MAX_PLAUSIBLE_TRIP_KM = 1200;

function toTime(value: string | Date | null): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function computeTripMetrics(
  readings: TripReadings,
  context: TripContext,
  baseline: Baseline | null = null,
): TripMetrics {
  const {
    startOdometerKm,
    endOdometerKm,
    startRangeKm,
    endRangeKm,
    startFuelPercent,
    endFuelPercent,
    refuelLitres,
  } = readings;

  const hasOdometers = startOdometerKm != null && endOdometerKm != null;
  const distanceKm = hasOdometers ? round(endOdometerKm - startOdometerKm, 1) : null;

  const distanceVarianceKm =
    distanceKm == null ? null : round(distanceKm - context.expectedDistanceKm, 1);
  const distanceVariancePct =
    distanceKm == null || context.expectedDistanceKm <= 0
      ? null
      : round(((distanceKm - context.expectedDistanceKm) / context.expectedDistanceKm) * 100, 2);
  const withinTolerance =
    distanceVariancePct == null
      ? null
      : Math.abs(distanceVariancePct) <= context.distanceTolerancePct;

  const startMs = toTime(context.startedAt);
  const endMs = toTime(context.endedAt);
  const durationMinutes =
    startMs != null && endMs != null ? Math.round((endMs - startMs) / 60000) : null;

  const averageSpeedKmph =
    distanceKm != null && durationMinutes != null && durationMinutes > 0
      ? round((distanceKm / durationMinutes) * 60, 1)
      : null;

  // --- Fuel -----------------------------------------------------------------
  // Electric buses have no litres at all; saying "0 L used" would be a lie, so
  // the field stays unknown and the UI shows range/percentage indicators only.
  let fuelUsedLitres: number | null = null;
  if (
    context.fuelType !== 'ELECTRIC' &&
    context.tankCapacityLitres != null &&
    context.tankCapacityLitres > 0 &&
    startFuelPercent != null &&
    endFuelPercent != null
  ) {
    const drop = ((startFuelPercent - endFuelPercent) / 100) * context.tankCapacityLitres;
    const used = drop + (refuelLitres ?? 0);
    fuelUsedLitres = used > 0 ? round(used, 2) : null;
  }

  const efficiencyKmpl =
    distanceKm != null && distanceKm > 0 && fuelUsedLitres != null && fuelUsedLitres > 0
      ? round(distanceKm / fuelUsedLitres, 2)
      : null;

  // A *learned* median only outranks the configured figure once enough valid
  // trips exist; otherwise one unlucky week would redefine "normal".
  const referenceEfficiency =
    baseline && baseline.sampleSize > 0 && baseline.medianEfficiencyKmpl != null
      ? baseline.medianEfficiencyKmpl
      : context.nominalEfficiencyKmpl;

  const efficiencyVsBaselinePct =
    efficiencyKmpl != null && referenceEfficiency != null && referenceEfficiency > 0
      ? round(((efficiencyKmpl - referenceEfficiency) / referenceEfficiency) * 100, 2)
      : null;

  // --- Range ----------------------------------------------------------------
  // Range is the vehicle's own forecast, not a measurement. It is compared only
  // against this bus's own history, never converted into litres.
  const rangeDropKm =
    startRangeKm != null && endRangeKm != null ? round(startRangeKm - endRangeKm, 1) : null;

  const rangeDropPerKm =
    rangeDropKm != null && distanceKm != null && distanceKm > 0
      ? round(rangeDropKm / distanceKm, 3)
      : null;

  const expectedRangeDropKm =
    distanceKm != null && baseline?.medianRangeDropPerKm != null
      ? round(distanceKm * baseline.medianRangeDropPerKm, 1)
      : null;

  const rangeDropVariancePct =
    rangeDropKm != null && expectedRangeDropKm != null && expectedRangeDropKm > 0
      ? round(((rangeDropKm - expectedRangeDropKm) / expectedRangeDropKm) * 100, 2)
      : null;

  return {
    distanceKm,
    distanceVarianceKm,
    distanceVariancePct,
    withinTolerance,
    durationMinutes,
    averageSpeedKmph,
    fuelUsedLitres,
    efficiencyKmpl,
    efficiencyVsBaselinePct,
    rangeDropKm,
    rangeDropPerKm,
    expectedRangeDropKm,
    rangeDropVariancePct,
    impossible: {
      odometerRegressed: hasOdometers && endOdometerKm < startOdometerKm,
      negativeDuration: durationMinutes != null && durationMinutes < 0,
      implausibleSpeed: averageSpeedKmph != null && averageSpeedKmph > MAX_PLAUSIBLE_SPEED_KMPH,
    },
  };
}

/**
 * Median of a numeric sample. Used for baselines instead of the mean so that a
 * single mis-read odometer cannot drag "normal" with it.
 */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Median absolute deviation — a dispersion measure that ignores outliers. */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const med = median(values);
  if (med == null) return null;
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust z-score. Uses MAD rather than standard deviation, scaled by 1.4826 so
 * that for normally distributed data it matches the familiar z.
 */
export function robustZScore(value: number, values: readonly number[]): number | null {
  const med = median(values);
  const mad = medianAbsoluteDeviation(values);
  if (med == null || mad == null || mad === 0) return null;
  return round((value - med) / (1.4826 * mad), 3);
}
