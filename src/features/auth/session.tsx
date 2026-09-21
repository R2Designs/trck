import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { AppLocale, AppRole } from '@domain/types.ts';
import type { Permission } from '@domain/roles.ts';
import { can, isAdminRole, isManagerRole, isStaffRole } from '@domain/roles.ts';
import { supabase } from '@/lib/supabase/client';
import type { DepotRow, ProfileRow } from '@/lib/supabase/database.types';
import { logger } from '@/lib/logger';
import { handleError } from '@/lib/errors';
import { changeLanguage } from '@/i18n';

/**
 * Session, identity and authorisation state.
 *
 * What lives here and why:
 *   • the Supabase session (tokens, refresh, expiry);
 *   • the *application* identity — profile, role, accessible depots — which
 *     Supabase knows nothing about and which drives every navigation decision;
 *   • the user's language, applied the moment we learn it, so a Tamil-speaking
 *     manager sees Tamil from the first screen after sign-in rather than a
 *     flash of English.
 *
 * Everything here is a *rendering* concern. Authorisation is enforced by RLS
 * and by the RPC guards; `can()` decides what to draw, never what is allowed.
 */

export type AuthStatus =
  'loading' | 'authenticated' | 'unauthenticated' | 'no-access' | 'deactivated';

export interface AuthIdentity {
  user: User;
  profile: ProfileRow;
  role: AppRole;
  organizationId: string;
  organizationName: string;
  /** Depots this person may act on. Admins get every active depot. */
  depots: DepotRow[];
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  identity: AuthIdentity | null;
  /** Depot currently in focus for a multi-depot manager or an admin. */
  activeDepotId: string | null;
  setActiveDepotId: (depotId: string | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  setLocale: (locale: AppLocale) => Promise<void>;
  refreshIdentity: () => Promise<void>;
  can: (permission: Permission) => boolean;
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVE_DEPOT_KEY = 'trck.active-depot';

/**
 * Loads everything the application needs to know about the signed-in person,
 * in as few round trips as the RLS policies allow.
 */
async function loadIdentity(
  user: User,
): Promise<
  { kind: 'ok'; identity: AuthIdentity } | { kind: 'no-access' } | { kind: 'deactivated' }
> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return { kind: 'no-access' };
  if (profile.status === 'INACTIVE' || profile.deactivated_at) return { kind: 'deactivated' };
  if (!profile.organization_id) return { kind: 'no-access' };

  const [rolesResult, orgResult, depotsResult, assignmentsResult] = await Promise.all([
    supabase
      .from('user_roles')
      .select('role, organization_id')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .limit(1),
    supabase
      .from('organizations')
      .select('id, name')
      .eq('id', profile.organization_id)
      .maybeSingle(),
    supabase.from('depots').select('*').eq('is_active', true).order('name'),
    supabase
      .from('manager_depots')
      .select('depot_id')
      .eq('user_id', user.id)
      .is('unassigned_at', null),
  ]);

  if (rolesResult.error) throw rolesResult.error;
  if (orgResult.error) throw orgResult.error;
  if (depotsResult.error) throw depotsResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const role = rolesResult.data?.[0]?.role;
  if (!role) return { kind: 'no-access' };

  const allDepots = depotsResult.data ?? [];
  const assigned = new Set((assignmentsResult.data ?? []).map((row) => row.depot_id));
  const depots = isAdminRole(role)
    ? allDepots
    : allDepots.filter((depot) => assigned.has(depot.id));

  return {
    kind: 'ok',
    identity: {
      user,
      profile,
      role,
      organizationId: profile.organization_id,
      organizationName: orgResult.data?.name ?? '',
      depots,
    },
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [activeDepotId, setActiveDepotIdState] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const applyUser = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);

    if (!nextSession?.user) {
      setIdentity(null);
      setStatus('unauthenticated');
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const result = await loadIdentity(nextSession.user);
      if (result.kind === 'no-access') {
        setIdentity(null);
        setStatus('no-access');
        return;
      }
      if (result.kind === 'deactivated') {
        setIdentity(null);
        setStatus('deactivated');
        await supabase.auth.signOut();
        return;
      }

      setIdentity(result.identity);
      setStatus('authenticated');

      // The stored language wins over the browser, and the profile wins over
      // the device — see src/i18n/languages.ts.
      if (result.identity.profile.preferred_locale) {
        await changeLanguage(result.identity.profile.preferred_locale);
      }

      const stored = (() => {
        try {
          return localStorage.getItem(ACTIVE_DEPOT_KEY);
        } catch {
          return null;
        }
      })();
      const valid = result.identity.depots.some((depot) => depot.id === stored);
      setActiveDepotIdState(valid ? stored : (result.identity.depots[0]?.id ?? null));
    } catch (error) {
      handleError(error, 'load identity');
      setIdentity(null);
      setStatus('no-access');
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) void applyUser(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logger.debug('Auth state changed', { event });
      if (event === 'SIGNED_OUT') {
        setIdentity(null);
        setSession(null);
        setStatus('unauthenticated');
        return;
      }
      // TOKEN_REFRESHED fires often; the identity has not changed, so only the
      // session is updated to avoid a burst of queries on every refresh.
      if (event === 'TOKEN_REFRESHED') {
        setSession(nextSession);
        return;
      }
      void applyUser(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [applyUser]);

  const setActiveDepotId = useCallback((depotId: string | null) => {
    setActiveDepotIdState(depotId);
    try {
      if (depotId) localStorage.setItem(ACTIVE_DEPOT_KEY, depotId);
      else localStorage.removeItem(ACTIVE_DEPOT_KEY);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;

    // Best-effort: a failure here must not block a successful sign-in.
    void supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id)
      .then(({ error: updateError }) => {
        if (updateError) logger.warn('Could not record last login', { error: updateError });
      });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIdentity(null);
    setStatus('unauthenticated');
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const setLocale = useCallback(
    async (locale: AppLocale) => {
      await changeLanguage(locale);
      if (!identity) return;
      const { error } = await supabase
        .from('profiles')
        .update({ preferred_locale: locale })
        .eq('id', identity.user.id);
      if (error) {
        // The UI has already switched; a failed write just means the choice is
        // device-local until the next successful save.
        logger.warn('Could not persist language preference', { error });
        return;
      }
      setIdentity((current) =>
        current
          ? { ...current, profile: { ...current.profile, preferred_locale: locale } }
          : current,
      );
    },
    [identity],
  );

  const refreshIdentity = useCallback(async () => {
    if (session) await applyUser(session);
  }, [applyUser, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      identity,
      activeDepotId,
      setActiveDepotId,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      setLocale,
      refreshIdentity,
      can: (permission: Permission) => can(identity?.role ?? null, permission),
      isAdmin: isAdminRole(identity?.role),
      isManager: isManagerRole(identity?.role),
      isStaff: isStaffRole(identity?.role),
    }),
    [
      status,
      session,
      identity,
      activeDepotId,
      setActiveDepotId,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      setLocale,
      refreshIdentity,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Throws when called outside an authenticated tree — a programming error. */
export function useIdentity(): AuthIdentity {
  const { identity } = useAuth();
  if (!identity) throw new Error('useIdentity requires an authenticated session');
  return identity;
}

/** The depot a manager is currently working in, with its name resolved. */
export function useActiveDepot(): DepotRow | null {
  const { identity, activeDepotId } = useAuth();
  if (!identity) return null;
  return identity.depots.find((depot) => depot.id === activeDepotId) ?? identity.depots[0] ?? null;
}
