-- ============================================================================
-- trck — Local test shim
-- ============================================================================
-- Recreates just enough of the Supabase platform (auth + storage schemas and
-- the roles the policies reference) so that the real migrations, policies and
-- RLS tests can run against a plain PostgreSQL 16 instance in CI — no Docker,
-- no Supabase account, no network.
--
-- This file is NEVER applied to a hosted project: it lives outside
-- supabase/migrations on purpose. See docs/DEPLOYMENT.md ("Testing the DB").
-- ============================================================================

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
create schema if not exists storage;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to postgres, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text default 'authenticated',
  role               text default 'authenticated',
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);

-- Mirrors GoTrue: claims arrive as a GUC on the connection.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets (id) on delete cascade,
  name       text not null,
  owner      uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- Supabase's helper: splits an object path into its folder segments.
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
