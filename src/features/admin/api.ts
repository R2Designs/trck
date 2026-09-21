import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppRole } from '@domain/types.ts';
import { supabase, invokeFunction } from '@/lib/supabase/client';
import type { AuditLogRow, DepotRow, Insert, ProfileRow } from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';

/**
 * Administration.
 *
 * Creating a manager, deactivating one and resetting their access all require
 * the Supabase service-role key, which must never exist in a browser bundle.
 * Every one of those operations therefore goes through the `admin-users` Edge
 * Function, which re-checks the caller's role server-side before acting. The
 * hooks below are thin clients for that function — there is no table write
 * here that could be reached by tampering with a request.
 */

export interface ManagerRecord extends ProfileRow {
  role: AppRole | null;
  depots: Array<Pick<DepotRow, 'id' | 'name'>>;
}

export function useManagers(filters: { depotId?: string | null; includeInactive?: boolean } = {}) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: queryKeys.managers(filters),
    enabled: isAdmin,
    queryFn: async (): Promise<ManagerRecord[]> => {
      const [profiles, roles, assignments, depots] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('user_roles').select('user_id, role').is('revoked_at', null),
        supabase.from('manager_depots').select('user_id, depot_id').is('unassigned_at', null),
        supabase.from('depots').select('id, name'),
      ]);

      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      if (assignments.error) throw assignments.error;
      if (depots.error) throw depots.error;

      const roleByUser = new Map((roles.data ?? []).map((row) => [row.user_id, row.role]));
      const depotById = new Map((depots.data ?? []).map((row) => [row.id, row]));
      const depotsByUser = new Map<string, Array<Pick<DepotRow, 'id' | 'name'>>>();
      for (const row of assignments.data ?? []) {
        const depot = depotById.get(row.depot_id);
        if (!depot) continue;
        const list = depotsByUser.get(row.user_id) ?? [];
        list.push(depot);
        depotsByUser.set(row.user_id, list);
      }

      return (profiles.data ?? [])
        .map((profile) => ({
          ...profile,
          role: roleByUser.get(profile.id) ?? null,
          depots: depotsByUser.get(profile.id) ?? [],
        }))
        .filter((record) => record.role === 'MANAGER')
        .filter((record) => (filters.includeInactive ? true : record.status !== 'INACTIVE'))
        .filter((record) =>
          filters.depotId ? record.depots.some((depot) => depot.id === filters.depotId) : true,
        );
    },
  });
}

export function useInviteManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['admin.inviteManager'],
    mutationFn: async (input: { fullName: string; email: string; depotIds: string[] }) =>
      invokeFunction<{ userId: string }>('admin-users', {
        action: 'invite-manager',
        fullName: input.fullName,
        email: input.email,
        depotIds: input.depotIds,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['managers'] }),
  });
}

export function useSetManagerActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['admin.setManagerActive'],
    mutationFn: async (input: { userId: string; active: boolean }) =>
      invokeFunction('admin-users', {
        action: input.active ? 'reactivate-user' : 'deactivate-user',
        userId: input.userId,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['managers'] }),
  });
}

export function useResetManagerAccess() {
  return useMutation({
    mutationKey: ['admin.resetAccess'],
    mutationFn: async (input: { userId: string }) =>
      invokeFunction('admin-users', { action: 'reset-password', userId: input.userId }),
  });
}

export function useAssignManagerDepots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['admin.assignDepots'],
    mutationFn: async (input: { userId: string; depotIds: string[] }) =>
      invokeFunction('admin-users', {
        action: 'assign-depots',
        userId: input.userId,
        depotIds: input.depotIds,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['managers'] }),
  });
}

// ---------------------------------------------------------------------------
// Depots
// ---------------------------------------------------------------------------

export function useSaveDepot() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['depot.save'],
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string;
      values: Omit<Insert<'depots'>, 'organization_id'>;
    }) => {
      if (!identity) throw new Error('Not authenticated');
      const payload = { ...values, organization_id: identity.organizationId };

      const { data, error } = id
        ? await supabase.from('depots').update(payload).eq('id', id).select().single()
        : await supabase
            .from('depots')
            .insert({ ...payload, created_by: identity.user.id } as Insert<'depots'>)
            .select()
            .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['depots'] }),
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditFilters {
  entityType?: string | null;
  actorId?: string | null;
  from?: string;
  to?: string;
  limit?: number;
}

export function useAuditLogs(filters: AuditFilters = {}) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: queryKeys.auditLogs(filters),
    enabled: isAdmin,
    queryFn: async (): Promise<AuditLogRow[]> => {
      let query = supabase.from('audit_logs').select('*');
      if (filters.entityType) query = query.eq('entity_type', filters.entityType);
      if (filters.actorId) query = query.eq('actor_id', filters.actorId);
      if (filters.from) query = query.gte('occurred_at', filters.from);
      if (filters.to) query = query.lte('occurred_at', filters.to);

      const { data, error } = await query
        .order('occurred_at', { ascending: false })
        .limit(filters.limit ?? 100);
      if (error) throw error;
      return data ?? [];
    },
  });
}
