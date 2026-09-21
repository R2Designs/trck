import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnomalyFinding } from '@domain/anomaly-engine.ts';
import type { AnomalyRow } from '@/lib/supabase/database.types';
import { formatConfidence, formatDistance, formatEfficiency, formatNumber } from '@/lib/format';

/**
 * Turning a finding into a sentence.
 *
 * The engine never produces prose — it produces a kind, an observed value, an
 * expected value and a few details. This hook is the only place those become
 * words, which is what makes the same anomaly readable in Tamil, Telugu and
 * Kannada without the engine knowing any of them exist.
 *
 * It is also where the product's tone is enforced. The explanations describe
 * what was measured and what is usual. They do not speculate about why, and
 * the "things this could be" list is offered separately, as possibilities for
 * a human to weigh.
 */

type Explainable = Pick<
  AnomalyFinding,
  'kind' | 'observedValue' | 'expectedValue' | 'variancePct' | 'detail'
>;

/** Normalises a database row into the same shape a live finding has. */
export function anomalyToExplainable(anomaly: AnomalyRow): Explainable {
  return {
    kind: anomaly.kind,
    observedValue: anomaly.observed_value,
    expectedValue: anomaly.expected_value,
    variancePct: anomaly.variance_pct,
    detail: (anomaly.detail ?? {}) as Record<string, unknown>,
  };
}

export function useAnomalyExplanation() {
  const { t } = useTranslation();

  return useCallback(
    (finding: Explainable): string => {
      const detail = (finding.detail ?? {}) as Record<string, unknown>;
      const observed = finding.observedValue;
      const expected = finding.expectedValue;

      switch (finding.kind) {
        case 'DISTANCE_VARIANCE': {
          const key =
            detail.direction === 'BELOW'
              ? 'anomalies.explanations.DISTANCE_VARIANCE_BELOW'
              : 'anomalies.explanations.DISTANCE_VARIANCE_ABOVE';
          return t(key, {
            observed: formatDistance(observed),
            expected: formatDistance(expected),
            variance: formatNumber(Math.abs(finding.variancePct ?? 0), {
              maximumFractionDigits: 0,
            }),
          });
        }

        case 'ODOMETER_REGRESSION':
          return t('anomalies.explanations.ODOMETER_REGRESSION', {
            observed: formatDistance(observed),
            expected: formatDistance(expected),
          });

        case 'ODOMETER_IMPLAUSIBLE':
          return t('anomalies.explanations.ODOMETER_IMPLAUSIBLE', {
            observed: formatDistance(observed),
            duration: formatNumber(Number(detail.durationMinutes ?? 0), {
              maximumFractionDigits: 0,
            }),
            speed: formatNumber(Number(detail.averageSpeedKmph ?? 0), { maximumFractionDigits: 0 }),
          });

        case 'RANGE_DROP':
          return t('anomalies.explanations.RANGE_DROP', {
            observed: formatDistance(observed),
            expected: formatDistance(expected),
            distance: formatDistance(Number(detail.distanceKm ?? 0)),
          });

        case 'LOW_EFFICIENCY':
          return t('anomalies.explanations.LOW_EFFICIENCY', {
            observed: formatEfficiency(observed),
            expected: formatEfficiency(expected),
          });

        case 'FUEL_DROP_WITHOUT_DISTANCE':
          return t('anomalies.explanations.FUEL_DROP_WITHOUT_DISTANCE', {
            observed: formatNumber(observed, { maximumFractionDigits: 1 }),
            distance: formatDistance(Number(detail.distanceKm ?? 0)),
          });

        case 'READING_CONFIDENCE':
          return t('anomalies.explanations.READING_CONFIDENCE', {
            field: t(`ocr.fields.${String(detail.field ?? 'ODOMETER')}`),
          });

        case 'READING_CORRECTION':
          return t('anomalies.explanations.READING_CORRECTION', {
            field: t(`ocr.fields.${String(detail.field ?? 'ODOMETER')}`),
            expected: formatNumber(expected, { maximumFractionDigits: 1 }),
            observed: formatNumber(observed, { maximumFractionDigits: 1 }),
          });

        case 'MISSING_END_READING':
          return t('anomalies.explanations.MISSING_END_READING');

        case 'DURATION_INCONSISTENT':
          return t('anomalies.explanations.DURATION_INCONSISTENT');

        case 'DUPLICATE_CAPTURE':
          return t('anomalies.explanations.DUPLICATE_CAPTURE');

        default:
          return t('anomalies.details.whyFlagged');
      }
    },
    [t],
  );
}

/** The "things this could be" list — possibilities, never conclusions. */
export function useAnomalyReasons() {
  const { t } = useTranslation();

  return useCallback(
    (finding: Explainable): string[] => {
      const reasons = (finding.detail as { reasons?: unknown })?.reasons;
      if (!Array.isArray(reasons)) return [];
      return reasons
        .filter((reason): reason is string => typeof reason === 'string')
        .map((reason) => t(`anomalies.reasons.${reason}`));
    },
    [t],
  );
}

/** Formats a raw 0–1 confidence for display next to a flagged reading. */
export function formatFindingConfidence(value: number | null | undefined): string {
  return formatConfidence(value);
}
