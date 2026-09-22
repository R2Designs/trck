import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Check, ShieldCheck, Sun, X } from 'lucide-react';
import type { QualityIssue } from '@domain/face-match.ts';
import { canCompleteEnrolment } from '@domain/face-match.ts';
import { FlowShell } from '@/components/layout/AppShell';
import { FlowSuccess, StepHeader, StepProgress } from '@/components/common/StepFlow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Progress } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState, NotFoundState } from '@/components/feedback/states';
import { CameraView, FaceGuideOverlay } from '@/components/camera/CameraView';
import { useCamera } from '@/components/camera/useCamera';
import { useToast } from '@/components/ui/toast';
import { getFaceProvider } from '@/providers/face';
import { toAppError } from '@/lib/errors';
import { cn } from '@/lib/cn';
import { useActiveDepot } from '@/features/auth/session';
import { useEmployee, useFaceEnrolmentStatus } from '@/features/fleet/api';
import { useThresholds } from '@/features/settings/api';
import { ENROLMENT_POSES, evaluateEnrolmentShot, useSaveEnrolment } from './enrolment';
import type { EnrolmentShot } from './enrolment';

const NOTICE_VERSION = 'v1.0-2026-01';

/**
 * Face enrolment.
 *
 * Three beats: consent, guidance, capture.
 *
 * Consent is a gate, not a footnote — no photograph is taken until a manager
 * confirms the driver has been told what the data is for. The guidance screen
 * leads with lighting, because lighting is the single biggest determinant of
 * whether recognition works later, and it matters most for the drivers whose
 * faces the camera under-exposes by default.
 *
 * A photo that will not work is refused with a specific reason. Saving a bad
 * enrolment produces a scanner that "doesn't work" a week later, with no
 * obvious cause.
 */

type Stage = 'consent' | 'guidance' | 'capture' | 'done';

export default function FaceEnrolmentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { toast } = useToast();
  const depot = useActiveDepot();
  const { thresholds } = useThresholds();

  const employee = useEmployee(employeeId);
  const status = useFaceEnrolmentStatus(employeeId);
  const save = useSaveEnrolment();

  const [stage, setStage] = useState<Stage>('consent');
  const [consented, setConsented] = useState(false);
  const [shots, setShots] = useState<EnrolmentShot[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [lastRejection, setLastRejection] = useState<QualityIssue | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelReady, setModelReady] = useState(false);

  const goBack = () => {
    switch (stage) {
      case 'consent':
      case 'done':
        navigate(-1);
        break;
      case 'guidance':
        setStage('consent');
        break;
      case 'capture':
        setStage('guidance');
        break;
    }
  };

  // Front camera with a positive exposure bias: enrolment is usually done in a
  // depot office, often with a window behind the subject.
  const camera = useCamera({ facing: 'user', autoStart: false, exposureBias: 0.7 });
  const required = thresholds.faceMinEnrolmentPhotos;
  const progress = canCompleteEnrolment(
    shots.map((shot) => shot.assessment),
    thresholds,
  );
  const poseIndex = Math.min(shots.length, ENROLMENT_POSES.length - 1);
  const currentPose = ENROLMENT_POSES[poseIndex];

  useEffect(() => {
    if (stage !== 'capture') return;
    let active = true;
    const provider = getFaceProvider();

    void provider
      .load((fraction) => active && setModelProgress(fraction))
      .then(() => {
        if (!active) return;
        setModelReady(true);
        void camera.start();
      })
      .catch(() => {
        if (active) toast({ tone: 'error', title: t('face.modelLoadFailed') });
      });

    return () => {
      active = false;
      camera.stop();
      void provider.dispose();
    };
    // camera identity changes on every render; starting it once per stage is
    // the intent, so it is deliberately excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(
    () => () => shots.forEach((shot) => URL.revokeObjectURL(shot.image.previewUrl)),
    [shots],
  );

  if (employee.isLoading) {
    return (
      <FlowShell title={t('face.enrolTitle')} onClose={() => navigate(-1)}>
        <SkeletonList count={3} />
      </FlowShell>
    );
  }
  if (employee.isError) {
    return (
      <FlowShell title={t('face.enrolTitle')} onClose={() => navigate(-1)}>
        <ErrorState error={employee.error} onRetry={() => void employee.refetch()} />
      </FlowShell>
    );
  }
  if (!employee.data) {
    return (
      <FlowShell title={t('face.enrolTitle')} onClose={() => navigate(-1)}>
        <NotFoundState />
      </FlowShell>
    );
  }

  const person = employee.data;
  const close = () => navigate(`/fleet/drivers/${person.id}`);

  const capture = async () => {
    setEvaluating(true);
    setLastRejection(null);
    try {
      const blob = await camera.capture();
      if (!blob) return;

      const result = await evaluateEnrolmentShot(blob, thresholds);
      if (!result.assessment.acceptable || !result.descriptor) {
        setLastRejection(result.assessment.issues[0] ?? 'NO_FACE');
        URL.revokeObjectURL(result.image.previewUrl);
        return;
      }

      setShots((current) => [
        ...current,
        {
          pose: currentPose as (typeof ENROLMENT_POSES)[number],
          image: result.image,
          assessment: result.assessment,
          descriptor: result.descriptor,
        },
      ]);
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    } finally {
      setEvaluating(false);
    }
  };

  const persist = async () => {
    if (!depot) return;
    try {
      await save.mutateAsync({
        employeeId: person.id,
        depotId: person.depot_id,
        shots,
        noticeVersion: NOTICE_VERSION,
        photoRetentionDays: thresholds.photoRetentionDays,
        replaceExisting: (status.data?.embeddingCount ?? 0) > 0,
      });
      toast({ tone: 'success', title: t('face.saved', { name: person.full_name }) });
      setStage('done');
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  };

  return (
    <FlowShell title={t('face.enrolTitle')} subtitle={person.full_name} onClose={goBack}>
      {/* --- Consent ---------------------------------------------------- */}
      {stage === 'consent' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <h2 className="text-base font-bold">{t('face.consentTitle')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('face.consentBody')}</p>
            </div>
          </div>

          <Card>
            <CardContent className="space-y-3 pt-4 text-sm">
              <PrivacyPoint title={t('privacy.collectTitle')} body={t('privacy.collectBody')} />
              <PrivacyPoint title={t('privacy.useTitle')} body={t('privacy.useBody')} />
              <PrivacyPoint title={t('privacy.storeTitle')} body={t('privacy.storeBody')} />
              <PrivacyPoint
                title={t('privacy.retainTitle')}
                body={t('privacy.retainBody', { days: thresholds.photoRetentionDays })}
              />
              <PrivacyPoint title={t('privacy.rightsTitle')} body={t('privacy.rightsBody')} />
            </CardContent>
          </Card>

          <label className="flex min-h-touch-lg cursor-pointer items-start gap-3 rounded-xl border-2 border-border bg-card p-4">
            <Checkbox
              checked={consented}
              onCheckedChange={(checked) => setConsented(checked === true)}
              aria-describedby="consent-text"
            />
            <span id="consent-text" className="text-sm font-medium">
              {t('face.consentCheckbox', { name: person.full_name })}
            </span>
          </label>

          <Button size="lg" block disabled={!consented} onClick={() => setStage('guidance')}>
            {t('actions.continue')}
          </Button>
        </div>
      )}

      {/* --- Guidance --------------------------------------------------- */}
      {stage === 'guidance' && (
        <div className="space-y-4">
          <StepHeader
            current={1}
            total={2}
            prompt={t('face.guidance.title')}
            hint={t('face.enrolSubtitle', { name: person.full_name, count: required })}
          />

          <Card className="border-primary/40">
            <CardContent className="space-y-2.5 pt-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Sun className="size-4 text-warning" aria-hidden />
                {t('face.lighting.title')}
              </p>
              <GuidancePoint text={t('face.guidance.lightOnFace')} />
              <GuidancePoint text={t('face.guidance.openShade')} />
              <GuidancePoint text={t('face.guidance.lighting')} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2.5 pt-4">
              <GuidancePoint text={t('face.guidance.onePerson')} />
              <GuidancePoint text={t('face.guidance.faceVisible')} />
              <GuidancePoint text={t('face.guidance.noSunglasses')} />
              <GuidancePoint text={t('face.guidance.distance')} />
              <GuidancePoint text={t('face.guidance.steady')} />
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            {t('face.retentionNote', { days: thresholds.photoRetentionDays })}
          </p>

          <Button size="lg" block onClick={() => setStage('capture')}>
            <Camera className="size-5" aria-hidden />
            {t('actions.takePhoto')}
          </Button>
        </div>
      )}

      {/* --- Capture ----------------------------------------------------- */}
      {stage === 'capture' && (
        <div className="space-y-4">
          <StepProgress current={2} total={2} />
          <StepHeader
            current={shots.length + 1}
            total={Math.max(required, ENROLMENT_POSES.length)}
            prompt={t(`face.poses.${currentPose}`)}
            hint={t('face.step', {
              current: shots.length + 1,
              total: Math.max(required, ENROLMENT_POSES.length),
            })}
          />

          {!modelReady && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium">{t('face.modelLoading')}</p>
              <Progress className="mt-3" value={Math.round(modelProgress * 100)} />
            </div>
          )}

          <CameraView
            camera={camera}
            mirrored
            onFallback={close}
            fallbackLabel={t('actions.cancel')}
            overlay={
              <FaceGuideOverlay
                tone={lastRejection ? 'warning' : 'neutral'}
                hint={
                  lastRejection
                    ? t(`face.quality.${lastRejection}`)
                    : t(`face.poses.${currentPose}`)
                }
              />
            }
          />

          {lastRejection && (
            <div
              role="alert"
              className="rounded-xl border-2 border-warning/40 bg-warning-muted p-3"
            >
              <p className="text-sm font-semibold">{t('face.quality.issuesTitle')}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t(`face.quality.${lastRejection}`)}
              </p>
            </div>
          )}

          {shots.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">
                {t('face.progress', { usable: progress.usable, required: progress.required })}
              </p>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {shots.map((shot, index) => (
                  <li key={shot.image.previewUrl} className="relative shrink-0">
                    <img
                      src={shot.image.previewUrl}
                      alt={t(`face.poses.${shot.pose}`)}
                      className="size-20 rounded-lg border-2 border-success object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t('actions.remove')}
                      onClick={() => {
                        URL.revokeObjectURL(shot.image.previewUrl);
                        setShots((current) => current.filter((_, i) => i !== index));
                      }}
                      className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full
                        bg-destructive text-destructive-foreground shadow"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className={cn('text-sm', progress.ok ? 'text-success' : 'text-muted-foreground')}>
            {progress.ok
              ? t('face.readyToSave')
              : t('face.needMore', { count: progress.required - progress.usable })}
          </p>

          <div className="sticky-cta space-y-2">
            <Button
              size="lg"
              block
              variant="outline"
              onClick={() => void capture()}
              loading={evaluating}
              loadingLabel={t('face.quality.checking')}
              disabled={!modelReady || camera.status !== 'streaming'}
            >
              <Camera className="size-5" aria-hidden />
              {t('actions.takePhoto')}
            </Button>
            <Button
              size="lg"
              block
              disabled={!progress.ok}
              loading={save.isPending}
              loadingLabel={t('face.saving')}
              onClick={() => void persist()}
            >
              <Check className="size-5" aria-hidden />
              {t('actions.save')}
            </Button>
          </div>
        </div>
      )}

      {/* --- Done --------------------------------------------------------- */}
      {stage === 'done' && (
        <FlowSuccess
          title={t('face.saved', { name: person.full_name })}
          description={t('employees.faceEnrolled', {
            // The face-status query is invalidated after save and may already
            // contain the new rows by the time this screen renders. Adding the
            // local shots again would display 12 for six successfully saved
            // photos.
            count: status.data?.embeddingCount ?? save.data?.saved ?? shots.length,
          })}
        >
          <Button size="lg" block onClick={close}>
            {t('actions.done')}
          </Button>
        </FlowSuccess>
      )}
    </FlowShell>
  );
}

function PrivacyPoint({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{body}</p>
    </div>
  );
}

function GuidancePoint({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
