-- ============================================================================
-- trck — 0008 · Anomalies, reviews and learned baselines
-- ============================================================================
-- Language rule, enforced by schema design as well as by copy: this system
-- records *anomalies requiring review*. It never records an accusation.
-- ============================================================================

create table public.anomalies (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  trip_id           uuid references public.trips (id) on delete cascade,
  bus_id            uuid references public.buses (id) on delete restrict,
  driver_id         uuid references public.employees (id) on delete restrict,
  route_id          uuid references public.routes (id) on delete set null,
  capture_id        uuid references public.dashboard_captures (id) on delete set null,

  kind              anomaly_kind not null,
  severity          anomaly_severity not null,
  -- 0..100. Comparable across kinds; used only for ordering the review queue.
  score             numeric(5, 2) not null default 0,

  -- The three numbers a reviewer always wants first.
  observed_value    numeric(12, 3),
  expected_value    numeric(12, 3),
  variance_pct      numeric(8, 2),
  unit              text,

  -- Which rule fired, and with what configuration, so a historical anomaly can
  -- still be explained after thresholds are changed.
  rule_code         text not null,
  rule_version      smallint not null default 1,
  threshold_snapshot jsonb not null default '{}'::jsonb,
  -- i18n key + interpolation values; never a pre-translated sentence.
  detail            jsonb not null default '{}'::jsonb,

  review_status     anomaly_review_status not null default 'OPEN',
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles (id) on delete set null,

  detected_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint anomalies_score_range check (score >= 0 and score <= 100),
  constraint anomalies_resolution_consistent check (
    (review_status in ('OPEN', 'IN_REVIEW') and resolved_at is null)
    or (review_status not in ('OPEN', 'IN_REVIEW') and resolved_at is not null)
  )
);
-- The same rule must not raise twice for the same trip.
create unique index anomalies_trip_rule_key on public.anomalies (trip_id, kind, rule_code)
  where trip_id is not null;
create index anomalies_open_idx on public.anomalies (organization_id, severity, detected_at desc)
  where review_status in ('OPEN', 'IN_REVIEW', 'NEEDS_INVESTIGATION');
create index anomalies_depot_idx on public.anomalies (depot_id, detected_at desc);
create index anomalies_bus_idx on public.anomalies (bus_id, detected_at desc);

-- ---------------------------------------------------------------------------
-- Append-only review trail. Every state change is a new row.

create table public.anomaly_reviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  anomaly_id      uuid not null references public.anomalies (id) on delete cascade,
  previous_status anomaly_review_status,
  new_status      anomaly_review_status not null,
  notes           text,
  reviewed_by     uuid not null references public.profiles (id) on delete restrict,
  reviewed_at     timestamptz not null default now(),
  -- High-severity outcomes must be justified in writing.
  constraint anomaly_reviews_notes_required check (
    new_status in ('IN_REVIEW')
    or char_length(trim(coalesce(notes, ''))) >= 10
  )
);
create index anomaly_reviews_anomaly_idx on public.anomaly_reviews (anomaly_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- Learned, robust per-bus baselines. Recomputed from *valid completed trips*
-- only; medians rather than means so one wild reading cannot move the bar.

create table public.bus_baselines (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  bus_id                 uuid not null references public.buses (id) on delete cascade,
  route_id               uuid references public.routes (id) on delete cascade,
  sample_size            integer not null default 0,
  median_efficiency_kmpl numeric(6, 2),
  mad_efficiency_kmpl    numeric(6, 2),
  median_range_drop_per_km numeric(6, 3),
  mad_range_drop_per_km  numeric(6, 3),
  median_distance_km     numeric(8, 2),
  window_start           date,
  window_end             date,
  computed_at            timestamptz not null default now(),
  constraint bus_baselines_sample_nonneg check (sample_size >= 0)
);
create unique index bus_baselines_bus_route_key
  on public.bus_baselines (bus_id, coalesce(route_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index bus_baselines_org_idx on public.bus_baselines (organization_id);
