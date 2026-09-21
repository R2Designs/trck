-- ============================================================================
-- trck — 0007 · Dashboard captures, OCR readings, fuel entries
-- ============================================================================
-- The contract between the camera and the trip record:
--   dashboard_captures  = the photograph + the raw engine response (evidence)
--   dashboard_readings  = one row per extracted field, with confidence and the
--                         manager's correction, if any        (interpretation)
-- A trip only ever consumes *readings*, never the raw OCR blob.
-- ============================================================================

create table public.dashboard_captures (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  bus_id            uuid not null references public.buses (id) on delete restrict,
  trip_id           uuid references public.trips (id) on delete set null,
  kind              capture_kind not null,

  storage_provider  text not null default 'supabase',
  storage_bucket    text not null,
  storage_path      text not null,
  content_type      text not null default 'image/jpeg',
  byte_size         integer not null,
  width             integer,
  height            integer,
  -- Perceptual hash of the compressed image. Two identical hashes for the same
  -- bus within a short window means the same photo was submitted twice.
  image_hash        text,

  captured_at       timestamptz not null default now(),
  captured_by       uuid not null references public.profiles (id) on delete restrict,

  ocr_provider      text,
  ocr_engine_version text,
  ocr_status        text not null default 'PENDING',
  ocr_duration_ms   integer,
  -- Raw engine output. JSONB is acceptable *here* precisely because it is an
  -- opaque third-party payload kept for audit, not queryable business data.
  ocr_raw_response  jsonb,
  preprocessing     jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  purged_at         timestamptz,

  constraint dashboard_captures_size_limit check (byte_size > 0 and byte_size <= 8 * 1024 * 1024),
  constraint dashboard_captures_content_type check (
    content_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint dashboard_captures_ocr_status check (
    ocr_status in ('PENDING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED')
  )
);
create unique index dashboard_captures_path_key on public.dashboard_captures (storage_bucket, storage_path);
create index dashboard_captures_trip_idx on public.dashboard_captures (trip_id, kind);
create index dashboard_captures_bus_idx on public.dashboard_captures (bus_id, captured_at desc);
create index dashboard_captures_hash_idx on public.dashboard_captures (bus_id, image_hash)
  where image_hash is not null;

alter table public.trips
  add constraint trips_start_capture_fk
    foreign key (start_capture_id) references public.dashboard_captures (id) on delete set null,
  add constraint trips_end_capture_fk
    foreign key (end_capture_id) references public.dashboard_captures (id) on delete set null;

-- ---------------------------------------------------------------------------

create table public.dashboard_readings (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  depot_id           uuid not null references public.depots (id) on delete restrict,
  capture_id         uuid not null references public.dashboard_captures (id) on delete cascade,
  trip_id            uuid references public.trips (id) on delete set null,
  field              reading_field not null,

  -- What the engine thought it saw (may be NULL when nothing was legible).
  ocr_text           text,
  ocr_value          numeric(12, 2),
  ocr_confidence     numeric(5, 4),
  confidence_band    confidence_band,

  -- What the manager confirmed. This is the value the trip actually uses.
  final_value        numeric(12, 2),
  source             reading_source not null,
  was_corrected      boolean not null default false,
  corrected_by       uuid references public.profiles (id) on delete set null,
  corrected_at       timestamptz,

  created_at         timestamptz not null default now(),

  constraint dashboard_readings_confidence_range check (
    ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)
  ),
  constraint dashboard_readings_fuel_percent_range check (
    field <> 'FUEL_PERCENT' or final_value is null or (final_value between 0 and 100)
  ),
  constraint dashboard_readings_nonneg check (final_value is null or final_value >= 0),
  constraint dashboard_readings_correction_consistent check (
    (was_corrected = false and source <> 'OCR_CORRECTED')
    or (was_corrected = true and corrected_by is not null and corrected_at is not null)
  ),
  -- A value that came from OCR must carry its confidence; a manual value must not
  -- masquerade as one.
  constraint dashboard_readings_source_consistent check (
    (source = 'MANUAL' and ocr_confidence is null)
    or (source in ('OCR', 'OCR_CORRECTED'))
  )
);
create unique index dashboard_readings_capture_field_key on public.dashboard_readings (capture_id, field);
create index dashboard_readings_trip_idx on public.dashboard_readings (trip_id);
create index dashboard_readings_lowconf_idx on public.dashboard_readings (organization_id, created_at desc)
  where confidence_band = 'LOW' or was_corrected;

-- ---------------------------------------------------------------------------
-- Actual fuel purchases. Only when these exist can the system speak about
-- litres; otherwise it speaks about range and percentage *indicators*.

create table public.fuel_entries (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  bus_id            uuid not null references public.buses (id) on delete restrict,
  trip_id           uuid references public.trips (id) on delete set null,
  filled_at         timestamptz not null default now(),
  litres            numeric(8, 2) not null,
  cost_amount       numeric(10, 2),
  currency          char(3) not null default 'INR',
  odometer_km       numeric(10, 1),
  is_full_tank      boolean not null default false,
  vendor            text,
  reference_no      text,
  notes             text,
  recorded_by       uuid not null references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  constraint fuel_entries_litres_positive check (litres > 0 and litres <= 2000),
  constraint fuel_entries_cost_nonneg check (cost_amount is null or cost_amount >= 0),
  constraint fuel_entries_odometer_nonneg check (odometer_km is null or odometer_km >= 0)
);
create index fuel_entries_bus_idx on public.fuel_entries (bus_id, filled_at desc);
create index fuel_entries_trip_idx on public.fuel_entries (trip_id) where trip_id is not null;
