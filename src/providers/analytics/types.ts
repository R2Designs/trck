import type { AppLocale } from '@domain/types.ts';

/**
 * Product analytics.
 *
 * Constraints this design is built around:
 *   • **No paid vendor.** Events go to the project's own Postgres table by
 *     default, which costs nothing and keeps the data inside the tenant.
 *   • **No personal data, ever.** The event map below is exhaustive and typed;
 *     a property that is not declared cannot be sent. There are no free-form
 *     string bags, because that is how names and registration numbers end up
 *     in an analytics table by accident.
 *   • **Never a descriptor or an image.** Biometric payloads are rejected by
 *     construction — none of the declared properties can hold one.
 *
 * The events themselves are the ones that answer operational questions: is the
 * face scanner working in the field, how often does OCR need correcting, how
 * often do managers fall back to manual entry.
 */

export interface AnalyticsEventMap {
  login_success: { role: string };
  employee_created: { employee_type: string };
  employee_face_enrolled: { photo_count: number; usable_count: number; mean_quality: number };
  attendance_scan_started: { has_scheduled_driver: boolean };
  attendance_scan_success: {
    decision: 'AUTO_ACCEPT' | 'REVIEW';
    similarity_band: 'high' | 'medium';
    candidate_count: number;
    duration_ms: number;
  };
  attendance_scan_failed: {
    reason:
      'NO_FACE' | 'MULTIPLE_FACES' | 'LOW_CONFIDENCE' | 'LIVENESS' | 'QUALITY' | 'NO_CANDIDATES';
    duration_ms: number;
  };
  attendance_manual_override: { reason_code: string };
  trip_started: { has_start_reading: boolean };
  dashboard_capture_started: { kind: 'TRIP_START' | 'TRIP_END'; dashboard_type: string };
  dashboard_ocr_success: { fields_found: number; mean_confidence: number; duration_ms: number };
  dashboard_ocr_corrected: { field: string; substantial: boolean };
  trip_completed: { with_override: boolean; anomaly_count: number };
  anomaly_created: { kind: string; severity: string };
  anomaly_reviewed: { outcome: string };
  language_changed: { locale: AppLocale };
  report_exported: { report: string; row_count: number };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export interface AnalyticsEvent<K extends AnalyticsEventName = AnalyticsEventName> {
  name: K;
  properties: AnalyticsEventMap[K];
  occurredAt: string;
}

export interface AnalyticsContext {
  organizationId: string | null;
  depotId: string | null;
  userId: string | null;
  locale: AppLocale | null;
  appVersion: string;
}

export interface AnalyticsProvider {
  readonly name: string;
  /** Called once the identity is known; may be called again when it changes. */
  identify(context: AnalyticsContext): void;
  track<K extends AnalyticsEventName>(name: K, properties: AnalyticsEventMap[K]): void;
  /** Sends anything buffered. Called on page hide. */
  flush(): Promise<void>;
}
