import { registerSW } from 'virtual:pwa-register';
import { logger } from '@/lib/logger';

/**
 * Service worker registration.
 *
 * Update strategy is `prompt`, not `autoUpdate`: silently swapping the app out
 * from under a manager who is halfway through a face scan is worse than a
 * slightly stale shell. The new version is applied on the next full reload,
 * or immediately if the page is idle.
 */
export function registerServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      logger.info('A new version of trck is available');
      // Apply on the next navigation rather than interrupting the current task.
      window.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') void updateSW(true);
        },
        { once: true },
      );
    },
    onOfflineReady() {
      logger.info('trck is ready to work offline');
    },
    onRegisterError(error) {
      logger.warn('Service worker registration failed', { error });
    },
  });
}
