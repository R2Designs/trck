/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Ambient declarations for the build-time virtual modules.
 *
 * `virtual:pwa-register` does not exist on disk — vite-plugin-pwa synthesises
 * it during the build — so TypeScript needs to be told what it exports. The
 * reference above supplies that; this file also documents the two environment
 * variables the app refuses to start without, which `src/app/config.ts`
 * validates at boot.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_STORAGE_PROVIDER?: 'supabase' | 'r2';
  readonly VITE_FACE_PROVIDER?: 'human' | 'mock';
  readonly VITE_OCR_PROVIDER?: 'tesseract' | 'mock';
  readonly VITE_ANALYTICS_PROVIDER?: 'supabase' | 'console' | 'noop';
  readonly VITE_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
