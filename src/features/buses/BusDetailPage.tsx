import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Bus, Gauge, Pencil, Route as RouteIcon } from 'lucide-react';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { BusStatusBadge, AnomalyBadge } from '@/components/common/StatusBadge';
import { EntityCard } from '@/components/common/EntityCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NotFoundState } from '@/components/feedback/states';
import {
  EMPTY_VALUE,
  formatDate,
  formatDateTime,
  formatDistance,
  formatEfficiency,
  formatPercent,
} from '@/lib/format';
import { useAuth } from '@/features/auth/session';
import { useBus, useBusBaseline } from '@/features/fleet/api';
import { useTrips } from '@/features/trips/api';
import { useAnomalies } from '@/features/anomalies/api';
import { useThresholds } from '@/features/settings/api';
import { TripStatusBadge } from '@/components/common/StatusBadge';

/**
 * One bus, everything about it.
 *
 * The overview answers "can this bus go out now?"; the other tabs answer
 * "what has it been doing?" and "why was it flagged?". The learned-baseline
 * card is deliberately explicit about how many trips it rests on — a figure
 * derived from four trips deserves less trust than one derived from forty,
 * and the screen says which it is.
 */
export default function BusDetailPage() {
  const { t } = useTranslation();
  const { busId } = useParams<{ busId: string }>();
  const { can } = useAuth();
  const { thresholds } = useThresholds();

  const bus = useBus(busId);
  const baseline = useBusBaseline(busId);
  const trips = useTrips({ busId, limit: 20 });
  const anomalies = useAnomalies({ busId, limit: 20 });

  if (bus.isLoading) return <SkeletonList count={4} />;
  if (bus.isError) return <ErrorState error={bus.error} onRetry={() => void bus.refetch()} />;
  if (!bus.data) return <NotFoundState />;

  const record = bus.data;
  const learned = baseline.data;
  const tripsNeeded = Math.max(0, thresholds.minTripsForBaseline - (learned?.sample_size ?? 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title={record.registration_number}
        description={[record.fleet_number, record.make, record.model].filter(Boolean).join(' · ')}
        action={
          can('bus.update') && (
            <Button asChild variant="outline" size="md">
              <Link to={`/fleet/buses/${record.id}/edit`}>
                <Pencil className="size-4" aria-hidden />
                {t('actions.edit')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <BusStatusBadge status={record.status} />
        <span className="text-xs text-muted-foreground">
          {t('buses.currentOdometer')}:{' '}
          <span className="tabular font-medium text-foreground">
            {t('units.kmValue', { value: formatDistance(record.current_odometer_km, 0) })}
          </span>
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('buses.overview')}</TabsTrigger>
          <TabsTrigger value="trips">{t('buses.tripHistory')}</TabsTrigger>
          <TabsTrigger value="alerts">{t('buses.anomalyHistory')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <DetailList>
                <DetailRow label={t('buses.fuelType')} value={t(`fuelType.${record.fuel_type}`)} />
                <DetailRow
                  label={t('buses.dashboardType')}
                  value={t(`dashboardType.${record.dashboard_type}`)}
                />
                <DetailRow
                  label={t('buses.manufacturingYear')}
                  value={record.manufacturing_year ?? EMPTY_VALUE}
                  mono
                />
                <DetailRow
                  label={t('buses.tankCapacity')}
                  value={
                    record.tank_capacity_litres
                      ? t('units.litresValue', { value: record.tank_capacity_litres })
                      : EMPTY_VALUE
                  }
                  mono
                />
                <DetailRow
                  label={t('buses.nominalEfficiency')}
                  value={
                    record.nominal_efficiency_kmpl
                      ? t('units.kmplValue', {
                          value: formatEfficiency(record.nominal_efficiency_kmpl),
                        })
                      : EMPTY_VALUE
                  }
                  mono
                />
                <DetailRow
                  label={t('buses.totalDistance')}
                  value={t('units.kmValue', {
                    value: formatDistance(
                      record.current_odometer_km - record.starting_odometer_km,
                      0,
                    ),
                  })}
                  mono
                />
                <DetailRow
                  label={t('common.createdOn', { date: '' })}
                  value={formatDate(record.created_at)}
                />
              </DetailList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="size-4 text-muted-foreground" aria-hidden />
                {t('buses.historicalEfficiency')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {learned && learned.sample_size >= thresholds.minTripsForBaseline ? (
                <DetailList>
                  <DetailRow
                    label={t('buses.baselineEfficiency')}
                    value={
                      learned.median_efficiency_kmpl
                        ? t('units.kmplValue', {
                            value: formatEfficiency(learned.median_efficiency_kmpl),
                          })
                        : EMPTY_VALUE
                    }
                    mono
                  />
                  <DetailRow
                    label={t('anomalies.details.baselineSample')}
                    value={t('buses.baselineFrom', { count: learned.sample_size })}
                  />
                </DetailList>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('buses.noBaselineYet', { count: tripsNeeded })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trips" className="space-y-3">
          {trips.isLoading && <SkeletonList count={3} />}
          {trips.isError && <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />}
          {!trips.isLoading && (trips.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('empty.trips')}
              description={t('empty.tripsBody')}
            />
          )}
          <ul className="space-y-3">
            {trips.data?.map((trip) => (
              <li key={trip.id}>
                <EntityCard
                  to={`/trips/${trip.id}`}
                  icon={RouteIcon}
                  title={trip.route?.name ?? t('trips.title')}
                  subtitle={formatDateTime(trip.actual_start_time)}
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

        <TabsContent value="alerts" className="space-y-3">
          {anomalies.isLoading && <SkeletonList count={3} />}
          {!anomalies.isLoading && (anomalies.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={Bus}
              title={t('empty.anomalies')}
              description={t('empty.anomaliesBody')}
            />
          )}
          <ul className="space-y-3">
            {anomalies.data?.map((anomaly) => (
              <li key={anomaly.id}>
                <EntityCard
                  to={`/alerts/${anomaly.id}`}
                  icon={AlertTriangle}
                  title={t(`anomalies.kinds.${anomaly.kind}`)}
                  subtitle={formatDateTime(anomaly.detected_at)}
                  meta={<AnomalyBadge severity={anomaly.severity} size="sm" />}
                />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
