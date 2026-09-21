-- ============================================================================
-- trck — 0013 · Dashboard aggregates
-- ============================================================================
-- One round trip per dashboard. Doing this in SQL keeps low-end phones from
-- downloading hundreds of rows just to count them.
-- ============================================================================

create or replace function public.rpc_manager_dashboard(p_depot_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org   uuid := public.auth_org_id();
  v_tz    text := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'Asia/Kolkata');
  v_today date := public.fn_org_today(v_org);
  v_depots uuid[];
  v_result jsonb;
begin
  if v_org is null then raise exception 'NOT_AUTHORISED' using errcode = '42501'; end if;

  if p_depot_id is not null then
    v_depots := array[p_depot_id];
  else
    select coalesce(array_agg(x), '{}') into v_depots from public.auth_depot_ids() x;
  end if;

  select jsonb_build_object(
    'date', v_today,
    'depot_ids', to_jsonb(v_depots),
    'today', (
      select jsonb_build_object(
        'drivers_total', (select count(*) from public.employees e
                          where e.depot_id = any(v_depots) and e.employee_type = 'DRIVER'
                            and e.employment_status = 'ACTIVE' and e.deactivated_at is null),
        'drivers_present', (select count(distinct a.employee_id) from public.attendance_records a
                            where a.depot_id = any(v_depots) and a.attendance_date = v_today
                              and a.attendance_type = 'CHECK_IN'),
        'drivers_manual', (select count(distinct a.employee_id) from public.attendance_records a
                           where a.depot_id = any(v_depots) and a.attendance_date = v_today
                             and a.manual_override),
        'trips_completed', (select count(*) from public.trips t
                            where t.depot_id = any(v_depots)
                              and t.status in ('COMPLETED','REVIEW_REQUIRED')
                              and (t.actual_end_time at time zone v_tz)::date = v_today),
        'trips_active', (select count(*) from public.trips t
                         where t.depot_id = any(v_depots) and t.status = 'STARTED'),
        'issues_open', (select count(*) from public.anomalies an
                        where an.depot_id = any(v_depots)
                          and an.review_status in ('OPEN','IN_REVIEW','NEEDS_INVESTIGATION'))
      )
    ),
    'fleet', (
      select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (
        select b.status::text as status, count(*) as n from public.buses b
        where b.depot_id = any(v_depots) and b.is_active group by b.status
      ) s
    ),
    'trips', (
      select coalesce(jsonb_agg(x order by x ->> 'started_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', t.id, 'status', t.status, 'started_at', t.actual_start_time,
          'ended_at', t.actual_end_time,
          'bus', jsonb_build_object('id', b.id, 'registration_number', b.registration_number),
          'route', jsonb_build_object('id', r.id, 'name', r.name, 'origin', r.origin,
                                      'destination', r.destination),
          'driver', case when e.id is null then null
                    else jsonb_build_object('id', e.id, 'full_name', e.full_name) end,
          'distance_variance_pct', t.distance_variance_pct
        ) as x
        from public.trips t
        join public.buses b on b.id = t.bus_id
        join public.routes r on r.id = t.route_id
        left join public.employees e on e.id = t.driver_id
        where t.depot_id = any(v_depots)
          and (t.status = 'STARTED'
               or (t.actual_start_time at time zone v_tz)::date = v_today)
        order by t.actual_start_time desc
        limit 25
      ) q
    ),
    'attention', (
      select coalesce(jsonb_agg(x order by x ->> 'detected_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', an.id, 'kind', an.kind, 'severity', an.severity, 'score', an.score,
          'detected_at', an.detected_at, 'review_status', an.review_status,
          'observed_value', an.observed_value, 'expected_value', an.expected_value,
          'variance_pct', an.variance_pct, 'unit', an.unit, 'detail', an.detail,
          'bus', case when b.id is null then null
                 else jsonb_build_object('id', b.id, 'registration_number', b.registration_number) end,
          'trip_id', an.trip_id
        ) as x
        from public.anomalies an
        left join public.buses b on b.id = an.bus_id
        where an.depot_id = any(v_depots)
          and an.review_status in ('OPEN','IN_REVIEW','NEEDS_INVESTIGATION')
        order by case an.severity when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end,
                 an.detected_at desc
        limit 10
      ) q
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(x order by x ->> 'occurred_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', al.id, 'action', al.action, 'entity_type', al.entity_type,
          'entity_label', al.entity_label, 'actor', al.actor_email,
          'occurred_at', al.occurred_at
        ) as x
        from public.audit_logs al
        where al.organization_id = v_org
          and (al.depot_id is null or al.depot_id = any(v_depots))
          and al.occurred_at > now() - interval '3 days'
        order by al.occurred_at desc
        limit 12
      ) q
    ),
    'performance', (
      select jsonb_build_object(
        'window_days', 7,
        'distance_km', coalesce(round(sum(t.calculated_distance_km), 1), 0),
        'trips', count(*),
        'avg_efficiency_kmpl', round(avg(t.calculated_efficiency_kmpl), 2),
        'trips_with_anomalies', count(*) filter (
          where exists (select 1 from public.anomalies an where an.trip_id = t.id))
      )
      from public.trips t
      where t.depot_id = any(v_depots)
        and t.status in ('COMPLETED','REVIEW_REQUIRED')
        and t.actual_end_time >= now() - interval '7 days'
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------

create or replace function public.rpc_admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org   uuid := public.auth_org_id();
  v_tz    text := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'Asia/Kolkata');
  v_today date := public.fn_org_today(v_org);
  v_days  integer := greatest(7, least(coalesce(p_days, 30), 180));
  v_result jsonb;
begin
  if v_org is null or not public.auth_is_admin() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'window_days', v_days,
    'totals', jsonb_build_object(
      'managers', (select count(*) from public.user_roles ur join public.profiles p on p.id = ur.user_id
                   where ur.organization_id = v_org and ur.revoked_at is null
                     and ur.role = 'MANAGER' and p.status = 'ACTIVE'),
      'drivers', (select count(*) from public.employees e
                  where e.organization_id = v_org and e.employee_type = 'DRIVER'
                    and e.employment_status = 'ACTIVE' and e.deactivated_at is null),
      'buses', (select count(*) from public.buses b where b.organization_id = v_org and b.is_active),
      'depots', (select count(*) from public.depots d where d.organization_id = v_org and d.is_active),
      'routes', (select count(*) from public.routes r where r.organization_id = v_org and r.status = 'ACTIVE'),
      'trips_today', (select count(*) from public.trips t where t.organization_id = v_org
                        and (t.actual_start_time at time zone v_tz)::date = v_today),
      'trips_completed_today', (select count(*) from public.trips t where t.organization_id = v_org
                        and t.status in ('COMPLETED','REVIEW_REQUIRED')
                        and (t.actual_end_time at time zone v_tz)::date = v_today),
      'anomalies_open', (select count(*) from public.anomalies an where an.organization_id = v_org
                        and an.review_status in ('OPEN','IN_REVIEW','NEEDS_INVESTIGATION')),
      'anomalies_high', (select count(*) from public.anomalies an where an.organization_id = v_org
                        and an.severity = 'HIGH'
                        and an.review_status in ('OPEN','IN_REVIEW','NEEDS_INVESTIGATION'))
    ),
    'attendance_rate_today', (
      select case when total = 0 then null else round(present::numeric / total * 100, 1) end
      from (
        select
          (select count(*) from public.employees e where e.organization_id = v_org
             and e.employee_type = 'DRIVER' and e.employment_status = 'ACTIVE'
             and e.deactivated_at is null) as total,
          (select count(distinct a.employee_id) from public.attendance_records a
             where a.organization_id = v_org and a.attendance_date = v_today
               and a.attendance_type = 'CHECK_IN') as present
      ) s
    ),
    'fleet_availability', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select b.status::text as status, count(*) as n from public.buses b
            where b.organization_id = v_org and b.is_active group by b.status) x
    ),
    'series', jsonb_build_object(
      'attendance', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'value', v) order by d), '[]'::jsonb)
        from (
          select gs::date as d,
                 (select count(distinct a.employee_id) from public.attendance_records a
                  where a.organization_id = v_org and a.attendance_date = gs::date
                    and a.attendance_type = 'CHECK_IN') as v
          from generate_series(v_today - (v_days - 1), v_today, interval '1 day') gs
        ) s
      ),
      'distance', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'value', v) order by d), '[]'::jsonb)
        from (
          select gs::date as d,
                 coalesce((select round(sum(t.calculated_distance_km), 1) from public.trips t
                  where t.organization_id = v_org
                    and (t.actual_end_time at time zone v_tz)::date = gs::date), 0) as v
          from generate_series(v_today - (v_days - 1), v_today, interval '1 day') gs
        ) s
      ),
      'efficiency', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'value', v) order by d), '[]'::jsonb)
        from (
          select gs::date as d,
                 (select round(avg(t.calculated_efficiency_kmpl), 2) from public.trips t
                  where t.organization_id = v_org
                    and (t.actual_end_time at time zone v_tz)::date = gs::date
                    and t.calculated_efficiency_kmpl is not null) as v
          from generate_series(v_today - (v_days - 1), v_today, interval '1 day') gs
        ) s
      ),
      'anomalies', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'value', v) order by d), '[]'::jsonb)
        from (
          select gs::date as d,
                 (select count(*) from public.anomalies an
                  where an.organization_id = v_org
                    and (an.detected_at at time zone v_tz)::date = gs::date) as v
          from generate_series(v_today - (v_days - 1), v_today, interval '1 day') gs
        ) s
      )
    ),
    'repeat_offenders', (
      select coalesce(jsonb_agg(x order by (x ->> 'count')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'bus_id', b.id, 'registration_number', b.registration_number,
          'depot_id', b.depot_id, 'count', count(an.id)) as x
        from public.anomalies an join public.buses b on b.id = an.bus_id
        where an.organization_id = v_org and an.detected_at >= now() - make_interval(days => v_days)
        group by b.id, b.registration_number, b.depot_id
        having count(an.id) >= 2
        order by count(an.id) desc limit 8
      ) q
    ),
    'depot_comparison', (
      select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'depot_id', d.id, 'name', d.name,
          'buses', (select count(*) from public.buses b where b.depot_id = d.id and b.is_active),
          'drivers', (select count(*) from public.employees e where e.depot_id = d.id
                        and e.employment_status = 'ACTIVE' and e.deactivated_at is null),
          'trips', (select count(*) from public.trips t where t.depot_id = d.id
                      and t.actual_start_time >= now() - make_interval(days => v_days)),
          'distance_km', coalesce((select round(sum(t.calculated_distance_km), 1)
                      from public.trips t where t.depot_id = d.id
                      and t.actual_end_time >= now() - make_interval(days => v_days)), 0),
          'anomalies', (select count(*) from public.anomalies an where an.depot_id = d.id
                      and an.detected_at >= now() - make_interval(days => v_days))
        ) as x
        from public.depots d where d.organization_id = v_org and d.is_active
      ) q
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.rpc_manager_dashboard(uuid) to authenticated;
grant execute on function public.rpc_admin_dashboard(integer) to authenticated;
