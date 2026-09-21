import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2 } from 'lucide-react';
import type { CaptureKind } from '@domain/types.ts';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/controls';
import { ErrorState } from '@/components/feedback/states';
import { useCamera } from './useCamera';
import { CameraView, DashboardGuideOverlay } from './CameraView';

/**
 * Dashboard photography.
 *
 * Rear camera, no exposure bias — pushing exposure up would blow out an
 * instrument cluster that is already self-illuminated, which is the opposite
 * of what is needed for the face scanner.
 *
 * The framing rectangle is guidance rather than a crop: cropping to it would
 * throw away context that helps when a reading is later disputed, and managers
 * do not aim as precisely as designers imagine.
 */
export function DashboardScanner({
  kind,
  processing,
  progress,
  error,
  onCapture,
  onManualEntry,
}: {
  kind: CaptureKind;
  processing: boolean;
  progress: number;
  error: unknown;
  onCapture: (blob: Blob) => void | Promise<void>;
  onManualEntry: () => void;
}) {
  const { t } = useTranslation();
  const camera = useCamera({ facing: 'environment' });
  const [capturing, setCapturing] = useState(false);

  const take = async () => {
    setCapturing(true);
    try {
      const blob = await camera.capture();
      if (blob) await onCapture(blob);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">
          {kind === 'TRIP_END' ? t('capture.endTitle') : t('capture.startTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('capture.hint')}</p>
      </div>

      {error != null && <ErrorState error={error} compact />}

      <CameraView
        camera={camera}
        onFallback={onManualEntry}
        fallbackLabel={t('actions.enterManually')}
        overlay={<DashboardGuideOverlay hint={t('capture.instruction')} />}
      />

      {processing && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {progress < 0.2 ? t('capture.compressing') : t('capture.processing')}
          </div>
          <Progress className="mt-3" value={Math.round(progress * 100)} />
        </div>
      )}

      <div className="space-y-2">
        <Button
          size="lg"
          block
          onClick={() => void take()}
          disabled={camera.status !== 'streaming' || processing}
          loading={capturing || processing}
        >
          <Camera className="size-5" aria-hidden />
          {t('actions.takePhoto')}
        </Button>
        <Button variant="ghost" size="lg" block onClick={onManualEntry} disabled={processing}>
          {t('actions.enterManually')}
        </Button>
      </div>
    </div>
  );
}
