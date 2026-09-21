import { parseDashboardText } from '@domain/ocr-parse.ts';
import type { DashboardReadRequest, DashboardReadResult, DashboardReadingProvider } from './types';

/**
 * Scripted OCR, for tests and demos.
 *
 * Playwright cannot photograph a bus, and downloading the Tesseract WASM core
 * on every CI run is both slow and flaky. This provider returns whatever text
 * the test told it to, then runs it through the *real* parser — so the parsing
 * behaviour under test is the production one.
 */

let scriptedText = 'ODO 186420 km RANGE 275 km FUEL 58%';
let scriptedConfidence = 0.9;
let shouldFail = false;

export function configureMockOcr(options: {
  text?: string;
  confidence?: number;
  fail?: boolean;
}): void {
  if (options.text !== undefined) scriptedText = options.text;
  if (options.confidence !== undefined) scriptedConfidence = options.confidence;
  if (options.fail !== undefined) shouldFail = options.fail;
}

class MockDashboardProvider implements DashboardReadingProvider {
  readonly name = 'mock';
  readonly version = 'mock-1';
  private loaded = false;

  isLoaded(): boolean {
    return this.loaded;
  }

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    onProgress?.(1);
    this.loaded = true;
  }

  async read(request: DashboardReadRequest): Promise<DashboardReadResult> {
    request.onProgress?.(1);

    if (shouldFail) {
      return {
        parsed: {
          readings: [],
          missing: ['ODOMETER', 'RANGE_KM', 'FUEL_PERCENT'],
          normalisedText: '',
        },
        raw: { mock: true },
        engine: this.name,
        engineVersion: this.version,
        durationMs: 1,
        status: 'FAILED',
      };
    }

    const parsed = parseDashboardText(scriptedText, scriptedConfidence, request.hints ?? {});
    return {
      parsed,
      raw: { text: scriptedText, mock: true },
      engine: this.name,
      engineVersion: this.version,
      durationMs: 1,
      status: parsed.missing.length > 0 ? 'PARTIAL' : 'SUCCEEDED',
    };
  }

  async dispose(): Promise<void> {
    this.loaded = false;
  }
}

export const mockDashboardProvider: DashboardReadingProvider = new MockDashboardProvider();
