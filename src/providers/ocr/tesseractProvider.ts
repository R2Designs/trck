import {
  parseDashboardWords,
  parseSevenSegmentOdometerWords,
  parseSevenSegmentRangeWords,
} from '@domain/ocr-parse.ts';
import type { OcrWord } from '@domain/ocr-parse.ts';
import { config } from '@/app/config';
import { imageDimensions, preprocessForOcr } from '@/lib/image';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import type { DashboardReadRequest, DashboardReadResult, DashboardReadingProvider } from './types';

/**
 * Tesseract.js adapter.
 *
 * Honest about what it is: Tesseract was built for printed documents, and an
 * instrument cluster is not one. It does well on modern digital dashboards,
 * acceptably on segmented LCDs, and *not at all* on analogue dials — which is
 * why `dashboard_type` is stored per bus and the review screen always offers
 * manual entry. See docs/OCR.md for measured expectations.
 *
 * Configuration choices that matter:
 *   • the character set is restricted to digits, a decimal point, "km" and "%",
 *     which removes most hallucinated letters;
 *   • page segmentation is set to "sparse text", because a cluster is a
 *     scattering of numbers rather than paragraphs;
 *   • the worker is created once and reused, since spinning one up costs
 *     around a second on a low-end phone.
 */

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: Blob | string,
    options?: { rectangle?: { left: number; top: number; width: number; height: number } },
  ) => Promise<TesseractResult>;
  terminate: () => Promise<unknown>;
};

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    words?: Array<{
      text: string;
      confidence: number;
      bbox?: { x0: number; y0: number; x1: number; y1: number };
    }>;
  };
}

interface SevenSegmentPass {
  odometerResult: TesseractResult;
  rangeResult: TesseractResult | null;
  odometer: OcrWord | null;
  range: OcrWord | null;
}

const ENGINE_VERSION = 'tesseract.js-5';

const OCR_PARAMETERS = {
  // Labels are essential context. Excluding their letters made a gauge tick
  // such as "35" indistinguishable from a range reading and prevented "ODO"
  // from helping the parser select the odometer.
  tessedit_char_whitelist: '0123456789.,%abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/ ',
  tessedit_pageseg_mode: '11',
  preserve_interword_spaces: '1',
};

function wordsFrom(result: TesseractResult): OcrWord[] {
  return (result.data.words ?? [])
    .filter((word) => word.text.trim().length > 0)
    .map((word) => ({
      text: word.text.trim(),
      confidence: Math.max(0, Math.min(1, word.confidence / 100)),
      ...(word.bbox ? { bbox: word.bbox } : {}),
    }));
}

async function readSevenSegmentOdometer(image: Blob): Promise<SevenSegmentPass> {
  const dimensions = await imageDimensions(image);
  // The capture guide asks managers to keep the whole cluster in frame. Across
  // the supported dashboard photos, ODO is in this upper-left instrument
  // region. Reading the original photo matters: aggressive contrast made the
  // open left side of a seven-segment "4" disappear in real captures.
  const rectangle = {
    left: Math.round(dimensions.width * 0.08),
    top: Math.round(dimensions.height * 0.04),
    width: Math.round(dimensions.width * 0.44),
    height: Math.round(dimensions.height * 0.3),
  };

  const tesseract = await import('tesseract.js');
  const langPath = new URL(`${import.meta.env.BASE_URL}tessdata`, window.location.origin).href;
  const worker = (await tesseract.createWorker('7seg', 1, {
    langPath,
    ...(config.ocr.workerPath ? { workerPath: config.ocr.workerPath } : {}),
    ...(config.ocr.corePath ? { corePath: config.ocr.corePath } : {}),
  })) as unknown as TesseractWorker;

  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789., ',
      tessedit_pageseg_mode: '11',
      preserve_interword_spaces: '1',
    });
    const odometerResult = await worker.recognize(image, { rectangle });
    const parsed = parseSevenSegmentOdometerWords(wordsFrom(odometerResult));
    let rangeResult: TesseractResult | null = null;
    let range: OcrWord | null = null;

    if (parsed) {
      const sourceTokens = parsed.sourceText.split(/\s+/).filter(Boolean);
      const modelWords = odometerResult.data.words ?? [];
      const matched = modelWords.findIndex((word) => word.text.trim() === sourceTokens[0]);
      const matchedWords = matched < 0 ? [] : modelWords.slice(matched, matched + sourceTokens.length);
      const boxes = matchedWords.flatMap((word) => (word.bbox ? [word.bbox] : []));
      if (boxes.length > 0) {
        const bounds = {
          x0: Math.min(...boxes.map((box) => box.x0)),
          y0: Math.min(...boxes.map((box) => box.y0)),
          x1: Math.max(...boxes.map((box) => box.x1)),
          y1: Math.max(...boxes.map((box) => box.y1)),
        };
        const width = Math.max(1, bounds.x1 - bounds.x0);
        const height = Math.max(1, bounds.y1 - bounds.y0);
        const rangeRectangle = {
          left: Math.max(0, Math.round(bounds.x0 + width * 0.6)),
          top: Math.max(0, Math.round(bounds.y0 + height * 0.55)),
          // The AFE/range readout is consistently below-right of ODO, but its
          // glyphs are much narrower. Keep a minimum crop based on the whole
          // photo so the decimal/tenths digit is not clipped when ODO itself
          // has a tight recognition box.
          width: Math.round(Math.max(width * 1.1, dimensions.width * 0.24)),
          height: Math.round(Math.max(height * 2, dimensions.height * 0.235)),
        };
        rangeRectangle.width = Math.min(dimensions.width - rangeRectangle.left, rangeRectangle.width);
        rangeRectangle.height = Math.min(
          dimensions.height - rangeRectangle.top,
          rangeRectangle.height,
        );
        rangeResult = await worker.recognize(image, { rectangle: rangeRectangle });
        const parsedRange = parseSevenSegmentRangeWords(wordsFrom(rangeResult));
        if (parsedRange) {
          range = { text: String(parsedRange.value), confidence: 0.7 };
        }
      }
    }
    return {
      odometerResult,
      rangeResult,
      odometer: parsed
        ? {
            text: String(parsed.value),
            // The specialised model frequently reports zero confidence even
            // for a correct display. Keep this conservative; bus history can
            // raise it when the value is plausible.
            confidence: 0.7,
          }
        : null,
      range,
    };
  } finally {
    await worker.terminate();
  }
}

function mergePasses(
  passes: Array<ReturnType<typeof parseDashboardWords>>,
): ReturnType<typeof parseDashboardWords> {
  const fields = ['ODOMETER', 'RANGE_KM'] as const;
  const readings = fields.flatMap((field) => {
    const candidates = passes.flatMap((pass) => pass.readings.filter((item) => item.field === field));
    const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    return best ? [best] : [];
  });
  const found = new Set(readings.map((reading) => reading.field));
  return {
    readings,
    missing: fields.filter((field) => !found.has(field)),
    normalisedText: passes
      .map((pass) => pass.normalisedText)
      .filter(Boolean)
      .join(' | '),
  };
}

class TesseractDashboardProvider implements DashboardReadingProvider {
  readonly name = 'tesseract';
  readonly version = ENGINE_VERSION;

  private worker: TesseractWorker | null = null;
  private loading: Promise<void> | null = null;

  isLoaded(): boolean {
    return this.worker !== null;
  }

  async load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.worker) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        onProgress?.(0.1);
        const tesseract = await import('tesseract.js');
        onProgress?.(0.4);

        const worker = (await tesseract.createWorker('eng', 1, {
          ...(config.ocr.workerPath ? { workerPath: config.ocr.workerPath } : {}),
          ...(config.ocr.corePath ? { corePath: config.ocr.corePath } : {}),
          ...(config.ocr.langPath ? { langPath: config.ocr.langPath } : {}),
          logger: (message: { status: string; progress: number }) => {
            if (message.status === 'recognizing text') onProgress?.(0.4 + message.progress * 0.5);
          },
        })) as unknown as TesseractWorker;

        await worker.setParameters(OCR_PARAMETERS);

        this.worker = worker;
        onProgress?.(1);
        logger.info('OCR engine ready', { engine: this.name, version: this.version });
      } catch (error) {
        this.loading = null;
        logger.error('OCR engine failed to load', { error });
        throw new AppError('OCR engine failed to load', {
          kind: 'OCR',
          messageKey: 'errors.ocrFailed',
          retryable: true,
          cause: error,
        });
      }
    })();

    return this.loading;
  }

  async read(request: DashboardReadRequest): Promise<DashboardReadResult> {
    await this.load(request.onProgress);
    const worker = this.worker;
    if (!worker)
      throw new AppError('OCR engine unavailable', { kind: 'OCR', messageKey: 'errors.ocrFailed' });

    const started = performance.now();

    // Defaults chosen for an instrument cluster photographed in daylight:
    // desaturate, stretch contrast, sharpen the segment edges.
    const prepared = await preprocessForOcr(request.image, {
      grayscale: true,
      contrast: 1.45,
      sharpen: true,
      ...request.preprocess,
    });

    let result: TesseractResult;
    let focusedResult: TesseractResult | null = null;
    let sevenSegmentPass: SevenSegmentPass | null = null;
    try {
      result = await worker.recognize(prepared);

      const firstWords = wordsFrom(result);
      const firstParsed = parseDashboardWords(firstWords, request.hints ?? {});
      const firstOdometer = firstParsed.readings.find((reading) => reading.field === 'ODOMETER');

      // Seven-segment odometers are often too small in the full dashboard
      // frame, and the generic model frequently drops a visible tenths digit.
      // The focused English pass is useful only when that first result is weak.
      if (!firstOdometer || Number.isInteger(firstOdometer.value)) {
        request.onProgress?.(0.92);
        const focused = await preprocessForOcr(request.image, {
          grayscale: true,
          contrast: 1.7,
          sharpen: true,
          crop: { x: 0.08, y: 0.04, width: 0.84, height: 0.78 },
          scale: 2,
        });
        // Keep sparse-text mode for the focused pass: a dashboard is still a
        // set of independent readouts, not one paragraph or uniform block.
        await worker.setParameters(OCR_PARAMETERS);
        focusedResult = await worker.recognize(focused);
        await worker.setParameters(OCR_PARAMETERS);

      }

      // This fleet uses a stable dashboard layout. Always run the specialist
      // against the fixed ODO and AFE/range regions; a plausible-looking value
      // from general OCR (often TRIP A) must not suppress the reliable pass.
      request.onProgress?.(0.97);
      try {
        sevenSegmentPass = await readSevenSegmentOdometer(request.image);
      } catch (error) {
        // Manual review remains available offline if the optional model asset
        // cannot be loaded.
        logger.warn('Seven-segment OCR fallback failed', { error });
      }
    } catch (error) {
      // Leave the shared worker in its normal mode after a failed focused pass.
      await worker.setParameters(OCR_PARAMETERS).catch(() => undefined);
      logger.warn('OCR recognition failed', { error });
      return {
        parsed: {
          readings: [],
          missing: ['ODOMETER', 'RANGE_KM'],
          normalisedText: '',
        },
        raw: { error: error instanceof Error ? error.message : String(error) },
        engine: this.name,
        engineVersion: this.version,
        durationMs: Math.round(performance.now() - started),
        status: 'FAILED',
      };
    }

    const words = wordsFrom(result);
    const passes = [parseDashboardWords(words, request.hints ?? {})];
    if (focusedResult) {
      passes.push(parseDashboardWords(wordsFrom(focusedResult), request.hints ?? {}));
    }
    if (sevenSegmentPass?.odometer) {
      passes.push(
        parseDashboardWords(
          [
            { text: 'ODO', confidence: 0.5 },
            sevenSegmentPass.odometer,
            ...(sevenSegmentPass.range
              ? [{ text: 'RANGE', confidence: 0.5 }, sevenSegmentPass.range]
              : []),
          ],
          request.hints ?? {},
        ),
      );
    }
    const parsed = mergePasses(passes);
    const durationMs = Math.round(performance.now() - started);

    logger.debug('Dashboard OCR complete', {
      readings: parsed.readings.map(({ field, value }) => ({ field, value })),
      missing: parsed.missing,
      sevenSegmentText: sevenSegmentPass?.odometerResult.data.text ?? null,
      sevenSegmentRangeText: sevenSegmentPass?.rangeResult?.data.text ?? null,
      durationMs,
    });

    return {
      parsed,
      // The raw payload is trimmed: full Tesseract output includes per-symbol
      // data that bloats the audit row without helping anyone read it later.
      raw: {
        text: result.data.text,
        focusedText: focusedResult?.data.text ?? null,
        sevenSegmentText: sevenSegmentPass?.odometerResult.data.text ?? null,
        sevenSegmentRangeText: sevenSegmentPass?.rangeResult?.data.text ?? null,
        confidence: result.data.confidence,
        wordCount: words.length + (focusedResult ? wordsFrom(focusedResult).length : 0),
      },
      engine: this.name,
      engineVersion: this.version,
      durationMs,
      status:
        parsed.readings.length === 0
          ? 'FAILED'
          : parsed.missing.length > 0
            ? 'PARTIAL'
            : 'SUCCEEDED',
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.worker?.terminate();
    } catch (error) {
      logger.warn('OCR worker termination failed', { error });
    }
    this.worker = null;
    this.loading = null;
  }
}

export const tesseractDashboardProvider: DashboardReadingProvider =
  new TesseractDashboardProvider();
