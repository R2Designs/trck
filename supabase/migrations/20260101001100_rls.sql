-- ============================================================================
-- trck — 0011 · Row Level Security
-- ============================================================================
-- Model
--   * RLS is ON for every table in `public`; there is no "trusted" table.
--   * Tenant isolation is a *predicate on every policy*, never an application
--     concern. Rewriting organization_id in a request body achieves nothing:
--     the WITH CHECK clause compares it to auth_org_id() server-side.
--   * Admin  -> whole organization.
--     Manager-> organization AND an assigned depot.
--   * Biometric tables are readable only by staff of the owning depot, and
--     never by anon.
--   * audit_logs / anomaly_reviews have no UPDATE or DELETE policy at all.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','depots','profiles','user_roles','manager_depots',
    'buses','routes','route_stops','employees','biometric_consents',
    'employee_photos','face_embeddings','driver_assignments',
    'trips','attendance_records','dashboard_captures','dashboard_readings',
    'fuel_entries','anomalies','anomaly_reviews','bus_baselines',
    'audit_logs','app_settings','user_preferences','notifications','analytics_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- Nothing is reachable without authentication.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.auth_org_id());

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.auth_org_id() and public.auth_is_admin())
  with check (id = public.auth_org_id() and public.auth_is_admin());

-- ---------------------------------------------------------------------------
-- depots
-- ---------------------------------------------------------------------------
-- Managers can *see* every depot in their org (needed to render names on
-- historical records) but can only act on the ones assigned to them.
create policy depots_select on public.depots
  for select to authenticated
  using (organization_id = public.auth_org_id());

create policy depots_insert on public.depots
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_admin());

create policy depots_update on public.depots
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_admin())
  with check (organization_id = public.auth_org_id() and public.auth_is_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_org on public.profiles
  for select to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff());

-- A user may edit their own display fields. organization_id and status are
-- protected by the column-level trigger below, not by this policy.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_admin())
  with check (organization_id = public.auth_org_id() and public.auth_is_admin());

-- Self-service edits must not touch privilege-bearing columns.
create or replace function public.fn_guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = new.id and not public.auth_is_admin() then
    if new.organization_id is distinct from old.organization_id
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.deactivated_at is distinct from old.deactivated_at then
      raise exception 'Not allowed to change account status, email or organization'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_profiles_guard_self before update on public.profiles
  for each row execute function public.fn_guard_profile_self_update();

-- ---------------------------------------------------------------------------
-- user_roles / manager_depots  (read-only from the browser; writes are done by
-- the admin-users Edge Function under the service role)
-- ---------------------------------------------------------------------------
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or (organization_id = public.auth_org_id() and public.auth_is_admin()));

create policy manager_depots_select on public.manager_depots
  for select to authenticated
  using (user_id = auth.uid() or (organization_id = public.auth_org_id() and public.auth_is_staff()));

-- ---------------------------------------------------------------------------
-- buses
-- ---------------------------------------------------------------------------
create policy buses_select on public.buses
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy buses_insert on public.buses
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy buses_update on public.buses
  for update to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

-- ---------------------------------------------------------------------------
-- routes / route_stops
-- ---------------------------------------------------------------------------
create policy routes_select on public.routes
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy routes_insert on public.routes
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy routes_update on public.routes
  for update to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

create policy route_stops_select on public.route_stops
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and exists (select 1 from public.routes r
                     where r.id = route_id
                       and (public.auth_is_admin() or public.auth_can_access_depot(r.depot_id))));

create policy route_stops_write on public.route_stops
  for all to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and exists (select 1 from public.routes r
                     where r.id = route_id and public.auth_can_access_depot(r.depot_id)))
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and exists (select 1 from public.routes r
                          where r.id = route_id and public.auth_can_access_depot(r.depot_id)));

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
create policy employees_select on public.employees
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy employees_insert on public.employees
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy employees_update on public.employees
  for update to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));
-- No DELETE policy anywhere: employees are deactivated, never removed.

-- ---------------------------------------------------------------------------
-- Biometrics — the tightest policies in the schema.
-- ---------------------------------------------------------------------------
create policy biometric_consents_select on public.biometric_consents
  for select to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and exists (select 1 from public.employees e
                     where e.id = employee_id and public.auth_can_access_depot(e.depot_id)));

create policy biometric_consents_write on public.biometric_consents
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and exists (select 1 from public.employees e
                          where e.id = employee_id and public.auth_can_access_depot(e.depot_id)));

create policy biometric_consents_revoke on public.biometric_consents
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff())
  with check (organization_id = public.auth_org_id() and public.auth_is_staff());

create policy employee_photos_select on public.employee_photos
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id));

create policy employee_photos_insert on public.employee_photos
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy employee_photos_delete on public.employee_photos
  for delete to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id));

create policy face_embeddings_select on public.face_embeddings
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id)
         and deleted_at is null);

create policy face_embeddings_insert on public.face_embeddings
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

-- Soft delete only (sets deleted_at); the hard DELETE path does not exist.
create policy face_embeddings_update on public.face_embeddings
  for update to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

-- ---------------------------------------------------------------------------
-- driver_assignments / trips / attendance
-- ---------------------------------------------------------------------------
create policy driver_assignments_select on public.driver_assignments
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy driver_assignments_write on public.driver_assignments
  for all to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy trips_select on public.trips
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy trips_insert on public.trips
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy trips_update on public.trips
  for update to authenticated
  using (organization_id = public.auth_org_id()
         and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

create policy attendance_select on public.attendance_records
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id)
              and manager_id = auth.uid());
-- Attendance is never edited: a correction is a new record plus an audit entry.

-- ---------------------------------------------------------------------------
-- captures / readings / fuel
-- ---------------------------------------------------------------------------
create policy dashboard_captures_select on public.dashboard_captures
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy dashboard_captures_insert on public.dashboard_captures
  for insert to authenticated
  with check (organization_id = public.auth_org_id()
              and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id)
              and captured_by = auth.uid());

create policy dashboard_captures_update on public.dashboard_captures
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

create policy dashboard_readings_select on public.dashboard_readings
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy dashboard_readings_write on public.dashboard_readings
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy dashboard_readings_update on public.dashboard_readings
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

create policy fuel_entries_select on public.fuel_entries
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy fuel_entries_write on public.fuel_entries
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id) and recorded_by = auth.uid());

-- ---------------------------------------------------------------------------
-- anomalies / reviews / baselines
-- ---------------------------------------------------------------------------
create policy anomalies_select on public.anomalies
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (public.auth_is_admin() or public.auth_can_access_depot(depot_id)));

create policy anomalies_insert on public.anomalies
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and public.auth_can_access_depot(depot_id));

create policy anomalies_update on public.anomalies
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff()
         and public.auth_can_access_depot(depot_id))
  with check (organization_id = public.auth_org_id()
              and public.auth_can_access_depot(depot_id));

create policy anomaly_reviews_select on public.anomaly_reviews
  for select to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_staff());

create policy anomaly_reviews_insert on public.anomaly_reviews
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff()
              and reviewed_by = auth.uid());

create policy bus_baselines_select on public.bus_baselines
  for select to authenticated
  using (organization_id = public.auth_org_id());

-- ---------------------------------------------------------------------------
-- audit_logs — read-only, and only for admins. INSERT happens exclusively
-- through the SECURITY DEFINER function fn_write_audit.
-- ---------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_admin());

-- ---------------------------------------------------------------------------
-- settings / preferences / notifications / analytics
-- ---------------------------------------------------------------------------
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (organization_id = public.auth_org_id());

create policy app_settings_update on public.app_settings
  for update to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_admin())
  with check (organization_id = public.auth_org_id() and public.auth_is_admin());

create policy user_preferences_all on public.user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_select on public.notifications
  for select to authenticated
  using (organization_id = public.auth_org_id()
         and (recipient_id = auth.uid()
              or (recipient_id is null
                  and recipient_role = public.auth_role()
                  and (depot_id is null or public.auth_can_access_depot(depot_id)))));

create policy notifications_update on public.notifications
  for update to authenticated
  using (organization_id = public.auth_org_id() and recipient_id = auth.uid())
  with check (organization_id = public.auth_org_id() and recipient_id = auth.uid());

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and public.auth_is_staff());

-- Analytics: write-only from the browser. Nobody reads their own event stream.
create policy analytics_events_insert on public.analytics_events
  for insert to authenticated
  with check (organization_id = public.auth_org_id() and user_id = auth.uid());

create policy analytics_events_select on public.analytics_events
  for select to authenticated
  using (organization_id = public.auth_org_id() and public.auth_is_admin());
