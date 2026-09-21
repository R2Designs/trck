import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { thresholdsFromRow, DEFAULT_THRESHOLDS } from '@domain/thresholds.ts';
import type { AppSettingsRow as SettingsRowShape, Thresholds } from '@domain/thresholds.ts';
import { supabase } from '@/lib/supabase/client';
import type { AppSettingsRow } from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';

/**
 * Operational thresholds.
 *
 * Read on nearly every screen — the OCR review needs the confidence bands, the
 * alert list needs the tolerances — so this shares one aggressively cached
 * query key. A missing or unreadable row degrades to the documented defaults
 * rather than breaking the screen.
 */
export function useThresholds(): { thresholds: Thresholds; isLoading: boolean } {
  const { identity } = useAuth();

  const query = useQuery({
    queryKey: queryKeys.settings(identity?.organizationId ?? 'none'),
    enabled: Boolean(identity),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AppSettingsRow | null> => {
      const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return {
    thresholds: query.data
      ? thresholdsFromRow(query.data as unknown as SettingsRowShape)
      : DEFAULT_THRESHOLDS,
    isLoading: query.isLoading,
  };
}

export function useSettingsRow() {
  const { identity } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.settings(identity?.organizationId ?? 'none'), 'row'],
    enabled: Boolean(identity),
    queryFn: async (): Promise<AppSettingsRow | null> => {
      const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['settings.update'],
    mutationFn: async (values: Partial<AppSettingsRow>) => {
      if (!identity) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('app_settings')
        .update({ ...values, updated_by: identity.user.id })
        .eq('organization_id', identity.organizationId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Thresholds change how every anomaly is explained, so the whole cache is
      // invalidated rather than just the settings key.
      void queryClient.invalidateQueries();
    },
  });
}

export function useUserPreferences() {
  const { identity } = useAuth();
  return useQuery({
    queryKey: ['user-preferences', identity?.user.id],
    enabled: Boolean(identity),
    queryFn: async () => {
      if (!identity) return null;
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', identity.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['user-preferences.update'],
    mutationFn: async (values: {
      theme?: 'light' | 'dark' | 'system';
      dense_tables?: boolean;
      reduce_motion?: boolean;
      default_depot_id?: string | null;
    }) => {
      if (!identity) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('user_preferences')
        .upsert({ user_id: identity.user.id, ...values }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['user-preferences'] }),
  });
}
