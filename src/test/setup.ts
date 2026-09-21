/**
 * Vitest global setup.
 *
 * Provides the browser APIs jsdom does not implement but the product relies on:
 * media devices, matchMedia, IntersectionObserver and a deterministic clock
 * hook. Nothing here fakes application behaviour — only platform surface.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- matchMedia (theme + reduced motion) -----------------------------------
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// --- IntersectionObserver / ResizeObserver ---------------------------------
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: NoopObserver });
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: NoopObserver });

// --- Camera ----------------------------------------------------------------
// Tests that exercise camera UI opt in by overriding these; by default the
// environment reports "no camera", which is itself a state the UI must handle.
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    value: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('No camera', 'NotFoundError')),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
}

// jsdom implements neither of these, and the image pipeline touches both.
if (!('createObjectURL' in URL)) {
  Object.defineProperty(URL, 'createObjectURL', { writable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: () => undefined });
}

Object.defineProperty(window, 'scrollTo', { writable: true, value: vi.fn() });

// --- ImageData -------------------------------------------------------------
// jsdom only provides ImageData when the optional `canvas` package is
// installed, which drags in a native build. The image pipeline is pure
// arithmetic over the pixel buffer, so a faithful minimal shim is enough and
// keeps `npm test` free of native dependencies.
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataShim {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb' as const;

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
      }
    }
  }
  Object.defineProperty(globalThis, 'ImageData', { writable: true, value: ImageDataShim });
}
