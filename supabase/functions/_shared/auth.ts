import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { PublicError } from './http.ts';
import type { AppRole } from './domain/types.ts';

/**
 * Caller identity and the two clients every privileged function needs.
 *
 * The distinction is the whole security model of this directory:
 *
 *  • `asCaller` carries the browser's JWT. Every read through it is filtered by
 *    the same RLS policies the browser is subject to, so it physically cannot
 *    see another tenant's rows — even if this code asked it to.
 *  • `asService` holds the service-role key and bypasses RLS. It exists only
 *    for the operations RLS cannot express (creating an auth user, writing an
 *    anomaly attributed to the system). Every use of it in this codebase is
 *    preceded by an explicit tenant check derived from `asCaller`.
 *
 * The service-role key lives in a Supabase secret. It is never returned, never
 * logged, and never reaches the browser bundle.
 */

export interface Caller {
  userId: string;
  email: string | null;
  organizationId: string;
  role: AppRole;
  depotIds: string[];
  asCaller: SupabaseClient;
  asService: SupabaseClient;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticate(request: Request): Promise<Caller> {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) throw new PublicError('UNAUTHENTICATED', 401);

  const asCaller = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) throw new PublicError('UNAUTHENTICATED', 401);

  const asService = serviceClient();

  // Read the profile with the service client but *filtered by the verified
  // user id* — the caller's own client cannot be trusted to tell us its role,
  // and a profile row is not always visible to the profile's owner mid-invite.
  const { data: profile, error: profileError } = await asService
    .from('profiles')
    .select('id, organization_id, status')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) throw new PublicError('NO_PROFILE', 403);
  if (profile.status !== 'ACTIVE') throw new PublicError('ACCOUNT_INACTIVE', 403);

  const { data: roleRow, error: roleError } = await asService
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('organization_id', profile.organization_id)
    .is('revoked_at', null)
    .maybeSingle();

  if (roleError) throw roleError;
  if (!roleRow) throw new PublicError('NO_ROLE', 403);

  const { data: depotRows, error: depotError } = await asService
    .from('manager_depots')
    .select('depot_id')
    .eq('user_id', userData.user.id)
    .is('unassigned_at', null);

  if (depotError) throw depotError;

  return {
    userId: userData.user.id,
    email: userData.user.email ?? null,
    organizationId: profile.organization_id as string,
    role: roleRow.role as AppRole,
    depotIds: (depotRows ?? []).map((row) => row.depot_id as string),
    asCaller,
    asService,
  };
}

export function requireAdmin(caller: Caller): void {
  if (caller.role !== 'ADMIN' && caller.role !== 'SUPER_ADMIN') {
    throw new PublicError('FORBIDDEN', 403);
  }
}

/**
 * Asserts that a depot belongs to the caller's organisation *and*, for a
 * manager, is one of theirs. Called before anything is written with the
 * service client.
 */
export async function requireDepotAccess(caller: Caller, depotId: string): Promise<void> {
  const { data, error } = await caller.asService
    .from('depots')
    .select('id, organization_id')
    .eq('id', depotId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.organization_id !== caller.organizationId) {
    // Deliberately the same error as "not permitted": a caller must not be
    // able to probe which depot ids exist in other organisations.
    throw new PublicError('FORBIDDEN', 403);
  }
  if (caller.role === 'MANAGER' && !caller.depotIds.includes(depotId)) {
    throw new PublicError('FORBIDDEN', 403);
  }
}

/** Writes an audit row attributed to the caller, for actions RLS cannot log. */
export async function writeAudit(
  caller: Caller,
  entry: {
    /** SCREAMING_SNAKE, matching the `audit_logs_action_format` constraint. */
    action: string;
    entityType: string;
    entityId: string | null;
    entityLabel?: string | null;
    depotId?: string | null;
    before?: unknown;
    after?: unknown;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await caller.asService.from('audit_logs').insert({
    organization_id: caller.organizationId,
    depot_id: entry.depotId ?? null,
    actor_id: caller.userId,
    actor_email: caller.email,
    actor_role: caller.role,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    entity_label: entry.entityLabel ?? null,
    before_values: entry.before ?? null,
    after_values: entry.after ?? null,
    context: entry.context ?? {},
  });
  // An audit write that fails must surface: it is not decorative.
  if (error) throw error;
}
