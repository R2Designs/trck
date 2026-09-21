import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

const configuredBase = process.env.VITE_BASE_PATH?.trim() || '/';
const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'fonts/*.woff2'],
      manifest: {
        name: 'trck — Bus Fleet Operations',
        short_name: 'trck',
        description: 'Attendance, trips and fuel anomaly review for bus fleets.',
        theme_color: '#0b3d2c',
        background_color: '#000001',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          {
            src: `${base}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${base}icons/maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Static deployments must not leave users on an older UI after a push.
        // Activate the newly generated worker as soon as it is installed.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Face/OCR model weights are large; never precache them.
        globIgnores: ['**/models/**', '**/*.wasm'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api/, /^\/auth/],
        runtimeCaching: [
          {
            // Reference data (routes, buses, depots) — stale-while-revalidate for
            // fast cold starts in weak-signal parking lots.
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'trck-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'trck-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // The specialist seven-segment model is ~10 MB. Download it only
            // after ordinary OCR misses an odometer, then keep it for future
            // depot captures and offline use.
            urlPattern: ({ url }) => url.pathname.includes('/tessdata/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'trck-ocr-models',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The domain layer is shared verbatim with the Supabase Edge Functions,
      // so there is exactly one implementation of the anomaly rules, the OCR
      // parser and the face-matching maths. See docs/ARCHITECTURE.md.
      '@domain': path.resolve(__dirname, './supabase/functions/_shared/domain'),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-forms': ['react-hook-form', 'zod', '@hookform/resolvers'],
          'vendor-charts': ['recharts'],
          'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
