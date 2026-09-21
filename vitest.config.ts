import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The domain layer is shared verbatim with the Supabase Edge Functions,
      // so there is exactly one implementation of the anomaly rules, the OCR
      // parser and the face-matching maths. See docs/ARCHITECTURE.md.
      '@domain': path.resolve(__dirname, './supabase/functions/_shared/domain'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // `src/app/config.ts` refuses to load without these, by design — a missing
    // Supabase URL should stop the app at boot rather than fail mysteriously on
    // the first query. Tests get throwaway values so that guard stays intact.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_ANALYTICS_PROVIDER: 'noop',
      VITE_FACE_PROVIDER: 'mock',
      VITE_OCR_PROVIDER: 'mock',
      VITE_LOG_LEVEL: 'silent',
    },
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/unit/**/*.{test,spec}.ts',
      'tests/integration/**/*.{test,spec}.ts',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/lib/**', 'src/providers/**', 'supabase/functions/_shared/domain/**'],
    },
    testTimeout: 15000,
  },
});
