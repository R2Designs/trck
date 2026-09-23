import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bus as BusIcon, Play, Route as RouteIcon } from 'lucide-react';
import { FlowShell } from '@/components/layout/AppShell';
import {
  AnsweredStep,
  Choice,
  ChoiceList,
  FlowSuccess,
  StepHeader,
  StepProgress,
} from '@/components/common/StepFlow';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { BusStatusBadge } from '@/components/common/StatusBadge';
import { DashboardScanner } from '@/components/camera/DashboardScanner';
import { OCRReview } from '@/components/camera/OCRReview';
import { useToast } from '@/components/ui/toast';
import { formatDistance } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import { useActiveDepot } from '@/features/auth/session';
import { useBuses, useEmployees, useRoutes, useAssignedDrivers } from '@/features/fleet/api';
import { useThresholds } from '@/features/settings/api';
import { useCommitCapture, useDashboardCapture } from './capture';
import { useStartTrip } from './api';

/**
 * Start a trip.
 *
 * Bus → route → driver → dashboard photo. The photo step is where most of the
 * value is: a trip whose start odometer was typed from memory cannot be
 * checked afterwards, so the camera is the default and typing is the fallback.
 */

type Stage =
  | { name: 'bus' }
  | { name: 'route' }
  | { name: 'driver' }
  | { name: 'capture' }
  | { name: 'review' }
  | { name: 'manual' }
  | { name: 'done'; busLabel: string; routeLabel: string };

const TOTAL_STEPS = 4;

export default function StartTripFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const depot = useActiveDepot();
  const { thresholds } = useThresholds();

  const [stage, setStage] = useState<Stage>({ name: 'bus' });
  const [busId, setBusId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [manual, setManual] = useState({ odometer: '', range: '', fuel: '' });

  const buses = useBuses({ depotId: depot?.id ?? null });
  const routes = useRoutes({ depotId: depot?.id ?? null });
  const drivers = useEmployees({ depotId: depot?.id ?? null, type: 'DRIVER', status: 'ACTIVE' });
  const assigned = useAssignedDrivers({ depotId: depot?.id ?? null, routeId, busId });

  const selectedBus = buses.data?.find((bus) => bus.id === busId);
  const selectedRoute = routes.data?.find((route) => route.id === routeId);
  const selectedDriver = drivers.data?.find((driver) => driver.id === driverId);

  const capture = useDashboardCapture({
    busId: busId ?? '',
    dashboardType: selectedBus?.dashboard_type ?? 'UNKNOWN',
    previousOdometerKm: selectedBus?.current_odometer_km ?? null,
    isElectric: selectedBus?.fuel_type === 'ELECTRIC',
    thresholds,
  });
  const commit = useCommitCapture();
  const startTrip = useStartTrip();

  // Drivers scheduled on this bus or route float to the top of the list.
  const orderedDrivers = useMemo(() => {
    const scheduled = new Set((assigned.data ?? []).map((row) => row.employee_id));
    return [...(drivers.data ?? [])].sort((a, b) => {
      const rank = Number(scheduled.has(b.id)) - Number(scheduled.has(a.id));
      return rank !== 0 ? rank : a.full_name.localeCompare(b.full_name);
    });
  }, [assigned.data, drivers.data]);

  const scheduledIds = useMemo(
    () => new Set((assigned.data ?? []).map((row) => row.employee_id)),
    [assigned.data],
  );

  const close = () => navigate('/trips');
  const goBack = () => {
    switch (stage.name) {
      case 'bus':
      case 'done':
        close();
        break;
      case 'route':
        setStage({ name: 'bus' });
        break;
      case 'driver':
        setStage({ name: 'route' });
        break;
      case 'capture':
        setStage({ name: 'driver' });
        break;
      case 'review':
      case 'manual':
        capture.reset();
        setStage({ name: 'capture' });
        break;
    }
  };

  const begin = async (readings: {
    odometer: number;
    range: number | null;
    fuel: number | null;
    captureId: string | null;
  }) => {
    if (!busId || !routeId || !depot) return;
    try {
      await startTrip.mutateAsync({
        busId,
        routeId,
        driverId,
        startOdometerKm: readings.odometer,
        startRangeKm: readings.range,
        startFuelPercent: readings.fuel,
        captureId: readings.captureId,
      });
      setStage({
        name: 'done',
        busLabel: selectedBus?.registration_number ?? '',
        routeLabel: selectedRoute?.name ?? '',
      });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  };

  const confirmCapture = async () => {
    if (!capture.draft || !busId || !depot) return;
    try {
      const result = await commit.mutateAsync({
        draft: capture.draft,
        busId,
        depotId: depot.id,
        kind: 'TRIP_START',
        thresholds,
      });
      await begin({
        odometer: result.odometerKm as number,
        range: result.rangeKm,
        fuel: result.fuelPercent,
        captureId: result.captureId,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  };

  if (!depot) {
    return (
      <FlowShell title={t('trips.startTitle')} onClose={close}>
        <EmptyState title={t('home.noDepotTitle')} description={t('home.noDepotBody')} />
      </FlowShell>
    );
  }

  const step =
    stage.name === 'bus' ? 1 : stage.name === 'route' ? 2 : stage.name === 'driver' ? 3 : 4;

  return (
    <FlowShell title={t('trips.startTitle')} subtitle={depot.name} onClose={goBack}>
      {stage.name !== 'done' && (
        <>
          <StepProgress current={step} total={TOTAL_STEPS} />
          <div className="mb-4 space-y-2">
            {selectedBus && stage.name !== 'bus' && (
              <AnsweredStep
                label={t('trips.busLabel')}
                value={selectedBus.registration_number}
                onEdit={() => setStage({ name: 'bus' })}
              />
            )}
            {selectedRoute && !['bus', 'route'].includes(stage.name) && (
              <AnsweredStep
                label={t('trips.routeLabel')}
                value={selectedRoute.name}
                onEdit={() => setStage({ name: 'route' })}
              />
            )}
            {selectedDriver && ['capture', 'review', 'manual'].includes(stage.name) && (
              <AnsweredStep
                label={t('trips.driverLabel')}
                value={selectedDriver.full_name}
                onEdit={() => setStage({ name: 'driver' })}
              />
            )}
          </div>
        </>
      )}

      {stage.name === 'bus' && (
        <>
          <StepHeader current={1} total={TOTAL_STEPS} prompt={t('trips.stepBus')} />
          {buses.isLoading && <SkeletonList count={4} />}
          {buses.isError && <ErrorState error={buses.error} onRetry={() => void buses.refetch()} />}
          {!buses.isLoading && (buses.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={BusIcon}
              title={t('empty.buses')}
              description={t('empty.busesBody')}
            />
          )}
          <ChoiceList>
            {buses.data?.map((bus) => (
              <Choice
                key={bus.id}
                title={bus.registration_number}
                subtitle={t('units.kmValue', { value: formatDistance(bus.current_odometer_km, 0) })}
                meta={<BusStatusBadge status={bus.status} />}
                disabled={bus.status === 'ON_TRIP' || bus.status === 'OUT_OF_SERVICE'}
                disabledReason={
                  bus.status === 'ON_TRIP'
                    ? t('errors.busAlreadyOnTrip')
                    : t('errors.busOutOfService')
                }
                onSelect={() => {
                  setBusId(bus.id);
                  setStage({ name: 'route' });
                }}
              />
            ))}
          </ChoiceList>
        </>
      )}

      {stage.name === 'route' && (
        <>
          <StepHeader current={2} total={TOTAL_STEPS} prompt={t('trips.stepRoute')} />
          {routes.isLoading && <SkeletonList count={4} />}
          <ChoiceList>
            {routes.data?.map((route) => (
              <Choice
                key={route.id}
                title={route.name}
                subtitle={`${route.origin} → ${route.destination}`}
                meta={
                  <span className="tabular text-xs text-muted-foreground">
                    {t('units.kmValue', { value: formatDistance(route.expected_distance_km) })}
                  </span>
                }
                onSelect={() => {
                  setRouteId(route.id);
                  setStage({ name: 'driver' });
                }}
              />
            ))}
          </ChoiceList>
          {!routes.isLoading && (routes.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('empty.routes')}
              description={t('empty.routesBody')}
            />
          )}
        </>
      )}

      {stage.name === 'driver' && (
        <>
          <StepHeader current={3} total={TOTAL_STEPS} prompt={t('trips.stepDriver')} />
          <ChoiceList>
            {orderedDrivers.map((driver) => (
              <Choice
                key={driver.id}
                title={driver.full_name}
                subtitle={driver.employee_code}
                meta={
                  scheduledIds.has(driver.id) ? (
                    <span className="rounded-full bg-primary-muted px-2 py-0.5 text-xs font-semibold text-primary">
                      {t('attendance.scheduledDriver')}
                    </span>
                  ) : undefined
                }
                onSelect={() => {
                  setDriverId(driver.id);
                  setStage({ name: 'capture' });
                }}
              />
            ))}
          </ChoiceList>
          <Button
            variant="ghost"
            size="lg"
            block
            className="mt-3"
            onClick={() => {
              setDriverId(null);
              setStage({ name: 'capture' });
            }}
          >
            {t('common.notRecorded')}
          </Button>
        </>
      )}

      {stage.name === 'capture' && (
        <>
          <StepHeader current={4} total={TOTAL_STEPS} prompt={t('trips.stepReading')} />
          <DashboardScanner
            kind="TRIP_START"
            processing={capture.processing}
            progress={capture.progress}
            error={capture.error}
            onCapture={async (blob) => {
              await capture.process(blob, 'TRIP_START');
              setStage({ name: 'review' });
            }}
            onManualEntry={() => setStage({ name: 'manual' })}
          />
        </>
      )}

      {stage.name === 'review' && capture.draft && (
        <OCRReview
          draft={capture.draft}
          analogue={selectedBus?.dashboard_type === 'ANALOG'}
          onChange={capture.updateReading}
          onRetake={() => {
            capture.reset();
            setStage({ name: 'capture' });
          }}
          onConfirm={() => void confirmCapture()}
          confirming={commit.isPending || startTrip.isPending}
          minimumOdometerKm={selectedBus?.current_odometer_km}
        />
      )}

      {stage.name === 'manual' && (
        <div className="space-y-4">
          <StepHeader
            current={4}
            total={TOTAL_STEPS}
            prompt={t('trips.stepReading')}
            hint={t('capture.failedBody')}
          />
          <Card>
            <CardContent className="space-y-4 pt-4">
              <Field
                label={t('trips.startOdometer')}
                required
                requiredLabel={t('a11y.requiredField')}
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
              <Field label={t('trips.startRange')}>
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
              <Field label={t('trips.startFuel')}>
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
            </CardContent>
          </Card>

          <div className="sticky-cta flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setStage({ name: 'capture' })}>
              {t('actions.back')}
            </Button>
            <Button
              size="lg"
              className="flex-1"
              loading={startTrip.isPending}
              disabled={manual.odometer.trim() === ''}
              onClick={() =>
                void begin({
                  odometer: Number.parseFloat(manual.odometer.replace(',', '.')),
                  range: manual.range ? Number.parseFloat(manual.range.replace(',', '.')) : null,
                  fuel: manual.fuel ? Number.parseFloat(manual.fuel.replace(',', '.')) : null,
                  captureId: null,
                })
              }
            >
              <Play className="size-5" aria-hidden />
              {t('home.startTrip')}
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'done' && (
        <FlowSuccess
          icon={<Play className="size-8" aria-hidden />}
          title={t('trips.started', { bus: stage.busLabel, route: stage.routeLabel })}
        >
          <div className="space-y-2">
            <Button size="lg" block onClick={close}>
              {t('actions.done')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              block
              onClick={() => {
                setBusId(null);
                setRouteId(null);
                setDriverId(null);
                capture.reset();
                setStage({ name: 'bus' });
              }}
            >
              {t('home.startTrip')}
            </Button>
          </div>
        </FlowSuccess>
      )}
    </FlowShell>
  );
}
