import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Play, Route as RouteIcon, Square } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard } from '@/components/common/EntityCard';
import { TripStatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { formatDateTime, formatDistance, formatPercent, formatRelativeTime } from '@/lib/format';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useActiveTrips, useTrips } from './api';

export default function TripsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const depot = useActiveDepot();
  const [tab, setTab] = useState('active');

  const active = useActiveTrips(depot?.id ?? null);
  const recent = useTrips({ depotId: depot?.id ?? null, limit: 40 });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('trips.title')}
        description={depot?.name}
        action={
          can('trip.create') && (
            <Button asChild size="md">
              <Link to="/trips/start">
                <Play className="size-4" aria-hidden />
                {t('home.startTrip')}
              </Link>
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">
            {t('trips.active')}
            {(active.data?.length ?? 0) > 0 && (
              <span className="ml-1.5 grid size-5 place-items-center rounded-full bg-info text-xs font-bold text-info-foreground">
                {active.data?.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="recent">{t('trips.recent')}</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          {active.isLoading && <SkeletonList count={2} />}
          {active.isError && (
            <ErrorState error={active.error} onRetry={() => void active.refetch()} />
          )}
          {!active.isLoading && (active.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('trips.noActiveTrips')}
              description={t('empty.tripsBody')}
              action={
                can('trip.create') && (
                  <Button asChild>
                    <Link to="/trips/start">{t('home.startTrip')}</Link>
                  </Button>
                )
              }
            />
          )}
          <ul className="space-y-3">
            {active.data?.map((trip) => (
              <li key={trip.id}>
                <EntityCard
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  highlight
                  title={trip.bus?.registration_number ?? ''}
                  subtitle={`${trip.route?.name ?? ''}${trip.driver ? ` · ${trip.driver.full_name}` : ''}`}
                  meta={
                    <>
                      <TripStatusBadge status={trip.status} />
                      <span className="text-xs text-muted-foreground">
                        {t('trips.startedAt', { time: formatRelativeTime(trip.actual_start_time) })}
                      </span>
                    </>
                  }
                  trailing={
                    can('trip.complete') && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/trips/${trip.id}/end`}>
                          <Square className="size-3.5" aria-hidden />
                          {t('home.endTrip')}
                        </Link>
                      </Button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="recent" className="space-y-3">
          {recent.isLoading && <SkeletonList count={4} />}
          {recent.isError && (
            <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
          )}
          {!recent.isLoading && (recent.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('empty.trips')}
              description={t('empty.tripsBody')}
            />
          )}
          <ul className="space-y-3">
            {recent.data?.map((trip) => (
              <li key={trip.id}>
                <EntityCard
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  title={trip.bus?.registration_number ?? ''}
                  subtitle={`${trip.route?.name ?? ''} · ${formatDateTime(trip.actual_start_time)}`}
                  meta={
                    <>
                      <TripStatusBadge status={trip.status} />
                      {trip.calculated_distance_km != null && (
                        <span className="tabular text-xs text-muted-foreground">
                          {t('units.kmValue', {
                            value: formatDistance(trip.calculated_distance_km),
                          })}
                        </span>
                      )}
                      {trip.distance_variance_pct != null && (
                        <span className="tabular text-xs text-muted-foreground">
                          {formatPercent(trip.distance_variance_pct, { signed: true })}
                        </span>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
