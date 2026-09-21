-- ============================================================================
-- trck — 0004 · Fleet: buses, routes, stops, assignments
-- ============================================================================

create table public.buses (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  depot_id               uuid not null references public.depots (id) on delete restrict,
  registration_number    text not null,
  fleet_number           text,
  make                   text,
  model                  text,
  manufacturing_year     smallint,
  fuel_type              fuel_type not null default 'DIESEL',
  dashboard_type         dashboard_type not null default 'UNKNOWN',
  tank_capacity_litres   numeric(7, 2),
  -- Manufacturer / configured figure. The *learned* figure lives in
  -- bus_baselines and is what the anomaly engine prefers once it exists.
  nominal_efficiency_kmpl numeric(6, 2),
  baseline_efficiency_kmpl numeric(6, 2),
  starting_odometer_km   numeric(10, 1) not null default 0,
  current_odometer_km    numeric(10, 1) not null default 0,
  status                 bus_status not null default 'AVAILABLE',
  notes                  text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.profiles (id) on delete set null,
  deactivated_at         timestamptz,

  constraint buses_reg_format check (registration_number ~ '^[A-Z0-9][A-Z0-9 -]{3,19}$'),
  constraint buses_year_range check (
    manufacturing_year is null
    or manufacturing_year between 1950 and (extract(year from now())::int + 1)
  ),
  constraint buses_tank_positive check (tank_capacity_litres is null or tank_capacity_litres > 0),
  constraint buses_nominal_positive check (nominal_efficiency_kmpl is null or nominal_efficiency_kmpl > 0),
  constraint buses_baseline_positive check (baseline_efficiency_kmpl is null or baseline_efficiency_kmpl > 0),
  constraint buses_odo_nonneg check (starting_odometer_km >= 0 and current_odometer_km >= 0),
  constraint buses_odo_monotonic check (current_odometer_km >= starting_odometer_km)
);

-- Registration numbers are unique per tenant, case- and space-insensitive:
-- "KA 01 AB 1234" and "ka01ab1234" are the same vehicle.
create unique index buses_org_registration_key
  on public.buses (organization_id, upper(replace(replace(registration_number, ' ', ''), '-', '')));
create unique index buses_org_fleet_number_key
  on public.buses (organization_id, upper(fleet_number))
  where fleet_number is not null;
create index buses_depot_idx on public.buses (depot_id) where is_active;
create index buses_org_status_idx on public.buses (organization_id, status) where is_active;
create index buses_reg_trgm on public.buses using gin (registration_number gin_trgm_ops);

-- ---------------------------------------------------------------------------

create table public.routes (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete restrict,
  depot_id              uuid not null references public.depots (id) on delete restrict,
  name                  text not null,
  code                  text not null,
  origin                text not null,
  destination           text not null,
  expected_distance_km  numeric(7, 2) not null,
  -- Percentage band around expected_distance_km inside which a trip is normal.
  distance_tolerance_pct numeric(5, 2) not null default 10,
  typical_duration_minutes integer,
  status                route_status not null default 'ACTIVE',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  deactivated_at        timestamptz,

  constraint routes_distance_positive check (expected_distance_km > 0 and expected_distance_km <= 5000),
  constraint routes_tolerance_range check (distance_tolerance_pct >= 0 and distance_tolerance_pct <= 100),
  constraint routes_duration_positive check (typical_duration_minutes is null or typical_duration_minutes > 0),
  constraint routes_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$')
);
create unique index routes_org_code_key on public.routes (organization_id, upper(code));
create index routes_depot_idx on public.routes (depot_id) where status = 'ACTIVE';
create index routes_name_trgm on public.routes using gin (name gin_trgm_ops);

create table public.route_stops (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  route_id       uuid not null references public.routes (id) on delete cascade,
  sequence_no    smallint not null,
  name           text not null,
  distance_from_origin_km numeric(7, 2),
  created_at     timestamptz not null default now(),
  constraint route_stops_sequence_positive check (sequence_no > 0),
  constraint route_stops_distance_nonneg check (
    distance_from_origin_km is null or distance_from_origin_km >= 0
  )
);
create unique index route_stops_route_sequence_key on public.route_stops (route_id, sequence_no);
create index route_stops_route_idx on public.route_stops (route_id);
