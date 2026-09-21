import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, Route as RouteIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SearchInput } from '@/components/common/SearchInput';
import { EntityCard } from '@/components/common/EntityCard';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NoResultsState } from '@/components/feedback/states';
import { formatDistance, formatPercent } from '@/lib/format';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useRoutes } from '@/features/fleet/api';

export default function RouteListPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const depot = useActiveDepot();
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useRoutes({
    depotId: depot?.id ?? null,
    activeOnly: false,
  });

  const term = search.trim().toLowerCase();
  const filtered = term
    ? (data ?? []).filter(
        (route) =>
          route.name.toLowerCase().includes(term) ||
          route.code.toLowerCase().includes(term) ||
          route.origin.toLowerCase().includes(term) ||
          route.destination.toLowerCase().includes(term),
      )
    : (data ?? []);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('routes.title')}
        description={depot?.name}
        action={
          can('route.create') && (
            <Button asChild size="md">
              <Link to="/fleet/routes/new">
                <Plus className="size-4" aria-hidden />
                {t('routes.add')}
              </Link>
            </Button>
          )
        }
      />

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('routes.searchPlaceholder')}
      />

      {isLoading && <SkeletonList count={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {!isLoading && !isError && filtered.length === 0 && term && (
        <NoResultsState query={search} onClear={() => setSearch('')} />
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={RouteIcon}
          title={t('empty.routes')}
          description={t('empty.routesBody')}
          action={
            can('route.create') && (
              <Button asChild>
                <Link to="/fleet/routes/new">{t('routes.add')}</Link>
              </Button>
            )
          }
        />
      )}

      <ul className="space-y-3">
        {filtered.map((route) => (
          <li key={route.id}>
            <EntityCard
              to={can('route.update') ? `/fleet/routes/${route.id}/edit` : undefined}
              icon={RouteIcon}
              title={route.name}
              subtitle={`${route.origin} → ${route.destination}`}
              meta={
                <>
                  <span className="tabular text-xs font-medium text-muted-foreground">
                    {t('units.kmValue', { value: formatDistance(route.expected_distance_km) })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ±{formatPercent(route.distance_tolerance_pct, { decimals: 0 })}
                  </span>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
