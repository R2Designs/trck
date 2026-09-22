/**
 * Runtime configuration.
 *
 * Read once, validated once, frozen. A missing Supabase URL should fail at
 * startup with a sentence an engineer can act on — not as an undefined-property
 * crash three screens into the attendance flow.
 *
 * Only `VITE_`-prefixed variables exist in the bundle. The service-role key is
 * deliberately absent: privileged operations go through Edge Functions.
 */

export type StorageProviderName = 'supabase' | 'r2';
export type FaceProviderName = 'human' | 'mock';
export type OcrProviderName = 'tesseract' | 'mock';
export type AnalyticsProviderName = 'supabase' | 'console' | 'noop';

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage: {
    provider: StorageProviderName;
    faceBucket: string;
    dashboardBucket: string;
  };
  face: {
    provider: FaceProviderName;
    modelBasePath: string;
  };
  ocr: {
    provider: OcrProviderName;
    workerPath?: string;
    corePath?: string;
    langPath?: string;
  };
  analytics: { provider: AnalyticsProviderName };
  env: 'development' | 'test' | 'staging' | 'production';
  enablePwa: boolean;
  appVersion: string;
  /** Lowest level `logger` will emit. `silent` turns logging off entirely. */
  logLevel: LogThreshold;
}

export type LogThreshold = 'debug' | 'info' | 'warn' | 'error' | 'silent';

class ConfigurationError extends Error {
  override name = 'ConfigurationError';
}

function required(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new ConfigurationError(
      `Missing ${key}. Copy .env.example to .env.local and fill it in — see docs/DEPLOYMENT.md.`,
    );
  }
  return value.trim();
}

function oneOf<T extends string>(
  key: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!value) return fallback;
  const normalised = value.trim() as T;
  if (!allowed.includes(normalised)) {
    // A typo in an adapter name must be loud: silently falling back to a
    // different provider than the operator configured is worse than crashing.
    throw new ConfigurationError(
      `${key} must be one of ${allowed.join(', ')} — received "${value}".`,
    );
  }
  return normalised;
}

const raw = import.meta.env;

export const config: AppConfig = Object.freeze({
  supabaseUrl: required('VITE_SUPABASE_URL', raw.VITE_SUPABASE_URL),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', raw.VITE_SUPABASE_ANON_KEY),
  storage: Object.freeze({
    provider: oneOf(
      'VITE_STORAGE_PROVIDER',
      raw.VITE_STORAGE_PROVIDER,
      ['supabase', 'r2'],
      'supabase',
    ),
    faceBucket: raw.VITE_STORAGE_BUCKET_FACES?.trim() || 'employee-faces',
    dashboardBucket: raw.VITE_STORAGE_BUCKET_DASHBOARDS?.trim() || 'dashboard-captures',
  }),
  face: Object.freeze({
    provider: oneOf('VITE_FACE_PROVIDER', raw.VITE_FACE_PROVIDER, ['human', 'mock'], 'human'),
    modelBasePath:
      raw.VITE_FACE_MODEL_BASE_PATH?.trim() ||
      'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/',
  }),
  ocr: Object.freeze({
    provider: oneOf('VITE_OCR_PROVIDER', raw.VITE_OCR_PROVIDER, ['tesseract', 'mock'], 'tesseract'),
    workerPath: raw.VITE_OCR_WORKER_PATH?.trim() || undefined,
    corePath: raw.VITE_OCR_CORE_PATH?.trim() || undefined,
    langPath: raw.VITE_OCR_LANG_PATH?.trim() || undefined,
  }),
  analytics: Object.freeze({
    provider: oneOf(
      'VITE_ANALYTICS_PROVIDER',
      raw.VITE_ANALYTICS_PROVIDER,
      ['supabase', 'console', 'noop'],
      'supabase',
    ),
  }),
  env: oneOf(
    'VITE_APP_ENV',
    raw.VITE_APP_ENV,
    ['development', 'test', 'staging', 'production'],
    'development',
  ),
  logLevel: oneOf(
    'VITE_LOG_LEVEL',
    raw.VITE_LOG_LEVEL,
    ['debug', 'info', 'warn', 'error', 'silent'],
    // Development is chatty on purpose; a deployed build says only what an
    // operator needs to act on.
    raw.MODE === 'production' ? 'warn' : 'debug',
  ),
  enablePwa: raw.VITE_ENABLE_PWA !== 'false',
  appVersion: raw.VITE_APP_VERSION?.trim() || '1.0.0',
}) satisfies AppConfig;

export const isProduction = config.env === 'production';
export const isDevelopment = config.env === 'development';
