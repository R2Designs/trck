import { useTranslation } from 'react-i18next';
import { AlertTriangle, Camera, Check, Copy, Pencil } from 'lucide-react';
import type { ReadingField } from '@domain/types.ts';
import { ConfidenceBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { CaptureDraft, ReviewableReading } from '@/features/trips/capture';

/**
 * "Here's what we found."
 *
 * This screen is where the product's central principle becomes visible: an OCR
 * result is a *proposal*, not a fact. Every value is editable, every value
 * carries its confidence, a low-confidence value is called out rather than
 * quietly accepted, and the original photograph sits right there so the
 * manager can check against it without walking back to the bus.
 *
 * Nothing on this screen can be skipped past — the caller only gets values
 * after the manager has confirmed them.
 */

const UNIT_KEY: Record<ReadingField, string> = {
  ODOMETER: 'units.km',
  RANGE_KM: 'units.km',
  FUEL_PERCENT: '',
  TRIP_METER: 'units.km',
};

export function OCRReview({
  draft,
  onChange,
  onRetake,
  onConfirm,
  confirming,
  analogue,
}: {
  draft: CaptureDraft;
  onChange: (field: ReadingField, value: string) => void;
  onRetake: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  analogue?: boolean;
}) {
  const { t } = useTranslation();
  const odometer = draft.readings.find((reading) => reading.field === 'ODOMETER');
  const canConfirm = Boolean(odometer && odometer.value.trim() !== '');

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-black">
        <img
          src={draft.image.previewUrl}
          alt={t('capture.title')}
          className="max-h-64 w-full object-contain"
        />
      </div>

      {draft.duplicateOfCaptureId && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border-2 border-warning/40 bg-warning-muted p-3"
        >
          <Copy className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-semibold">{t('capture.duplicateTitle')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('capture.duplicateBody')}</p>
          </div>
        </div>
      )}

      {analogue && (
        <div className="rounded-xl border border-border bg-muted/50 p-3">
          <p className="text-sm font-semibold">{t('ocr.analogueNoticeTitle')}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('ocr.analogueNoticeBody')}</p>
        </div>
      )}

      {!analogue && draft.status === 'FAILED' && (
        <div className="rounded-xl border-2 border-warning/40 bg-warning-muted p-3">
          <p className="text-sm font-semibold">{t('capture.failedTitle')}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('capture.failedBody')}</p>
        </div>
      )}

      <div>
        <h2 className="text-base font-bold">{t('ocr.resultTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('ocr.resultSubtitle')}</p>
      </div>

      <div className="space-y-3">
        {draft.readings.map((reading) => (
          <ReadingRow key={reading.field} reading={reading} onChange={onChange} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t('ocr.rangeCaveat')}</p>
      {!analogue && draft.status !== 'FAILED' && (
        <p className="text-xs text-muted-foreground">
          {t('ocr.engine', { engine: `${draft.engine} ${draft.engineVersion}` })}
        </p>
      )}

      <div className="sticky-cta flex gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onRetake}>
          <Camera className="size-5" aria-hidden />
          {t('actions.retake')}
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!canConfirm}
          loading={confirming}
          onClick={onConfirm}
        >
          <Check className="size-5" aria-hidden />
          {t('ocr.confirmAll')}
        </Button>
      </div>
    </div>
  );
}

function ReadingRow({
  reading,
  onChange,
}: {
  reading: ReviewableReading;
  onChange: (field: ReadingField, value: string) => void;
}) {
  const { t } = useTranslation();
  const notFound = reading.ocrValue == null;
  const lowConfidence = reading.band === 'LOW';
  const unitKey = UNIT_KEY[reading.field];

  return (
    <Card
      className={cn(
        lowConfidence && !reading.edited && 'border-warning/50 bg-warning-muted/40',
        reading.edited && 'border-primary/40',
      )}
    >
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{t(`ocr.fields.${reading.field}`)}</span>
          {reading.band && !reading.edited && <ConfidenceBadge band={reading.band} />}
          {reading.edited && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
              <Pencil className="size-3" aria-hidden />
              {t('ocr.corrected')}
            </span>
          )}
        </div>

        <Field
          label={notFound ? t('ocr.enterValue') : t(`ocr.fields.${reading.field}`)}
          className="[&>label]:sr-only"
        >
          {(fieldProps) => (
            <div className="relative">
              <Input
                {...fieldProps}
                inputMode="decimal"
                value={reading.value}
                onChange={(event) => onChange(reading.field, event.target.value)}
                placeholder={notFound ? t('ocr.notFound') : undefined}
                className={cn('tabular text-lg font-semibold', unitKey && 'pr-14')}
              />
              {unitKey ? (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {t(unitKey)}
                </span>
              ) : (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              )}
            </div>
          )}
        </Field>
        {notFound && reading.field === 'RANGE_KM' && (
          <p className="text-xs text-muted-foreground">{t('ocr.rangeNotVisible')}</p>
        )}

        {reading.ocrValue != null && reading.edited && (
          <p className="text-xs text-muted-foreground">
            {t('ocr.originalValue', { value: reading.ocrValue })}
          </p>
        )}

        {lowConfidence && !reading.edited && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('ocr.lowConfidenceWarning')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
