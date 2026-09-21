import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './app/providers';
import { initI18n } from './i18n';
import { applyTheme } from './app/theme';
import { logger } from './lib/logger';
import { config } from './app/config';
import { registerOfflineHandlers } from './lib/offline-handlers';
import './index.css';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/500.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans/700.css';

/**
 * Entry point.
 *
 * Order matters: the theme is applied before the first paint (no white flash
 * on a dark-themed phone) and i18n is initialised before React mounts (no
 * flash of English for a Tamil-speaking manager).
 */

function readStoredTheme(): 'light' | 'dark' | 'system' {
  try {
    const value = localStorage.getItem('trck.theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

async function bootstrap(): Promise<void> {
  applyTheme(readStoredTheme());
  // Registered before anything can flush: a queued write whose handler is not
  // yet known is discarded, so this must happen before the `online` listener
  // in `offline-queue.ts` can fire.
  registerOfflineHandlers();
  await initI18n();

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );

  if (config.enablePwa && 'serviceWorker' in navigator) {
    // Registered lazily so the worker never competes with the first paint.
    const { registerServiceWorker } = await import('./app/service-worker');
    registerServiceWorker();
  }
}

void bootstrap().catch((error) => {
  logger.error('Bootstrap failed', { error });
  const container = document.getElementById('root');
  if (container) {
    // Last-resort fallback: i18n may itself be what failed, so this one string
    // is intentionally untranslated.
    container.innerHTML =
      '<div style="padding:24px;font-family:sans-serif;max-width:32rem;margin:0 auto">' +
      '<h1 style="font-size:1.125rem;margin:0 0 8px">trck could not start</h1>' +
      '<p style="color:#555;margin:0 0 16px">Please reload the page. If this keeps happening, ' +
      'contact your administrator.</p>' +
      '<button onclick="location.reload()" style="padding:10px 16px;border-radius:8px;' +
      'border:1px solid #ccc;background:#fff;font-weight:600">Reload</button></div>';
  }
});
