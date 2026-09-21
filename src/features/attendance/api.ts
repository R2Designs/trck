import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceMethod,
  AttendanceType,
  LivenessResult,
  OverrideReasonCode,
} from '@domain/types.ts';
import type { EnrolledDescriptor } from '@domain/face-match.ts';
import { supabase } from '@/lib/supabase/client';
import type {
  AttendanceRecordRow,
  BusRow,
  EmployeeRow,
  RouteRow,
} from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';
import { config } from '@/app/config';

/**
 * Attendance.
 *
 * Writes go exclusively through `rpc_record_attendance`, which re-checks
 * everything the client believes: that the driver is active and in the right
 * depot, that a face match actually cleared the configured threshold, that
 * liveness passed when it is required, that a manual entry carries a reason,
 * and that today's attendance was not already recorded. The client's job is to
 * collect the evidence and present the outcome — not to decide it.
 */

export interface AttendanceWithRelations extends AttendanceRecordRow {
  employee?: Pick<EmployeeRow, 'id' | 'full_name' | 'employee_code' | 'employee_type'> | null;
  bus?: Pick<BusRow, 'id' | 'registration_number'> | null;
  route?: Pick<RouteRow, 'id' | 'name'> | null;
}

const ATTENDANCE_SELECT = `
  *,
  employee:employees(id, full_name, employee_code, employee_type),
  bus:buses(id, registration_number),
  route:routes(id, name)
`;

export interface AttendanceFilters {
  depotId?: string | null;
  employeeId?: string | null;
  date?: string;
  from?: string;
  to?: string;
  manualOnly?: boolean;
  limit?: number;
}

export function useAttendance(filters: AttendanceFilters = {}) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.attendance(filters),
    enabled: Boolean(identity),
    queryFn: async (): Promise<AttendanceWithRelations[]> => {
      let query = supabase.from('attendance_records').select(ATTENDANCE_SELECT);
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
      if (filters.date) query = query.eq('attendance_date', filters.date);
      if (filters.from) query = query.gte('attendance_date', filters.from);
      if (filters.to) query = query.lte('attendance_date', filters.to);
      if (filters.manualOnly) query = query.eq('manual_override', true);

      const { data, error } = await query
        .order('recorded_at', { ascending: false })
        .limit(filters.limit ?? 100);
      if (error) throw error;
      return (data ?? []) as unknown as AttendanceWithRelations[];
    },
  });
}

/**
 * Enrolled descriptors for the drivers who could plausibly be standing here.
 *
 * Scoped by `rpc_face_candidates` to the selected depot, with drivers
 * scheduled on this route or bus ranked first. Never the whole organisation:
 * a smaller candidate set is both faster and materially more accurate, since
 * every extra face is another chance at a near-collision.
 */
export function useFaceCandidates(params: {
  depotId: string | null;
  routeId?: string | null;
  busId?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['face-candidates', params.depotId, params.routeId, params.busId],
    enabled: Boolean(params.depotId) && params.enabled !== false,
    // Biometric material: kept in memory only as long as the scan screen needs
    // it, and never written to any cache that outlives the tab.
    gcTime: 2 * 60_000,
    staleTime: 60_000,
    queryFn: async (): Promise<EnrolledDescriptor[]> => {
      const { data, error } = await supabase.rpc('rpc_face_candidates', {
        p_depot_id: params.depotId as string,
        p_route_id: params.routeId ?? null,
        p_bus_id: params.busId ?? null,
      });
      if (error) throw error;

      return (data ?? []).map((row) => ({
        employeeId: row.employee_id,
        embeddingId: row.embedding_id,
        employeeCode: row.employee_code,
        fullName: row.full_name,
        isAssigned: row.is_assigned,
        modelVersion: row.model_version,
        provider: row.provider,
        embedding: row.embedding,
        qualityScore: row.quality_score,
      }));
    },
  });
}

export interface RecordAttendanceInput {
  employeeId: string;
  depotId: string;
  routeId: string | null;
  busId: string | null;
  method: AttendanceMethod;
  attendanceType?: AttendanceType;
  tripId?: string | null;
  faceScore?: number | null;
  faceThreshold?: number | null;
  provider?: string | null;
  modelVersion?: string | null;
  liveness?: LivenessResult;
  livenessScore?: number | null;
  overrideReasonCode?: OverrideReasonCode | null;
  overrideReason?: string | null;
}

export function useRecordAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['attendance.record'],
    mutationFn: async (input: RecordAttendanceInput): Promise<AttendanceRecordRow> => {
      const { data, error } = await supabase.rpc('rpc_record_attendance', {
        p_employee_id: input.employeeId,
        p_depot_id: input.depotId,
        p_route_id: input.routeId,
        p_bus_id: input.busId,
        p_method: input.method,
        p_attendance_type: input.attendanceType ?? 'CHECK_IN',
        p_trip_id: input.tripId ?? null,
        p_face_score: input.faceScore ?? null,
        p_face_threshold: input.faceThreshold ?? null,
        p_provider: input.provider ?? null,
        p_model_version: input.modelVersion ?? null,
        p_liveness: input.liveness ?? 'SKIPPED',
        p_liveness_score: input.livenessScore ?? null,
        p_override_reason_code: input.overrideReasonCode ?? null,
        p_override_reason: input.overrideReason ?? null,
        // Non-identifying context, useful when a record is later disputed.
        p_device_metadata: {
          app_version: config.appVersion,
          platform: navigator.platform,
          screen: `${window.screen.width}x${window.screen.height}`,
          online: navigator.onLine,
        },
      });
      if (error) throw error;
      return data as unknown as AttendanceRecordRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Who has already checked in today, so the scan screen can say so early. */
export function useTodayAttendance(depotId: string | null) {
  const { identity } = useAuth();
  return useQuery({
    queryKey: ['attendance', 'today', depotId],
    enabled: Boolean(identity) && Boolean(depotId),
    staleTime: 30_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('attendance_records')
        .select('employee_id, recorded_at, manual_override, method')
        .eq('depot_id', depotId as string)
        .eq('attendance_date', today)
        .eq('attendance_type', 'CHECK_IN');
      if (error) throw error;
      return data ?? [];
    },
  });
}
