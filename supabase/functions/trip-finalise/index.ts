import { authenticate, writeAudit } from '../_shared/auth.ts';
import type { Caller } from '../_shared/auth.ts';
import { errorResponse, json, preflight, PublicError, readJson } from '../_shared/http.ts';
import { evaluateTrip } from '../_shared/domain/anomaly-engine.ts';
import type { AnomalyFinding, ReadingSignal } from '../_shared/domain/anomaly-engine.ts';
import { thresholdsFromRow } from '../_shared/domain/thresholds.ts';
import { EMPTY_BASELINE } from '../_shared/domain/types.ts';
import type { Baseline, TripContext, TripReadings } from '../_shared/domain/types.ts';

/**
 * Anomaly evaluation for a completed trip.
 *
 * Why this runs on the server at all: the browser already has the rules — it
 * imports the same `@domain` module to *explain* a finding. But a value the
 * browser computed is a value the browser could have chosen. The row that
 * lands in `anomalies` has to be produced somewhere the person being reviewed
 * cannot reach, from readings and thresholds read out of the database rather
 * than posted in a request body. That is the only thing this function adds,
 * and it is the whole point of it.
 *
 * The client sends one field: a trip id. Everything else is read here.
 *
 * Idempotent: re-running it on the same trip replaces the findings that are
 * still open and leaves anything a human has already reviewed untouched. A
 * retried request must never bury a reviewer's decision.
 */

interface RequestBody {
  tripId?: string;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const body = await readJson<RequestBody>(request);
    const caller = await authenticate(request);
    if (!body.tripId) throw new PublicError('MISSING_TRIP_ID', 400);
    return json(request, await finalise(caller, body.tripId));
  } catch (error) {
    return errorResponse(request, error);
  }
});

async function finalise(caller: Caller, tripId: string) {
  // Read the trip through the *caller's* client: RLS decides whether this
  // person may see this trip. No separate permission check is needed, and none
  // can be forgotten.
  const { data: trip, error: tripError } = await caller.asCaller
    .from('trips')
    .select(
      `*,
       bus:buses(id, registration_number, fuel_type, tank_capacity_litres, nominal_efficiency_kmpl),
       route:routes(id, name, expected_distance_km, distance_tolerance_pct)`,
    )
    .eq('id', tripId)
    .maybeSingle();

  if (tripError) throw tripError;
  if (!trip) throw new PublicError('TRIP_NOT_FOUND', 404);
  if (trip.status !== 'COMPLETED') throw new PublicError('TRIP_NOT_COMPLETED', 409);

  const bus = trip.bus as {
    id: string;
    fuel_type: string;
    tank_capacity_litres: number | null;
    nominal_efficiency_kmpl: number | null;
  } | null;

  const [thresholds, baseline, signals, duplicateOf] = await Promise.all([
    loadThresholds(caller),
    loadBaseline(caller, trip.bus_id as string, trip.route_id as string | null),
    loadSignals(caller, tripId),
    findDuplicateCapture(caller, trip.bus_id as string, tripId),
  ]);

  const readings: TripReadings = {
    startOdometerKm: numberOrNull(trip.start_odometer_km),
    endOdometerKm: numberOrNull(trip.end_odometer_km),
    startRangeKm: numberOrNull(trip.start_range_km),
    endRangeKm: numberOrNull(trip.end_range_km),
    startFuelPercent: numberOrNull(trip.start_fuel_percent),
    endFuelPercent: numberOrNull(trip.end_fuel_percent),
    refuelLitres: numberOrNull(trip.refuel_litres),
  };

  const context: TripContext = {
    // The trip's *snapshotted* figures, not the route's current ones: a route
    // edited after the fact must not retroactively make a trip anomalous.
    expectedDistanceKm: Number(trip.expected_distance_km),
    distanceTolerancePct: Number(trip.distance_tolerance_pct),
    startedAt: trip.actual_start_time as string | null,
    endedAt: trip.actual_end_time as string | null,
    tankCapacityLitres: numberOrNull(bus?.tank_capacity_litres),
    fuelType: (bus?.fuel_type ?? 'DIESEL') as TripContext['fuelType'],
    nominalEfficiencyKmpl: numberOrNull(bus?.nominal_efficiency_kmpl),
  };

  const evaluation = evaluateTrip({
    readings,
    context,
    baseline,
    thresholds,
    signals,
    duplicateCaptureOf: duplicateOf,
    completedWithOverride: Boolean(trip.completion_override),
  });

  await persist(
    caller,
    trip,
    evaluation.findings,
    evaluation.anomalyScore,
    evaluation.requiresReview,
  );

  return { evaluation };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadThresholds(caller: Caller) {
  const { data, error } = await caller.asService
    .from('app_settings')
    .select('*')
    .eq('organization_id', caller.organizationId)
    .maybeSingle();
  if (error) throw error;
  return thresholdsFromRow(data);
}

/**
 * Prefers the route-specific baseline and falls back to the bus's overall one.
 * A city route and a highway route have genuinely different fuel figures, so
 * comparing a trip against the wrong one manufactures anomalies.
 */
async function loadBaseline(
  caller: Caller,
  busId: string,
  routeId: string | null,
): Promise<Baseline | null> {
  const { data, error } = await caller.asService
    .from('bus_baselines')
    .select('*')
    .eq('bus_id', busId);
  if (error) throw error;

  const rows = data ?? [];
  const chosen =
    rows.find((row) => row.route_id === routeId) ?? rows.find((row) => row.route_id === null);
  if (!chosen) return EMPTY_BASELINE;

  return {
    sampleSize: chosen.sample_size ?? 0,
    medianEfficiencyKmpl: numberOrNull(chosen.median_efficiency_kmpl),
    madEfficiencyKmpl: numberOrNull(chosen.mad_efficiency_kmpl),
    medianRangeDropPerKm: numberOrNull(chosen.median_range_drop_per_km),
    madRangeDropPerKm: numberOrNull(chosen.mad_range_drop_per_km),
    medianDistanceKm: numberOrNull(chosen.median_distance_km),
  };
}

/** The per-field OCR evidence, so a low-confidence reading tempers a finding. */
async function loadSignals(caller: Caller, tripId: string): Promise<ReadingSignal[]> {
  const { data, error } = await caller.asService
    .from('dashboard_readings')
    .select('field, ocr_value, ocr_confidence, final_value, was_corrected')
    .eq('trip_id', tripId);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    field: row.field as ReadingSignal['field'],
    ocrConfidence: numberOrNull(row.ocr_confidence),
    ocrValue: numberOrNull(row.ocr_value),
    finalValue: numberOrNull(row.final_value),
    wasCorrected: Boolean(row.was_corrected),
  }));
}

/**
 * An identical image submitted twice for the same bus.
 *
 * Worth surfacing because the innocent explanation (a double-tap, a retry on a
 * flaky connection) and the one that needs a look are indistinguishable from
 * the image alone — which is exactly why this produces a review item and not a
 * verdict.
 */
async function findDuplicateCapture(
  caller: Caller,
  busId: string,
  tripId: string,
): Promise<string | null> {
  const { data: captures, error } = await caller.asService
    .from('dashboard_captures')
    .select('id, image_hash')
    .eq('trip_id', tripId)
    .not('image_hash', 'is', null);
  if (error) throw error;

  for (const capture of captures ?? []) {
    const { data: earlier, error: earlierError } = await caller.asService
      .from('dashboard_captures')
      .select('id')
      .eq('bus_id', busId)
      .eq('image_hash', capture.image_hash as string)
      .neq('trip_id', tripId)
      .order('captured_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (earlierError) throw earlierError;
    if (earlier) return earlier.id as string;
  }
  return null;
}

/**
 * Writes the findings.
 *
 * Open anomalies for this trip are replaced; reviewed ones are left alone. The
 * trip's own score and review status are updated with the service client
 * because a manager must not be able to clear their own trip's score by hand —
 * the RLS policy on `trips` does not permit them to write those columns.
 */
async function persist(
  caller: Caller,
  trip: Record<string, unknown>,
  findings: AnomalyFinding[],
  anomalyScore: number,
  requiresReview: boolean,
): Promise<void> {
  const tripId = trip.id as string;

  const { error: deleteError } = await caller.asService
    .from('anomalies')
    .delete()
    .eq('trip_id', tripId)
    .in('review_status', ['OPEN', 'IN_REVIEW']);
  if (deleteError) throw deleteError;

  if (findings.length > 0) {
    const { error: insertError } = await caller.asService.from('anomalies').insert(
      findings.map((finding) => ({
        organization_id: trip.organization_id,
        depot_id: trip.depot_id,
        trip_id: tripId,
        bus_id: trip.bus_id,
        driver_id: trip.driver_id,
        route_id: trip.route_id,
        capture_id: trip.end_capture_id ?? trip.start_capture_id ?? null,
        kind: finding.kind,
        severity: finding.severity,
        score: finding.score,
        observed_value: finding.observedValue,
        expected_value: finding.expectedValue,
        variance_pct: finding.variancePct,
        unit: finding.unit,
        rule_code: finding.ruleCode,
        rule_version: finding.ruleVersion,
        threshold_snapshot: finding.thresholdSnapshot,
        detail: finding.detail,
        review_status: 'OPEN',
      })),
    );
    if (insertError) throw insertError;
  }

  const { error: tripError } = await caller.asService
    .from('trips')
    .update({
      anomaly_score: anomalyScore,
      // A clean trip is closed by the engine; anything needing a human stays
      // OPEN. The engine never writes the other statuses — "false positive" and
      // "reading error" are conclusions only a person can reach.
      review_status: requiresReview ? 'OPEN' : 'REVIEWED_OK',
    })
    .eq('id', tripId);
  if (tripError) throw tripError;

  await writeAudit(caller, {
    action: 'TRIP_EVALUATED',
    entityType: 'trips',
    entityId: tripId,
    depotId: trip.depot_id as string,
    after: {
      anomaly_score: anomalyScore,
      finding_count: findings.length,
      rules: findings.map((finding) => finding.ruleCode),
    },
    context: { source: 'trip-finalise' },
  });

  if (requiresReview) await notifyReviewers(caller, trip, findings);
}

/**
 * One notification per trip, and only for a HIGH-severity finding.
 *
 * A medium finding is visible on the alerts screen the moment it is written;
 * pushing a notification for every one of those is how a manager learns to
 * ignore notifications, which costs more than it saves.
 */
async function notifyReviewers(
  caller: Caller,
  trip: Record<string, unknown>,
  findings: AnomalyFinding[],
): Promise<void> {
  const worst = findings[0];
  if (!worst || worst.severity !== 'HIGH') return;

  const bus = trip.bus as { registration_number?: string } | null;

  const { error } = await caller.asService.from('notifications').insert({
    organization_id: trip.organization_id,
    depot_id: trip.depot_id,
    recipient_role: 'MANAGER',
    kind: 'HIGH_SEVERITY_ANOMALY',
    severity: 'WARNING',
    title_key: 'notifications.highSeverityAnomaly.title',
    body_key: 'notifications.highSeverityAnomaly.body',
    // Interpolation values only — the recipient's app renders the sentence in
    // whichever of the four languages they use.
    payload: {
      registrationNumber: bus?.registration_number ?? '',
      count: findings.length,
      tripId: trip.id,
    },
    entity_type: 'trips',
    entity_id: trip.id,
  });
  // A missed notification must not fail an evaluation that was already written.
  if (error) console.error(JSON.stringify({ message: 'notification failed', error }));
}
