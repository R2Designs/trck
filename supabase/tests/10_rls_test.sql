-- ============================================================================
-- trck — Row Level Security test suite
-- ============================================================================
-- Runs against the seeded database. Each block asserts a *security* property,
-- not a happy path: the question is always "what can this session NOT see?".
--
--   psql -f 00_supabase_shim.sql
--   psql -f ../migrations/*.sql
--   psql -f ../seed.sql
--   psql -f 10_rls_test.sql          <- fails loudly on the first violation
--
-- `set local role authenticated` drops superuser, so FORCE ROW LEVEL SECURITY
-- genuinely applies. That is the whole point: a superuser connection would
-- silently pass every one of these.
-- ============================================================================

\set ON_ERROR_STOP on

-- --- A second tenant, to prove isolation rather than merely assume it -------
insert into public.organizations (id, name, slug)
values ('99999999-9999-9999-9999-999999999999', 'Kaveri Roadlines', 'kaveri-roadlines')
on conflict (id) do nothing;

insert into public.depots (id, organization_id, name, code)
values ('98888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
        'Mysuru Depot', 'MYS-1')
on conflict (id) do nothing;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('a9999999-9999-9999-9999-999999999999', 'rival@kaveri.example', 'x', now(),
        '{"full_name":"Rival Admin"}'::jsonb)
on conflict (id) do nothing;

update public.profiles
   set organization_id = '99999999-9999-9999-9999-999999999999',
       status = 'ACTIVE', full_name = 'Rival Admin'
 where id = 'a9999999-9999-9999-9999-999999999999';

insert into public.user_roles (user_id, organization_id, role)
values ('a9999999-9999-9999-9999-999999999999', '99999999-9999-9999-9999-999999999999', 'ADMIN')
on conflict do nothing;

insert into public.buses (organization_id, depot_id, registration_number, starting_odometer_km,
                          current_odometer_km)
values ('99999999-9999-9999-9999-999999999999', '98888888-8888-8888-8888-888888888888',
        'KA 09 ZZ 0001', 1000, 1000)
on conflict do nothing;

create or replace function public.test_assert(cond boolean, label text)
returns void language plpgsql as $$
begin
  if cond then
    raise notice '  PASS  %', label;
  else
    raise exception 'RLS TEST FAILED: %', label;
  end if;
end $$;

-- ===========================================================================
\echo '== 1. Cross-tenant isolation =============================================='
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'a9999999-9999-9999-9999-999999999999';  -- rival admin

  select public.test_assert(
    (select count(*) from public.buses where organization_id = '11111111-1111-1111-1111-111111111111') = 0,
    'rival admin sees zero buses of Sri Balaji Transport');

  select public.test_assert(
    (select count(*) from public.employees) = 0,
    'rival admin sees zero employees (none in own org yet)');

  select public.test_assert(
    (select count(*) from public.trips) = 0,
    'rival admin sees zero trips');

  select public.test_assert(
    (select count(*) from public.face_embeddings) = 0,
    'rival admin sees zero face embeddings');

  select public.test_assert(
    (select count(*) from public.audit_logs
      where organization_id = '11111111-1111-1111-1111-111111111111') = 0,
    'rival admin sees zero audit rows belonging to another tenant');

  select public.test_assert(
    (select count(*) from public.organizations) = 1
    and (select id from public.organizations) = '99999999-9999-9999-9999-999999999999',
    'rival admin sees only their own organization');
rollback;

-- Forging organization_id on write is rejected by WITH CHECK.
\echo '   -- attempting cross-tenant INSERT (must fail) --'
do $$
declare v_failed boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'a9999999-9999-9999-9999-999999999999', true);
    insert into public.buses (organization_id, depot_id, registration_number,
                              starting_odometer_km, current_odometer_km)
    values ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111',
            'KA 09 HACK 01', 0, 0);
  exception when insufficient_privilege or check_violation then
    v_failed := true;
  end;
  reset role;
  perform public.test_assert(v_failed, 'cross-tenant INSERT with forged organization_id is rejected');
end $$;

-- ===========================================================================
\echo '== 2. Manager depot scoping ==============================================='
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'a2222222-2222-2222-2222-222222222222';  -- North manager

  select public.test_assert(
    (select count(*) from public.buses where depot_id = '22222222-2222-2222-2222-222222222222') = 0,
    'North manager cannot see South depot buses');

  select public.test_assert(
    (select count(*) from public.buses where depot_id = '21111111-1111-1111-1111-111111111111') = 4,
    'North manager sees exactly their own depot buses');

  select public.test_assert(
    (select count(*) from public.employees where depot_id = '22222222-2222-2222-2222-222222222222') = 0,
    'North manager cannot see South depot employees');

  select public.test_assert(
    (select count(*) from public.attendance_records
      where depot_id = '22222222-2222-2222-2222-222222222222') = 0,
    'North manager cannot see South depot attendance');

  select public.test_assert(
    (select count(*) from public.audit_logs) = 0,
    'manager cannot read the audit log at all');
rollback;

-- ===========================================================================
\echo '== 3. Admin organization-wide visibility =================================='
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';  -- org admin

  select public.test_assert(
    (select count(*) from public.buses) = 8, 'admin sees all 8 buses across both depots');
  select public.test_assert(
    (select count(*) from public.employees) = 12, 'admin sees all 12 employees');
  select public.test_assert(
    (select count(*) from public.audit_logs) > 0, 'admin can read the audit log');
  select public.test_assert(
    (select count(*) from public.depots) = 2, 'admin sees both depots');
rollback;

-- ===========================================================================
\echo '== 4. Audit log immutability =============================================='
-- ===========================================================================
do $$
declare v_blocked boolean := false;
begin
  begin
    update public.audit_logs set action = 'TAMPERED' where id = (select min(id) from public.audit_logs);
  exception when others then v_blocked := true;
  end;
  perform public.test_assert(v_blocked, 'audit_logs UPDATE is blocked even for the table owner');

  v_blocked := false;
  begin
    delete from public.audit_logs where id = (select min(id) from public.audit_logs);
  exception when others then v_blocked := true;
  end;
  perform public.test_assert(v_blocked, 'audit_logs DELETE is blocked even for the table owner');

  v_blocked := false;
  begin
    delete from public.attendance_records where id = (select id from public.attendance_records limit 1);
  exception when others then v_blocked := true;
  end;
  perform public.test_assert(v_blocked, 'attendance_records DELETE is blocked');
end $$;

-- ===========================================================================
\echo '== 5. Privilege escalation via self-update ================================'
-- ===========================================================================
do $$
declare v_blocked boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
    update public.profiles
       set organization_id = '99999999-9999-9999-9999-999999999999'
     where id = 'a2222222-2222-2222-2222-222222222222';
  exception when others then v_blocked := true;
  end;
  reset role;
  perform public.test_assert(v_blocked, 'manager cannot move themselves into another organization');
end $$;

do $$
declare v_rows int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  -- No INSERT policy exists on user_roles for authenticated.
  begin
    insert into public.user_roles (user_id, organization_id, role)
    values ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'ADMIN');
    v_rows := 1;
  exception when others then v_rows := 0;
  end;
  reset role;
  perform public.test_assert(v_rows = 0, 'manager cannot grant themselves the ADMIN role');
end $$;

-- ===========================================================================
\echo '== 6. Attendance business rules ==========================================='
-- ===========================================================================
do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.rpc_record_attendance(
      '51111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
      'FACE_RECOGNITION'::public.attendance_method, 'CHECK_IN'::public.attendance_type,
      null, 0.81, 0.62, 'human', 'faceres-3.3.5', 'PASSED'::public.liveness_result, 0.9);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg like 'ATTENDANCE_ALREADY_RECORDED%';
  end;
  reset role;
  perform public.test_assert(v_ok, 'duplicate check-in for the same day is refused: ' || coalesce(v_msg, 'no error'));
end $$;

do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    -- Below face_review_similarity (0.50): the server must refuse regardless of
    -- what the client believed.
    perform public.rpc_record_attendance(
      '54444444-4444-4444-4444-444444444444', '21111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
      'FACE_RECOGNITION'::public.attendance_method, 'CHECK_IN'::public.attendance_type,
      null, 0.31, 0.62, 'human', 'faceres-3.3.5', 'PASSED'::public.liveness_result, 0.9);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg = 'FACE_SCORE_BELOW_THRESHOLD';
  end;
  reset role;
  perform public.test_assert(v_ok, 'low-confidence face match is refused server-side');
end $$;

do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.rpc_record_attendance(
      '57777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222',
      '34444444-4444-4444-4444-444444444444', '45555555-5555-5555-5555-555555555555',
      'MANUAL_OVERRIDE'::public.attendance_method, 'CHECK_IN'::public.attendance_type,
      null, null, null, null, null, 'SKIPPED'::public.liveness_result, null,
      'CAMERA_UNAVAILABLE', 'no camera');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := true;
  end;
  reset role;
  perform public.test_assert(v_ok, 'North manager cannot record attendance in the South depot');
end $$;

do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.rpc_record_attendance(
      '54444444-4444-4444-4444-444444444444', '21111111-1111-1111-1111-111111111111',
      '31111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
      'MANUAL_OVERRIDE'::public.attendance_method, 'CHECK_IN'::public.attendance_type,
      null, null, null, null, null, 'SKIPPED'::public.liveness_result, null,
      'OTHER', null);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg = 'OVERRIDE_REASON_REQUIRED';
  end;
  reset role;
  perform public.test_assert(v_ok, 'manual override without a reason is refused');
end $$;

-- ===========================================================================
\echo '== 7. Trip lifecycle invariants ==========================================='
-- ===========================================================================
do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    -- Bus 42222222 already has a STARTED trip in the seed.
    perform public.rpc_start_trip(
      '42222222-2222-2222-2222-222222222222', '32222222-2222-2222-2222-222222222222',
      '52222222-2222-2222-2222-222222222222', 252000);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg = 'BUS_ALREADY_ON_TRIP';
  end;
  reset role;
  perform public.test_assert(v_ok, 'a bus cannot start a second concurrent trip');
end $$;

do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.rpc_complete_trip('62222222-2222-2222-2222-222222222222', 251000);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg = 'END_ODOMETER_BELOW_START';
  end;
  reset role;
  perform public.test_assert(v_ok, 'end odometer below start odometer is refused');
end $$;

do $$
declare v_msg text; v_ok boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  begin
    perform public.rpc_complete_trip('62222222-2222-2222-2222-222222222222', null);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_ok := v_msg = 'END_READING_REQUIRED';
  end;
  reset role;
  perform public.test_assert(v_ok, 'completing without an end reading requires an explicit override');
end $$;

-- A legitimate completion, with derived metrics computed server-side.
do $$
declare v_trip public.trips;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  v_trip := public.rpc_complete_trip('62222222-2222-2222-2222-222222222222', 252015.0, 470, 79.0);
  reset role;
  perform public.test_assert(v_trip.calculated_distance_km = 35.0,
    'completed trip distance is computed server-side (got ' || v_trip.calculated_distance_km || ')');
  perform public.test_assert(round(v_trip.distance_variance_pct) = 7,
    'distance variance percentage is computed (got ' || v_trip.distance_variance_pct || ')');
  perform public.test_assert(
    (select status from public.buses where id = '42222222-2222-2222-2222-222222222222') = 'AVAILABLE',
    'bus returns to AVAILABLE when its trip completes');
end $$;

-- ===========================================================================
\echo '== 8. Face candidate scoping =============================================='
-- ===========================================================================
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a2222222-2222-2222-2222-222222222222', true);
  select count(*) into v_n
  from public.rpc_face_candidates('22222222-2222-2222-2222-222222222222');
  reset role;
  perform public.test_assert(v_n = 0,
    'face candidate query returns nothing for a depot the manager does not own');
end $$;

\echo ''
\echo '   All RLS and business-rule assertions passed.'
