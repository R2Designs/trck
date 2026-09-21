import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Flag } from 'lucide-react';
import type { AnomalyEvaluation } from '@domain/anomaly-engine.ts';
import { FlowShell } from '@/components/layout/AppShell';
import { AnsweredStep, FlowSuccess, StepHeader, StepProgress } from '@/components/common/StepFlow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { AnomalyBadge } from '@/components/common/StatusBadge';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, NotFoundState } from '@/components/feedback/states';
import { DashboardScanner } from '@/components/camera/DashboardScanner';
import { OCRReview } from '@/components/camera/OCRReview';
import { useToast } from '@/components/ui/toast';
import { formatDistance } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import { useActiveDepot } from '@/features/auth/session';
import { useThresholds } from '@/features/settings/api';
import { useCommitCapture, useDashboardCapture } from './capture';
import { useCompleteTrip, useTrip } from './api';
import { useAnomalyExplanation } from '@/features/anomalies/explain';

/**
 * End a trip.
 *
 * One photograph, one review, one confirmation — and then, crucially, the
 * result is shown *here* rather than filed away silently. If the trip was
 * flagged, the manager finds out while still standing next to the bus, which
 * is the only moment they can actually check anything.
 */

type Stage =
  | { name: 'capture' }
  | { name: 'review' }
  | { name: 'manual' }
  | { name: 'override' }
  | { name: 'done'; evaluation: AnomalyEvaluation | null; distanceKm: number | null };

export default function EndTripFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tripId } = useParams<{ tripId: string }>();
  const { toast } = useToast();
  const depot = useActiveDepot();
  const { thresholds } = useThresholds();

  const [stage, setStage] = useState<Stage>({ name: 'capture' });
  const [manual, setManual] = useState({ odometer: '', range: '', fuel: '', refuel: '' });
  const [overrideReason, setOverrideReason] = useState('');

  const trip = useTrip(tripId);
  const complete = useCompleteTrip();
  const commit = useCommitCapture();

  const capture = useDashboardCapture({
    busId: trip.data?.bus_id ?? '',
    dashboardType: trip.data?.bus?.dashboard_type ?? 'UNKNOWN',
    previousOdometerKm: trip.data?.start_odometer_km ?? null,
    isElectric: trip.data?.bus?.fuel_type === 'ELECTRIC',
    thresholds,
  });

  const close = () => navigate(tripId ? `/trips/${tripId}` : '/trips');
  const goBack = () => {
    switch (stage.name) {
      case 'capture':
      case 'done':
        close();
        break;
      case 'review':
      case 'manual':
      case 'override':
        capture.reset();
        setStage({ name: 'capture' });
        break;
    }
  };

  const finish = async (params: {
    odometer: number | null;
    range: number | null;
    fuel: number | null;
    refuel: number | null;
    captureId: string | null;
    override?: boolean;
    overrideReason?: string;
  }) => {
    if (!tripId) return;
    try {
      const result = await complete.mutateAsync({
        tripId,
        endOdometerKm: params.odometer,
        endRangeKm: params.range,
        endFuelPercent: params.fuel,
        refuelLitres: params.refuel,
        captureId: params.captureId,
        override: params.override ?? false,
        overrideReason: params.overrideReason ?? null,
      });
      setStage({
        name: 'done',
        evaluation: result.evaluation,
        distanceKm: result.trip.calculated_distance_km,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  };

  const confirmCapture = async () => {
    if (!capture.draft || !trip.data || !depot) return;
    try {
      const result = await commit.mutateAsync({
        draft: capture.draft,
        busId: trip.data.bus_id,
        depotId: depot.id,
        kind: 'TRIP_END',
        tripId,
        thresholds,
      });
      await finish({
        odometer: result.odometerKm,
        range: result.rangeKm,
        fuel: result.fuelPercent,
        refuel: null,
        captureId: result.captureId,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  };

  if (trip.isLoading) {
    return (
      <FlowShell title={t('trips.endTitle')} onClose={close}>
        <SkeletonList count={3} />
      </FlowShell>
    );
  }
  if (trip.isError) {
    return (
      <FlowShell title={t('trips.endTitle')} onClose={close}>
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      </FlowShell>
    );
  }
  if (!trip.data) {
    return (
      <FlowShell title={t('trips.endTitle')} onClose={close}>
        <NotFoundState />
      </FlowShell>
    );
  }
  if (trip.data.status !== 'STARTED') {
    return (
      <FlowShell title={t('trips.endTitle')} onClose={close}>
        <EmptyState title={t('errors.tripNotInProgress')} description={t('trips.noActiveTrips')} />
      </FlowShell>
    );
  }

  const record = trip.data;

  return (
    <FlowShell
      title={t('trips.endTitle')}
      subtitle={record.bus?.registration_number}
      onClose={goBack}
    >
      {stage.name !== 'done' && (
        <>
          <StepProgress current={stage.name === 'capture' ? 1 : 2} total={2} />
          <div className="mb-4 space-y-2">
            <AnsweredStep
              label={t('trips.busLabel')}
              value={record.bus?.registration_number ?? ''}
            />
            <AnsweredStep label={t('trips.routeLabel')} value={record.route?.name ?? ''} />
            <AnsweredStep
              label={t('trips.startOdometer')}
              value={t('units.kmValue', { value: formatDistance(record.start_odometer_km) })}
            />
          </div>
        </>
      )}

      {stage.name === 'capture' && (
        <>
          <StepHeader
            current={1}
            total={2}
            prompt={t('trips.stepReading')}
            hint={t('trips.endSubtitle')}
          />
          <DashboardScanner
            kind="TRIP_END"
            processing={capture.processing}
            progress={capture.progress}
            error={capture.error}
            onCapture={async (blob) => {
              await capture.process(blob, 'TRIP_END');
              setStage({ name: 'review' });
            }}
            onManualEntry={() => setStage({ name: 'manual' })}
          />
          <Button
            variant="ghost"
            size="lg"
            block
            className="mt-3"
            onClick={() => setStage({ name: 'override' })}
          >
            {t('trips.overrideTitle')}
          </Button>
        </>
      )}

      {stage.name === 'review' && capture.draft && (
        <OCRReview
          draft={capture.draft}
          analogue={record.bus?.dashboard_type === 'ANALOG'}
          onChange={capture.updateReading}
          onRetake={() => {
            capture.reset();
            setStage({ name: 'capture' });
          }}
          onConfirm={() => void confirmCapture()}
          confirming={commit.isPending || complete.isPending}
        />
      )}

      {stage.name === 'manual' && (
        <div className="space-y-4">
          <StepHeader
            current={2}
            total={2}
            prompt={t('trips.stepConfirm')}
            hint={t('capture.failedBody')}
          />
          <Card>
            <CardContent className="space-y-4 pt-4">
              <Field
                label={t('trips.endOdometer')}
                required
                requiredLabel={t('a11y.requiredField')}
                error={
                  manual.odometer &&
                  record.start_odometer_km != null &&
                  Number.parseFloat(manual.odometer) < record.start_odometer_km
                    ? t('validation.endOdometerBelowStart')
                    : undefined
                }
              >
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    inputMode="decimal"
                    className="tabular text-lg"
                    value={manual.odometer}
                    onChange={(event) => setManual((m) => ({ ...m, odometer: event.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('trips.endRange')}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    inputMode="decimal"
                    className="tabular"
                    value={manual.range}
                    onChange={(event) => setManual((m) => ({ ...m, range: event.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('trips.endFuel')}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    inputMode="decimal"
                    className="tabular"
                    value={manual.fuel}
                    onChange={(event) => setManual((m) => ({ ...m, fuel: event.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('trips.refuelLitres')} hint={t('trips.refuelHint')}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    inputMode="decimal"
                    className="tabular"
                    value={manual.refuel}
                    onChange={(event) => setManual((m) => ({ ...m, refuel: event.target.value }))}
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <div className="sticky-cta flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setStage({ name: 'capture' })}>
              {t('actions.back')}
            </Button>
            <Button
              size="lg"
              className="flex-1"
              loading={complete.isPending}
              disabled={
                manual.odometer.trim() === '' ||
                (record.start_odometer_km != null &&
                  Number.parseFloat(manual.odometer) < record.start_odometer_km)
              }
              onClick={() =>
                void finish({
                  odometer: Number.parseFloat(manual.odometer.replace(',', '.')),
                  range: manual.range ? Number.parseFloat(manual.range.replace(',', '.')) : null,
                  fuel: manual.fuel ? Number.parseFloat(manual.fuel.replace(',', '.')) : null,
                  refuel: manual.refuel ? Number.parseFloat(manual.refuel.replace(',', '.')) : null,
                  captureId: null,
                })
              }
            >
              {t('actions.done')}
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'override' && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-warning/40 bg-warning-muted p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div>
                <h2 className="text-base font-bold">{t('trips.overrideTitle')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('trips.overrideBody')}</p>
              </div>
            </div>
          </div>

          <Field label={t('trips.overrideReason')} required requiredLabel={t('a11y.requiredField')}>
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                rows={3}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
              />
            )}
          </Field>

          <div className="space-y-2">
            <Button
              size="lg"
              block
              variant="destructive"
              loading={complete.isPending}
              disabled={overrideReason.trim().length < 5}
              onClick={() =>
                void finish({
                  odometer: null,
                  range: null,
                  fuel: null,
                  refuel: null,
                  captureId: null,
                  override: true,
                  overrideReason: overrideReason.trim(),
                })
              }
            >
              {t('actions.confirm')}
            </Button>
            <Button variant="ghost" size="lg" block onClick={() => setStage({ name: 'capture' })}>
              {t('actions.cancel')}
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'done' && (
        <TripCompleted
          evaluation={stage.evaluation}
          distanceKm={stage.distanceKm}
          onClose={close}
          tripId={tripId as string}
        />
      )}
    </FlowShell>
  );
}

function TripCompleted({
  evaluation,
  distanceKm,
  onClose,
  tripId,
}: {
  evaluation: AnomalyEvaluation | null;
  distanceKm: number | null;
  onClose: () => void;
  tripId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const explain = useAnomalyExplanation();
  const flagged = (evaluation?.findings ?? []).filter((finding) => finding.severity !== 'LOW');

  if (flagged.length === 0) {
    return (
      <FlowSuccess
        icon={<CheckCircle2 className="size-8" aria-hidden />}
        title={t('trips.completed', {
          distance: t('units.kmValue', { value: formatDistance(distanceKm) }),
        })}
      >
        <Button size="lg" block onClick={onClose}>
          {t('actions.done')}
        </Button>
      </FlowSuccess>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-4 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-warning text-warning-foreground">
          <Flag className="size-8" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold leading-snug">{t('trips.completedWithReview')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('trips.completed', {
            distance: t('units.kmValue', { value: formatDistance(distanceKm) }),
          })}
        </p>
      </div>

      <ul className="space-y-3">
        {flagged.map((finding) => (
          <li key={finding.ruleCode}>
            <Card className="border-warning/40">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold">{t(`anomalies.kinds.${finding.kind}`)}</h3>
                  <AnomalyBadge severity={finding.severity} size="sm" />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{explain(finding)}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">{t('anomalies.severityHint')}</p>

      <div className="space-y-2">
        <Button size="lg" block onClick={() => navigate(`/trips/${tripId}`)}>
          {t('actions.viewDetails')}
        </Button>
        <Button variant="outline" size="lg" block onClick={onClose}>
          {t('actions.done')}
        </Button>
      </div>
    </div>
  );
}
