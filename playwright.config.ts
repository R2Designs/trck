import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These specs run against a *real* Supabase project seeded with `seed.sql` —
 * the whole point is to exercise RLS, the RPCs and the Edge Functions rather
 * than a mock of them. They are therefore skipped unless `E2E_BASE_URL` is
 * set, so `npm test` stays runnable on a laptop with no backend.
 *
 * The primary device is a mid-range Android phone, because that is what a
 * depot manager actually holds. Desktop is a secondary projection, not the
 * design target.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Camera permission is granted up front: the face and dashboard flows are
    // the core journeys, and a permission prompt is not what is under test.
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  projects: [
    {
      name: 'android-phone',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
