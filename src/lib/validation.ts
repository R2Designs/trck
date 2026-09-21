/**
 * Validation schemas.
 *
 * Two rules:
 *
 *  1. **Messages are translation keys, never sentences.** `zod` carries the
 *     key; the form renders `t(key)`. A validation error in Kannada is not an
 *     afterthought, it is the same code path as English.
 *  2. **This is the convenience layer, not the guarantee.** Every constraint
 *     here has a matching CHECK constraint or RPC guard in PostgreSQL. The
 *     client validation exists so the manager learns about the problem before
 *     the round trip, not so the server can trust the payload.
 */

import { z } from 'zod';
import {
  BUS_STATUSES,
  DASHBOARD_TYPES,
  EMPLOYEE_TYPES,
  EMPLOYMENT_STATUSES,
  FUEL_TYPES,
  OVERRIDE_REASON_CODES,
  ROUTE_STATUSES,
} from '@domain/types.ts';

const required = (message = 'validation.required') => z.string().trim().min(1, message);

/** Accepts "27.5" and "27,5"; rejects anything that is not a finite number. */
export const numeric = (options: { min?: number; max?: number; integer?: boolean } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.')),
    )
    .refine((value) => Number.isFinite(value), { message: 'validation.number' })
    .refine((value) => (options.integer ? Number.isInteger(value) : true), {
      message: 'validation.integer',
    })
    .refine((value) => (options.min === undefined ? true : value >= options.min), {
      message: 'validation.min',
    })
    .refine((value) => (options.max === undefined ? true : value <= options.max), {
      message: 'validation.max',
    });

export const optionalNumeric = (options: Parameters<typeof numeric>[0] = {}) =>
  z
    .union([z.literal(''), z.null(), z.undefined(), numeric(options)])
    .transform((value) => (value === '' || value == null ? null : (value as number)));

export const emailSchema = required().email('validation.email').toLowerCase();

export const passwordSchema = z
  .string()
  .min(10, 'validation.passwordMin')
  // Deliberately modest: length beats character-class theatre, and a rule the
  // manager cannot satisfy on a phone keyboard just produces "Passw0rd!".
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), {
    message: 'validation.passwordStrength',
  });

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+]?[0-9 ()-]{6,20}$/, 'validation.phone');

export const optionalPhone = z
  .union([z.literal(''), z.null(), z.undefined(), phoneSchema])
  .transform((value) => (value == null || value === '' ? null : value));

const optionalText = (max = 500) =>
  z
    .union([z.string().trim().max(max, 'validation.maxLength'), z.null(), z.undefined()])
    .transform((value) => (value ? value : null));

const optionalDate = z
  .union([z.literal(''), z.string().date('validation.date'), z.null(), z.undefined()])
  .transform((value) => (value ? value : null));

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employeeSchema = z
  .object({
    employee_code: required()
      .max(32, 'validation.maxLength')
      .regex(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/, 'validation.required'),
    full_name: required().min(2, 'validation.minLength').max(120, 'validation.maxLength'),
    employee_type: z.enum(EMPLOYEE_TYPES),
    depot_id: required('validation.selectOne').uuid('validation.selectOne'),
    phone: optionalPhone,
    employment_status: z.enum(EMPLOYMENT_STATUSES).default('ACTIVE'),
    joining_date: optionalDate,
    licence_number: optionalText(40),
    licence_expiry: optionalDate,
    emergency_contact_name: optionalText(120),
    emergency_contact_phone: optionalPhone,
    notes: optionalText(1000),
  })
  // A licence expiry with no licence number is a data-entry slip, not a state
  // the business ever wants stored.
  .refine((value) => !value.licence_expiry || Boolean(value.licence_number), {
    path: ['licence_number'],
    message: 'validation.required',
  });

export type EmployeeFormValues = z.input<typeof employeeSchema>;

// ---------------------------------------------------------------------------
// Buses
// ---------------------------------------------------------------------------

/** Indian commercial plates, tolerant of the spacing people actually type. */
const REGISTRATION_PATTERN = /^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{0,3}[ -]?[0-9]{1,4}$/i;

export const busSchema = z.object({
  registration_number: required()
    .max(20, 'validation.maxLength')
    .regex(REGISTRATION_PATTERN, 'validation.registrationNumber')
    .transform((value) => value.toUpperCase()),
  fleet_number: optionalText(24),
  depot_id: required('validation.selectOne').uuid('validation.selectOne'),
  make: optionalText(60),
  model: optionalText(60),
  manufacturing_year: optionalNumeric({
    min: 1950,
    max: new Date().getFullYear() + 1,
    integer: true,
  }),
  fuel_type: z.enum(FUEL_TYPES).default('DIESEL'),
  dashboard_type: z.enum(DASHBOARD_TYPES).default('UNKNOWN'),
  tank_capacity_litres: optionalNumeric({ min: 1, max: 2000 }),
  nominal_efficiency_kmpl: optionalNumeric({ min: 0.1, max: 60 }),
  starting_odometer_km: numeric({ min: 0, max: 9_999_999 }),
  status: z.enum(BUS_STATUSES).default('AVAILABLE'),
  notes: optionalText(1000),
});

export type BusFormValues = z.input<typeof busSchema>;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const routeSchema = z.object({
  name: required().min(3, 'validation.minLength').max(120, 'validation.maxLength'),
  code: required()
    .max(24, 'validation.maxLength')
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'validation.required')
    .transform((value) => value.toUpperCase()),
  depot_id: required('validation.selectOne').uuid('validation.selectOne'),
  origin: required().max(120, 'validation.maxLength'),
  destination: required().max(120, 'validation.maxLength'),
  expected_distance_km: numeric({ min: 0.1, max: 5000 }),
  distance_tolerance_pct: numeric({ min: 0, max: 100 }),
  typical_duration_minutes: optionalNumeric({ min: 1, max: 1440, integer: true }),
  status: z.enum(ROUTE_STATUSES).default('ACTIVE'),
  notes: optionalText(1000),
});

export type RouteFormValues = z.input<typeof routeSchema>;

export const routeStopSchema = z.object({
  name: required().max(120, 'validation.maxLength'),
  distance_from_origin_km: optionalNumeric({ min: 0, max: 5000 }),
});

// ---------------------------------------------------------------------------
// Dashboard readings
// ---------------------------------------------------------------------------

export const readingsSchema = z.object({
  odometer_km: optionalNumeric({ min: 0, max: 9_999_999 }),
  range_km: optionalNumeric({ min: 0, max: 5000 }),
  fuel_percent: optionalNumeric({ min: 0, max: 100 }),
});

export type ReadingsFormValues = z.input<typeof readingsSchema>;

/**
 * Trip completion.
 *
 * The cross-field rule is the important one: an end odometer below the start
 * is physically impossible, so the form refuses it rather than letting the
 * server reject it after the manager has walked away from the bus.
 */
export const completeTripSchema = (startOdometer: number | null) =>
  z
    .object({
      odometer_km: optionalNumeric({ min: 0, max: 9_999_999 }),
      range_km: optionalNumeric({ min: 0, max: 5000 }),
      fuel_percent: optionalNumeric({ min: 0, max: 100 }),
      refuel_litres: optionalNumeric({ min: 0, max: 2000 }),
      override: z.boolean().default(false),
      override_reason: optionalText(500),
    })
    .refine((value) => value.override || value.odometer_km != null, {
      path: ['odometer_km'],
      message: 'validation.required',
    })
    .refine(
      (value) =>
        value.odometer_km == null || startOdometer == null || value.odometer_km >= startOdometer,
      { path: ['odometer_km'], message: 'validation.endOdometerBelowStart' },
    )
    .refine((value) => !value.override || (value.override_reason ?? '').trim().length >= 5, {
      path: ['override_reason'],
      message: 'validation.required',
    });

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const manualAttendanceSchema = z.object({
  employee_id: required('validation.selectOne').uuid('validation.selectOne'),
  reason_code: z.enum(OVERRIDE_REASON_CODES),
  reason: required('validation.required')
    .min(3, 'validation.minLength')
    .max(500, 'validation.maxLength'),
});

// ---------------------------------------------------------------------------
// Anomaly review
// ---------------------------------------------------------------------------

export const anomalyReviewSchema = z.object({
  new_status: z.enum(['REVIEWED_OK', 'NEEDS_INVESTIGATION', 'FALSE_POSITIVE', 'READING_ERROR']),
  // Ten characters is a low bar that still forces a sentence rather than "ok".
  notes: required('anomalies.review.notesRequired').min(10, 'anomalies.review.notesRequired'),
});

export type AnomalyReviewFormValues = z.input<typeof anomalyReviewSchema>;

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const inviteManagerSchema = z.object({
  full_name: required().min(2, 'validation.minLength').max(120, 'validation.maxLength'),
  email: emailSchema,
  depot_ids: z.array(z.string().uuid()).min(1, 'validation.selectAtLeastOne'),
});

export const depotSchema = z.object({
  name: required().min(2, 'validation.minLength').max(120, 'validation.maxLength'),
  code: required()
    .max(24, 'validation.maxLength')
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'validation.required')
    .transform((value) => value.toUpperCase()),
  city: optionalText(80),
  state: optionalText(80),
  address_line: optionalText(240),
});

export const thresholdsSchema = z
  .object({
    distance_tolerance_pct: numeric({ min: 0, max: 200 }),
    efficiency_drop_tolerance_pct: numeric({ min: 0, max: 100 }),
    range_drop_tolerance_pct: numeric({ min: 0, max: 200 }),
    min_trips_for_baseline: numeric({ min: 1, max: 200, integer: true }),
    baseline_window_days: numeric({ min: 7, max: 730, integer: true }),
    face_auto_accept_similarity: numeric({ min: 0, max: 1 }),
    face_review_similarity: numeric({ min: 0, max: 1 }),
    face_min_quality: numeric({ min: 0, max: 1 }),
    face_require_liveness: z.boolean(),
    face_min_enrolment_photos: numeric({ min: 1, max: 10, integer: true }),
    ocr_high_confidence: numeric({ min: 0, max: 1 }),
    ocr_medium_confidence: numeric({ min: 0, max: 1 }),
    photo_retention_days: numeric({ min: 1, max: 3650, integer: true }),
    dashboard_capture_retention_days: numeric({ min: 1, max: 3650, integer: true }),
    attendance_retention_days: numeric({ min: 30, max: 3650, integer: true }),
  })
  .refine((value) => value.face_auto_accept_similarity > value.face_review_similarity, {
    path: ['face_auto_accept_similarity'],
    message: 'validation.min',
  })
  .refine((value) => value.ocr_high_confidence > value.ocr_medium_confidence, {
    path: ['ocr_high_confidence'],
    message: 'validation.min',
  });

export type ThresholdsFormValues = z.input<typeof thresholdsSchema>;
