-- ============================================================================
-- trck — 0012 · Server-authoritative operations (RPC)
-- ============================================================================
-- Anything the client must not be trusted to get right lives here:
-- duplicate-attendance detection, trip state transitions, derived distance
-- metrics, and the small candidate query that face matching runs against.
--
-- All functions are SECURITY INVOKER except where noted, so RLS still applies:
-- these add *business* rules on top of the access rules, they do not bypass them.
-- ============================================================================

-- --- Settings helper --------------------------------------------------------
create or replace function public.fn_settings(p_org uuid)
returns public.app_settings
language sql
stable
set search_path = ''
as $$
  select * from public.app_settings where organization_id = p_org
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
-- Returns the freshly created row, or raises a typed error the client maps to a
-- translated message. Never returns a partial success.
create or replace function public.rpc_record_attendance(
  p_employee_id   uuid,
  p_depot_id      uuid,
  p_route_id      uuid,
  p_bus_id        uuid,
  p_method        public.attendance_method,
  p_attendance_type public.attendance_type default 'CHECK_IN',
  p_trip_id       uuid default null,
  p_face_score    numeric default null,
  p_face_threshold numeric default null,
  p_provider      text default null,
  p_model_version text default null,
  p_liveness      public.liveness_result default 'SKIPPED',
  p_liveness_score numeric default null,
  p_override_reason_code text default null,
  p_override_reason text default null,
  p_device_metadata jsonb default '{}'::jsonb
)
returns public.attendance_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org       uuid := public.auth_org_id();
  v_settings  public.app_settings;
  v_employee  public.employees;
  v_existing  public.attendance_records;
  v_date      date;
  v_row       public.attendance_records;
  v_manual    boolean := (p_method = 'MANUAL_OVERRIDE'::public.attendance_method);
begin
  if v_org is null or not public.auth_is_staff() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;

  select * into v_employee from public.employees where id = p_employee_id;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_employee.employment_status <> 'ACTIVE'::public.employment_status
     or v_employee.deactivated_at is not null then
    raise exception 'EMPLOYEE_INACTIVE' using errcode = 'P0001';
  end if;
  if v_employee.depot_id <> p_depot_id then
    raise exception 'EMPLOYEE_DEPOT_MISMATCH' using errcode = 'P0001';
  end if;

  v_settings := public.fn_settings(v_org);

  -- A face-recognised attendance must actually clear the configured bar. The
  -- client shows the score; the server decides whether it is good enough.
  if p_method = 'FACE_RECOGNITION'::public.attendance_method then
    if p_face_score is null or p_face_threshold is null then
      raise exception 'FACE_EVIDENCE_MISSING' using errcode = 'P0001';
    end if;
    if p_face_score < v_settings.face_review_similarity then
      raise exception 'FACE_SCORE_BELOW_THRESHOLD' using errcode = 'P0001';
    end if;
    if v_settings.face_require_liveness
       and p_liveness not in ('PASSED'::public.liveness_result, 'UNSUPPORTED'::public.liveness_result) then
      raise exception 'LIVENESS_NOT_PASSED' using errcode = 'P0001';
    end if;
  end if;

  if v_manual and coalesce(trim(p_override_reason), '') = '' then
    raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_date := public.fn_org_today(v_org);

  -- Idempotency: surface the original record rather than a constraint error.
  select * into v_existing
  from public.attendance_records a
  where a.employee_id = p_employee_id
    and a.attendance_type = p_attendance_type
    and ((p_trip_id is null and a.trip_id is null and a.attendance_date = v_date)
         or (p_trip_id is not null and a.trip_id = p_trip_id))
  limit 1;

  if found then
    raise exception 'ATTENDANCE_ALREADY_RECORDED at %', v_existing.recorded_at
      using errcode = 'P0001', detail = v_existing.id::text;
  end if;

  insert into public.attendance_records (
    organization_id, depot_id, employee_id, manager_id, route_id, bus_id, trip_id,
    attendance_type, attendance_date, method,
    face_match_score, face_match_threshold, recognition_provider, recognition_model_version,
    liveness, liveness_score, manual_override, override_reason_code, override_reason,
    device_metadata
  ) values (
    v_org, p_depot_id, p_employee_id, auth.uid(), p_route_id, p_bus_id, p_trip_id,
    p_attendance_type, v_date, p_method,
    p_face_score, p_face_threshold, p_provider, p_model_version,
    p_liveness, p_liveness_score, v_manual, p_override_reason_code, p_override_reason,
    coalesce(p_device_metadata, '{}'::jsonb)
  )
  returning * into v_row;

  if v_manual then
    perform public.fn_write_audit(
      'ATTENDANCE_MANUAL_OVERRIDE', 'attendance', v_row.id, v_employee.full_name,
      null, jsonb_build_object('reason_code', p_override_reason_code, 'reason', p_override_reason),
      v_org, p_depot_id, jsonb_build_object('source', 'rpc')
    );
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
create or replace function public.rpc_start_trip(
  p_bus_id    uuid,
  p_route_id  uuid,
  p_driver_id uuid,
  p_start_odometer numeric,
  p_start_range numeric default null,
  p_start_fuel_percent numeric default null,
  p_capture_id uuid default null,
  p_planned_start timestamptz default null
)
returns public.trips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org   uuid := public.auth_org_id();
  v_bus   public.buses;
  v_route public.routes;
  v_trip  public.trips;
begin
  if v_org is null or not public.auth_is_staff() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;

  select * into v_bus from public.buses where id = p_bus_id;
  if not found then raise exception 'BUS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_bus.status = 'OUT_OF_SERVICE'::public.bus_status then
    raise exception 'BUS_OUT_OF_SERVICE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trips t where t.bus_id = p_bus_id and t.status = 'STARTED') then
    raise exception 'BUS_ALREADY_ON_TRIP' using errcode = 'P0001';
  end if;

  select * into v_route from public.routes where id = p_route_id;
  if not found then raise exception 'ROUTE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_route.depot_id <> v_bus.depot_id then
    raise exception 'ROUTE_DEPOT_MISMATCH' using errcode = 'P0001';
  end if;

  -- A reading that would move the odometer backwards is rejected up front; the
  -- UI routes the manager to "correct the reading" rather than storing it.
  if p_start_odometer < v_bus.current_odometer_km - 1 then
    raise exception 'ODOMETER_BELOW_LAST_KNOWN' using errcode = 'P0001',
      detail = v_bus.current_odometer_km::text;
  end if;

  insert into public.trips (
    organization_id, depot_id, bus_id, route_id, driver_id, manager_id,
    status, planned_start_time, actual_start_time,
    expected_distance_km, distance_tolerance_pct,
    start_odometer_km, start_range_km, start_fuel_percent, start_capture_id, created_by
  ) values (
    v_org, v_bus.depot_id, p_bus_id, p_route_id, p_driver_id, auth.uid(),
    'STARTED'::public.trip_status, p_planned_start, now(),
    v_route.expected_distance_km, v_route.distance_tolerance_pct,
    p_start_odometer, p_start_range, p_start_fuel_percent, p_capture_id, auth.uid()
  )
  returning * into v_trip;

  if p_capture_id is not null then
    update public.dashboard_captures set trip_id = v_trip.id where id = p_capture_id;
    update public.dashboard_readings set trip_id = v_trip.id where capture_id = p_capture_id;
  end if;

  perform public.fn_write_audit('TRIP_STARTED', 'trip', v_trip.id,
    v_bus.registration_number, null, to_jsonb(v_trip), v_org, v_bus.depot_id,
    jsonb_build_object('source', 'rpc'));

  return v_trip;
end;
$$;

-- Completes a trip and writes the derived distance metrics. Anomaly *rules*
-- run afterwards in the trip-finalise Edge Function, which shares its engine
-- code with the browser (see supabase/functions/_shared/domain).
create or replace function public.rpc_complete_trip(
  p_trip_id   uuid,
  p_end_odometer numeric,
  p_end_range numeric default null,
  p_end_fuel_percent numeric default null,
  p_refuel_litres numeric default null,
  p_capture_id uuid default null,
  p_override boolean default false,
  p_override_reason text default null
)
returns public.trips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip     public.trips;
  v_distance numeric;
  v_duration integer;
  v_fuel_used numeric;
  v_efficiency numeric;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'TRIP_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_trip.status <> 'STARTED'::public.trip_status then
    raise exception 'TRIP_NOT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  if p_end_odometer is null then
    if not p_override then
      raise exception 'END_READING_REQUIRED' using errcode = 'P0001';
    end if;
    if coalesce(trim(p_override_reason), '') = '' then
      raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  elsif v_trip.start_odometer_km is not null and p_end_odometer < v_trip.start_odometer_km then
    raise exception 'END_ODOMETER_BELOW_START' using errcode = 'P0001',
      detail = v_trip.start_odometer_km::text;
  end if;

  v_distance := case
    when p_end_odometer is null or v_trip.start_odometer_km is null then null
    else round(p_end_odometer - v_trip.start_odometer_km, 1)
  end;

  v_duration := greatest(0, (extract(epoch from (now() - v_trip.actual_start_time)) / 60)::int);

  -- Litres are only spoken about when litres are actually known.
  if v_trip.start_fuel_percent is not null and p_end_fuel_percent is not null then
    select
      case when b.tank_capacity_litres is null then null
           else round(
             (v_trip.start_fuel_percent - p_end_fuel_percent) / 100.0 * b.tank_capacity_litres
             + coalesce(p_refuel_litres, 0), 2)
      end
    into v_fuel_used
    from public.buses b where b.id = v_trip.bus_id;
  end if;

  v_efficiency := case
    when v_distance is null or v_fuel_used is null or v_fuel_used <= 0 then null
    else round(v_distance / v_fuel_used, 2)
  end;

  update public.trips set
    status = 'COMPLETED'::public.trip_status,
    actual_end_time = now(),
    end_odometer_km = p_end_odometer,
    end_range_km = p_end_range,
    end_fuel_percent = p_end_fuel_percent,
    refuel_litres = p_refuel_litres,
    end_capture_id = coalesce(p_capture_id, end_capture_id),
    calculated_distance_km = v_distance,
    distance_variance_km = case when v_distance is null then null
                                else round(v_distance - expected_distance_km, 1) end,
    distance_variance_pct = case when v_distance is null or expected_distance_km = 0 then null
                                 else round((v_distance - expected_distance_km)
                                            / expected_distance_km * 100, 2) end,
    calculated_efficiency_kmpl = v_efficiency,
    duration_minutes = v_duration,
    completion_override = p_override,
    completion_override_reason = p_override_reason
  where id = p_trip_id
  returning * into v_trip;

  if p_capture_id is not null then
    update public.dashboard_captures set trip_id = p_trip_id where id = p_capture_id;
    update public.dashboard_readings set trip_id = p_trip_id where capture_id = p_capture_id;
  end if;

  perform public.fn_write_audit('TRIP_COMPLETED', 'trip', v_trip.id, null,
    null, to_jsonb(v_trip), v_trip.organization_id, v_trip.depot_id,
    jsonb_build_object('source', 'rpc', 'override', p_override));

  return v_trip;
end;
$$;

-- ---------------------------------------------------------------------------
-- Face matching candidate set
-- ---------------------------------------------------------------------------
-- Deliberately narrow: drivers assigned to the chosen route/bus first, then the
-- rest of the depot's active drivers. Never the whole organization, never
-- another tenant. RLS still applies on top of this.
create or replace function public.rpc_face_candidates(
  p_depot_id uuid,
  p_route_id uuid default null,
  p_bus_id   uuid default null,
  p_limit    integer default 150
)
returns table (
  employee_id   uuid,
  employee_code text,
  full_name     text,
  is_assigned   boolean,
  embedding_id  uuid,
  model_version text,
  provider      text,
  dimensions    smallint,
  embedding     double precision[],
  quality_score numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with assigned as (
    select distinct da.employee_id
    from public.driver_assignments da
    where da.depot_id = p_depot_id
      and (da.effective_to is null or da.effective_to >= current_date)
      and da.effective_from <= current_date
      and ((p_route_id is not null and da.route_id = p_route_id)
           or (p_bus_id is not null and da.bus_id = p_bus_id))
  )
  select
    e.id, e.employee_code, e.full_name,
    (a.employee_id is not null) as is_assigned,
    fe.id, fe.model_version, fe.provider, fe.dimensions, fe.embedding, fe.quality_score
  from public.employees e
  join public.face_embeddings fe
    on fe.employee_id = e.id and fe.is_active and fe.deleted_at is null
  left join assigned a on a.employee_id = e.id
  where e.depot_id = p_depot_id
    and e.employment_status = 'ACTIVE'
    and e.deactivated_at is null
    and e.employee_type = 'DRIVER'
    and exists (select 1 from public.biometric_consents bc
                where bc.employee_id = e.id and bc.revoked_at is null)
  order by (a.employee_id is not null) desc, e.full_name
  limit greatest(1, least(coalesce(p_limit, 150), 500));
$$;

-- ---------------------------------------------------------------------------
-- Baselines — robust statistics over *valid* completed trips only.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_recompute_bus_baseline(p_bus_id uuid, p_route_id uuid default null)
returns public.bus_baselines
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org      uuid := public.auth_org_id();
  v_settings public.app_settings := public.fn_settings(public.auth_org_id());
  v_window   integer;
  v_row      public.bus_baselines;
begin
  v_window := coalesce(v_settings.baseline_window_days, 90);

  with valid_trips as (
    select t.*,
           case when t.calculated_distance_km > 0 and t.start_range_km is not null
                     and t.end_range_km is not null
                then (t.start_range_km - t.end_range_km) / nullif(t.calculated_distance_km, 0)
           end as range_drop_per_km
    from public.trips t
    where t.bus_id = p_bus_id
      and (p_route_id is null or t.route_id = p_route_id)
      and t.status in ('COMPLETED', 'REVIEW_REQUIRED')
      and t.calculated_distance_km is not null
      and t.calculated_distance_km > 0
      and t.actual_start_time >= now() - make_interval(days => v_window)
      -- Trips whose readings were judged wrong must not teach the baseline.
      and not exists (
        select 1 from public.anomalies an
        where an.trip_id = t.id and an.review_status = 'READING_ERROR'
      )
  ), stats as (
    select
      count(*)::int as n,
      percentile_cont(0.5) within group (order by calculated_efficiency_kmpl)
        filter (where calculated_efficiency_kmpl is not null) as med_eff,
      percentile_cont(0.5) within group (order by range_drop_per_km)
        filter (where range_drop_per_km is not null) as med_rdpk,
      percentile_cont(0.5) within group (order by calculated_distance_km) as med_dist,
      min(actual_start_time::date) as w_start,
      max(actual_start_time::date) as w_end
    from valid_trips
  ), dispersion as (
    select
      s.*,
      percentile_cont(0.5) within group (order by abs(v.calculated_efficiency_kmpl - s.med_eff))
        filter (where v.calculated_efficiency_kmpl is not null) as mad_eff,
      percentile_cont(0.5) within group (order by abs(v.range_drop_per_km - s.med_rdpk))
        filter (where v.range_drop_per_km is not null) as mad_rdpk
    from stats s left join valid_trips v on true
    group by s.n, s.med_eff, s.med_rdpk, s.med_dist, s.w_start, s.w_end
  )
  insert into public.bus_baselines (
    organization_id, bus_id, route_id, sample_size,
    median_efficiency_kmpl, mad_efficiency_kmpl,
    median_range_drop_per_km, mad_range_drop_per_km,
    median_distance_km, window_start, window_end, computed_at
  )
  select v_org, p_bus_id, p_route_id, d.n,
         round(d.med_eff::numeric, 2), round(d.mad_eff::numeric, 2),
         round(d.med_rdpk::numeric, 3), round(d.mad_rdpk::numeric, 3),
         round(d.med_dist::numeric, 2), d.w_start, d.w_end, now()
  from dispersion d
  on conflict (bus_id, coalesce(route_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set
    sample_size = excluded.sample_size,
    median_efficiency_kmpl = excluded.median_efficiency_kmpl,
    mad_efficiency_kmpl = excluded.mad_efficiency_kmpl,
    median_range_drop_per_km = excluded.median_range_drop_per_km,
    mad_range_drop_per_km = excluded.mad_range_drop_per_km,
    median_distance_km = excluded.median_distance_km,
    window_start = excluded.window_start,
    window_end = excluded.window_end,
    computed_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Global search — debounced from the client, paginated and capped here.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_search(p_query text, p_limit integer default 8)
returns table (kind text, id uuid, title text, subtitle text, depot_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select nullif(trim(p_query), '') as term),
       lim as (select greatest(1, least(coalesce(p_limit, 8), 25)) as n)
  select * from (
    (select 'bus'::text, b.id, b.registration_number,
            coalesce(b.fleet_number, b.model, ''), b.depot_id
     from public.buses b, q, lim
     where q.term is not null
       and (b.registration_number ilike '%' || q.term || '%'
            or b.fleet_number ilike '%' || q.term || '%')
     order by b.registration_number limit (select n from lim))
    union all
    (select 'employee'::text, e.id, e.full_name, e.employee_code, e.depot_id
     from public.employees e, q, lim
     where q.term is not null
       and (e.full_name ilike '%' || q.term || '%' or e.employee_code ilike '%' || q.term || '%')
     order by e.full_name limit (select n from lim))
    union all
    (select 'route'::text, r.id, r.name, r.code, r.depot_id
     from public.routes r, q, lim
     where q.term is not null
       and (r.name ilike '%' || q.term || '%' or r.code ilike '%' || q.term || '%'
            or r.origin ilike '%' || q.term || '%' or r.destination ilike '%' || q.term || '%')
     order by r.name limit (select n from lim))
    union all
    (select 'manager'::text, p.id, p.full_name, p.email, null::uuid
     from public.profiles p, q, lim
     where q.term is not null and public.auth_is_admin()
       and (p.full_name ilike '%' || q.term || '%' or p.email ilike '%' || q.term || '%')
     order by p.full_name limit (select n from lim))
  ) results;
$$;

grant execute on function public.rpc_record_attendance(
  uuid, uuid, uuid, uuid, public.attendance_method, public.attendance_type, uuid,
  numeric, numeric, text, text, public.liveness_result, numeric, text, text, jsonb
) to authenticated;
grant execute on function public.rpc_start_trip(uuid, uuid, uuid, numeric, numeric, numeric, uuid, timestamptz) to authenticated;
grant execute on function public.rpc_complete_trip(uuid, numeric, numeric, numeric, numeric, uuid, boolean, text) to authenticated;
grant execute on function public.rpc_face_candidates(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.rpc_recompute_bus_baseline(uuid, uuid) to authenticated;
grant execute on function public.rpc_search(text, integer) to authenticated;
grant execute on function public.fn_settings(uuid) to authenticated;
