import { useTranslation } from 'react-i18next';
import { Camera, CameraOff, Lock, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CameraStatus } from './useCamera';

/**
 * Every camera failure, given its own screen.
 *
 * These are not error toasts. A manager standing beside a bus whose camera is
 * blocked needs to know *what to tap in their browser settings*, not that
 * something went wrong.
 */
export function CameraStateScreen({
  status,
  onRetry,
  onFallback,
  fallbackLabel,
}: {
  status: Exclude<CameraStatus, 'streaming' | 'requesting'>;
  onRetry?: () => void;
  /** e.g. "Record attendance by hand" — always offered when the camera fails. */
  onFallback?: () => void;
  fallbackLabel?: string;
}) {
  const { t } = useTranslation();

  const config = {
    idle: {
      icon: Camera,
      title: t('camera.permissionTitle'),
      body: t('camera.permissionBody'),
      primary: t('camera.allowCamera'),
      help: undefined as string | undefined,
    },
    denied: {
      icon: Lock,
      title: t('camera.deniedTitle'),
      body: t('camera.deniedBody'),
      primary: t('actions.retry'),
      help: t('camera.deniedHelp'),
    },
    blocked: {
      icon: Lock,
      title: t('camera.deniedTitle'),
      body: t('camera.deniedBody'),
      primary: t('actions.retry'),
      help: t('camera.deniedHelp'),
    },
    unavailable: {
      icon: VideoOff,
      title: t('camera.notFoundTitle'),
      body: t('camera.notFoundBody'),
      primary: undefined,
      help: undefined,
    },
    'in-use': {
      icon: CameraOff,
      title: t('camera.inUseTitle'),
      body: t('camera.inUseBody'),
      primary: t('actions.retry'),
      help: undefined,
    },
    error: {
      icon: CameraOff,
      title: t('camera.unsupportedTitle'),
      body: t('camera.unsupportedBody'),
      primary: t('actions.retry'),
      help: undefined,
    },
  }[status];

  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-card px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-bold">{config.title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{config.body}</p>
      {config.help && (
        <p className="mt-3 max-w-sm rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {config.help}
        </p>
      )}
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        {config.primary && onRetry && (
          <Button size="lg" block onClick={onRetry}>
            {config.primary}
          </Button>
        )}
        {onFallback && (
          <Button variant="outline" size="lg" block onClick={onFallback}>
            {fallbackLabel ?? t('actions.enterManually')}
          </Button>
        )}
      </div>
    </div>
  );
}
