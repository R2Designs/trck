-- ============================================================================
-- trck — 0001 · Extensions and domain enumerations
-- ============================================================================
-- Every enum below is a *closed* operational vocabulary. Values are stored as
-- stable SCREAMING_SNAKE identifiers and are translated in the client, never in
-- the database, so that adding a language never requires a migration.
-- ============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- trigram search on names / regs
create extension if not exists "btree_gist";    -- exclusion constraints

-- --- Identity / access ------------------------------------------------------
do $$ begin
  create type app_role as enum ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DRIVER');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type account_status as enum ('ACTIVE', 'INACTIVE', 'INVITED');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type app_locale as enum ('en', 'ta', 'te', 'kn');
exception when duplicate_object then null; end; $$;

-- --- People -----------------------------------------------------------------
do $$ begin
  create type employee_type as enum ('DRIVER', 'CONDUCTOR', 'HELPER', 'OTHER');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type employment_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end; $$;

-- --- Fleet ------------------------------------------------------------------
do $$ begin
  create type fuel_type as enum ('DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'OTHER');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type bus_status as enum ('AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'OUT_OF_SERVICE');
exception when duplicate_object then null; end; $$;

-- Recorded per bus so the OCR pipeline can pick a parsing strategy instead of
-- pretending one heuristic reads every instrument cluster. See docs/OCR.md.
do $$ begin
  create type dashboard_type as enum ('DIGITAL', 'SEGMENTED_LCD', 'ANALOG', 'MIXED', 'UNKNOWN');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type route_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null; end; $$;

-- --- Trips / attendance -----------------------------------------------------
do $$ begin
  create type trip_status as enum ('DRAFT', 'STARTED', 'COMPLETED', 'REVIEW_REQUIRED', 'CANCELLED');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type attendance_type as enum ('CHECK_IN', 'CHECK_OUT');
exception when duplicate_object then null; end; $$;

-- How the identity was established. Deliberately explicit: an attendance row
-- must always be able to answer "how do we know this was that person?".
do $$ begin
  create type attendance_method as enum ('FACE_RECOGNITION', 'MANUAL_OVERRIDE', 'MANUAL_SEARCH');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type liveness_result as enum ('PASSED', 'FAILED', 'SKIPPED', 'UNSUPPORTED');
exception when duplicate_object then null; end; $$;

-- --- Captures / readings ----------------------------------------------------
do $$ begin
  create type capture_kind as enum ('TRIP_START', 'TRIP_END', 'AD_HOC');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type reading_field as enum ('ODOMETER', 'RANGE_KM', 'FUEL_PERCENT', 'TRIP_METER');
exception when duplicate_object then null; end; $$;

-- Provenance of the final stored value.
do $$ begin
  create type reading_source as enum ('OCR', 'OCR_CORRECTED', 'MANUAL');
exception when duplicate_object then null; end; $$;

do $$ begin
  create type confidence_band as enum ('HIGH', 'MEDIUM', 'LOW');
exception when duplicate_object then null; end; $$;

-- --- Anomalies --------------------------------------------------------------
do $$ begin
  create type anomaly_kind as enum (
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
    'DUPLICATE_CAPTURE'
  );
exception when duplicate_object then null; end; $$;

do $$ begin
  create type anomaly_severity as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end; $$;

-- Note the vocabulary: the system never concludes "fraud" or "theft".
do $$ begin
  create type anomaly_review_status as enum (
    'OPEN',
    'IN_REVIEW',
    'REVIEWED_OK',
    'NEEDS_INVESTIGATION',
    'FALSE_POSITIVE',
    'READING_ERROR'
  );
exception when duplicate_object then null; end; $$;

-- --- Notifications ----------------------------------------------------------
do $$ begin
  create type notification_kind as enum (
    'TRIP_MISSING_END_READING',
    'HIGH_SEVERITY_ANOMALY',
    'ATTENDANCE_MISSING',
    'LICENCE_EXPIRING',
    'BUS_REPEATED_ANOMALIES',
    'SYSTEM'
  );
exception when duplicate_object then null; end; $$;

do $$ begin
  create type notification_severity as enum ('INFO', 'WARNING', 'CRITICAL');
exception when duplicate_object then null; end; $$;
