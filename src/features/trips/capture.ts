import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { confidenceBand } from '@domain/thresholds.ts';
import type { Thresholds } from '@domain/thresholds.ts';
import type { CaptureKind, ReadingField } from '@domain/types.ts';
import type { ParsedReading } from '@domain/ocr-parse.ts';
import { supabase } from '@/lib/supabase/client';
import { getStorageProvider, buildDashboardObjectKey } from '@/providers/storage';
import { getDashboardReadingProvider } from '@/providers/ocr';
import { prepareImage } from '@/lib/image';
import type { PreparedImage } from '@/lib/image';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { trackEvent } from '@/providers/analytics';
import { useAuth } from '@/features/auth/session';

/**
 * The dashboard capture pipeline.
 *
 * Deliberate ordering, driven by the network rather than by tidiness:
 *
 *   photograph → compress → read locally → **manager reviews** → upload + save
 *
 * OCR runs on-device, so a retake costs nothing but a second. The upload only
 * happens once the manager has confirmed the numbers, which means a discarded
 * photo never costs a manager on a weak connection a megabyte of data.
 *
 * What ends up stored: the compressed image (private bucket, EXIF stripped),
 * the raw engine response for audit, and one row per field carrying what the
 * engine read, how confident it was, what the manager finally confirmed, and
 * whether they changed it.
 */

export interface ReviewableReading {
  field: ReadingField;
  ocrValue: number | null;
  ocrText: string | null;
  ocrConfidence: number | null;
  band: ReturnType<typeof confidenceBand> | null;
  /** What the manager has in the box right now. */
  value: string;
  /** True once they have typed over what OCR produced. */
  edited: boolean;
}

export interface CaptureDraft {
  image: PreparedImage;
  readings: ReviewableReading[];
  engine: string;
  engineVersion: string;
  raw: unknown;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  durationMs: number;
  /** Set when this exact photograph was already submitted for this bus. */
  duplicateOfCaptureId: string | null;
}

const REVIEW_FIELDS: ReadingField[] = ['ODOMETER', 'RANGE_KM'];

function toReviewable(
  parsed: readonly ParsedReading[],
  thresholds: Thresholds,
): ReviewableReading[] {
  return REVIEW_FIELDS.map((field) => {
    const reading = parsed.find((item) => item.field === field);
    return {
      field,
      ocrValue: reading?.value ?? null,
      ocrText: reading?.sourceText ?? null,
      ocrConfidence: reading?.confidence ?? null,
      band: reading ? confidenceBand(reading.confidence, thresholds) : null,
      value: reading ? String(reading.value) : '',
      edited: false,
    };
  });
}

export function useDashboardCapture(options: {
  busId: string;
  dashboardType: string;
  previousOdometerKm: number | null;
  isElectric: boolean;
  thresholds: Thresholds;
}) {
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const previousUrl = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
    previousUrl.current = null;
    setDraft(null);
    setError(null);
    setProgress(0);
  }, []);

  /** Compress, read on-device, and look for a duplicate — no upload yet. */
  const process = useCallback(
    async (blob: Blob, kind: CaptureKind) => {
      setProcessing(true);
      setError(null);
      setProgress(0);

      try {
        trackEvent('dashboard_capture_started', {
          kind: kind === 'TRIP_END' ? 'TRIP_END' : 'TRIP_START',
          dashboard_type: options.dashboardType,
        });

        const image = await prepareImage(blob, 'dashboard');
        if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
        previousUrl.current = image.previewUrl;
        setProgress(0.2);

        // Analogue dials are not readable by an OCR engine built for printed
        // text. Saying so and going straight to manual entry is more honest —
        // and faster — than producing a confident wrong number.
        const skipOcr = options.dashboardType === 'ANALOG';

        let readings: ReviewableReading[] = toReviewable([], options.thresholds);
        let engine = 'manual';
        let engineVersion = '-';
        let raw: unknown = null;
        let status: CaptureDraft['status'] = 'FAILED';
        let durationMs = 0;

        if (!skipOcr) {
          const provider = getDashboardReadingProvider();
          const result = await provider.read({
            image: image.blob,
            hints: {
              previousOdometerKm: options.previousOdometerKm,
              isElectric: options.isElectric,
            },
            onProgress: (fraction) => setProgress(0.2 + fraction * 0.7),
          });

          readings = toReviewable(result.parsed.readings, options.thresholds);
          engine = result.engine;
          engineVersion = result.engineVersion;
          raw = result.raw;
          status = result.status;
          durationMs = result.durationMs;

          if (result.status !== 'FAILED') {
            const found = result.parsed.readings;
            trackEvent('dashboard_ocr_success', {
              fields_found: found.length,
              mean_confidence:
                found.length === 0
                  ? 0
                  : Math.round(
                      (found.reduce((sum, r) => sum + r.confidence, 0) / found.length) * 100,
                    ) / 100,
              duration_ms: result.durationMs,
            });
          }
        }

        // Duplicate detection: the same photograph submitted twice for the same
        // bus is worth flagging, but it is not an error — the manager may have
        // a legitimate reason, so this only annotates the draft.
        const duplicate = await supabase
          .from('dashboard_captures')
          .select('id')
          .eq('bus_id', options.busId)
          .eq('image_hash', image.hash)
          .limit(1)
          .maybeSingle();

        setProgress(1);
        setDraft({
          image,
          readings,
          engine,
          engineVersion,
          raw,
          status,
          durationMs,
          duplicateOfCaptureId: duplicate.data?.id ?? null,
        });
      } catch (caught) {
        logger.warn('Dashboard capture processing failed', { error: caught });
        setError(caught);
      } finally {
        setProcessing(false);
      }
    },
    [
      options.busId,
      options.dashboardType,
      options.isElectric,
      options.previousOdometerKm,
      options.thresholds,
    ],
  );

  const updateReading = useCallback((field: ReadingField, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        readings: current.readings.map((reading) =>
          reading.field === field
            ? { ...reading, value, edited: value !== (reading.ocrValue?.toString() ?? '') }
            : reading,
        ),
      };
    });
  }, []);

  return { draft, processing, progress, error, process, reset, updateReading };
}

export interface CommitCaptureInput {
  draft: CaptureDraft;
  busId: string;
  depotId: string;
  kind: CaptureKind;
  tripId?: string | null;
  thresholds: Thresholds;
}

export interface CommitCaptureResult {
  captureId: string;
  odometerKm: number | null;
  rangeKm: number | null;
  fuelPercent: number | null;
}

/** Uploads the confirmed photograph and writes the capture plus its readings. */
export function useCommitCapture() {
  const { identity } = useAuth();

  return useMutation({
    mutationKey: ['capture.commit'],
    mutationFn: async (input: CommitCaptureInput): Promise<CommitCaptureResult> => {
      if (!identity) throw new Error('Not authenticated');

      const storage = getStorageProvider();
      const fileId = crypto.randomUUID();
      const path = buildDashboardObjectKey({
        organizationId: identity.organizationId,
        busId: input.busId,
        tripId: input.tripId ?? null,
        fileId,
      });

      const uploaded = await storage.upload({
        bucket: 'dashboards',
        path,
        body: input.draft.image.blob,
        contentType: 'image/jpeg',
      });

      const capture = await supabase
        .from('dashboard_captures')
        .insert({
          organization_id: identity.organizationId,
          depot_id: input.depotId,
          bus_id: input.busId,
          trip_id: input.tripId ?? null,
          kind: input.kind,
          storage_provider: uploaded.provider,
          storage_bucket: uploaded.bucket,
          storage_path: uploaded.path,
          content_type: 'image/jpeg',
          byte_size: input.draft.image.byteSize,
          width: input.draft.image.width,
          height: input.draft.image.height,
          image_hash: input.draft.image.hash,
          captured_by: identity.user.id,
          ocr_provider: input.draft.engine,
          ocr_engine_version: input.draft.engineVersion,
          ocr_status: input.draft.status,
          ocr_duration_ms: input.draft.durationMs,
          ocr_raw_response: (input.draft.raw ?? null) as never,
          preprocessing: { grayscale: true, contrast: 1.45, sharpen: true } as never,
        })
        .select('id')
        .single();

      if (capture.error) throw capture.error;
      const captureId = capture.data.id;

      const parsedValues: Record<ReadingField, number | null> = {
        ODOMETER: null,
        RANGE_KM: null,
        FUEL_PERCENT: null,
        TRIP_METER: null,
      };

      const rows = input.draft.readings
        .map((reading) => {
          const trimmed = reading.value.trim();
          if (trimmed === '') return null;
          const finalValue = Number.parseFloat(trimmed.replace(',', '.'));
          if (!Number.isFinite(finalValue)) return null;
          parsedValues[reading.field] = finalValue;

          const corrected = reading.ocrValue != null && finalValue !== reading.ocrValue;
          const manual = reading.ocrValue == null;

          if (corrected) {
            trackEvent('dashboard_ocr_corrected', {
              field: reading.field,
              substantial:
                Math.abs(finalValue - (reading.ocrValue as number)) /
                  Math.max(Math.abs(reading.ocrValue as number), 1) >
                0.05,
            });
          }

          return {
            organization_id: identity.organizationId,
            depot_id: input.depotId,
            capture_id: captureId,
            trip_id: input.tripId ?? null,
            field: reading.field,
            ocr_text: reading.ocrText,
            ocr_value: reading.ocrValue,
            ocr_confidence: manual ? null : reading.ocrConfidence,
            confidence_band: reading.band,
            final_value: finalValue,
            source: manual
              ? ('MANUAL' as const)
              : corrected
                ? ('OCR_CORRECTED' as const)
                : ('OCR' as const),
            was_corrected: corrected,
            corrected_by: corrected ? identity.user.id : null,
            corrected_at: corrected ? new Date().toISOString() : null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        const readings = await supabase.from('dashboard_readings').insert(rows);
        if (readings.error) throw readings.error;
      }

      if (parsedValues.ODOMETER == null) {
        throw new AppError('Odometer reading missing', {
          kind: 'VALIDATION',
          messageKey: 'errors.endReadingRequired',
          retryable: false,
        });
      }

      return {
        captureId,
        odometerKm: parsedValues.ODOMETER,
        rangeKm: parsedValues.RANGE_KM,
        fuelPercent: parsedValues.FUEL_PERCENT,
      };
    },
  });
}
