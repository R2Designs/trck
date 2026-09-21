-- ============================================================================
-- trck — 0002 · Tenancy: organizations, depots, profiles, roles
-- ============================================================================
-- Hierarchy:  organization -> depot -> (managers | employees | buses | routes)
-- EVERY operational table carries organization_id; depot-scoped tables also
-- carry depot_id. Both are enforced by RLS in migration 0011, not by the client.
-- ============================================================================

create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null,
  contact_email   text,
  contact_phone   text,
  timezone        text not null default 'Asia/Kolkata',
  default_locale  app_locale not null default 'en',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deactivated_at  timestamptz,
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint organizations_name_len check (char_length(name) between 2 and 160)
);
create unique index organizations_slug_key on public.organizations (slug);

comment on table public.organizations is
  'Tenant root. All isolation policies ultimately compare against this id.';

-- ---------------------------------------------------------------------------

create table public.depots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name            text not null,
  code            text not null,
  address_line    text,
  city            text,
  state           text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  deactivated_at  timestamptz,
  constraint depots_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
  constraint depots_lat_range check (latitude is null or latitude between -90 and 90),
  constraint depots_lng_range check (longitude is null or longitude between -180 and 180)
);
create unique index depots_org_code_key on public.depots (organization_id, upper(code));
create index depots_org_idx on public.depots (organization_id) where is_active;

-- ---------------------------------------------------------------------------
-- profiles mirrors auth.users for application-level data. It is created by a
-- trigger on auth.users (migration 0010) so a user can never exist without one.

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete restrict,
  full_name        text not null default '',
  email            text not null,
  phone            text,
  status           account_status not null default 'INVITED',
  preferred_locale app_locale,
  avatar_path      text,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  deactivated_at   timestamptz,
  constraint profiles_email_format check (position('@' in email) > 1)
);
create index profiles_org_idx on public.profiles (organization_id);
create index profiles_email_idx on public.profiles (lower(email));
create index profiles_name_trgm on public.profiles using gin (full_name gin_trgm_ops);

comment on column public.profiles.preferred_locale is
  'NULL means "never chosen". The client suggests from navigator.language but '
  'must never silently overwrite a stored choice.';

-- ---------------------------------------------------------------------------
-- Roles live in their own table (never on profiles, never in JWT claims that
-- the client could tamper with). A user may hold exactly one role per org.

create table public.user_roles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  role            app_role not null,
  granted_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create unique index user_roles_active_key
  on public.user_roles (user_id, organization_id)
  where revoked_at is null;
create index user_roles_lookup_idx on public.user_roles (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Depot assignments for managers. Admins implicitly reach every depot in their
-- organization, so they need no rows here.

create table public.manager_depots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  depot_id        uuid not null references public.depots (id) on delete cascade,
  assigned_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unassigned_at   timestamptz
);
create unique index manager_depots_active_key
  on public.manager_depots (user_id, depot_id)
  where unassigned_at is null;
create index manager_depots_user_idx on public.manager_depots (user_id) where unassigned_at is null;
create index manager_depots_depot_idx on public.manager_depots (depot_id) where unassigned_at is null;
