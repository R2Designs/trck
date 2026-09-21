-- ============================================================================
-- trck — 0009 · Audit log, settings, preferences, notifications, events
-- ============================================================================

-- Immutable by construction: no UPDATE or DELETE policy is ever granted, and a
-- trigger (migration 0010) additionally blocks both for every non-superuser.
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete restrict,
  depot_id        uuid references public.depots (id) on delete set null,
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_email     text,
  actor_role      app_role,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  entity_label    text,
  before_values   jsonb,
  after_values    jsonb,
  -- Request context: IP / user-agent / app version. Never biometric data.
  context         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  constraint audit_logs_action_format check (action ~ '^[A-Z][A-Z0-9_.]{2,63}$')
);
create index audit_logs_org_time_idx on public.audit_logs (organization_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);

comment on table public.audit_logs is
  'Append-only. before/after values are redacted of biometric payloads by '
  'public.fn_write_audit before insertion.';

-- ---------------------------------------------------------------------------
-- Operational thresholds. One row per organization; JSONB is used only for the
-- open-ended rule map, while the hot, queried knobs are real columns.

create table public.app_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,

  distance_tolerance_pct        numeric(5, 2) not null default 10,
  efficiency_drop_tolerance_pct numeric(5, 2) not null default 20,
  range_drop_tolerance_pct      numeric(5, 2) not null default 35,
  min_trips_for_baseline        smallint not null default 8,
  baseline_window_days          smallint not null default 90,

  -- Face matching. Distances below auto_accept are confirmed with one tap;
  -- between auto_accept and review the manager must eyeball the photo; above
  -- review it is simply "not verified".
  face_auto_accept_similarity   numeric(4, 3) not null default 0.62,
  face_review_similarity        numeric(4, 3) not null default 0.50,
  face_min_quality              numeric(4, 3) not null default 0.45,
  face_require_liveness         boolean not null default true,
  face_min_enrolment_photos     smallint not null default 3,

  ocr_high_confidence           numeric(4, 3) not null default 0.85,
  ocr_medium_confidence         numeric(4, 3) not null default 0.60,

  photo_retention_days          integer not null default 365,
  dashboard_capture_retention_days integer not null default 180,
  attendance_retention_days     integer not null default 2555,

  -- Rule enable/disable + per-rule overrides, keyed by anomaly_kind.
  anomaly_rules                 jsonb not null default '{}'::jsonb,

  updated_at                    timestamptz not null default now(),
  updated_by                    uuid references public.profiles (id) on delete set null,

  constraint app_settings_pcts check (
    distance_tolerance_pct between 0 and 200
    and efficiency_drop_tolerance_pct between 0 and 100
    and range_drop_tolerance_pct between 0 and 200
  ),
  constraint app_settings_face_thresholds check (
    face_auto_accept_similarity > face_review_similarity
    and face_auto_accept_similarity between 0 and 1
    and face_review_similarity between 0 and 1
    and face_min_quality between 0 and 1
  ),
  constraint app_settings_ocr_thresholds check (
    ocr_high_confidence > ocr_medium_confidence
    and ocr_high_confidence between 0 and 1
    and ocr_medium_confidence between 0 and 1
  ),
  constraint app_settings_baseline check (
    min_trips_for_baseline between 1 and 200 and baseline_window_days between 7 and 730
  ),
  constraint app_settings_retention check (
    photo_retention_days between 1 and 3650
    and dashboard_capture_retention_days between 1 and 3650
    and attendance_retention_days between 30 and 3650
  )
);

-- ---------------------------------------------------------------------------

create table public.user_preferences (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  locale          app_locale,
  theme           text not null default 'system',
  -- Depot a manager lands on when they open the app (multi-depot managers).
  default_depot_id uuid references public.depots (id) on delete set null,
  dense_tables    boolean not null default false,
  reduce_motion   boolean not null default false,
  updated_at      timestamptz not null default now(),
  constraint user_preferences_theme check (theme in ('light', 'dark', 'system'))
);

-- ---------------------------------------------------------------------------
-- In-app notifications. A NotificationProvider abstraction in the client can
-- later fan these out to email / push / WhatsApp without schema changes.

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  depot_id        uuid references public.depots (id) on delete cascade,
  recipient_id    uuid references public.profiles (id) on delete cascade,
  -- NULL recipient + role => broadcast to every holder of that role in scope.
  recipient_role  app_role,
  kind            notification_kind not null,
  severity        notification_severity not null default 'INFO',
  title_key       text not null,
  body_key        text not null,
  payload         jsonb not null default '{}'::jsonb,
  entity_type     text,
  entity_id       uuid,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  constraint notifications_target check (recipient_id is not null or recipient_role is not null)
);
create index notifications_inbox_idx on public.notifications (recipient_id, created_at desc)
  where read_at is null;
create index notifications_role_idx on public.notifications (organization_id, recipient_role, created_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Privacy-safe product analytics. No PII, no biometric payloads: `properties`
-- is validated client-side against a typed event map before it is sent.

create table public.analytics_events (
  id              bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  depot_id        uuid references public.depots (id) on delete set null,
  user_id         uuid references public.profiles (id) on delete set null,
  name            text not null,
  properties      jsonb not null default '{}'::jsonb,
  app_version     text,
  locale          app_locale,
  occurred_at     timestamptz not null default now(),
  constraint analytics_events_name_format check (name ~ '^[a-z][a-z0-9_]{2,63}$')
);
create index analytics_events_org_time_idx on public.analytics_events (organization_id, occurred_at desc);
create index analytics_events_name_idx on public.analytics_events (name, occurred_at desc);
