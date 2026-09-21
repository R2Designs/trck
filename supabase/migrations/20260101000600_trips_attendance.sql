-- ============================================================================
-- trck — 0006 · Trips and attendance
-- ============================================================================

create table public.trips (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  depot_id              uuid not null references public.depots (id) on delete restrict,
  bus_id                uuid not null references public.buses (id) on delete restrict,
  route_id              uuid not null references public.routes (id) on delete restrict,
  driver_id             uuid references public.employees (id) on delete restrict,
  manager_id            uuid references public.profiles (id) on delete set null,

  status                trip_status not null default 'DRAFT',
  planned_start_time    timestamptz,
  actual_start_time     timestamptz,
  actual_end_time       timestamptz,

  -- Snapshotted from the route at start: editing a route later must not
  -- retroactively change how an old trip was judged.
  expected_distance_km  numeric(7, 2) not null,
  distance_tolerance_pct numeric(5, 2) not null default 10,

  start_odometer_km     numeric(10, 1),
  end_odometer_km       numeric(10, 1),
  start_range_km        numeric(7, 1),
  end_range_km          numeric(7, 1),
  start_fuel_percent    numeric(5, 2),
  end_fuel_percent      numeric(5, 2),
  refuel_litres         numeric(7, 2),

  start_capture_id      uuid,
  end_capture_id        uuid,

  -- Derived on completion by public.fn_finalise_trip (migration 0012).
  calculated_distance_km   numeric(10, 1),
  distance_variance_km     numeric(10, 1),
  distance_variance_pct    numeric(7, 2),
  calculated_efficiency_kmpl numeric(6, 2),
  duration_minutes         integer,
  anomaly_score            numeric(5, 2) not null default 0,
  review_status            anomaly_review_status not null default 'OPEN',

  -- Manager consciously completed a trip with an incomplete reading set.
  completion_override      boolean not null default false,
  completion_override_reason text,

  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  cancelled_at          timestamptz,
  cancel_reason         text,

  constraint trips_expected_distance_positive check (expected_distance_km > 0),
  constraint trips_odometers_nonneg check (
    (start_odometer_km is null or start_odometer_km >= 0)
    and (end_odometer_km is null or end_odometer_km >= 0)
  ),
  constraint trips_fuel_percent_range check (
    (start_fuel_percent is null or start_fuel_percent between 0 and 100)
    and (end_fuel_percent is null or end_fuel_percent between 0 and 100)
  ),
  constraint trips_range_nonneg check (
    (start_range_km is null or start_range_km >= 0) and (end_range_km is null or end_range_km >= 0)
  ),
  constraint trips_refuel_nonneg check (refuel_litres is null or refuel_litres >= 0),
  constraint trips_time_order check (
    actual_end_time is null or actual_start_time is null or actual_end_time >= actual_start_time
  ),
  -- An end odometer *below* the start is not merely unusual, it is impossible.
  -- Rather than silently storing it we reject it; the UI offers correction.
  constraint trips_odometer_not_regressed check (
    end_odometer_km is null or start_odometer_km is null or end_odometer_km >= start_odometer_km
  ),
  constraint trips_override_needs_reason check (
    completion_override = false
    or (completion_override_reason is not null and char_length(trim(completion_override_reason)) >= 5)
  ),
  constraint trips_started_needs_time check (
    status <> 'STARTED' or actual_start_time is not null
  ),
  constraint trips_completed_needs_times check (
    status not in ('COMPLETED', 'REVIEW_REQUIRED')
    or (actual_start_time is not null and actual_end_time is not null)
  )
);

create index trips_depot_status_idx on public.trips (depot_id, status);
create index trips_bus_started_idx on public.trips (bus_id, actual_start_time desc);
create index trips_driver_idx on public.trips (driver_id, actual_start_time desc);
-- Range scans on a timestamptz column, rather than an expression index: casting
-- to date is only STABLE (it depends on TimeZone), so it cannot be indexed.
create index trips_org_started_idx on public.trips (organization_id, actual_start_time desc);
create index trips_org_ended_idx on public.trips (organization_id, actual_end_time desc);
create index trips_review_idx on public.trips (organization_id, review_status)
  where review_status in ('OPEN', 'NEEDS_INVESTIGATION');

-- A bus can only be on one live trip at a time. Enforced in the database, not
-- just in the UI, because two managers may act on the same bus concurrently.
create unique index trips_one_open_per_bus
  on public.trips (bus_id)
  where status = 'STARTED';

-- ---------------------------------------------------------------------------

create table public.attendance_records (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  depot_id               uuid not null references public.depots (id) on delete restrict,
  employee_id            uuid not null references public.employees (id) on delete restrict,
  manager_id             uuid not null references public.profiles (id) on delete restrict,
  route_id               uuid references public.routes (id) on delete set null,
  bus_id                 uuid references public.buses (id) on delete set null,
  trip_id                uuid references public.trips (id) on delete set null,

  attendance_type        attendance_type not null default 'CHECK_IN',
  -- Local business day at the depot; the uniqueness rule below hangs off it.
  attendance_date        date not null default (now() at time zone 'Asia/Kolkata')::date,
  recorded_at            timestamptz not null default now(),

  method                 attendance_method not null,
  face_match_score       numeric(5, 4),
  face_match_threshold   numeric(5, 4),
  recognition_provider   text,
  recognition_model_version text,
  liveness               liveness_result not null default 'SKIPPED',
  liveness_score         numeric(5, 4),

  manual_override        boolean not null default false,
  override_reason_code   text,
  override_reason        text,

  -- Non-identifying client context, useful when investigating a dispute.
  device_metadata        jsonb not null default '{}'::jsonb,

  created_at             timestamptz not null default now(),

  constraint attendance_score_range check (
    face_match_score is null or (face_match_score >= 0 and face_match_score <= 1)
  ),
  constraint attendance_threshold_range check (
    face_match_threshold is null or (face_match_threshold >= 0 and face_match_threshold <= 1)
  ),
  -- Face-recognised rows must carry the evidence that justified them.
  constraint attendance_face_requires_evidence check (
    method <> 'FACE_RECOGNITION'
    or (face_match_score is not null and face_match_threshold is not null
        and recognition_provider is not null and recognition_model_version is not null)
  ),
  -- A manual override must always say why. This is the audit backbone.
  constraint attendance_override_requires_reason check (
    manual_override = false
    or (override_reason_code is not null and char_length(trim(coalesce(override_reason, ''))) >= 3)
  ),
  constraint attendance_method_override_consistent check (
    (method = 'MANUAL_OVERRIDE') = manual_override
  )
);

-- One check-in per employee per depot day. Attempting a second one surfaces
-- "Attendance already recorded" with the original timestamp.
create unique index attendance_unique_per_day
  on public.attendance_records (employee_id, attendance_date, attendance_type)
  where trip_id is null;

-- When attendance is tied to a specific trip, the trip scopes uniqueness.
create unique index attendance_unique_per_trip
  on public.attendance_records (employee_id, trip_id, attendance_type)
  where trip_id is not null;

create index attendance_depot_date_idx on public.attendance_records (depot_id, attendance_date desc);
create index attendance_employee_idx on public.attendance_records (employee_id, attendance_date desc);
create index attendance_org_date_idx on public.attendance_records (organization_id, attendance_date desc);
create index attendance_manual_idx on public.attendance_records (organization_id, attendance_date desc)
  where manual_override;
