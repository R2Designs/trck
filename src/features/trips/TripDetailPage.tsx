import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Square, TriangleAlert } from 'lucide-react';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { AnomalyBadge, ConfidenceBadge, TripStatusBadge } from '@/components/common/StatusBadge';
import { EntityCard } from '@/components/common/EntityCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState, NotFoundState } from '@/components/feedback/states';
import {
  EMPTY_VALUE,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEfficiency,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { getStorageProvider } from '@/providers/storage';
import { useAuth } from '@/features/auth/session';
import { useTrip, useTripCaptures } from './api';
import { useAnomalies } from '@/features/anomalies/api';
import { useAnomalyExplanation, anomalyToExplainable } from '@/features/anomalies/explain';

/**
 * One trip, with its evidence.
 *
 * Readings are shown *with* their provenance — read by OCR, corrected by a
 * manager, or typed in — because "86,542 km" means something different
 * depending on which of those it was.
 */
export default function TripDetailPage() {
  const { t } = useTranslation();
  const { tripId } = useParams<{ tripId: string }>();
  const { can } = useAuth();
  const explain = useAnomalyExplanation();

  const trip = useTrip(tripId);
  const captures = useTripCaptures(tripId);
  const anomalies = useAnomalies({ limit: 20 });
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const paths = (captures.data?.captures ?? []).map((capture) => capture.storage_path);
    if (paths.length === 0) return;
    let cancelled = false;
    void getStorageProvider()
      .getSignedUrls('dashboards', paths, 300)
      .then((urls) => {
        if (!cancelled) setSignedUrls(new Map([...urls].map(([path, s]) => [path, s.url])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [captures.data]);

  if (trip.isLoading) return <SkeletonList count={4} />;
  if (trip.isError) return <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />;
  if (!trip.data) return <NotFoundState />;

  const record = trip.data;
  const duration = formatDuration(record.duration_minutes);
  const tripAnomalies = (anomalies.data ?? []).filter((anomaly) => anomaly.trip_id === record.id);

  const readingsFor = (kind: 'TRIP_START' | 'TRIP_END') => {
    const capture = captures.data?.captures.find((item) => item.kind === kind);
    if (!capture) return { capture: null, readings: [] };
    return {
      capture,
      readings: (captures.data?.readings ?? []).filter((r) => r.capture_id === capture.id),
    };
  };

  const start = readingsFor('TRIP_START');
  const end = readingsFor('TRIP_END');

  return (
    <div className="space-y-4">
      <PageHeader
        title={record.bus?.registration_number ?? t('trips.title')}
        description={record.route?.name ?? undefined}
        action={
          record.status === 'STARTED' &&
          can('trip.complete') && (
            <Button asChild size="md">
              <Link to={`/trips/${record.id}/end`}>
                <Square className="size-4" aria-hidden />
                {t('home.endTrip')}
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TripStatusBadge status={record.status} />
        {record.completion_override && (
          <span className="rounded-full bg-warning-muted px-2.5 py-1 text-xs font-semibold text-warning">
            {t('trips.missingEndReading')}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <DetailList>
            <DetailRow
              label={t('trips.driverLabel')}
              value={record.driver?.full_name ?? EMPTY_VALUE}
            />
            <DetailRow
              label={t('trips.startedAt', { time: '' }).trim()}
              value={formatDateTime(record.actual_start_time)}
            />
            <DetailRow
              label={t('trips.endedAt', { time: '' }).trim()}
              value={formatDateTime(record.actual_end_time)}
            />
            <DetailRow
              label={t('trips.duration')}
              value={
                duration
                  ? t('units.hoursMinutes', { hours: duration.hours, minutes: duration.minutes })
                  : EMPTY_VALUE
              }
              mono
            />
            <DetailRow
              label={t('trips.expectedDistance')}
              value={t('units.kmValue', { value: formatDistance(record.expected_distance_km) })}
              mono
            />
            <DetailRow
              label={t('trips.actualDistance')}
              value={
                record.calculated_distance_km != null
                  ? t('units.kmValue', { value: formatDistance(record.calculated_distance_km) })
                  : EMPTY_VALUE
              }
              mono
            />
            <DetailRow
              label={t('trips.variance')}
              value={formatPercent(record.distance_variance_pct, { signed: true })}
              mono
            />
            <DetailRow
              label={t('trips.efficiency')}
              value={
                record.calculated_efficiency_kmpl != null
                  ? t('units.kmplValue', {
                      value: formatEfficiency(record.calculated_efficiency_kmpl),
                    })
                  : EMPTY_VALUE
              }
              mono
            />
          </DetailList>
          {record.calculated_efficiency_kmpl != null && (
            <p className="mt-3 text-xs text-muted-foreground">{t('trips.efficiencyEstimate')}</p>
          )}
        </CardContent>
      </Card>

      {tripAnomalies.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-warning" aria-hidden />
              {t('anomalies.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tripAnomalies.map((anomaly) => (
              <EntityCard
                key={anomaly.id}
                to={`/alerts/${anomaly.id}`}
                title={t(`anomalies.kinds.${anomaly.kind}`)}
                subtitle={explain(anomalyToExplainable(anomaly))}
                meta={<AnomalyBadge severity={anomaly.severity} size="sm" />}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {(['TRIP_START', 'TRIP_END'] as const).map((kind) => {
        const section = kind === 'TRIP_START' ? start : end;
        if (!section.capture) return null;
        const url = signedUrls.get(section.capture.storage_path);

        return (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>
                {t(kind === 'TRIP_END' ? 'trips.endReading' : 'trips.startReading')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {url ? (
                <img
                  src={url}
                  alt={t('capture.title')}
                  className="max-h-56 w-full rounded-lg border border-border bg-black object-contain"
                />
              ) : (
                <div className="skeleton h-40 w-full rounded-lg" />
              )}

              <DetailList>
                {section.readings.map((reading) => (
                  <DetailRow
                    key={reading.id}
                    label={t(`ocr.fields.${reading.field}`)}
                    value={
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular">
                          {formatNumber(reading.final_value, { maximumFractionDigits: 1 })}
                        </span>
                        {reading.source === 'MANUAL' ? (
                          <span className="text-xs text-muted-foreground">
                            {t('attendance.methods.MANUAL_OVERRIDE')}
                          </span>
                        ) : reading.was_corrected ? (
                          <span className="text-xs font-semibold text-primary">
                            {t('ocr.corrected')}
                          </span>
                        ) : (
                          reading.confidence_band && (
                            <ConfidenceBadge band={reading.confidence_band} />
                          )
                        )}
                      </span>
                    }
                  />
                ))}
              </DetailList>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
