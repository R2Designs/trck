-- ============================================================================
-- trck — 0015 · Retention
-- ============================================================================
-- Retention is *configurable*, not "keep everything forever". These functions
-- mark rows for purge and remove the storage objects; a scheduled job (pg_cron
-- on paid tiers, or the retention-sweep Edge Function on free tiers) calls them.
--
-- Deliberately asymmetric: images expire, operational history does not.
-- Deactivating an employee never deletes their attendance or trip records.
-- ============================================================================

create or replace function public.fn_purge_expired_media()
returns table (bucket text, purged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_faces int := 0;
  v_dash  int := 0;
begin
  for r in
    select s.organization_id, s.photo_retention_days, s.dashboard_capture_retention_days
    from public.app_settings s
  loop
    with expired as (
      select ep.id, ep.storage_bucket, ep.storage_path
      from public.employee_photos ep
      join public.biometric_consents bc on bc.employee_id = ep.employee_id
      where ep.organization_id = r.organization_id
        and ep.purged_at is null
        and ep.created_at < now() - make_interval(
              days => least(r.photo_retention_days, bc.photo_retention_days))
    ), removed as (
      delete from storage.objects o
      using expired e
      where o.bucket_id = e.storage_bucket and o.name = e.storage_path
      returning 1
    )
    update public.employee_photos ep
       set purged_at = now()
      from expired e
     where ep.id = e.id;
    get diagnostics v_faces = row_count;

    with expired as (
      select dc.id, dc.storage_bucket, dc.storage_path
      from public.dashboard_captures dc
      where dc.organization_id = r.organization_id
        and dc.purged_at is null
        and dc.created_at < now() - make_interval(days => r.dashboard_capture_retention_days)
        -- Evidence attached to an unresolved anomaly is never purged.
        and not exists (
          select 1 from public.anomalies an
          where an.capture_id = dc.id
            and an.review_status in ('OPEN','IN_REVIEW','NEEDS_INVESTIGATION'))
    ), removed as (
      delete from storage.objects o
      using expired e
      where o.bucket_id = e.storage_bucket and o.name = e.storage_path
      returning 1
    )
    update public.dashboard_captures dc
       set purged_at = now(), ocr_raw_response = null
      from expired e
     where dc.id = e.id;
    get diagnostics v_dash = row_count;
  end loop;

  return query select 'employee-faces'::text, v_faces
               union all select 'dashboard-captures'::text, v_dash;
end;
$$;

-- Full biometric erasure for one employee: embeddings soft-deleted (so the
-- audit trail still shows that they existed and when they were removed),
-- photos hard-deleted from storage.
create or replace function public.rpc_delete_biometric_data(p_employee_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_emp public.employees;
  v_embeddings int;
  v_photos int;
begin
  if not public.auth_is_staff() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_emp from public.employees where id = p_employee_id;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0002'; end if;

  update public.face_embeddings
     set is_active = false, deleted_at = now(), deleted_by = auth.uid(), delete_reason = p_reason
   where employee_id = p_employee_id and deleted_at is null;
  get diagnostics v_embeddings = row_count;

  delete from storage.objects o
  using public.employee_photos ep
  where ep.employee_id = p_employee_id
    and o.bucket_id = ep.storage_bucket and o.name = ep.storage_path;

  update public.employee_photos set purged_at = now()
   where employee_id = p_employee_id and purged_at is null;
  get diagnostics v_photos = row_count;

  update public.biometric_consents
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
   where employee_id = p_employee_id and revoked_at is null;

  perform public.fn_write_audit(
    'BIOMETRIC_DATA_DELETED', 'employee', p_employee_id, v_emp.full_name,
    null, jsonb_build_object('embeddings', v_embeddings, 'photos', v_photos, 'reason', p_reason),
    v_emp.organization_id, v_emp.depot_id, jsonb_build_object('source', 'rpc'));

  return jsonb_build_object('embeddings_deleted', v_embeddings, 'photos_deleted', v_photos);
end;
$$;

grant execute on function public.rpc_delete_biometric_data(uuid, text) to authenticated;
