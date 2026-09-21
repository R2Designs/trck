/**
 * The Supabase browser client.
 *
 * Only the *anon* key ever reaches this file, and that is safe precisely
 * because every table is protected by Row Level Security: the key identifies
 * the project, the JWT identifies the user, and PostgreSQL decides what they
 * may see. The service-role key lives exclusively in Edge Function secrets.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/app/config';
import type { Database } from './database.types';

export const supabase: SupabaseClient<Database> = createClient<Database>(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'trck.auth',
      flowType: 'pkce',
    },
    global: {
      headers: {
        'x-application-name': 'trck',
        'x-client-version': config.appVersion,
      },
    },
    db: { schema: 'public' },
    // Realtime is not used in V1; disabling it avoids an idle WebSocket that
    // would keep a phone's radio awake for no benefit.
    realtime: { params: { eventsPerSecond: 1 } },
  },
);

/**
 * Invokes an Edge Function with the caller's session attached.
 * Privileged operations (creating managers, deactivating accounts) go through
 * here rather than through direct table writes.
 */
export async function invokeFunction<TResponse, TBody = unknown>(
  name: string,
  body?: TBody,
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse>(name, {
    body: body ?? {},
  });
  if (error) throw error;
  return data as TResponse;
}

export type { Database };
