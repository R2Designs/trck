-- ============================================================================
-- trck — 0014 · Private object storage (Supabase Storage adapter)
-- ============================================================================
-- Both buckets are PRIVATE. Nothing here is ever served from a public URL;
-- the client always asks for a short-lived signed URL.
--
-- Path convention (mirrored exactly by the R2 adapter):
--   employee-faces/organizations/{orgId}/employees/{employeeId}/faces/{uuid}.jpg
--   dashboard-captures/organizations/{orgId}/buses/{busId}/trips/{tripId}/dashboard/{uuid}.jpg
--
-- storage.foldername(name) is 1-indexed, so element 2 is the organization id.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('employee-faces', 'employee-faces', false, 8388608,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('dashboard-captures', 'dashboard-captures', false, 8388608,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.fn_storage_org(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare parts text[];
begin
  parts := storage.foldername(object_name);
  if array_length(parts, 1) is null or array_length(parts, 1) < 2 then
    return null;
  end if;
  if parts[1] <> 'organizations' then
    return null;
  end if;
  return parts[2]::uuid;
exception when others then
  return null;
end;
$$;

-- Face photos: staff of the owning organization only.
create policy "faces_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'employee-faces'
         and public.auth_is_staff()
         and public.fn_storage_org(name) = public.auth_org_id());

create policy "faces_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employee-faces'
              and public.auth_is_staff()
              and public.fn_storage_org(name) = public.auth_org_id());

-- Deletion exists so the "delete biometric data" workflow can actually remove
-- the objects, not merely flag them.
create policy "faces_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'employee-faces'
         and public.auth_is_staff()
         and public.fn_storage_org(name) = public.auth_org_id());

create policy "dashboards_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'dashboard-captures'
         and public.auth_is_staff()
         and public.fn_storage_org(name) = public.auth_org_id());

create policy "dashboards_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dashboard-captures'
              and public.auth_is_staff()
              and public.fn_storage_org(name) = public.auth_org_id());

create policy "dashboards_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dashboard-captures'
         and public.auth_is_admin()
         and public.fn_storage_org(name) = public.auth_org_id());

grant execute on function public.fn_storage_org(text) to authenticated;
