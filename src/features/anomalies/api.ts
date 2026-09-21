import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnomalyKind, AnomalyReviewStatus, AnomalySeverity } from '@domain/types.ts';
import { supabase } from '@/lib/supabase/client';
import type {
  AnomalyRow,
  AnomalyReviewRow,
  BusRow,
  EmployeeRow,
  RouteRow,
} from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';
import { trackEvent } from '@/providers/analytics';

/**
 * Anomalies and their review trail.
 *
 * Vocabulary note, because it governs this whole module: these are
 * *observations that need a human to look at them*. Nothing here concludes
 * anything, and the resolution statuses are deliberately neutral — "reviewed,
 * no issue", "needs investigation", "false positive", "a reading was wrong".
 */

export interface AnomalyWithRelations extends AnomalyRow {
  bus?: Pick<BusRow, 'id' | 'registration_number'> | null;
  driver?: Pick<EmployeeRow, 'id' | 'full_name' | 'employee_code'> | null;
  route?: Pick<RouteRow, 'id' | 'name' | 'expected_distance_km'> | null;
}

const ANOMALY_SELECT = `
  *,
  bus:buses(id, registration_number),
  driver:employees(id, full_name, employee_code),
  route:routes(id, name, expected_distance_km)
`;

export interface AnomalyFilters {
  depotId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  severity?: AnomalySeverity | 'ALL';
  kind?: AnomalyKind | 'ALL';
  reviewStatus?: AnomalyReviewStatus | 'OPEN_ONLY' | 'ALL';
  from?: string;
  to?: string;
  limit?: number;
}

const OPEN_STATUSES: AnomalyReviewStatus[] = ['OPEN', 'IN_REVIEW', 'NEEDS_INVESTIGATION'];

/** Lightweight count for navigation badges; avoids loading alert detail rows. */
export function useOpenAnomalyCount() {
  const { identity } = useAuth();

  return useQuery({
    queryKey: ['anomalies', 'open-count'],
    enabled: Boolean(identity),
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('anomalies')
        .select('id', { count: 'exact', head: true })
        .in('review_status', OPEN_STATUSES);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useAnomalies(filters: AnomalyFilters = {}) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.anomalies(filters),
    enabled: Boolean(identity),
    queryFn: async (): Promise<AnomalyWithRelations[]> => {
      let query = supabase.from('anomalies').select(ANOMALY_SELECT);
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.busId) query = query.eq('bus_id', filters.busId);
      if (filters.driverId) query = query.eq('driver_id', filters.driverId);
      if (filters.severity && filters.severity !== 'ALL')
        query = query.eq('severity', filters.severity);
      if (filters.kind && filters.kind !== 'ALL') query = query.eq('kind', filters.kind);
      if (filters.reviewStatus === 'OPEN_ONLY') query = query.in('review_status', OPEN_STATUSES);
      else if (filters.reviewStatus && filters.reviewStatus !== 'ALL') {
        query = query.eq('review_status', filters.reviewStatus);
      }
      if (filters.from) query = query.gte('detected_at', filters.from);
      if (filters.to) query = query.lte('detected_at', filters.to);

      const { data, error } = await query
        .order('detected_at', { ascending: false })
        .limit(filters.limit ?? 50);
      if (error) throw error;

      // Most serious first — a manager with five minutes should spend them on
      // the HIGH ones, not on whatever happened to be most recent.
      const rank: Record<AnomalySeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return ((data ?? []) as unknown as AnomalyWithRelations[]).sort(
        (a, b) =>
          rank[a.severity] - rank[b.severity] ||
          new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
      );
    },
  });
}

export function useAnomaly(anomalyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.anomaly(anomalyId ?? ''),
    enabled: Boolean(anomalyId),
    queryFn: async (): Promise<AnomalyWithRelations | null> => {
      const { data, error } = await supabase
        .from('anomalies')
        .select(ANOMALY_SELECT)
        .eq('id', anomalyId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as AnomalyWithRelations | null;
    },
  });
}

export function useAnomalyReviews(anomalyId: string | undefined) {
  return useQuery({
    queryKey: ['anomalies', 'reviews', anomalyId],
    enabled: Boolean(anomalyId),
    queryFn: async (): Promise<AnomalyReviewRow[]> => {
      const { data, error } = await supabase
        .from('anomaly_reviews')
        .select('*')
        .eq('anomaly_id', anomalyId as string)
        .order('reviewed_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Records a review outcome.
 *
 * Two writes, in this order: the append-only review row first, then the
 * anomaly's current status. If the second fails the trail still shows what the
 * reviewer concluded — the reverse would lose it.
 */
export function useReviewAnomaly() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['anomaly.review'],
    mutationFn: async ({
      anomaly,
      newStatus,
      notes,
    }: {
      anomaly: AnomalyRow;
      newStatus: Exclude<AnomalyReviewStatus, 'OPEN' | 'IN_REVIEW'>;
      notes: string;
    }) => {
      if (!identity) throw new Error('Not authenticated');

      const review = await supabase.from('anomaly_reviews').insert({
        organization_id: anomaly.organization_id,
        anomaly_id: anomaly.id,
        previous_status: anomaly.review_status,
        new_status: newStatus,
        notes,
        reviewed_by: identity.user.id,
      });
      if (review.error) throw review.error;

      const update = await supabase
        .from('anomalies')
        .update({
          review_status: newStatus,
          resolved_at: new Date().toISOString(),
          resolved_by: identity.user.id,
        })
        .eq('id', anomaly.id);
      if (update.error) throw update.error;

      trackEvent('anomaly_reviewed', { outcome: newStatus });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anomalies'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
