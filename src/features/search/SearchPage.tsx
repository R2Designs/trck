import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Bus, Route as RouteIcon, UserCog, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NoResultsState } from '@/components/feedback/states';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/app/query-client';
import { useAuth } from '@/features/auth/session';

/**
 * Global search.
 *
 * Runs server-side through `rpc_search`: debounced, capped, and scoped by RLS,
 * so it never pulls a fleet's worth of rows into a phone just to filter them
 * locally. Two characters is the floor — a single letter matches everything and
 * costs a round trip to say so.
 */

type SearchKind = 'bus' | 'employee' | 'route' | 'manager';

const GROUP_ORDER: SearchKind[] = ['bus', 'employee', 'route', 'manager'];

const GROUP_ICON = {
  bus: Bus,
  employee: Users,
  route: RouteIcon,
  manager: UserCog,
} as const;

const GROUP_LINK: Record<SearchKind, (id: string) => string | undefined> = {
  bus: (id) => `/fleet/buses/${id}`,
  employee: (id) => `/fleet/drivers/${id}`,
  route: (id) => `/fleet/routes/${id}/edit`,
  manager: () => '/admin/managers',
};

export default function SearchPage() {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const enabled = Boolean(identity) && trimmed.length >= 2;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.search(trimmed),
    enabled,
    queryFn: async () => {
      const { data: rows, error: rpcError } = await supabase.rpc('rpc_search', {
        p_query: trimmed,
        p_limit: 8,
      });
      if (rpcError) throw rpcError;
      return rows ?? [];
    },
  });

  const grouped = GROUP_ORDER.map((kind) => ({
    kind,
    items: (data ?? []).filter((row) => row.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader backTo="/" title={t('search.title')} />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('search.placeholder')}
        autoFocus
      />

      {!enabled && <EmptyState title={t('search.title')} description={t('search.hint')} />}

      {enabled && isLoading && <SkeletonList count={4} />}
      {enabled && isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {enabled && !isLoading && !isError && grouped.length === 0 && (
        <NoResultsState query={trimmed} onClear={() => setQuery('')} />
      )}

      {grouped.map((group) => {
        const Icon = GROUP_ICON[group.kind];
        return (
          <section key={group.kind}>
            <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t(`search.groups.${group.kind}`)}
            </h2>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <EntityCard
                    to={GROUP_LINK[group.kind](item.id)}
                    icon={group.kind === 'employee' ? undefined : Icon}
                    avatarText={group.kind === 'employee' ? initialsOf(item.title) : undefined}
                    title={item.title}
                    subtitle={item.subtitle || undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
