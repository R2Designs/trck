-- ============================================================================
-- trck — 0010 · Triggers: updated_at, profile bootstrap, audit, immutability
-- ============================================================================

-- --- updated_at -------------------------------------------------------------
create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','depots','profiles','buses','routes','employees',
    'trips','anomalies'
  ] loop
    execute format(
      'create trigger trg_%1$s_touch before update on public.%1$s
         for each row execute function public.fn_touch_updated_at()', t);
  end loop;
end; $$;

create trigger trg_app_settings_touch before update on public.app_settings
  for each row execute function public.fn_touch_updated_at();
create trigger trg_user_preferences_touch before update on public.user_preferences
  for each row execute function public.fn_touch_updated_at();

-- --- Profile bootstrap ------------------------------------------------------
-- A row in auth.users without a profile would be invisible to every RLS helper,
-- so create it atomically. Organization / role assignment happens separately in
-- the admin-users Edge Function, which runs with the service role.
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, status, organization_id, preferred_locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'INVITED'::public.account_status,
    nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid,
    nullif(new.raw_user_meta_data ->> 'locale', '')::public.app_locale
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- --- Audit ------------------------------------------------------------------
-- Keys that must never reach the audit log even if a caller passes them.
create or replace function public.fn_redact(payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when payload is null then null
    else payload - 'embedding' - 'ocr_raw_response' - 'password' - 'access_token'
                 - 'refresh_token' - 'device_metadata'
  end
$$;

create or replace function public.fn_write_audit(
  p_action       text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_entity_label text default null,
  p_before       jsonb default null,
  p_after        jsonb default null,
  p_org          uuid default null,
  p_depot        uuid default null,
  p_context      jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_email text;
begin
  select p.email into v_email from public.profiles p where p.id = auth.uid();

  insert into public.audit_logs (
    organization_id, depot_id, actor_id, actor_email, actor_role,
    action, entity_type, entity_id, entity_label,
    before_values, after_values, context
  )
  values (
    coalesce(p_org, public.auth_org_id()), p_depot, auth.uid(), v_email, public.auth_role(),
    p_action, p_entity_type, p_entity_id, p_entity_label,
    public.fn_redact(p_before), public.fn_redact(p_after),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.fn_write_audit(
  text, text, uuid, text, jsonb, jsonb, uuid, uuid, jsonb
) to authenticated;

-- Generic row-level audit trigger, attached to the tables where "who changed
-- this?" is an operational question rather than a curiosity.
create or replace function public.fn_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_org    uuid;
  v_depot  uuid;
  v_label  text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new); v_action := upper(tg_argv[0]) || '_CREATED';
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old); v_after := to_jsonb(new); v_action := upper(tg_argv[0]) || '_UPDATED';
  else
    v_before := to_jsonb(old); v_action := upper(tg_argv[0]) || '_DELETED';
  end if;

  v_org   := coalesce(v_after ->> 'organization_id', v_before ->> 'organization_id')::uuid;
  v_depot := coalesce(v_after ->> 'depot_id', v_before ->> 'depot_id')::uuid;
  v_label := coalesce(
    v_after ->> 'full_name', v_before ->> 'full_name',
    v_after ->> 'registration_number', v_before ->> 'registration_number',
    v_after ->> 'name', v_before ->> 'name',
    v_after ->> 'email', v_before ->> 'email'
  );

  perform public.fn_write_audit(
    v_action, tg_argv[0],
    coalesce(v_after ->> 'id', v_before ->> 'id')::uuid,
    v_label, v_before, v_after, v_org, v_depot,
    jsonb_build_object('source', 'db_trigger', 'table', tg_table_name)
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_audit_employees after insert or update or delete on public.employees
  for each row execute function public.fn_audit_row('employee');
create trigger trg_audit_buses after insert or update or delete on public.buses
  for each row execute function public.fn_audit_row('bus');
create trigger trg_audit_routes after insert or update or delete on public.routes
  for each row execute function public.fn_audit_row('route');
create trigger trg_audit_depots after insert or update or delete on public.depots
  for each row execute function public.fn_audit_row('depot');
create trigger trg_audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.fn_audit_row('user_role');
create trigger trg_audit_attendance after insert on public.attendance_records
  for each row execute function public.fn_audit_row('attendance');
create trigger trg_audit_app_settings after update on public.app_settings
  for each row execute function public.fn_audit_row('app_settings');
create trigger trg_audit_face_embeddings after insert or update on public.face_embeddings
  for each row execute function public.fn_audit_row('face_embedding');

-- --- Immutability guards ----------------------------------------------------
create or replace function public.fn_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable', tg_table_name
    using errcode = '42501', hint = 'Append a new record instead of modifying history.';
end;
$$;

create trigger trg_audit_logs_no_update before update or delete on public.audit_logs
  for each statement execute function public.fn_block_mutation();
create trigger trg_anomaly_reviews_no_update before update or delete on public.anomaly_reviews
  for each statement execute function public.fn_block_mutation();
create trigger trg_attendance_no_delete before delete on public.attendance_records
  for each statement execute function public.fn_block_mutation();

-- --- Keep bus odometer / status in step with trips --------------------------
create or replace function public.fn_sync_bus_from_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = 'STARTED' and old.status is distinct from 'STARTED' then
    update public.buses
       set status = 'ON_TRIP'::public.bus_status,
           current_odometer_km = greatest(current_odometer_km, coalesce(new.start_odometer_km, 0))
     where id = new.bus_id;
  elsif tg_op = 'UPDATE'
        and new.status in ('COMPLETED', 'REVIEW_REQUIRED', 'CANCELLED')
        and old.status = 'STARTED' then
    update public.buses
       set status = case when status = 'ON_TRIP' then 'AVAILABLE'::public.bus_status else status end,
           current_odometer_km = greatest(current_odometer_km, coalesce(new.end_odometer_km, 0))
     where id = new.bus_id;
  end if;
  return new;
end;
$$;

create trigger trg_trips_sync_bus after update on public.trips
  for each row execute function public.fn_sync_bus_from_trip();
