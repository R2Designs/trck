/**
 * Shared domain vocabulary.
 *
 * This module is imported *verbatim* by both the browser bundle (via the
 * `@domain` alias) and the Supabase Edge Functions (via relative Deno imports).
 * It therefore has zero dependencies and uses no platform APIs — no `window`,
 * no `Deno`, no npm packages. Keep it that way: it is the reason the anomaly
 * rules that run on the server are provably the same ones the UI explains.
 *
 * Every union below mirrors a PostgreSQL enum declared in
 * `supabase/migrations/…_extensions_and_enums.sql`. The `*_VALUES` arrays exist
 * so that runtime validation, `<select>` options and i18n key generation can
 * all iterate the same source of truth.
 */

export const APP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DRIVER'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'INVITED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const APP_LOCALES = ['en', 'ta', 'te', 'kn'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const EMPLOYEE_TYPES = ['DRIVER', 'CONDUCTOR', 'HELPER', 'OTHER'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const FUEL_TYPES = ['DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'OTHER'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const BUS_STATUSES = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE'] as const;
export type BusStatus = (typeof BUS_STATUSES)[number];

export const DASHBOARD_TYPES = ['DIGITAL', 'SEGMENTED_LCD', 'ANALOG', 'MIXED', 'UNKNOWN'] as const;
export type DashboardType = (typeof DASHBOARD_TYPES)[number];

export const ROUTE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const TRIP_STATUSES = [
  'DRAFT',
  'STARTED',
  'COMPLETED',
  'REVIEW_REQUIRED',
  'CANCELLED',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const ATTENDANCE_TYPES = ['CHECK_IN', 'CHECK_OUT'] as const;
export type AttendanceType = (typeof ATTENDANCE_TYPES)[number];

export const ATTENDANCE_METHODS = ['FACE_RECOGNITION', 'MANUAL_OVERRIDE', 'MANUAL_SEARCH'] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

export const LIVENESS_RESULTS = ['PASSED', 'FAILED', 'SKIPPED', 'UNSUPPORTED'] as const;
export type LivenessResult = (typeof LIVENESS_RESULTS)[number];

export const CAPTURE_KINDS = ['TRIP_START', 'TRIP_END', 'AD_HOC'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const READING_FIELDS = ['ODOMETER', 'RANGE_KM', 'FUEL_PERCENT', 'TRIP_METER'] as const;
export type ReadingField = (typeof READING_FIELDS)[number];

export const READING_SOURCES = ['OCR', 'OCR_CORRECTED', 'MANUAL'] as const;
export type ReadingSource = (typeof READING_SOURCES)[number];

export const CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const ANOMALY_KINDS = [
  'DISTANCE_VARIANCE',
  'ODOMETER_IMPLAUSIBLE',
  'ODOMETER_REGRESSION',
  'RANGE_DROP',
  'LOW_EFFICIENCY',
  'FUEL_DROP_WITHOUT_DISTANCE',
  'READING_CONFIDENCE',
  'READING_CORRECTION',
  'MISSING_END_READING',
  'DURATION_INCONSISTENT',
  'DUPLICATE_CAPTURE',
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_REVIEW_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'REVIEWED_OK',
  'NEEDS_INVESTIGATION',
  'FALSE_POSITIVE',
  'READING_ERROR',
] as const;
export type AnomalyReviewStatus = (typeof ANOMALY_REVIEW_STATUSES)[number];

export const NOTIFICATION_KINDS = [
  'TRIP_MISSING_END_READING',
  'HIGH_SEVERITY_ANOMALY',
  'ATTENDANCE_MISSING',
  'LICENCE_EXPIRING',
  'BUS_REPEATED_ANOMALIES',
  'SYSTEM',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/** Reason codes offered when a manager records attendance by hand. */
export const OVERRIDE_REASON_CODES = [
  'CAMERA_UNAVAILABLE',
  'APPEARANCE_CHANGED',
  'NETWORK_ISSUE',
  'RECOGNITION_FAILED',
  'OTHER',
] as const;
export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];

/**
 * Plain-data shapes the domain functions operate on. They are intentionally
 * narrower than the database rows: a rule should depend on the three numbers it
 * needs, not on an entire ORM entity.
 */
export interface TripReadings {
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  startRangeKm: number | null;
  endRangeKm: number | null;
  startFuelPercent: number | null;
  endFuelPercent: number | null;
  refuelLitres: number | null;
}

export interface TripContext {
  expectedDistanceKm: number;
  distanceTolerancePct: number;
  startedAt: string | Date | null;
  endedAt: string | Date | null;
  tankCapacityLitres: number | null;
  fuelType: FuelType;
  /** Configured or manufacturer figure; only used when no baseline exists. */
  nominalEfficiencyKmpl: number | null;
}

/** Robust, learned statistics for one bus (optionally scoped to one route). */
export interface Baseline {
  sampleSize: number;
  medianEfficiencyKmpl: number | null;
  madEfficiencyKmpl: number | null;
  medianRangeDropPerKm: number | null;
  madRangeDropPerKm: number | null;
  medianDistanceKm: number | null;
}

export const EMPTY_BASELINE: Baseline = {
  sampleSize: 0,
  medianEfficiencyKmpl: null,
  madEfficiencyKmpl: null,
  medianRangeDropPerKm: null,
  madRangeDropPerKm: null,
  medianDistanceKm: null,
};
