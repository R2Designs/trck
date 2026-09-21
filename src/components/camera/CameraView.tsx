import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, Zap, ZapOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { UseCameraResult } from './useCamera';
import { CameraStateScreen } from './CameraStates';

/**
 * Live camera surface with an overlay slot.
 *
 * The preview is always 4:3 or taller so a one-handed grip does not cut the
 * subject off, and the controls sit along the bottom edge where a thumb
 * already is. Overlay children are positioned absolutely over the video — the
 * face oval and the dashboard framing rectangle both use this.
 */
export function CameraView({
  camera,
  overlay,
  footer,
  onFallback,
  fallbackLabel,
  className,
  mirrored,
}: {
  camera: UseCameraResult;
  overlay?: React.ReactNode;
  footer?: React.ReactNode;
  onFallback?: () => void;
  fallbackLabel?: string;
  className?: string;
  /** Mirror the preview for a front-facing camera, as users expect. */
  mirrored?: boolean;
}) {
  const { t } = useTranslation();
  const { status, videoRef, hasMultipleCameras, torchAvailable, torchOn } = camera;

  if (status !== 'streaming' && status !== 'requesting') {
    return (
      <CameraStateScreen
        status={status}
        onRetry={() => void camera.start()}
        onFallback={onFallback}
        fallbackLabel={fallbackLabel}
      />
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label={t('a11y.cameraPreview')}
          className={cn(
            'aspect-[3/4] w-full object-cover sm:aspect-[4/3]',
            mirrored && 'scale-x-[-1]',
          )}
        />

        {status === 'requesting' && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-white">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <p className="text-sm">{t('camera.starting')}</p>
            </div>
          </div>
        )}

        {overlay}

        <div className="absolute right-2 top-2 flex flex-col gap-2">
          {hasMultipleCameras && (
            <Button
              variant="overlay"
              size="icon"
              onClick={() => void camera.switchCamera()}
              aria-label={t('camera.switchCamera')}
            >
              <RefreshCw className="size-5" aria-hidden />
            </Button>
          )}
          {torchAvailable && (
            <Button
              variant="overlay"
              size="icon"
              onClick={() => void camera.toggleTorch()}
              aria-label={t('camera.torch')}
              aria-pressed={torchOn}
            >
              {torchOn ? (
                <Zap className="size-5" aria-hidden />
              ) : (
                <ZapOff className="size-5" aria-hidden />
              )}
            </Button>
          )}
        </div>
      </div>

      {footer}
    </div>
  );
}

/**
 * Oval face guide.
 *
 * `tone` reflects live quality: neutral while looking, amber when something is
 * off, green when the frame is good enough to capture. The ring is thick and
 * high-contrast so it survives a sunlit screen.
 */
export function FaceGuideOverlay({
  tone = 'neutral',
  hint,
}: {
  tone?: 'neutral' | 'warning' | 'good';
  hint?: string;
}) {
  const ring = {
    neutral: 'border-white/85',
    warning: 'border-warning',
    good: 'border-success',
  }[tone];

  return (
    <>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div
          className={cn(
            'h-[62%] w-[52%] rounded-[50%] border-4 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]',
            ring,
          )}
        />
      </div>
      {hint && (
        <p
          className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2
          text-center text-sm font-medium text-white backdrop-blur-sm"
        >
          {hint}
        </p>
      )}
    </>
  );
}

/** Rectangular framing guide for the instrument cluster. */
export function DashboardGuideOverlay({ hint }: { hint?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 grid place-items-center"
        role="img"
        aria-label={t('capture.frameGuide')}
      >
        <div
          className="relative h-[46%] w-[86%] rounded-lg border-2 border-white/90
          shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
        >
          {/* Corner ticks read as "align here" far better than a plain box. */}
          {[
            'left-0 top-0 border-l-4 border-t-4 rounded-tl-lg',
            'right-0 top-0 border-r-4 border-t-4 rounded-tr-lg',
            'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-lg',
            'right-0 bottom-0 border-r-4 border-b-4 rounded-br-lg',
          ].map((position) => (
            <span key={position} className={cn('absolute size-7 border-white', position)} />
          ))}
        </div>
      </div>
      {hint && (
        <p
          className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2
          text-center text-sm font-medium text-white backdrop-blur-sm"
        >
          {hint}
        </p>
      )}
    </>
  );
}
