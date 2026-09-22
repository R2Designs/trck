import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bus as BusIcon,
  CheckCircle2,
  Route as RouteIcon,
  UserSearch,
} from 'lucide-react';
import type { LivenessResult, OverrideReasonCode } from '@domain/types.ts';
import { OVERRIDE_REASON_CODES } from '@domain/types.ts';
import type { MatchResult } from '@domain/face-match.ts';
import { FlowShell } from '@/components/layout/AppShell';
import {
  AnsweredStep,
  Choice,
  ChoiceList,
  FlowSuccess,
  StepHeader,
} from '@/components/common/StepFlow';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { FaceScanner } from '@/components/camera/FaceScanner';
import type { ScanOutcome } from '@/components/camera/FaceScanner';
import { BusStatusBadge } from '@/components/common/StatusBadge';
import { useToast } from '@/components/ui/toast';
import { EMPTY_VALUE, formatConfidence, formatTime } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import { useActiveDepot } from '@/features/auth/session';
import { useBuses, useDriverAssignments, useEmployees, useRoutes } from '@/features/fleet/api';
import { useThresholds } from '@/features/settings/api';
import { useFaceCandidates, useRecordAttendance, useTodayAttendance } from './api';
import { trackEvent } from '@/providers/analytics';

/**
 * Take attendance.
 *
 * Scan first. The matched driver's saved route and bus are applied
 * automatically; route and bus pickers are only used when today's assignment
 * is different. Every failure state still has a direct manual fallback.
 */

type Stage =
  | { name: 'route' }
  | { name: 'bus' }
  | { name: 'scan' }
  | { name: 'match'; outcome: Extract<ScanOutcome, { kind: 'MATCH' }> }
  | { name: 'failure'; outcome: ScanOutcome }
  | { name: 'manual'; prefilledEmployeeId?: string }
  | { name: 'done'; employeeName: string; recordedAt: string };

export default function TakeAttendanceFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const depot = useActiveDepot();
  const { thresholds } = useThresholds();

  const [stage, setStage] = useState<Stage>({ name: 'scan' });
  const [returnStage, setReturnStage] = useState<Stage | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [busId, setBusId] = useState<string | null>(null);

  const routes = useRoutes({ depotId: depot?.id ?? null });
  const buses = useBuses({ depotId: depot?.id ?? null });
  const drivers = useEmployees({ depotId: depot?.id ?? null, type: 'DRIVER', status: 'ACTIVE' });
  const assignments = useDriverAssignments(depot?.id ?? null);
  const today = useTodayAttendance(depot?.id ?? null);
  const record = useRecordAttendance();

  const candidatesEnabled = stage.name === 'scan';
  const candidates = useFaceCandidates({
    depotId: depot?.id ?? null,
    routeId,
    busId,
    enabled: candidatesEnabled,
  });

  const selectedRoute = routes.data?.find((route) => route.id === routeId);
  const selectedBus = buses.data?.find((bus) => bus.id === busId);

  const alreadyPresent = useMemo(
    () => new Set((today.data ?? []).map((row) => row.employee_id)),
    [today.data],
  );

  const close = () => navigate('/attendance');
  const goBack = () => {
    switch (stage.name) {
      case 'route':
      case 'bus':
        if (returnStage) {
          setStage(returnStage);
          setReturnStage(null);
        } else {
          setStage({ name: 'scan' });
        }
        break;
      case 'scan':
      case 'done':
        close();
        break;
      case 'match':
      case 'failure':
      case 'manual':
        setStage({ name: 'scan' });
        break;
    }
  };

  const submit = async (params: {
    employeeId: string;
    employeeName: string;
    method: 'FACE_RECOGNITION' | 'MANUAL_OVERRIDE' | 'MANUAL_SEARCH';
    faceScore?: number | null;
    liveness?: LivenessResult;
    livenessScore?: number | null;
    provider?: string;
    modelVersion?: string;
    reasonCode?: OverrideReasonCode;
    reason?: string;
  }) => {
    if (!depot) return;
    const savedAssignment = assignments.data?.find(
      (assignment) => assignment.employee_id === params.employeeId,
    );
    const resolvedRouteId = routeId ?? savedAssignment?.route_id ?? null;
    const resolvedBusId = busId ?? savedAssignment?.bus_id ?? null;
    setRouteId(resolvedRouteId);
    setBusId(resolvedBusId);
    try {
      const saved = await record.mutateAsync({
        employeeId: params.employeeId,
        depotId: depot.id,
        routeId: resolvedRouteId,
        busId: resolvedBusId,
        method: params.method,
        faceScore: params.faceScore ?? null,
        faceThreshold: params.faceScore != null ? thresholds.faceReviewSimilarity : null,
        provider: params.provider ?? null,
        modelVersion: params.modelVersion ?? null,
        liveness: params.liveness ?? 'SKIPPED',
        livenessScore: params.livenessScore ?? null,
        overrideReasonCode: params.reasonCode ?? null,
        overrideReason: params.reason ?? null,
      });

      if (params.method === 'MANUAL_OVERRIDE') {
        trackEvent('attendance_manual_override', { reason_code: params.reasonCode ?? 'OTHER' });
      }
      setStage({ name: 'done', employeeName: params.employeeName, recordedAt: saved.recorded_at });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({
        tone: 'error',
        title: t(appError.messageKey, appError.messageParams),
        description:
          appError.kind === 'CONFLICT'
            ? t('attendance.alreadyRecordedBody', {
                name: params.employeeName,
                time: formatTime(new Date()),
              })
            : undefined,
      });
    }
  };

  const handleScan = (outcome: ScanOutcome) => {
    if (outcome.kind === 'MATCH') {
      const employeeId = outcome.match.best?.employeeId;
      const savedAssignment = assignments.data?.find(
        (assignment) => assignment.employee_id === employeeId,
      );
      setRouteId(savedAssignment?.route_id ?? null);
      setBusId(savedAssignment?.bus_id ?? null);
      trackEvent('attendance_scan_success', {
        decision: outcome.match.decision === 'AUTO_ACCEPT' ? 'AUTO_ACCEPT' : 'REVIEW',
        similarity_band: outcome.match.decision === 'AUTO_ACCEPT' ? 'high' : 'medium',
        candidate_count: candidates.data?.length ?? 0,
        duration_ms: outcome.durationMs,
      });
      setStage({ name: 'match', outcome });
      return;
    }

    const reason =
      outcome.kind === 'LOW_CONFIDENCE'
        ? 'LOW_CONFIDENCE'
        : outcome.kind === 'LIVENESS_FAILED'
          ? 'LIVENESS'
          : outcome.kind === 'MULTIPLE_FACES'
            ? 'MULTIPLE_FACES'
            : outcome.kind === 'NO_CANDIDATES'
              ? 'NO_CANDIDATES'
              : outcome.kind === 'QUALITY'
                ? 'QUALITY'
                : 'NO_FACE';
    trackEvent('attendance_scan_failed', {
      reason,
      duration_ms: 'durationMs' in outcome ? outcome.durationMs : 0,
    });
    setStage({ name: 'failure', outcome });
  };

  if (!depot) {
    return (
      <FlowShell title={t('attendance.title')} onClose={close}>
        <EmptyState title={t('home.noDepotTitle')} description={t('home.noDepotBody')} />
      </FlowShell>
    );
  }

  // --- Answered-so-far summary ---------------------------------------------
  const answered = (
    <div className="mb-4 space-y-2">
      {(selectedRoute || stage.name === 'match') && stage.name !== 'route' && (
        <AnsweredStep
          label={t('trips.routeLabel')}
          value={selectedRoute?.name ?? EMPTY_VALUE}
          onEdit={
            stage.name === 'scan' || stage.name === 'match'
              ? () => {
                  setReturnStage(stage);
                  setStage({ name: 'route' });
                }
              : undefined
          }
        />
      )}
      {(selectedBus || stage.name === 'match') &&
        stage.name !== 'route' &&
        stage.name !== 'bus' && (
        <AnsweredStep
          label={t('trips.busLabel')}
          value={selectedBus?.registration_number ?? EMPTY_VALUE}
          onEdit={
            stage.name === 'scan' || stage.name === 'match'
              ? () => {
                  setReturnStage(stage);
                  setStage({ name: 'bus' });
                }
              : undefined
          }
        />
      )}
    </div>
  );

  return (
    <FlowShell title={t('attendance.title')} subtitle={depot.name} onClose={goBack}>
      {stage.name !== 'done' && answered}

      {/* --- Step 1: route --------------------------------------------- */}
      {stage.name === 'route' && (
        <>
          <StepHeader
            prompt={t('attendance.stepRoute')}
            hint={t('attendance.stepRouteHint')}
          />
          {routes.isLoading && <SkeletonList count={4} />}
          {routes.isError && (
            <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />
          )}
          {!routes.isLoading && (routes.data?.length ?? 0) === 0 && (
            <EmptyState
              icon={RouteIcon}
              title={t('empty.routes')}
              description={t('empty.routesBody')}
            />
          )}
          <ChoiceList>
            {routes.data?.map((route) => (
              <Choice
                key={route.id}
                title={route.name}
                subtitle={`${route.origin} → ${route.destination}`}
                selected={route.id === routeId}
                onSelect={() => {
                  setRouteId(route.id);
                  setStage(returnStage ?? { name: 'scan' });
                  setReturnStage(null);
                }}
              />
            ))}
          </ChoiceList>
        </>
      )}

      {/* --- Step 2: bus ----------------------------------------------- */}
      {stage.name === 'bus' && (
        <>
          <StepHeader
            prompt={t('attendance.stepBus')}
            hint={t('attendance.stepBusHint', { depot: depot.name })}
          />
          {buses.isLoading && <SkeletonList count={4} />}
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
                subtitle={[bus.fleet_number, bus.model].filter(Boolean).join(' · ')}
                meta={<BusStatusBadge status={bus.status} />}
                selected={bus.id === busId}
                disabled={bus.status === 'OUT_OF_SERVICE'}
                disabledReason={t('errors.busOutOfService')}
                onSelect={() => {
                  setBusId(bus.id);
                  setStage(returnStage ?? { name: 'scan' });
                  setReturnStage(null);
                }}
              />
            ))}
          </ChoiceList>
        </>
      )}

      {/* --- Step 3: scan ---------------------------------------------- */}
      {stage.name === 'scan' && (
        <>
          <StepHeader prompt={t('attendance.stepScan')} />

          {candidates.isLoading ? (
            <SkeletonList count={2} />
          ) : candidates.isError ? (
            <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />
          ) : (candidates.data?.length ?? 0) === 0 ? (
            <ScanFailure
              outcome={{ kind: 'NO_CANDIDATES' }}
              onRescan={() => void candidates.refetch()}
              onManual={() => setStage({ name: 'manual' })}
            />
          ) : (
            <FaceScanner
              candidates={candidates.data ?? []}
              thresholds={thresholds}
              onResult={handleScan}
              onFallback={() => setStage({ name: 'manual' })}
              fallbackLabel={t('attendance.searchManually')}
            />
          )}
        </>
      )}

      {/* --- Match found ------------------------------------------------ */}
      {stage.name === 'match' && (
        <MatchConfirmation
          match={stage.outcome.match}
          liveness={stage.outcome.liveness}
          alreadyPresent={alreadyPresent}
          busLabel={selectedBus?.registration_number ?? ''}
          routeLabel={selectedRoute?.name ?? ''}
          saving={record.isPending}
          onConfirm={(employeeId, employeeName, score) =>
            void submit({
              employeeId,
              employeeName,
              method: 'FACE_RECOGNITION',
              faceScore: score,
              liveness: stage.outcome.liveness,
              livenessScore: stage.outcome.livenessScore,
              provider: 'face',
              modelVersion: 'current',
            })
          }
          onRescan={() => setStage({ name: 'scan' })}
          onManual={() => setStage({ name: 'manual' })}
        />
      )}

      {/* --- Scan failure ----------------------------------------------- */}
      {stage.name === 'failure' && (
        <ScanFailure
          outcome={stage.outcome}
          onRescan={() => setStage({ name: 'scan' })}
          onManual={() => setStage({ name: 'manual' })}
        />
      )}

      {/* --- Manual fallback -------------------------------------------- */}
      {stage.name === 'manual' && (
        <ManualAttendance
          drivers={drivers.data ?? []}
          alreadyPresent={alreadyPresent}
          saving={record.isPending}
          onCancel={() => setStage({ name: 'scan' })}
          onSubmit={(employeeId, employeeName, reasonCode, reason) =>
            void submit({
              employeeId,
              employeeName,
              method: 'MANUAL_OVERRIDE',
              reasonCode,
              reason,
            })
          }
        />
      )}

      {/* --- Done -------------------------------------------------------- */}
      {stage.name === 'done' && (
        <FlowSuccess
          title={t('attendance.markedTitle', { name: stage.employeeName })}
          description={t('attendance.markedSubtitle', {
            time: formatTime(stage.recordedAt),
            bus: selectedBus?.registration_number ?? '',
            route: selectedRoute?.name ?? '',
          })}
        >
          <div className="space-y-2">
            <Button
              size="lg"
              block
              onClick={() => {
                void today.refetch();
                setRouteId(null);
                setBusId(null);
                setStage({ name: 'scan' });
              }}
            >
              {t('attendance.markAnother')}
            </Button>
            <Button variant="outline" size="lg" block onClick={close}>
              {t('actions.done')}
            </Button>
          </div>
        </FlowSuccess>
      )}
    </FlowShell>
  );
}

// ---------------------------------------------------------------------------

function MatchConfirmation({
  match,
  liveness,
  alreadyPresent,
  busLabel,
  routeLabel,
  saving,
  onConfirm,
  onRescan,
  onManual,
}: {
  match: MatchResult;
  liveness: LivenessResult;
  alreadyPresent: Set<string>;
  busLabel: string;
  routeLabel: string;
  saving: boolean;
  onConfirm: (employeeId: string, employeeName: string, score: number) => void;
  onRescan: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation();
  const best = match.best;
  if (!best) return null;

  const duplicate = alreadyPresent.has(best.employeeId);
  const needsLook = match.decision === 'REVIEW';

  return (
    <div className="space-y-4">
      <Card className={needsLook ? 'border-warning/50' : 'border-success/50'}>
        <CardContent className="pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t('attendance.matchFoundTitle', { name: '' }).trim()}
          </p>
          <h2 className="mt-1 text-xl font-bold">{best.fullName}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{best.employeeCode}</p>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                {t('attendance.matchConfidence', { value: '' }).replace(/[\s%]*$/, '')}
              </dt>
              <dd className="tabular font-semibold">{formatConfidence(best.similarity)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('trips.busLabel')}</dt>
              <dd className="font-medium">{busLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('trips.routeLabel')}</dt>
              <dd className="truncate font-medium">{routeLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                {t('attendance.liveness.PASSED').split(' ')[0]}
              </dt>
              <dd className="font-medium">{t(`attendance.liveness.${liveness}`)}</dd>
            </div>
          </dl>

          {needsLook && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning-muted p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{t('attendance.lowConfidenceBody')}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {duplicate && (
        <div className="rounded-xl border-2 border-warning/40 bg-warning-muted p-3">
          <p className="text-sm font-semibold">{t('attendance.alreadyRecordedTitle')}</p>
        </div>
      )}

      <div className="space-y-2">
        <Button
          size="lg"
          block
          variant="success"
          disabled={duplicate}
          loading={saving}
          loadingLabel={t('attendance.marking')}
          onClick={() => onConfirm(best.employeeId, best.fullName, best.similarity)}
        >
          <CheckCircle2 className="size-5" aria-hidden />
          {t('attendance.markPresent')}
        </Button>
        <Button variant="outline" size="lg" block onClick={onRescan}>
          {t('actions.scanAgain')}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onManual}>
          {t('attendance.searchManually')}
        </Button>
      </div>
    </div>
  );
}

function ScanFailure({
  outcome,
  onRescan,
  onManual,
}: {
  outcome: ScanOutcome;
  onRescan: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation();

  const copy = (() => {
    switch (outcome.kind) {
      case 'LOW_CONFIDENCE':
        return {
          title: t('attendance.lowConfidenceTitle'),
          body: t('attendance.lowConfidenceBody'),
        };
      case 'MULTIPLE_FACES':
        return {
          title: t('attendance.multipleFacesTitle'),
          body: t('attendance.multipleFacesBody'),
        };
      case 'LIVENESS_FAILED':
        return {
          title: t('attendance.livenessFailedTitle'),
          body: t('attendance.livenessFailedBody'),
        };
      case 'NO_CANDIDATES':
        return { title: t('attendance.notEnrolledTitle'), body: t('attendance.notEnrolledBody') };
      case 'QUALITY':
        return {
          title: t('face.quality.issuesTitle'),
          body: t(`face.quality.${outcome.assessment.issues[0] ?? 'NO_FACE'}`),
        };
      default:
        return { title: t('attendance.noFaceTitle'), body: t('attendance.noFaceBody') };
    }
  })();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-warning/40 bg-warning-muted p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <h2 className="text-base font-bold">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
          </div>
        </div>
      </div>

      {outcome.kind === 'LOW_CONFIDENCE' && outcome.match.best && (
        <Card>
          <CardContent className="pt-4 text-sm">
            <p className="text-muted-foreground">
              {t('attendance.matchFoundTitle', { name: outcome.match.best.fullName })} ·{' '}
              <span className="tabular font-semibold text-foreground">
                {formatConfidence(outcome.match.best.similarity)}
              </span>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {outcome.kind !== 'NO_CANDIDATES' && (
          <Button size="lg" block onClick={onRescan}>
            {t('actions.scanAgain')}
          </Button>
        )}
        <Button variant="outline" size="lg" block onClick={onManual}>
          <UserSearch className="size-5" aria-hidden />
          {t('attendance.searchManually')}
        </Button>
      </div>
    </div>
  );
}

function ManualAttendance({
  drivers,
  alreadyPresent,
  saving,
  onCancel,
  onSubmit,
}: {
  drivers: Array<{ id: string; full_name: string; employee_code: string }>;
  alreadyPresent: Set<string>;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (
    employeeId: string,
    employeeName: string,
    reasonCode: OverrideReasonCode,
    reason: string,
  ) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode>('RECOGNITION_FAILED');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drivers;
    return drivers.filter(
      (driver) =>
        driver.full_name.toLowerCase().includes(term) ||
        driver.employee_code.toLowerCase().includes(term),
    );
  }, [drivers, search]);

  const reasonTooShort = reason.trim().length < 3;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold leading-snug">{t('attendance.manualTitle')}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('attendance.manualSubtitle')}</p>
      </div>

      {!selected ? (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('attendance.searchPlaceholder')}
            autoFocus
          />
          <ChoiceList>
            {filtered.map((driver) => (
              <Choice
                key={driver.id}
                title={driver.full_name}
                subtitle={driver.employee_code}
                disabled={alreadyPresent.has(driver.id)}
                disabledReason={t('attendance.alreadyRecordedTitle')}
                onSelect={() => setSelected({ id: driver.id, name: driver.full_name })}
              />
            ))}
          </ChoiceList>
          <Button variant="ghost" size="lg" block onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </>
      ) : (
        <>
          <AnsweredStep
            label={t('trips.driverLabel')}
            value={selected.name}
            onEdit={() => setSelected(null)}
          />

          <Field
            label={t('attendance.manualReason')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Select
                value={reasonCode}
                onValueChange={(value) => setReasonCode(value as OverrideReasonCode)}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERRIDE_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`attendance.reasonCodes.${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            label={t('attendance.manualReasonDetail')}
            error={touched && reasonTooShort ? t('validation.required') : undefined}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onBlur={() => setTouched(true)}
                invalid={touched && reasonTooShort}
              />
            )}
          </Field>

          <div className="space-y-2">
            <Button
              size="lg"
              block
              loading={saving}
              loadingLabel={t('attendance.marking')}
              onClick={() => {
                setTouched(true);
                if (reasonTooShort) return;
                onSubmit(selected.id, selected.name, reasonCode, reason.trim());
              }}
            >
              {t('attendance.manualConfirm')}
            </Button>
            <Button variant="ghost" size="lg" block onClick={onCancel}>
              {t('actions.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
