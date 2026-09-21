import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { handleError, toAppError } from '@/lib/errors';
import { reportNetworkFailure, reportNetworkSuccess } from '@/lib/network';

/**
 * The query client.
 *
 * Tuned for a phone on a weak connection rather than for a desktop on fibre:
 *
 *  • Reference data (depots, routes, buses) is cached for minutes, not
 *    seconds — it changes rarely and refetching it on every screen costs a
 *    visible pause on a 3G link.
 *  • Retries back off, and stop entirely for errors that retrying cannot fix
 *    (a permission denial, a validation failure, a duplicate).
 *  • Every failure is converted to an `AppError` here, so no component ever
 *    receives a `PostgrestError`.
 */

const NON_RETRYABLE = new Set(['PERMISSION', 'VALIDATION', 'CONFLICT', 'NOT_FOUND', 'AUTH']);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 15 * 60_000,
        retry: (failureCount, error) => {
          const appError = toAppError(error);
          if (NON_RETRYABLE.has(appError.kind)) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        // Refetch when the phone comes back from a tunnel, not on every tab
        // switch — the former is a real state change, the latter is noise.
        refetchOnReconnect: true,
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: false,
        networkMode: 'offlineFirst',
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        const appError = handleError(error, `query ${String(query.queryKey[0])}`);
        if (appError.kind === 'NETWORK' || appError.kind === 'OFFLINE') reportNetworkFailure();
      },
      onSuccess: () => reportNetworkSuccess(),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const appError = handleError(
          error,
          `mutation ${String(mutation.options.mutationKey?.[0] ?? 'unknown')}`,
        );
        if (appError.kind === 'NETWORK' || appError.kind === 'OFFLINE') reportNetworkFailure();
      },
      onSuccess: () => reportNetworkSuccess(),
    }),
  });
}

/**
 * Query keys, centralised.
 *
 * Every key is a tuple starting with a domain noun, so invalidating "every
 * trip query" is one call rather than a hunt through the codebase.
 */
export const queryKeys = {
  settings: (orgId: string) => ['settings', orgId] as const,
  depots: () => ['depots'] as const,
  buses: (filters?: unknown) => ['buses', filters ?? {}] as const,
  bus: (id: string) => ['buses', 'detail', id] as const,
  busBaseline: (busId: string, routeId?: string | null) =>
    ['buses', 'baseline', busId, routeId ?? null] as const,
  routes: (filters?: unknown) => ['routes', filters ?? {}] as const,
  route: (id: string) => ['routes', 'detail', id] as const,
  employees: (filters?: unknown) => ['employees', filters ?? {}] as const,
  employee: (id: string) => ['employees', 'detail', id] as const,
  employeeFaceStatus: (id: string) => ['employees', 'face', id] as const,
  trips: (filters?: unknown) => ['trips', filters ?? {}] as const,
  trip: (id: string) => ['trips', 'detail', id] as const,
  activeTrips: (depotId: string | null) => ['trips', 'active', depotId] as const,
  attendance: (filters?: unknown) => ['attendance', filters ?? {}] as const,
  anomalies: (filters?: unknown) => ['anomalies', filters ?? {}] as const,
  anomaly: (id: string) => ['anomalies', 'detail', id] as const,
  managerDashboard: (depotId: string | null) => ['dashboard', 'manager', depotId] as const,
  adminDashboard: (days: number) => ['dashboard', 'admin', days] as const,
  managers: (filters?: unknown) => ['managers', filters ?? {}] as const,
  auditLogs: (filters?: unknown) => ['audit', filters ?? {}] as const,
  notifications: () => ['notifications'] as const,
  search: (query: string) => ['search', query] as const,
  report: (type: string, filters: unknown) => ['reports', type, filters] as const,
} as const;
