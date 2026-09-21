import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw, SignalLow, Wifi } from 'lucide-react';
import { useConnectionState } from '@/lib/network';
import { pendingCount, subscribeToQueue, flushQueue } from '@/lib/offline-queue';
import { cn } from '@/lib/cn';

/**
 * Connectivity banner.
 *
 * Three states, all of which a manager in a parking lot will meet:
 *   offline   — nothing will reach the server; writes are queued where safe
 *   unstable  — requests are failing intermittently; warn, don't block
 *   syncing   — we are draining the queue; say so, and say how many
 *
 * "Back online" is shown briefly and then disappears: a permanent green bar is
 * noise, but silently going from offline to online leaves the manager unsure
 * whether the thing they saved actually went anywhere.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const connection = useConnectionState();
  const [queued, setQueued] = useState(0);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => subscribeToQueue(setQueued), []);
  useEffect(() => {
    void pendingCount().then(setQueued);
  }, []);

  useEffect(() => {
    if (connection !== 'online') return;
    let cancelled = false;
    setJustReconnected(true);
    void flushQueue().then(() => {
      if (!cancelled) void pendingCount().then(setQueued);
    });
    const timer = setTimeout(() => setJustReconnected(false), 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection]);

  const syncing = connection === 'online' && queued > 0;
  const visible = connection !== 'online' || syncing || justReconnected;
  if (!visible) return null;

  const tone =
    connection === 'offline'
      ? 'offline'
      : syncing
        ? 'syncing'
        : connection === 'unstable'
          ? 'unstable'
          : 'online';

  const config = {
    offline: {
      icon: CloudOff,
      className: 'bg-destructive text-destructive-foreground',
      title: t('network.offline'),
      detail: queued > 0 ? t('network.queuedCount', { count: queued }) : t('network.offlineBody'),
    },
    unstable: {
      icon: SignalLow,
      className: 'bg-warning text-warning-foreground',
      title: t('network.slowConnection'),
      detail: undefined,
    },
    syncing: {
      icon: RefreshCw,
      className: 'bg-info text-info-foreground',
      title: t('network.syncingCount', { count: queued }),
      detail: undefined,
    },
    online: {
      icon: Wifi,
      className: 'bg-success text-success-foreground',
      title: t('network.online'),
      detail: undefined,
    },
  }[tone];

  const Icon = config.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2.5 px-4 py-2 text-sm font-medium', config.className)}
    >
      <Icon className={cn('size-4 shrink-0', tone === 'syncing' && 'animate-spin')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {config.title}
        {config.detail && <span className="ml-1.5 font-normal opacity-90">{config.detail}</span>}
      </span>
    </div>
  );
}
