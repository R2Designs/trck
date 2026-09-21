-- ============================================================================
-- trck — 0003 · Authorization helper functions
-- ============================================================================
-- These are the single source of truth for "what may this session see?".
--
-- They are SECURITY DEFINER on purpose: they read profiles / user_roles /
-- manager_depots, which are themselves RLS-protected. Without DEFINER the
-- policies that call them would recurse. They are `stable` so PostgreSQL can
-- cache them per statement, and they are locked to an empty search_path so a
-- caller cannot shadow `public` with a malicious schema.
--
-- EXECUTE is granted to authenticated only; anon can call none of them.
-- ============================================================================

-- Organization of the calling user (NULL when unauthenticated / orphaned).
create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'ACTIVE'::public.account_status
$$;

-- Active role of the calling user within their organization.
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid()
    and ur.revoked_at is null
    and p.status = 'ACTIVE'::public.account_status
    and ur.organization_id = p.organization_id
  limit 1
$$;

create or replace function public.auth_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role), false)
$$;

create or replace function public.auth_is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'MANAGER'::public.app_role, false)
$$;

create or replace function public.auth_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_is_admin() or public.auth_is_manager()
$$;

-- Depots the caller may operate on.
--   ADMIN / SUPER_ADMIN -> every active depot in their organization
--   MANAGER             -> only depots explicitly assigned to them
--   anything else       -> none
create or replace function public.auth_depot_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.depots d
  where d.organization_id = public.auth_org_id()
    and (
      public.auth_is_admin()
      or exists (
        select 1
        from public.manager_depots md
        where md.user_id = auth.uid()
          and md.depot_id = d.id
          and md.unassigned_at is null
      )
    )
$$;

-- Convenience predicate used by nearly every depot-scoped policy.
-- A NULL depot (organization-wide record) is visible to admins only.
create or replace function public.auth_can_access_depot(target_depot uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_depot is null then public.auth_is_admin()
    else exists (select 1 from public.auth_depot_ids() x where x = target_depot)
  end
$$;

-- Row belongs to the caller's tenant AND to a depot they may touch.
create or replace function public.auth_can_access_row(target_org uuid, target_depot uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_org is not null
     and target_org = public.auth_org_id()
     and (public.auth_is_admin() or public.auth_can_access_depot(target_depot))
$$;

-- The organization's *local business date*. Attendance uniqueness, dashboard
-- "today" counters and report boundaries must all agree on when a day starts,
-- and UTC midnight is the wrong answer for an operator in Bengaluru.
create or replace function public.fn_org_today(p_org uuid default null)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select o.timezone from public.organizations o
      where o.id = coalesce(p_org, public.auth_org_id())),
    'Asia/Kolkata'))::date
$$;

revoke all on function public.auth_org_id() from public, anon;
revoke all on function public.auth_role() from public, anon;
revoke all on function public.auth_is_admin() from public, anon;
revoke all on function public.auth_is_manager() from public, anon;
revoke all on function public.auth_is_staff() from public, anon;
revoke all on function public.auth_depot_ids() from public, anon;
revoke all on function public.auth_can_access_depot(uuid) from public, anon;
revoke all on function public.auth_can_access_row(uuid, uuid) from public, anon;

grant execute on function public.auth_org_id() to authenticated;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_is_admin() to authenticated;
grant execute on function public.auth_is_manager() to authenticated;
grant execute on function public.auth_is_staff() to authenticated;
grant execute on function public.auth_depot_ids() to authenticated;
grant execute on function public.auth_can_access_depot(uuid) to authenticated;
grant execute on function public.auth_can_access_row(uuid, uuid) to authenticated;
grant execute on function public.fn_org_today(uuid) to authenticated;
