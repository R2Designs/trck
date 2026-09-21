import { registerSW } from 'virtual:pwa-register';
import { logger } from '@/lib/logger';

/**
 * Service worker registration.
 *
 * Static releases use an auto-update worker so a normal reload always receives
 * the latest deployed interface. Existing pages are not force-reloaded while a
 * manager is in the middle of a capture flow.
 */
export function registerServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      logger.info('A new version of trck is available');
      void updateSW(false);
    },
    onOfflineReady() {
      logger.info('trck is ready to work offline');
    },
    onRegisterError(error) {
      logger.warn('Service worker registration failed', { error });
    },
  });
}
