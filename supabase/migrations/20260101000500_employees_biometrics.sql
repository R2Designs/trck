-- ============================================================================
-- trck — 0005 · Employees and biometric enrolment
-- ============================================================================
-- Biometric data is the most sensitive thing in this system. Three deliberate
-- choices:
--   1. Embeddings live in their own table, never in the employee row, so a
--      normal employee query can never accidentally leak them.
--   2. Raw photos live in *private* object storage; only the path is stored.
--   3. Consent, retention and deletion are first-class columns, not policy
--      documents. See docs/SECURITY.md ("Biometric data").
-- ============================================================================

create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete restrict,
  depot_id           uuid not null references public.depots (id) on delete restrict,
  -- Human-facing staff number printed on the ID card.
  employee_code      text not null,
  full_name          text not null,
  employee_type      employee_type not null default 'DRIVER',
  phone              text,
  employment_status  employment_status not null default 'ACTIVE',
  joining_date       date,
  licence_number     text,
  licence_expiry     date,
  emergency_contact_name  text,
  emergency_contact_phone text,
  notes              text,
  -- Populated only if/when drivers are later given their own login. The column
  -- exists now so adding driver accounts is a data change, not a redesign.
  user_id            uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  deactivated_at     timestamptz,

  constraint employees_code_format check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,31}$'),
  constraint employees_name_len check (char_length(trim(full_name)) between 2 and 120),
  constraint employees_phone_format check (phone is null or phone ~ '^[+]?[0-9 ()-]{6,20}$'),
  constraint employees_emergency_phone_format check (
    emergency_contact_phone is null or emergency_contact_phone ~ '^[+]?[0-9 ()-]{6,20}$'
  ),
  constraint employees_licence_for_driver check (
    employee_type <> 'DRIVER' or licence_number is null or char_length(licence_number) >= 4
  ),
  constraint employees_licence_expiry_needs_number check (
    licence_expiry is null or licence_number is not null
  )
);
create unique index employees_org_code_key on public.employees (organization_id, upper(employee_code));
create index employees_depot_active_idx
  on public.employees (depot_id, employment_status)
  where deactivated_at is null;
create index employees_org_type_idx on public.employees (organization_id, employee_type);
create index employees_name_trgm on public.employees using gin (full_name gin_trgm_ops);
create index employees_licence_expiry_idx
  on public.employees (organization_id, licence_expiry)
  where licence_expiry is not null and employment_status = 'ACTIVE';
create unique index employees_user_id_key on public.employees (user_id) where user_id is not null;

comment on table public.employees is
  'Drivers, conductors and helpers. Never hard-deleted: historical attendance '
  'and trips must stay resolvable. Use deactivated_at + employment_status.';

-- ---------------------------------------------------------------------------
-- Explicit, revocable consent for biometric enrolment.

create table public.biometric_consents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  -- Which consent text version the employee was shown.
  notice_version    text not null,
  acknowledged_by   uuid not null references public.profiles (id) on delete restrict,
  acknowledged_at   timestamptz not null default now(),
  -- Retention window for raw photos; embeddings follow the enrolment lifecycle.
  photo_retention_days integer not null default 365,
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete set null,
  revoke_reason     text,
  constraint biometric_consents_retention_range check (photo_retention_days between 1 and 3650)
);
create unique index biometric_consents_active_key
  on public.biometric_consents (employee_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Raw enrolment photos. Only storage coordinates + quality metrics here.

create table public.employee_photos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  storage_provider  text not null default 'supabase',
  storage_bucket    text not null,
  storage_path      text not null,
  content_type      text not null default 'image/jpeg',
  byte_size         integer not null,
  width             integer,
  height            integer,
  -- 0..1 composite of sharpness / face-size / brightness / single-face checks.
  quality_score     numeric(4, 3),
  pose_hint         text,
  captured_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  -- Set by the retention job; the row survives for audit, the object does not.
  purged_at         timestamptz,

  constraint employee_photos_size_limit check (byte_size > 0 and byte_size <= 8 * 1024 * 1024),
  constraint employee_photos_quality_range check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  constraint employee_photos_content_type check (content_type in ('image/jpeg', 'image/png', 'image/webp'))
);
create index employee_photos_employee_idx on public.employee_photos (employee_id) where purged_at is null;
create unique index employee_photos_path_key on public.employee_photos (storage_bucket, storage_path);

-- ---------------------------------------------------------------------------
-- Face descriptors. Stored as float8[] rather than a vector extension so the
-- schema runs on any free-tier Postgres; candidate sets are always small
-- (one depot / one route), so brute-force cosine in the client is fine.
-- See docs/FACE_RECOGNITION.md ("Why no pgvector (yet)").

create table public.face_embeddings (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  photo_id          uuid references public.employee_photos (id) on delete set null,
  provider          text not null,
  model_version     text not null,
  dimensions        smallint not null,
  embedding         double precision[] not null,
  quality_score     numeric(4, 3),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id) on delete set null,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles (id) on delete set null,
  delete_reason     text,

  constraint face_embeddings_dimensions_match check (array_length(embedding, 1) = dimensions),
  constraint face_embeddings_dimensions_range check (dimensions between 32 and 2048),
  constraint face_embeddings_quality_range check (
    quality_score is null or (quality_score >= 0 and quality_score <= 1)
  )
);
create index face_embeddings_candidate_idx
  on public.face_embeddings (depot_id, is_active)
  where deleted_at is null;
create index face_embeddings_employee_idx on public.face_embeddings (employee_id);

comment on table public.face_embeddings is
  'HIGHLY SENSITIVE. Readable only through the enrolment and attendance paths; '
  'never joined into ordinary employee list queries.';

-- ---------------------------------------------------------------------------
-- Which driver is expected on which bus/route. Used to build a small, sensible
-- candidate set for face matching instead of scanning the whole organization.

create table public.driver_assignments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete restrict,
  depot_id          uuid not null references public.depots (id) on delete restrict,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  bus_id            uuid references public.buses (id) on delete set null,
  route_id          uuid references public.routes (id) on delete set null,
  effective_from    date not null default current_date,
  effective_to      date,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id) on delete set null,
  constraint driver_assignments_period check (effective_to is null or effective_to >= effective_from),
  constraint driver_assignments_target check (bus_id is not null or route_id is not null)
);
create index driver_assignments_lookup_idx
  on public.driver_assignments (depot_id, effective_from desc);
create index driver_assignments_route_idx on public.driver_assignments (route_id) where route_id is not null;
create index driver_assignments_bus_idx on public.driver_assignments (bus_id) where bus_id is not null;
create index driver_assignments_employee_idx on public.driver_assignments (employee_id);
