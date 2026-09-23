import { parseDashboardWords, parseSevenSegmentOdometerWords } from '@domain/ocr-parse.ts';
import type { OcrWord } from '@domain/ocr-parse.ts';
import { config } from '@/app/config';
import { preprocessForOcr } from '@/lib/image';
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
  results: TesseractResult[];
  odometer: OcrWord | null;
  afe: OcrWord | null;
}

const ENGINE_VERSION = 'tesseract.js-5';

const OCR_PARAMETERS = {
  // Labels are essential context. Excluding their letters made a gauge tick
  // such as "35" indistinguishable from an AFE reading and prevented "ODO"
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

export function chooseSevenSegmentOdometer(
  candidates: ReadonlyArray<{ value: number; sourceText: string }>,
  previousOdometerKm?: number | null,
): { value: number; sourceText: string } | null {
  if (candidates.length === 0) return null;

  const previous = previousOdometerKm ?? null;
  const grouped = new Map<number, { value: number; sourceText: string; votes: number }>();
  for (const candidate of candidates) {
    const value = Math.round(candidate.value * 10) / 10;
    if (!Number.isFinite(value) || value < 0) continue;
    const current = grouped.get(value);
    grouped.set(
      value,
      current ? { ...current, votes: current.votes + 1 } : { ...candidate, value, votes: 1 },
    );
  }

  const ranked = [...grouped.values()]
    .map((candidate) => {
      let score = candidate.votes * 10;
      if (previous != null) {
        const delta = candidate.value - previous;
        if (delta < -5) score -= 100;
        else if (delta <= 600) score += 30;
        else if (delta <= 2_000) score += 10;
        else score -= 30;
        score -= Math.min(Math.abs(delta) / 1_000, 10);
      }
      return { ...candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  // History influences which candidate wins, but it must never erase digits
  // that were actually readable. The domain parser will cap an odometer that
  // moves backwards to LOW confidence so the manager can correct it.
  if (!winner) return null;
  return { value: winner.value, sourceText: winner.sourceText };
}

async function readSevenSegmentOdometer(
  image: Blob,
  previousOdometerKm?: number | null,
): Promise<SevenSegmentPass> {
  // The framing guide keeps the instrument cluster centred. These overlapping
  // crops deliberately cover only the upper-left readout where ODO is shown;
  // excluding TRIP, AFE, the clock and gauge markings prevents a plausible but
  // semantically wrong number from winning.
  const odometerCrops = [
    // Zoomed camera image used by most phones.
    { x: 0.16, y: 0.18, width: 0.25, height: 0.16 },
    // Wider preview framing used by some Android/WebView cameras.
    { x: 0.3, y: 0.24, width: 0.2, height: 0.18 },
  ];
  const afeCrop = { x: 0.38, y: 0.3, width: 0.18, height: 0.18 };

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
      // Each prepared image is one small odometer line, not a page of sparse
      // text. Treating it as a line keeps separated seven-segment digits in
      // reading order.
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
    });
    const preparedOdometers = await Promise.all(
      odometerCrops.flatMap((crop) => [
        preprocessForOcr(image, { grayscale: true, crop, scale: 3 }),
        preprocessForOcr(image, { grayscale: true, autoContrast: true, crop, scale: 3 }),
      ]),
    );
    const preparedAfe = await Promise.all([
      preprocessForOcr(image, { grayscale: true, crop: afeCrop, scale: 3 }),
      preprocessForOcr(image, { grayscale: true, autoContrast: true, crop: afeCrop, scale: 3 }),
    ]);
    const odometerResults: TesseractResult[] = [];
    for (const variant of preparedOdometers) odometerResults.push(await worker.recognize(variant));
    const afeResults: TesseractResult[] = [];
    for (const variant of preparedAfe) afeResults.push(await worker.recognize(variant));
    const parsed = chooseSevenSegmentOdometer(
      odometerResults.flatMap((result) => {
        const reading = parseSevenSegmentOdometerWords(wordsFrom(result));
        return reading ? [reading] : [];
      }),
      previousOdometerKm,
    );
    const afeCandidates = afeResults
      .map((result) => result.data.text.trim())
      .map((text) => {
        const direct = text.match(/(\d{1,2})[.,](\d)/);
        if (direct) return { value: Number(`${direct[1]}.${direct[2]}`), sourceText: text };
        const digits = text.replace(/\D/g, '');
        return digits.length === 2
          ? { value: Number(`${digits[0]}.${digits[1]}`), sourceText: text }
          : null;
      })
      .filter(
        (candidate): candidate is { value: number; sourceText: string } =>
          candidate != null && candidate.value > 0 && candidate.value <= 30,
      );
    const afe = afeCandidates[0] ?? null;

    return {
      results: [...odometerResults, ...afeResults],
      odometer: parsed
        ? {
            text: String(parsed.value),
            // The specialised model frequently reports zero confidence even
            // for a correct display. Keep this conservative; bus history can
            // raise it when the value is plausible.
            confidence: 0.7,
          }
        : null,
      afe: afe ? { text: String(afe.value), confidence: 0.7 } : null,
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
    const candidates = passes.flatMap((pass) =>
      pass.readings.filter((item) => item.field === field),
    );
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
      // against the fixed ODO and AFE regions; a plausible-looking value
      // from general OCR (often TRIP A) must not suppress the reliable pass.
      request.onProgress?.(0.97);
      try {
        sevenSegmentPass = await readSevenSegmentOdometer(
          request.image,
          request.hints?.previousOdometerKm,
        );
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
          [{ text: 'ODO', confidence: 0.5 }, sevenSegmentPass.odometer],
          request.hints ?? {},
        ),
      );
    }
    if (sevenSegmentPass?.afe) {
      passes.push(
        parseDashboardWords(
          [{ text: 'AFE', confidence: 0.5 }, sevenSegmentPass.afe],
          request.hints ?? {},
        ),
      );
    }
    const parsed = mergePasses(passes);
    const durationMs = Math.round(performance.now() - started);

    logger.debug('Dashboard OCR complete', {
      readings: parsed.readings.map(({ field, value }) => ({ field, value })),
      missing: parsed.missing,
      sevenSegmentText: sevenSegmentPass?.results.map((item) => item.data.text) ?? null,
      durationMs,
    });

    return {
      parsed,
      // The raw payload is trimmed: full Tesseract output includes per-symbol
      // data that bloats the audit row without helping anyone read it later.
      raw: {
        text: result.data.text,
        focusedText: focusedResult?.data.text ?? null,
        sevenSegmentText: sevenSegmentPass?.results.map((item) => item.data.text) ?? null,
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
