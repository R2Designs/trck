import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import type {
  BusBaselineRow,
  BusRow,
  DepotRow,
  EmployeeRow,
  Insert,
  RouteRow,
  Update,
} from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';
import { enqueue } from '@/lib/offline-queue';
import { isOffline } from '@/lib/network';
import { trackEvent } from '@/providers/analytics';

/**
 * Fleet reference data: depots, buses, routes, employees.
 *
 * Every query here is already depot-scoped by RLS, so the filters below exist
 * for *usefulness*, not security — passing no filter returns exactly what the
 * signed-in person may see, and nothing more.
 *
 * Creates and updates are offline-queueable. Attendance and trips are not:
 * `src/lib/offline-queue.ts` explains where that line is drawn and why.
 */

export function useDepots() {
  const { identity } = useAuth();
  return useQuery({
    queryKey: queryKeys.depots(),
    enabled: Boolean(identity),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DepotRow[]> => {
      const { data, error } = await supabase
        .from('depots')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

export interface BusFilters {
  depotId?: string | null;
  status?: BusRow['status'] | 'ALL';
  search?: string;
}

export function useBuses(filters: BusFilters = {}) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.buses(filters),
    enabled: Boolean(identity),
    queryFn: async (): Promise<BusRow[]> => {
      let query = supabase.from('buses').select('*').eq('is_active', true);
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status);
      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`registration_number.ilike.${term},fleet_number.ilike.${term}`);
      }
      const { data, error } = await query.order('registration_number').limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBus(busId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bus(busId ?? ''),
    enabled: Boolean(busId),
    queryFn: async (): Promise<BusRow | null> => {
      const { data, error } = await supabase
        .from('buses')
        .select('*')
        .eq('id', busId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useBusBaseline(busId: string | undefined, routeId?: string | null) {
  return useQuery({
    queryKey: queryKeys.busBaseline(busId ?? '', routeId),
    enabled: Boolean(busId),
    queryFn: async (): Promise<BusBaselineRow | null> => {
      let query = supabase
        .from('bus_baselines')
        .select('*')
        .eq('bus_id', busId as string);
      query = routeId ? query.eq('route_id', routeId) : query.is('route_id', null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveBus() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['bus.save'],
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string;
      values: Omit<Insert<'buses'>, 'organization_id'>;
    }) => {
      if (!identity) throw new Error('Not authenticated');
      const payload = { ...values, organization_id: identity.organizationId };

      // A bus that cannot be created right now is still a bus the manager
      // described correctly. Queue it rather than losing their typing.
      if (!id && isOffline()) {
        await enqueue('bus.create', payload);
        return null;
      }

      const { data, error } = id
        ? await supabase
            .from('buses')
            .update(payload as Update<'buses'>)
            .eq('id', id)
            .select()
            .single()
        : await supabase
            .from('buses')
            .insert({ ...payload, created_by: identity.user.id } as Insert<'buses'>)
            .select()
            .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['buses'] }),
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function useRoutes(filters: { depotId?: string | null; activeOnly?: boolean } = {}) {
  const { identity } = useAuth();
  return useQuery({
    queryKey: queryKeys.routes(filters),
    enabled: Boolean(identity),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RouteRow[]> => {
      let query = supabase.from('routes').select('*');
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.activeOnly !== false) query = query.eq('status', 'ACTIVE');
      const { data, error } = await query.order('name').limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRoute(routeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.route(routeId ?? ''),
    enabled: Boolean(routeId),
    queryFn: async (): Promise<RouteRow | null> => {
      const { data, error } = await supabase
        .from('routes')
        .select('*')
        .eq('id', routeId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveRoute() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['route.save'],
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string;
      values: Omit<Insert<'routes'>, 'organization_id'>;
    }) => {
      if (!identity) throw new Error('Not authenticated');
      const payload = { ...values, organization_id: identity.organizationId };

      if (!id && isOffline()) {
        await enqueue('route.create', payload);
        return null;
      }

      const { data, error } = id
        ? await supabase
            .from('routes')
            .update(payload as Update<'routes'>)
            .eq('id', id)
            .select()
            .single()
        : await supabase
            .from('routes')
            .insert({ ...payload, created_by: identity.user.id } as Insert<'routes'>)
            .select()
            .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['routes'] }),
  });
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeFilters {
  depotId?: string | null;
  type?: EmployeeRow['employee_type'] | 'ALL';
  status?: EmployeeRow['employment_status'] | 'ALL';
  search?: string;
}

export function useEmployees(filters: EmployeeFilters = {}) {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.employees(filters),
    enabled: Boolean(identity),
    queryFn: async (): Promise<EmployeeRow[]> => {
      let query = supabase.from('employees').select('*').is('deactivated_at', null);
      if (filters.depotId) query = query.eq('depot_id', filters.depotId);
      if (filters.type && filters.type !== 'ALL') query = query.eq('employee_type', filters.type);
      if (filters.status && filters.status !== 'ALL') {
        query = query.eq('employment_status', filters.status);
      }
      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`full_name.ilike.${term},employee_code.ilike.${term}`);
      }
      const { data, error } = await query.order('full_name').limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEmployee(employeeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.employee(employeeId ?? ''),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<EmployeeRow | null> => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Face enrolment status for one employee.
 *
 * Counts and photo *paths* only. Descriptors are never fetched for display;
 * the sole code path that reads an embedding is the attendance matcher, via
 * `rpc_face_candidates`.
 */
export function useFaceEnrolmentStatus(employeeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.employeeFaceStatus(employeeId ?? ''),
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const id = employeeId as string;
      const [embeddings, photos, consent] = await Promise.all([
        supabase
          .from('face_embeddings')
          .select('id', { count: 'exact', head: true })
          .eq('employee_id', id)
          .eq('is_active', true)
          .is('deleted_at', null),
        supabase
          .from('employee_photos')
          .select('id, storage_bucket, storage_path, quality_score, pose_hint, created_at')
          .eq('employee_id', id)
          .is('purged_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('biometric_consents')
          .select('*')
          .eq('employee_id', id)
          .is('revoked_at', null)
          .maybeSingle(),
      ]);

      if (embeddings.error) throw embeddings.error;
      if (photos.error) throw photos.error;
      if (consent.error) throw consent.error;

      return {
        embeddingCount: embeddings.count ?? 0,
        photos: photos.data ?? [],
        consent: consent.data,
      };
    },
  });
}

export function useSaveEmployee() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['employee.save'],
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string;
      values: Omit<Insert<'employees'>, 'organization_id'>;
    }) => {
      if (!identity) throw new Error('Not authenticated');
      const payload = { ...values, organization_id: identity.organizationId };

      if (!id && isOffline()) {
        await enqueue('employee.create', payload);
        return null;
      }

      const { data, error } = id
        ? await supabase
            .from('employees')
            .update(payload as Update<'employees'>)
            .eq('id', id)
            .select()
            .single()
        : await supabase
            .from('employees')
            .insert({ ...payload, created_by: identity.user.id } as Insert<'employees'>)
            .select()
            .single();

      if (error) throw error;
      if (data && !id) trackEvent('employee_created', { employee_type: data.employee_type });
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });
}

/** Deactivation, never deletion — historical attendance must stay resolvable. */
export function useSetEmployeeActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['employee.setActive'],
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('employees')
        .update({
          employment_status: active ? 'ACTIVE' : 'INACTIVE',
          deactivated_at: active ? null : new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });
}

/** Drivers scheduled on a route or bus today — the face-match candidate hint. */
export function useAssignedDrivers(params: {
  depotId?: string | null;
  routeId?: string | null;
  busId?: string | null;
}) {
  return useQuery({
    queryKey: ['driver-assignments', params],
    enabled: Boolean(params.depotId) && Boolean(params.routeId || params.busId),
    queryFn: async () => {
      let query = supabase
        .from('driver_assignments')
        .select('employee_id, bus_id, route_id')
        .eq('depot_id', params.depotId as string)
        .lte('effective_from', new Date().toISOString().slice(0, 10));
      if (params.routeId) query = query.eq('route_id', params.routeId);
      if (params.busId) query = query.eq('bus_id', params.busId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}
