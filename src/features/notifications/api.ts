import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import type { NotificationRow } from '@/lib/supabase/database.types';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';

/**
 * In-app notifications.
 *
 * V1 is deliberately in-app only: SMS and WhatsApp both cost money per message
 * and the brief was to stay at zero. The `NotificationProvider` abstraction in
 * `src/providers/notifications` exists so that adding a channel later is a new
 * adapter rather than a rewrite of these hooks.
 */

export function useNotifications() {
  const { identity } = useAuth();

  return useQuery({
    queryKey: queryKeys.notifications(),
    enabled: Boolean(identity),
    staleTime: 30_000,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Badge count for the header. Never throws — a failure shows zero. */
export function useUnreadNotificationCount(): number {
  const { data } = useNotifications();
  return (data ?? []).filter((notification) => !notification.read_at).length;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['notifications.markRead'],
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['notifications.markAllRead'],
    mutationFn: async () => {
      if (!identity) return;
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', identity.user.id)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}

/**
 * Maps a stored notification onto its translation keys.
 *
 * Notifications store *keys*, never sentences, so a notification written while
 * the manager's language was English still reads correctly in Tamil later.
 */
export function notificationCopyKeys(notification: NotificationRow): {
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown>;
} {
  return {
    titleKey: notification.title_key,
    bodyKey: notification.body_key,
    params: (notification.payload ?? {}) as Record<string, unknown>,
  };
}
