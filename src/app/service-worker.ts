import { registerSW } from 'virtual:pwa-register';
import { logger } from '@/lib/logger';

/**
 * Service worker registration.
 *
 * Static releases use an auto-update worker. When a new worker is ready we
 * reload once so the page cannot keep running an older JavaScript bundle after
 * a deployment. Without the reload, an installed GitHub Pages PWA can continue
 * showing the previous OCR flow even though the new assets are already live.
 */
export function registerServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      logger.info('A new version of trck is available');
      void updateSW(true);
    },
    onOfflineReady() {
      logger.info('trck is ready to work offline');
    },
    onRegisterError(error) {
      logger.warn('Service worker registration failed', { error });
    },
  });
}
