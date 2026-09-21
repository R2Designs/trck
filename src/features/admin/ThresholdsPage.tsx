import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { thresholdsSchema } from '@/lib/validation';
import type { ThresholdsFormValues } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useSettingsRow, useUpdateSettings } from '@/features/settings/api';

/**
 * Operational thresholds.
 *
 * These numbers decide when a trip is flagged, when a face match is trusted
 * and how long images are kept. Two safeguards: every change is written to the
 * audit log by a database trigger, and every anomaly stores a snapshot of the
 * thresholds in force when it fired — so tightening a tolerance today does not
 * silently re-explain last month's alerts.
 */
export default function ThresholdsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const settings = useSettingsRow();
  const update = useUpdateSettings();

  const form = useForm<ThresholdsFormValues>({
    resolver: zodResolver(thresholdsSchema),
    defaultValues: {
      distance_tolerance_pct: 10,
      efficiency_drop_tolerance_pct: 20,
      range_drop_tolerance_pct: 35,
      min_trips_for_baseline: 8,
      baseline_window_days: 90,
      face_auto_accept_similarity: 0.62,
      face_review_similarity: 0.5,
      face_min_quality: 0.45,
      face_require_liveness: true,
      face_min_enrolment_photos: 3,
      ocr_high_confidence: 0.85,
      ocr_medium_confidence: 0.6,
      photo_retention_days: 365,
      dashboard_capture_retention_days: 180,
      attendance_retention_days: 2555,
    },
  });

  useEffect(() => {
    if (!settings.data) return;
    form.reset({
      distance_tolerance_pct: settings.data.distance_tolerance_pct,
      efficiency_drop_tolerance_pct: settings.data.efficiency_drop_tolerance_pct,
      range_drop_tolerance_pct: settings.data.range_drop_tolerance_pct,
      min_trips_for_baseline: settings.data.min_trips_for_baseline,
      baseline_window_days: settings.data.baseline_window_days,
      face_auto_accept_similarity: settings.data.face_auto_accept_similarity,
      face_review_similarity: settings.data.face_review_similarity,
      face_min_quality: settings.data.face_min_quality,
      face_require_liveness: settings.data.face_require_liveness,
      face_min_enrolment_photos: settings.data.face_min_enrolment_photos,
      ocr_high_confidence: settings.data.ocr_high_confidence,
      ocr_medium_confidence: settings.data.ocr_medium_confidence,
      photo_retention_days: settings.data.photo_retention_days,
      dashboard_capture_retention_days: settings.data.dashboard_capture_retention_days,
      attendance_retention_days: settings.data.attendance_retention_days,
    });
  }, [settings.data, form]);

  const error = (name: keyof ThresholdsFormValues): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message as string) : undefined;
  };

  const submit = form.handleSubmit(async (raw) => {
    const values = thresholdsSchema.parse(raw);
    try {
      await update.mutateAsync(values);
      toast({ tone: 'success', title: t('settings.saved') });
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  if (settings.isLoading) return <SkeletonList count={5} />;
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  const numberField = (
    name: keyof ThresholdsFormValues,
    label: string,
    hint?: string,
    step?: string,
  ) => (
    <Field label={label} hint={hint} error={error(name)}>
      {(fieldProps) => (
        <Input
          {...fieldProps}
          {...form.register(name)}
          inputMode="decimal"
          step={step}
          className="tabular"
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pb-24">
      <PageHeader title={t('settings.thresholds')} description={t('settings.thresholdsSubtitle')} />

      <div className="flex items-start gap-2.5 rounded-xl border border-info/40 bg-info-muted p-3">
        <Info className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('anomalies.severityHint')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('anomalies.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {numberField(
            'distance_tolerance_pct',
            t('settings.distanceTolerance'),
            t('settings.distanceToleranceHint'),
          )}
          {numberField('efficiency_drop_tolerance_pct', t('settings.efficiencyTolerance'))}
          {numberField('range_drop_tolerance_pct', t('settings.rangeTolerance'))}
          {numberField('min_trips_for_baseline', t('settings.minTripsForBaseline'))}
          {numberField('baseline_window_days', t('settings.baselineWindow'))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.faceThresholds')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {numberField(
            'face_auto_accept_similarity',
            t('settings.faceAutoAccept'),
            t('settings.faceAutoAcceptHint'),
            '0.01',
          )}
          {numberField(
            'face_review_similarity',
            t('settings.faceReview'),
            t('settings.faceReviewHint'),
            '0.01',
          )}
          {numberField('face_min_quality', t('settings.faceMinQuality'), undefined, '0.01')}
          {numberField('face_min_enrolment_photos', t('settings.faceMinPhotos'))}

          <label className="flex min-h-touch items-center justify-between gap-4">
            <span className="text-sm font-semibold">{t('settings.faceRequireLiveness')}</span>
            <Switch
              checked={form.watch('face_require_liveness')}
              onCheckedChange={(checked) => form.setValue('face_require_liveness', checked)}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.ocrThresholds')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {numberField('ocr_high_confidence', t('settings.ocrHigh'), undefined, '0.01')}
          {numberField('ocr_medium_confidence', t('settings.ocrMedium'), undefined, '0.01')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.retention')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('settings.retentionSubtitle')}</p>
          {numberField('photo_retention_days', t('settings.photoRetention'))}
          {numberField('dashboard_capture_retention_days', t('settings.captureRetention'))}
          {numberField('attendance_retention_days', t('settings.attendanceRetention'))}
        </CardContent>
      </Card>

      <div className="sticky-cta">
        <Button
          type="submit"
          size="lg"
          block
          loading={form.formState.isSubmitting || update.isPending}
          loadingLabel={t('actions.saving')}
        >
          {t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
