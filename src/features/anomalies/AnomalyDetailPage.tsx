import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Image as ImageIcon, Search, TriangleAlert, XCircle } from 'lucide-react';
import type { AnomalyReviewStatus } from '@domain/types.ts';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { AnomalyBadge, ConfidenceBadge, ReviewStatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState, NotFoundState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { EMPTY_VALUE, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { anomalyReviewSchema } from '@/lib/validation';
import type { AnomalyReviewFormValues } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { getStorageProvider } from '@/providers/storage';
import { useAuth } from '@/features/auth/session';
import { useTrip, useTripCaptures } from '@/features/trips/api';
import { useAnomaly, useAnomalyReviews, useReviewAnomaly } from './api';
import { anomalyToExplainable, useAnomalyExplanation, useAnomalyReasons } from './explain';

/**
 * Investigating one anomaly.
 *
 * This screen exists to let a human disagree with the system. It lays out the
 * measurement, what is usual for this bus, the photographs the readings came
 * from, and which values a manager corrected — and then asks for a conclusion
 * and a note. The note is mandatory for every outcome except "in review",
 * because an audit trail of bare verdicts is not an audit trail.
 */

const OUTCOMES: Array<{
  value: Exclude<AnomalyReviewStatus, 'OPEN' | 'IN_REVIEW'>;
  labelKey: string;
  icon: typeof CheckCircle2;
  tone: 'success' | 'destructive' | 'secondary';
}> = [
  {
    value: 'REVIEWED_OK',
    labelKey: 'anomalies.review.markReviewed',
    icon: CheckCircle2,
    tone: 'success',
  },
  {
    value: 'NEEDS_INVESTIGATION',
    labelKey: 'anomalies.review.needsInvestigation',
    icon: Search,
    tone: 'destructive',
  },
  {
    value: 'FALSE_POSITIVE',
    labelKey: 'anomalies.review.falsePositive',
    icon: XCircle,
    tone: 'secondary',
  },
  {
    value: 'READING_ERROR',
    labelKey: 'anomalies.review.readingError',
    icon: TriangleAlert,
    tone: 'secondary',
  },
];

export default function AnomalyDetailPage() {
  const { t } = useTranslation();
  const { anomalyId } = useParams<{ anomalyId: string }>();
  const { can } = useAuth();
  const { toast } = useToast();
  const explain = useAnomalyExplanation();
  const reasonsOf = useAnomalyReasons();

  const anomaly = useAnomaly(anomalyId);
  const reviews = useAnomalyReviews(anomalyId);
  const trip = useTrip(anomaly.data?.trip_id ?? undefined);
  const captures = useTripCaptures(anomaly.data?.trip_id ?? undefined);
  const review = useReviewAnomaly();

  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [outcome, setOutcome] = useState<AnomalyReviewFormValues['new_status'] | null>(null);

  const form = useForm<AnomalyReviewFormValues>({
    resolver: zodResolver(anomalyReviewSchema),
    defaultValues: { new_status: 'REVIEWED_OK', notes: '' },
  });

  // Dashboard photographs live in a private bucket; URLs are signed on demand
  // and expire, so they are fetched here rather than stored anywhere.
  useEffect(() => {
    const paths = (captures.data?.captures ?? []).map((capture) => capture.storage_path);
    if (paths.length === 0) return;
    let cancelled = false;

    void getStorageProvider()
      .getSignedUrls('dashboards', paths, 300)
      .then((urls) => {
        if (cancelled) return;
        setSignedUrls(new Map([...urls].map(([path, signed]) => [path, signed.url])));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [captures.data]);

  if (anomaly.isLoading) return <SkeletonList count={4} />;
  if (anomaly.isError)
    return <ErrorState error={anomaly.error} onRetry={() => void anomaly.refetch()} />;
  if (!anomaly.data) return <NotFoundState />;

  const record = anomaly.data;
  const explainable = anomalyToExplainable(record);
  const reasons = reasonsOf(explainable);
  const isOpen = ['OPEN', 'IN_REVIEW', 'NEEDS_INVESTIGATION'].includes(record.review_status);
  const snapshot = (record.threshold_snapshot ?? {}) as Record<string, unknown>;
  const corrected = (captures.data?.readings ?? []).filter((reading) => reading.was_corrected);

  const submit = form.handleSubmit(async (values) => {
    try {
      await review.mutateAsync({
        anomaly: record,
        newStatus: values.new_status,
        notes: values.notes,
      });
      toast({ tone: 'success', title: t('anomalies.review.saved') });
      setOutcome(null);
      form.reset({ new_status: 'REVIEWED_OK', notes: '' });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t(`anomalies.kinds.${record.kind}`)}
        description={t('anomalies.details.detectedAt', {
          time: formatDateTime(record.detected_at),
        })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <AnomalyBadge severity={record.severity} />
        <ReviewStatusBadge status={record.review_status} />
        {record.bus && (
          <Link
            to={`/fleet/buses/${record.bus.id}`}
            className="rounded text-xs font-semibold text-primary hover:underline"
          >
            {record.bus.registration_number}
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('anomalies.details.whyFlagged')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{explain(explainable)}</p>

          <DetailList>
            <DetailRow
              label={t('anomalies.details.observed')}
              value={`${formatNumber(record.observed_value, { maximumFractionDigits: 2 })} ${record.unit ?? ''}`.trim()}
              mono
            />
            <DetailRow
              label={t('anomalies.details.expected')}
              value={`${formatNumber(record.expected_value, { maximumFractionDigits: 2 })} ${record.unit ?? ''}`.trim()}
              mono
            />
            <DetailRow
              label={t('anomalies.details.variance')}
              value={formatPercent(record.variance_pct, { signed: true })}
              mono
            />
            {typeof snapshot.sample_size === 'number' && (
              <DetailRow
                label={t('anomalies.details.baseline')}
                value={t('anomalies.details.baselineSample', { count: snapshot.sample_size })}
              />
            )}
          </DetailList>

          {reasons.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{t('anomalies.possibleReasons')}</h3>
              <ul className="mt-2 space-y-1">
                {reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                      aria-hidden
                    />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {trip.data && (
        <Card>
          <CardHeader>
            <CardTitle>{t('trips.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailRow
                label={t('trips.routeLabel')}
                value={trip.data.route?.name ?? EMPTY_VALUE}
              />
              <DetailRow
                label={t('trips.driverLabel')}
                value={trip.data.driver?.full_name ?? EMPTY_VALUE}
              />
              <DetailRow
                label={t('trips.startOdometer')}
                value={formatNumber(trip.data.start_odometer_km, { maximumFractionDigits: 1 })}
                mono
              />
              <DetailRow
                label={t('trips.endOdometer')}
                value={formatNumber(trip.data.end_odometer_km, { maximumFractionDigits: 1 })}
                mono
              />
              <DetailRow
                label={t('trips.startRange')}
                value={formatNumber(trip.data.start_range_km, { maximumFractionDigits: 0 })}
                mono
              />
              <DetailRow
                label={t('trips.endRange')}
                value={formatNumber(trip.data.end_range_km, { maximumFractionDigits: 0 })}
                mono
              />
            </DetailList>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to={`/trips/${trip.data.id}`}>{t('actions.viewDetails')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {(captures.data?.captures.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
              {t('anomalies.details.photos')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {captures.data?.captures.map((capture) => {
              const url = signedUrls.get(capture.storage_path);
              return (
                <figure
                  key={capture.id}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={t(
                        capture.kind === 'TRIP_END' ? 'trips.endReading' : 'trips.startReading',
                      )}
                      className="aspect-video w-full bg-black object-contain"
                    />
                  ) : (
                    <div className="skeleton aspect-video w-full" />
                  )}
                  <figcaption className="px-3 py-2 text-xs text-muted-foreground">
                    {t(capture.kind === 'TRIP_END' ? 'trips.endReading' : 'trips.startReading')} ·{' '}
                    {formatDateTime(capture.captured_at)}
                  </figcaption>
                </figure>
              );
            })}
          </CardContent>
        </Card>
      )}

      {corrected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('anomalies.details.corrections')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              {corrected.map((reading) => (
                <DetailRow
                  key={reading.id}
                  label={t(`ocr.fields.${reading.field}`)}
                  value={
                    <span className="inline-flex items-center gap-2">
                      <span className="tabular text-muted-foreground line-through">
                        {formatNumber(reading.ocr_value, { maximumFractionDigits: 1 })}
                      </span>
                      <span className="tabular">
                        {formatNumber(reading.final_value, { maximumFractionDigits: 1 })}
                      </span>
                      {reading.confidence_band && (
                        <ConfidenceBadge band={reading.confidence_band} />
                      )}
                    </span>
                  }
                />
              ))}
            </DetailList>
          </CardContent>
        </Card>
      )}

      {can('anomaly.review') && isOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{t('anomalies.review.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {OUTCOMES.map((option) => {
                  const Icon = option.icon;
                  const selected = outcome === option.value;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? 'primary' : 'outline'}
                      size="lg"
                      className="justify-start"
                      onClick={() => {
                        setOutcome(option.value);
                        form.setValue('new_status', option.value);
                      }}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="truncate">{t(option.labelKey)}</span>
                    </Button>
                  );
                })}
              </div>

              <Field
                label={t('anomalies.review.notes')}
                hint={t('anomalies.review.notesHint')}
                error={
                  form.formState.errors.notes
                    ? t(form.formState.errors.notes.message as string)
                    : undefined
                }
                required
                requiredLabel={t('a11y.requiredField')}
              >
                {(fieldProps) => (
                  <Textarea
                    {...fieldProps}
                    rows={4}
                    {...form.register('notes')}
                    invalid={Boolean(form.formState.errors.notes)}
                  />
                )}
              </Field>

              <Button type="submit" size="lg" block disabled={!outcome} loading={review.isPending}>
                {t('anomalies.review.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {(reviews.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('anomalies.review.history')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviews.data?.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <ReviewStatusBadge status={entry.new_status} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.reviewed_at)}
                  </span>
                </div>
                {entry.notes && <p className="mt-2 text-sm">{entry.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
