import { useQuery } from '@tanstack/react-query';
import type {
  AnomalyKind,
  AnomalyReviewStatus,
  AnomalySeverity,
  BusStatus,
  TripStatus,
} from '@domain/types.ts';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';

/**
 * Dashboard aggregates.
 *
 * Both dashboards are one RPC call each. Counting fifteen things client-side
 * would mean fifteen round trips on a connection that can barely afford one,
 * so the counting happens in PostgreSQL and the browser receives a single
 * JSON document. The shapes below mirror `rpc_manager_dashboard` and
 * `rpc_admin_dashboard` exactly.
 */

export interface ManagerDashboard {
  date: string;
  depot_ids: string[];
  today: {
    drivers_total: number;
    drivers_present: number;
    drivers_manual: number;
    trips_completed: number;
    trips_active: number;
    issues_open: number;
  };
  fleet: Partial<Record<BusStatus, number>>;
  trips: Array<{
    id: string;
    status: TripStatus;
    started_at: string | null;
    ended_at: string | null;
    bus: { id: string; registration_number: string };
    route: { id: string; name: string; origin: string; destination: string };
    driver: { id: string; full_name: string } | null;
    distance_variance_pct: number | null;
  }>;
  attention: Array<{
    id: string;
    kind: AnomalyKind;
    severity: AnomalySeverity;
    score: number;
    detected_at: string;
    review_status: AnomalyReviewStatus;
    observed_value: number | null;
    expected_value: number | null;
    variance_pct: number | null;
    unit: string | null;
    detail: Record<string, unknown>;
    bus: { id: string; registration_number: string } | null;
    trip_id: string | null;
  }>;
  recent_activity: Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_label: string | null;
    actor: string | null;
    occurred_at: string;
  }>;
  performance: {
    window_days: number;
    distance_km: number;
    trips: number;
    avg_efficiency_kmpl: number | null;
    trips_with_anomalies: number;
  };
}

export function useManagerDashboard(depotId: string | null) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.managerDashboard(depotId),
    enabled: Boolean(identity),
    staleTime: 60_000,
    queryFn: async (): Promise<ManagerDashboard> => {
      const { data, error } = await supabase.rpc('rpc_manager_dashboard', {
        p_depot_id: depotId,
      });
      if (error) throw error;
      return data as unknown as ManagerDashboard;
    },
  });
}

export interface SeriesPoint {
  date: string;
  value: number | null;
}

export interface AdminDashboard {
  window_days: number;
  totals: {
    managers: number;
    drivers: number;
    buses: number;
    depots: number;
    routes: number;
    trips_today: number;
    trips_completed_today: number;
    anomalies_open: number;
    anomalies_high: number;
  };
  attendance_rate_today: number | null;
  fleet_availability: Partial<Record<BusStatus, number>>;
  series: {
    attendance: SeriesPoint[];
    distance: SeriesPoint[];
    efficiency: SeriesPoint[];
    anomalies: SeriesPoint[];
  };
  repeat_offenders: Array<{
    bus_id: string;
    registration_number: string;
    depot_id: string;
    count: number;
  }>;
  depot_comparison: Array<{
    depot_id: string;
    name: string;
    buses: number;
    drivers: number;
    trips: number;
    distance_km: number;
    anomalies: number;
  }>;
}

export function useAdminDashboard(days = 30) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: queryKeys.adminDashboard(days),
    enabled: isAdmin,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<AdminDashboard> => {
      const { data, error } = await supabase.rpc('rpc_admin_dashboard', { p_days: days });
      if (error) throw error;
      return data as unknown as AdminDashboard;
    },
  });
}
