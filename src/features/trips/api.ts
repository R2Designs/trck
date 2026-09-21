import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnomalyEvaluation } from '@domain/anomaly-engine.ts';
import { supabase, invokeFunction } from '@/lib/supabase/client';
import type { BusRow, EmployeeRow, RouteRow, TripRow } from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';
import { trackEvent } from '@/providers/analytics';

/**
 * Trips.
 *
 * Both state transitions go through RPCs rather than table writes, because
 * both carry rules a client cannot be trusted with: a bus may not start a
 * second concurrent trip, an end odometer may not be below its start, and a
 * trip may not be completed without a reading unless a manager explicitly
 * overrides and says why. Those rules live in `rpc_start_trip` and
 * `rpc_complete_trip`.
 *
 * Anomaly evaluation happens *after* completion, in the `trip-finalise` Edge
 * Function, which runs the same shared engine this app uses to explain the
 * result. The client never decides whether a trip is anomalous.
 */

export interface TripWithRelations extends TripRow {
  bus?: Pick<
    BusRow,
    | 'id'
    | 'registration_number'
    | 'fleet_number'
    | 'dashboard_type'
    | 'tank_capacity_litres'
    | 'fuel_type'
  > | null;
  route?: Pick<
    RouteRow,
    | 'id'
    | 'name'
    | 'code'
    | 'origin'
    | 'destination'
    | 'expected_distance_km'
    | 'distance_tolerance_pct'
  > | null;
  driver?: Pick<EmployeeRow, 'id' | 'full_name' | 'employee_code'> | null;
}

const TRIP_SELECT = `
  *,
  bus:buses(id, registration_number, fleet_number, dashboard_type, tank_capacity_litres, fuel_type),
  route:routes(id, name, code, origin, destination, expected_distance_km, distance_tolerance_pct),
  driver:employees(id, full_name, employee_code)
`;

export interface TripFilters {
  depotId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  routeId?: string | null;
  status?: TripRow['status'] | 'ALL';
  from?: string;
  to?: string;
  limit?: number;
}

export function useTrips(filters: TripFilters = {}) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.trips(filters),
    enabled: Boolean(identity),
    queryFn: async (): Promise<TripWithRelations[]> => {
      let query = supabase.from('trips').select(TRIP_SELECT);
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.busId) query = query.eq('bus_id', filters.busId);
      if (filters.driverId) query = query.eq('driver_id', filters.driverId);
      if (filters.routeId) query = query.eq('route_id', filters.routeId);
      if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status);
      if (filters.from) query = query.gte('actual_start_time', filters.from);
      if (filters.to) query = query.lte('actual_start_time', filters.to);

      const { data, error } = await query
        .order('actual_start_time', { ascending: false, nullsFirst: false })
        .limit(filters.limit ?? 50);
      if (error) throw error;
      return (data ?? []) as unknown as TripWithRelations[];
    },
  });
}

export function useTrip(tripId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.trip(tripId ?? ''),
    enabled: Boolean(tripId),
    queryFn: async (): Promise<TripWithRelations | null> => {
      const { data, error } = await supabase
        .from('trips')
        .select(TRIP_SELECT)
        .eq('id', tripId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as TripWithRelations | null;
    },
  });
}

/** Trips currently on the road — what "End a trip" chooses from. */
export function useActiveTrips(depotId: string | null) {
  const { identity } = useAuth();
  return useQuery({
    queryKey: queryKeys.activeTrips(depotId),
    enabled: Boolean(identity),
    staleTime: 15_000,
    queryFn: async (): Promise<TripWithRelations[]> => {
      let query = supabase.from('trips').select(TRIP_SELECT).eq('status', 'STARTED');
      if (depotId) query = query.eq('depot_id', depotId);
      const { data, error } = await query.order('actual_start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TripWithRelations[];
    },
  });
}

export interface StartTripInput {
  busId: string;
  routeId: string;
  driverId: string | null;
  startOdometerKm: number;
  startRangeKm?: number | null;
  startFuelPercent?: number | null;
  captureId?: string | null;
}

export function useStartTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['trip.start'],
    mutationFn: async (input: StartTripInput): Promise<TripRow> => {
      const { data, error } = await supabase.rpc('rpc_start_trip', {
        p_bus_id: input.busId,
        p_route_id: input.routeId,
        p_driver_id: input.driverId,
        p_start_odometer: input.startOdometerKm,
        p_start_range: input.startRangeKm ?? null,
        p_start_fuel_percent: input.startFuelPercent ?? null,
        p_capture_id: input.captureId ?? null,
      });
      if (error) throw error;
      trackEvent('trip_started', { has_start_reading: input.captureId != null });
      return data as unknown as TripRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['buses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface CompleteTripInput {
  tripId: string;
  endOdometerKm: number | null;
  endRangeKm?: number | null;
  endFuelPercent?: number | null;
  refuelLitres?: number | null;
  captureId?: string | null;
  override?: boolean;
  overrideReason?: string | null;
}

export interface CompleteTripResult {
  trip: TripRow;
  /** Server-side evaluation. Absent if the finalise call could not be reached. */
  evaluation: AnomalyEvaluation | null;
}

export function useCompleteTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['trip.complete'],
    mutationFn: async (input: CompleteTripInput): Promise<CompleteTripResult> => {
      const { data, error } = await supabase.rpc('rpc_complete_trip', {
        p_trip_id: input.tripId,
        p_end_odometer: input.endOdometerKm,
        p_end_range: input.endRangeKm ?? null,
        p_end_fuel_percent: input.endFuelPercent ?? null,
        p_refuel_litres: input.refuelLitres ?? null,
        p_capture_id: input.captureId ?? null,
        p_override: input.override ?? false,
        p_override_reason: input.overrideReason ?? null,
      });
      if (error) throw error;
      const trip = data as unknown as TripRow;

      // The trip is already saved. Anomaly evaluation is a second, separate
      // step so that a transient failure in the analysis never costs the
      // manager the reading they just walked out to the bus to take.
      let evaluation: AnomalyEvaluation | null = null;
      try {
        const response = await invokeFunction<{ evaluation: AnomalyEvaluation }>('trip-finalise', {
          tripId: trip.id,
        });
        evaluation = response.evaluation;
      } catch {
        evaluation = null;
      }

      trackEvent('trip_completed', {
        with_override: Boolean(input.override),
        anomaly_count: evaluation?.findings.length ?? 0,
      });

      return { trip, evaluation };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['buses'] });
      void queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCancelTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['trip.cancel'],
    mutationFn: async ({ tripId, reason }: { tripId: string; reason: string }) => {
      const { error } = await supabase
        .from('trips')
        .update({
          status: 'CANCELLED',
          cancelled_at: new Date().toISOString(),
          cancel_reason: reason,
        })
        .eq('id', tripId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['buses'] });
    },
  });
}

/** Dashboard captures and their per-field readings, for a trip. */
export function useTripCaptures(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trips', 'captures', tripId],
    enabled: Boolean(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dashboard_captures')
        .select(
          'id, kind, storage_bucket, storage_path, captured_at, ocr_provider, ocr_engine_version, ocr_status, image_hash',
        )
        .eq('trip_id', tripId as string)
        .order('captured_at');
      if (error) throw error;

      const captureIds = (data ?? []).map((capture) => capture.id);
      if (captureIds.length === 0) return { captures: data ?? [], readings: [] };

      const readings = await supabase
        .from('dashboard_readings')
        .select('*')
        .in('capture_id', captureIds);
      if (readings.error) throw readings.error;

      return { captures: data ?? [], readings: readings.data ?? [] };
    },
  });
}
