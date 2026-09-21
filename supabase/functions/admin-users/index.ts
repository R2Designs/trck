import { authenticate, requireAdmin, requireDepotAccess, writeAudit } from '../_shared/auth.ts';
import type { Caller } from '../_shared/auth.ts';
import { errorResponse, json, preflight, PublicError, readJson } from '../_shared/http.ts';

/**
 * Privileged user administration.
 *
 * This function exists for exactly one reason: creating, disabling and
 * re-enabling an auth user requires the service-role key, and that key must
 * never be in a browser bundle. Everything here is the small set of operations
 * that genuinely cannot be done with the caller's own session.
 *
 * Invariants enforced on every action:
 *   • the caller is an authenticated ADMIN of some organisation;
 *   • the *target* user belongs to that same organisation — checked by reading
 *     the target's profile, never by trusting an organisation id in the body;
 *   • a manager is never deleted, only deactivated, so their historical
 *     attendance approvals and anomaly reviews stay attributable;
 *   • every action writes an audit row before returning.
 *
 * A SUPER_ADMIN has no cross-tenant power here either. Operating on another
 * organisation's user is a support action performed with database access, not
 * an API an internet-facing function offers.
 */

type Action =
  'invite-manager' | 'deactivate-user' | 'reactivate-user' | 'reset-password' | 'assign-depots';

interface RequestBody {
  action?: Action;
  fullName?: string;
  email?: string;
  userId?: string;
  depotIds?: string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const body = await readJson<RequestBody>(request);
    const caller = await authenticate(request);
    requireAdmin(caller);

    switch (body.action) {
      case 'invite-manager':
        return json(request, await inviteManager(caller, body));
      case 'deactivate-user':
        return json(request, await setActive(caller, body, false));
      case 'reactivate-user':
        return json(request, await setActive(caller, body, true));
      case 'reset-password':
        return json(request, await resetPassword(caller, body));
      case 'assign-depots':
        return json(request, await assignDepots(caller, body));
      default:
        throw new PublicError('UNKNOWN_ACTION', 400);
    }
  } catch (error) {
    return errorResponse(request, error);
  }
});

/**
 * Loads the target user and proves they are in the caller's organisation.
 *
 * This is the check that makes the whole function safe: without it, an
 * administrator of one tenant could pass any user id and disable an account
 * belonging to another.
 */
async function loadTarget(caller: Caller, userId: string | undefined) {
  if (!userId) throw new PublicError('MISSING_USER_ID', 400);

  const { data, error } = await caller.asService
    .from('profiles')
    .select('id, organization_id, full_name, email, status')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  // Same error for "does not exist" and "not yours": a caller must not be able
  // to enumerate user ids across tenants.
  if (!data || data.organization_id !== caller.organizationId) {
    throw new PublicError('FORBIDDEN', 403);
  }
  if (data.id === caller.userId) throw new PublicError('CANNOT_MODIFY_SELF', 400);
  return data;
}

async function inviteManager(caller: Caller, body: RequestBody) {
  const fullName = (body.fullName ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const depotIds = [...new Set(body.depotIds ?? [])];

  if (fullName.length < 2) throw new PublicError('INVALID_NAME', 400);
  if (!EMAIL_PATTERN.test(email)) throw new PublicError('INVALID_EMAIL', 400);
  if (depotIds.length === 0) throw new PublicError('NO_DEPOTS_SELECTED', 400);

  for (const depotId of depotIds) await requireDepotAccess(caller, depotId);

  const redirectTo = Deno.env.get('APP_URL')
    ? `${Deno.env.get('APP_URL')}/auth/set-password`
    : undefined;

  // `inviteUserByEmail` sends the sign-up link and creates the auth user in one
  // step, so no password is ever chosen on this side of the wire.
  const { data: invited, error: inviteError } = await caller.asService.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, organization_id: caller.organizationId },
      redirectTo,
    },
  );

  if (inviteError) {
    // The one error worth distinguishing: the address is already in use.
    if (/already/i.test(inviteError.message)) throw new PublicError('EMAIL_IN_USE', 409);
    throw inviteError;
  }

  const userId = invited.user.id;

  // The `on auth.users` trigger created a bare profile. Complete it, then grant
  // the role and the depots. If any step fails the user is left INVITED with no
  // role, which grants nothing — the failure mode is inert, not dangerous.
  const { error: profileError } = await caller.asService
    .from('profiles')
    .update({
      organization_id: caller.organizationId,
      full_name: fullName,
      email,
      status: 'INVITED',
      created_by: caller.userId,
    })
    .eq('id', userId);
  if (profileError) throw profileError;

  const { error: roleError } = await caller.asService.from('user_roles').insert({
    user_id: userId,
    organization_id: caller.organizationId,
    role: 'MANAGER',
    granted_by: caller.userId,
  });
  if (roleError) throw roleError;

  const { error: depotError } = await caller.asService.from('manager_depots').insert(
    depotIds.map((depotId) => ({
      user_id: userId,
      organization_id: caller.organizationId,
      depot_id: depotId,
      assigned_by: caller.userId,
    })),
  );
  if (depotError) throw depotError;

  await writeAudit(caller, {
    action: 'MANAGER_INVITED',
    entityType: 'profiles',
    entityId: userId,
    entityLabel: fullName,
    after: { email, role: 'MANAGER', depot_count: depotIds.length },
  });

  return { userId };
}

async function setActive(caller: Caller, body: RequestBody, active: boolean) {
  const target = await loadTarget(caller, body.userId);

  // Deactivation is a ban with no expiry rather than a delete: the auth user
  // survives, so every row that references this profile stays resolvable.
  const { error: banError } = await caller.asService.auth.admin.updateUserById(target.id, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) throw banError;

  const { error: profileError } = await caller.asService
    .from('profiles')
    .update({
      status: active ? 'ACTIVE' : 'INACTIVE',
      deactivated_at: active ? null : new Date().toISOString(),
    })
    .eq('id', target.id);
  if (profileError) throw profileError;

  await writeAudit(caller, {
    action: active ? 'MANAGER_REACTIVATED' : 'MANAGER_DEACTIVATED',
    entityType: 'profiles',
    entityId: target.id,
    entityLabel: target.full_name,
    before: { status: target.status },
    after: { status: active ? 'ACTIVE' : 'INACTIVE' },
  });

  return { userId: target.id, status: active ? 'ACTIVE' : 'INACTIVE' };
}

async function resetPassword(caller: Caller, body: RequestBody) {
  const target = await loadTarget(caller, body.userId);

  const redirectTo = Deno.env.get('APP_URL')
    ? `${Deno.env.get('APP_URL')}/auth/reset-password`
    : undefined;

  // A *link* is generated and emailed. The administrator never sees it and
  // never sets a password on someone else's behalf, so an account is never
  // briefly accessible to two people.
  const { error } = await caller.asService.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;

  await writeAudit(caller, {
    action: 'MANAGER_ACCESS_RESET',
    entityType: 'profiles',
    entityId: target.id,
    entityLabel: target.full_name,
  });

  return { userId: target.id };
}

async function assignDepots(caller: Caller, body: RequestBody) {
  const target = await loadTarget(caller, body.userId);
  const depotIds = [...new Set(body.depotIds ?? [])];
  if (depotIds.length === 0) throw new PublicError('NO_DEPOTS_SELECTED', 400);

  for (const depotId of depotIds) await requireDepotAccess(caller, depotId);

  const { data: existing, error: existingError } = await caller.asService
    .from('manager_depots')
    .select('id, depot_id, unassigned_at')
    .eq('user_id', target.id)
    .eq('organization_id', caller.organizationId);
  if (existingError) throw existingError;

  const rows = existing ?? [];
  const current = new Set(
    rows.filter((row) => row.unassigned_at === null).map((row) => row.depot_id as string),
  );
  const wanted = new Set(depotIds);

  // Unassign rather than delete, so "who could see this depot in March" stays
  // an answerable question.
  const toRemove = rows.filter(
    (row) => row.unassigned_at === null && !wanted.has(row.depot_id as string),
  );
  if (toRemove.length > 0) {
    const { error } = await caller.asService
      .from('manager_depots')
      .update({ unassigned_at: new Date().toISOString() })
      .in(
        'id',
        toRemove.map((row) => row.id),
      );
    if (error) throw error;
  }

  const toAdd = depotIds.filter((depotId) => !current.has(depotId));
  if (toAdd.length > 0) {
    const { error } = await caller.asService.from('manager_depots').insert(
      toAdd.map((depotId) => ({
        user_id: target.id,
        organization_id: caller.organizationId,
        depot_id: depotId,
        assigned_by: caller.userId,
      })),
    );
    if (error) throw error;
  }

  await writeAudit(caller, {
    action: 'MANAGER_DEPOTS_ASSIGNED',
    entityType: 'profiles',
    entityId: target.id,
    entityLabel: target.full_name,
    before: { depot_ids: [...current] },
    after: { depot_ids: depotIds },
  });

  return { userId: target.id, depotIds };
}
