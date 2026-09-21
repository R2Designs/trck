-- ============================================================================
-- trck — Demo seed
-- ============================================================================
-- A realistic single-tenant dataset for local development, E2E tests and demos.
-- No lorem ipsum: every name, registration number and route is plausible for a
-- Bengaluru bus operator.
--
-- Identifiers are FIXED so Playwright specs can address rows directly.
--
-- Demo sign-ins (change immediately outside local development):
--   admin@trck.app          Admin@12345     ADMIN    — sees both depots
--   arun@trck.app           Manager@12345   MANAGER  — Bengaluru North
--   lakshmi@trck.app        Manager@12345   MANAGER  — Bengaluru South
-- ============================================================================

set search_path = public, extensions;

-- --- Organisation and depots -----------------------------------------------
insert into public.organizations (id, name, slug, contact_email, timezone, default_locale)
values ('11111111-1111-1111-1111-111111111111', 'Sri Balaji Transport', 'sri-balaji',
        'ops@sribalajitransport.example', 'Asia/Kolkata', 'en')
on conflict (id) do nothing;

insert into public.depots (id, organization_id, name, code, city, state, latitude, longitude)
values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Bengaluru North Depot', 'BLR-N', 'Bengaluru', 'Karnataka', 13.028500, 77.570400),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Bengaluru South Depot', 'BLR-S', 'Bengaluru', 'Karnataka', 12.914200, 77.610100)
on conflict (id) do nothing;

insert into public.app_settings (organization_id) values ('11111111-1111-1111-1111-111111111111')
on conflict (organization_id) do nothing;

-- --- Auth users -------------------------------------------------------------
-- Written directly into GoTrue's table so `supabase db reset` yields a usable
-- environment without a signup round-trip.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@trck.app', crypt('Admin@12345', gen_salt('bf')),
   now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb,
   jsonb_build_object('full_name', 'Priya Raghavan',
                      'organization_id', '11111111-1111-1111-1111-111111111111'),
   now(), now()),
  ('a2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'arun@trck.app', crypt('Manager@12345', gen_salt('bf')),
   now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb,
   jsonb_build_object('full_name', 'Arun Selvam',
                      'organization_id', '11111111-1111-1111-1111-111111111111'),
   now(), now()),
  ('a3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lakshmi@trck.app', crypt('Manager@12345', gen_salt('bf')),
   now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb,
   jsonb_build_object('full_name', 'Lakshmi Narayan',
                      'organization_id', '11111111-1111-1111-1111-111111111111'),
   now(), now())
on conflict (id) do nothing;

-- Current GoTrue versions resolve email/password users through auth.identities.
-- Keep these explicit so remote resets and local resets behave identically.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111',
   '{"sub":"a1111111-1111-1111-1111-111111111111","email":"admin@trck.app","email_verified":true}'::jsonb,
   'email', now(), now(), now()),
  ('b2222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222',
   'a2222222-2222-2222-2222-222222222222',
   '{"sub":"a2222222-2222-2222-2222-222222222222","email":"arun@trck.app","email_verified":true}'::jsonb,
   'email', now(), now(), now()),
  ('b3333333-3333-3333-3333-333333333333', 'a3333333-3333-3333-3333-333333333333',
   'a3333333-3333-3333-3333-333333333333',
   '{"sub":"a3333333-3333-3333-3333-333333333333","email":"lakshmi@trck.app","email_verified":true}'::jsonb,
   'email', now(), now(), now())
on conflict (id) do nothing;

-- The auth.users trigger creates skeleton profiles; fill in the rest.
update public.profiles set
  organization_id = '11111111-1111-1111-1111-111111111111',
  status = 'ACTIVE',
  preferred_locale = 'en',
  full_name = case id
    when 'a1111111-1111-1111-1111-111111111111' then 'Priya Raghavan'
    when 'a2222222-2222-2222-2222-222222222222' then 'Arun Selvam'
    else 'Lakshmi Narayan' end
where id in ('a1111111-1111-1111-1111-111111111111',
             'a2222222-2222-2222-2222-222222222222',
             'a3333333-3333-3333-3333-333333333333');

insert into public.user_roles (user_id, organization_id, role) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'ADMIN'),
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'MANAGER'),
  ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'MANAGER')
on conflict do nothing;

insert into public.manager_depots (user_id, organization_id, depot_id) values
  ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111'),
  ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

insert into public.user_preferences (user_id, locale, theme) values
  ('a1111111-1111-1111-1111-111111111111', 'en', 'system'),
  ('a2222222-2222-2222-2222-222222222222', 'ta', 'system'),
  ('a3333333-3333-3333-3333-333333333333', 'kn', 'system')
on conflict (user_id) do nothing;

-- --- Routes -----------------------------------------------------------------
insert into public.routes (id, organization_id, depot_id, name, code, origin, destination,
                           expected_distance_km, distance_tolerance_pct, typical_duration_minutes,
                           created_by)
values
  ('31111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'Majestic → Electronic City', 'BLR-N-01',
   'Kempegowda Bus Station (Majestic)', 'Electronic City Phase 1', 27.50, 10, 75,
   'a1111111-1111-1111-1111-111111111111'),
  ('32222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'Yeshwanthpur → Whitefield', 'BLR-N-02',
   'Yeshwanthpur TTMC', 'Whitefield ITPL', 32.80, 12, 95,
   'a1111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'Hebbal → Kempegowda Airport', 'BLR-N-03',
   'Hebbal Flyover', 'Kempegowda International Airport', 24.10, 8, 45,
   'a1111111-1111-1111-1111-111111111111'),
  ('34444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'Jayanagar → Sarjapur', 'BLR-S-01',
   'Jayanagar 4th Block', 'Sarjapur Road Junction', 18.60, 10, 55,
   'a1111111-1111-1111-1111-111111111111'),
  ('35555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'Banashankari → Hosur Circle', 'BLR-S-02',
   'Banashankari TTMC', 'Hosur Road Circle', 21.40, 10, 60,
   'a1111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.route_stops (organization_id, route_id, sequence_no, name, distance_from_origin_km)
values
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 1, 'Corporation Circle', 3.20),
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 2, 'Madiwala', 14.60),
  ('11111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 3, 'Silk Board', 18.90),
  ('11111111-1111-1111-1111-111111111111', '32222222-2222-2222-2222-222222222222', 1, 'Mekhri Circle', 6.10),
  ('11111111-1111-1111-1111-111111111111', '32222222-2222-2222-2222-222222222222', 2, 'Indiranagar', 19.40),
  ('11111111-1111-1111-1111-111111111111', '34444444-4444-4444-4444-444444444444', 1, 'BTM Layout', 7.30)
on conflict do nothing;

-- --- Buses ------------------------------------------------------------------
insert into public.buses (id, organization_id, depot_id, registration_number, fleet_number,
                          make, model, manufacturing_year, fuel_type, dashboard_type,
                          tank_capacity_litres, nominal_efficiency_kmpl, baseline_efficiency_kmpl,
                          starting_odometer_km, current_odometer_km, status, created_by)
values
  ('41111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'KA 01 AB 1234', 'N-01', 'Tata', 'Starbus Ultra', 2021,
   'DIESEL', 'DIGITAL', 160, 5.40, 5.20, 180000, 186420.5, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('42222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'KA 01 AB 5678', 'N-02', 'Ashok Leyland', 'Viking', 2019,
   'DIESEL', 'SEGMENTED_LCD', 180, 4.90, 4.60, 240000, 251980.0, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('43333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'KA 01 AC 9012', 'N-03', 'Tata', 'LP 909', 2022,
   'DIESEL', 'DIGITAL', 150, 5.80, 5.65, 60000, 64310.0, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   '21111111-1111-1111-1111-111111111111', 'KA 01 AD 3456', 'N-04', 'Eicher', 'Skyline Pro', 2020,
   'DIESEL', 'ANALOG', 140, 5.10, null, 120000, 128740.0, 'MAINTENANCE', 'a1111111-1111-1111-1111-111111111111'),
  ('45555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'KA 05 BB 2211', 'S-01', 'Tata', 'Starbus Ultra', 2021,
   'DIESEL', 'DIGITAL', 160, 5.40, 5.35, 90000, 95120.0, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('46666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'KA 05 BC 7788', 'S-02', 'Ashok Leyland', 'Oyster', 2018,
   'CNG', 'MIXED', 120, 4.20, 4.05, 300000, 312450.0, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('47777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'KA 05 BD 4455', 'S-03', 'Olectra', 'K9', 2023,
   'ELECTRIC', 'DIGITAL', null, null, null, 15000, 18960.0, 'AVAILABLE', 'a1111111-1111-1111-1111-111111111111'),
  ('48888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'KA 05 BE 6677', 'S-04', 'Tata', 'LP 909', 2017,
   'DIESEL', 'ANALOG', 150, 4.80, 4.40, 410000, 428300.0, 'OUT_OF_SERVICE', 'a1111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

-- --- Employees --------------------------------------------------------------
insert into public.employees (id, organization_id, depot_id, employee_code, full_name,
                              employee_type, phone, joining_date, licence_number, licence_expiry,
                              emergency_contact_name, emergency_contact_phone, created_by)
values
  ('51111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1001', 'Ramesh Kumar',    'DRIVER',    '+91 98450 11001', '2019-06-12', 'KA0120190001122', current_date + 240, 'Sunitha Kumar',  '+91 98450 11002', 'a1111111-1111-1111-1111-111111111111'),
  ('52222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1002', 'Mohammed Irfan',  'DRIVER',    '+91 98450 11003', '2020-02-01', 'KA0120200003344', current_date + 25,  'Ayesha Irfan',   '+91 98450 11004', 'a1111111-1111-1111-1111-111111111111'),
  ('53333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1003', 'Suresh Babu',     'DRIVER',    '+91 98450 11005', '2018-11-20', 'KA0120180005566', current_date + 500, 'Geetha Babu',    '+91 98450 11006', 'a1111111-1111-1111-1111-111111111111'),
  ('54444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1004', 'Venkatesh Rao',   'DRIVER',    '+91 98450 11007', '2021-08-15', 'KA0120210007788', current_date + 310, 'Shobha Rao',     '+91 98450 11008', 'a1111111-1111-1111-1111-111111111111'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1005', 'Anand Krishnan',  'DRIVER',    '+91 98450 11009', '2022-01-10', 'KA0120220009900', current_date + 620, 'Meera Krishnan', '+91 98450 11010', 'a1111111-1111-1111-1111-111111111111'),
  ('56666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'EMP-1006', 'Prakash Shetty',  'CONDUCTOR', '+91 98450 11011', '2020-05-05', null, null, 'Vidya Shetty',   '+91 98450 11012', 'a1111111-1111-1111-1111-111111111111'),
  ('57777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2001', 'Lokesh Gowda',    'DRIVER',    '+91 98450 22001', '2017-03-18', 'KA0520170011223', current_date + 90,  'Rekha Gowda',    '+91 98450 22002', 'a1111111-1111-1111-1111-111111111111'),
  ('58888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2002', 'Thangavel M',     'DRIVER',    '+91 98450 22003', '2019-09-09', 'KA0520190033445', current_date + 410, 'Kavitha T',      '+91 98450 22004', 'a1111111-1111-1111-1111-111111111111'),
  ('59999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2003', 'Basavaraj Patil', 'DRIVER',    '+91 98450 22005', '2021-12-01', 'KA0520210055667', current_date + 15,  'Sushma Patil',   '+91 98450 22006', 'a1111111-1111-1111-1111-111111111111'),
  ('5aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2004', 'Nagaraj Hegde',   'DRIVER',    '+91 98450 22007', '2016-07-21', 'KA0520160077889', current_date + 700, 'Asha Hegde',     '+91 98450 22008', 'a1111111-1111-1111-1111-111111111111'),
  ('5bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2005', 'Imran Pasha',     'DRIVER',    '+91 98450 22009', '2023-04-04', 'KA0520230099001', current_date + 820, 'Nusrat Pasha',   '+91 98450 22010', 'a1111111-1111-1111-1111-111111111111'),
  ('5ccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'EMP-2006', 'Kiran Bhat',      'HELPER',    '+91 98450 22011', '2022-10-10', null, null, 'Deepa Bhat',     '+91 98450 22012', 'a1111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

-- Every enrolled driver has an explicit, recorded consent.
insert into public.biometric_consents (organization_id, employee_id, notice_version, acknowledged_by)
select '11111111-1111-1111-1111-111111111111', e.id, 'v1.0-2026-01', 'a1111111-1111-1111-1111-111111111111'
from public.employees e
where e.employee_type = 'DRIVER'
on conflict do nothing;

-- --- Driver assignments -----------------------------------------------------
insert into public.driver_assignments (organization_id, depot_id, employee_id, bus_id, route_id, created_by)
values
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111', '31111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '52222222-2222-2222-2222-222222222222', '42222222-2222-2222-2222-222222222222', '32222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '53333333-3333-3333-3333-333333333333', '43333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '57777777-7777-7777-7777-777777777777', '45555555-5555-5555-5555-555555555555', '34444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '58888888-8888-8888-8888-888888888888', '46666666-6666-6666-6666-666666666666', '35555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- --- Today's attendance -----------------------------------------------------
insert into public.attendance_records (
  organization_id, depot_id, employee_id, manager_id, route_id, bus_id,
  attendance_type, attendance_date, recorded_at, method,
  face_match_score, face_match_threshold, recognition_provider, recognition_model_version,
  liveness, liveness_score, manual_override, override_reason_code, override_reason)
values
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', '31111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111', 'CHECK_IN', public.fn_org_today('11111111-1111-1111-1111-111111111111'), now() - interval '5 hours', 'FACE_RECOGNITION', 0.8140, 0.6200, 'human', 'faceres-3.3.5', 'PASSED', 0.9100, false, null, null),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '52222222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222', '32222222-2222-2222-2222-222222222222', '42222222-2222-2222-2222-222222222222', 'CHECK_IN', public.fn_org_today('11111111-1111-1111-1111-111111111111'), now() - interval '4 hours 40 minutes', 'FACE_RECOGNITION', 0.7420, 0.6200, 'human', 'faceres-3.3.5', 'PASSED', 0.8800, false, null, null),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', '53333333-3333-3333-3333-333333333333', 'a2222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '43333333-3333-3333-3333-333333333333', 'CHECK_IN', public.fn_org_today('11111111-1111-1111-1111-111111111111'), now() - interval '4 hours 20 minutes', 'MANUAL_OVERRIDE', null, null, null, null, 'SKIPPED', null, true, 'CAMERA_UNAVAILABLE', 'Front camera on the depot tablet stopped responding; identity confirmed against ID card.'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '57777777-7777-7777-7777-777777777777', 'a3333333-3333-3333-3333-333333333333', '34444444-4444-4444-4444-444444444444', '45555555-5555-5555-5555-555555555555', 'CHECK_IN', public.fn_org_today('11111111-1111-1111-1111-111111111111'), now() - interval '5 hours 10 minutes', 'FACE_RECOGNITION', 0.7910, 0.6200, 'human', 'faceres-3.3.5', 'PASSED', 0.9300, false, null, null),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '58888888-8888-8888-8888-888888888888', 'a3333333-3333-3333-3333-333333333333', '35555555-5555-5555-5555-555555555555', '46666666-6666-6666-6666-666666666666', 'CHECK_IN', public.fn_org_today('11111111-1111-1111-1111-111111111111'), now() - interval '4 hours 50 minutes', 'FACE_RECOGNITION', 0.6850, 0.6200, 'human', 'faceres-3.3.5', 'PASSED', 0.8600, false, null, null)
on conflict do nothing;

-- --- Historical trips -------------------------------------------------------
-- Fourteen days of ordinary operation, so the rolling baseline has something
-- robust to learn from before the anomalous trips below are judged against it.
insert into public.trips (
  organization_id, depot_id, bus_id, route_id, driver_id, manager_id, status,
  actual_start_time, actual_end_time, expected_distance_km, distance_tolerance_pct,
  start_odometer_km, end_odometer_km, start_range_km, end_range_km,
  start_fuel_percent, end_fuel_percent,
  calculated_distance_km, distance_variance_km, distance_variance_pct,
  calculated_efficiency_kmpl, duration_minutes, review_status, created_by)
select
  '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  '41111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  '51111111-1111-1111-1111-111111111111',
  'a2222222-2222-2222-2222-222222222222',
  'COMPLETED',
  (public.fn_org_today('11111111-1111-1111-1111-111111111111') - d) + time '07:15',
  (public.fn_org_today('11111111-1111-1111-1111-111111111111') - d) + time '08:32',
  27.50, 10,
  180000 + (d * 60), 180000 + (d * 60) + dist,
  420 - (d % 4) * 12, 420 - (d % 4) * 12 - (dist * 1.05),
  78 - (d % 5) * 2, 78 - (d % 5) * 2 - 3.4,
  dist, round(dist - 27.5, 1), round((dist - 27.5) / 27.5 * 100, 2),
  round(dist / 5.31, 2), 77, 'REVIEWED_OK',
  'a2222222-2222-2222-2222-222222222222'
from generate_series(3, 16) d
cross join lateral (select (26.8 + ((d * 7) % 19) * 0.12)::numeric(10,1) as dist) x
on conflict do nothing;

-- A completed, unremarkable trip today.
insert into public.trips (
  id, organization_id, depot_id, bus_id, route_id, driver_id, manager_id, status,
  actual_start_time, actual_end_time, expected_distance_km, distance_tolerance_pct,
  start_odometer_km, end_odometer_km, start_range_km, end_range_km,
  start_fuel_percent, end_fuel_percent, calculated_distance_km, distance_variance_km,
  distance_variance_pct, calculated_efficiency_kmpl, duration_minutes, review_status, created_by)
values (
  '61111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111', '51111111-1111-1111-1111-111111111111',
  'a2222222-2222-2222-2222-222222222222', 'COMPLETED',
  now() - interval '4 hours', now() - interval '2 hours 45 minutes', 27.50, 10,
  186392.0, 186420.5, 395, 365, 71, 67.5, 28.5, 1.0, 3.64, 5.29, 75, 'REVIEWED_OK',
  'a2222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- A trip still in progress — the manager dashboard shows this as "On trip".
insert into public.trips (
  id, organization_id, depot_id, bus_id, route_id, driver_id, manager_id, status,
  actual_start_time, expected_distance_km, distance_tolerance_pct,
  start_odometer_km, start_range_km, start_fuel_percent, created_by)
values (
  '62222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111', '42222222-2222-2222-2222-222222222222',
  '32222222-2222-2222-2222-222222222222', '52222222-2222-2222-2222-222222222222',
  'a2222222-2222-2222-2222-222222222222', 'STARTED',
  now() - interval '55 minutes', 32.80, 12, 251980.0, 512, 84,
  'a2222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- Anomalous trip 1 — distance well above the route's tolerance band.
insert into public.trips (
  id, organization_id, depot_id, bus_id, route_id, driver_id, manager_id, status,
  actual_start_time, actual_end_time, expected_distance_km, distance_tolerance_pct,
  start_odometer_km, end_odometer_km, start_range_km, end_range_km,
  start_fuel_percent, end_fuel_percent, calculated_distance_km, distance_variance_km,
  distance_variance_pct, calculated_efficiency_kmpl, duration_minutes,
  anomaly_score, review_status, created_by)
values (
  '63333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111', '43333333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333', '53333333-3333-3333-3333-333333333333',
  'a2222222-2222-2222-2222-222222222222', 'REVIEW_REQUIRED',
  now() - interval '1 day 6 hours', now() - interval '1 day 4 hours', 24.10, 8,
  64277.0, 64310.0, 380, 330, 66, 60.2, 33.0, 8.9, 36.93, 5.06, 120,
  72.0, 'OPEN', 'a2222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- Anomalous trip 2 — modest distance, but the displayed range fell far more
-- than this bus historically drops. Flagged as a *range* anomaly, not a fuel
-- quantity claim: range is the vehicle's own estimate, not a measurement.
insert into public.trips (
  id, organization_id, depot_id, bus_id, route_id, driver_id, manager_id, status,
  actual_start_time, actual_end_time, expected_distance_km, distance_tolerance_pct,
  start_odometer_km, end_odometer_km, start_range_km, end_range_km,
  start_fuel_percent, end_fuel_percent, calculated_distance_km, distance_variance_km,
  distance_variance_pct, calculated_efficiency_kmpl, duration_minutes,
  anomaly_score, review_status, created_by)
values (
  '64444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222', '46666666-6666-6666-6666-666666666666',
  '35555555-5555-5555-5555-555555555555', '58888888-8888-8888-8888-888888888888',
  'a3333333-3333-3333-3333-333333333333', 'REVIEW_REQUIRED',
  now() - interval '2 days 5 hours', now() - interval '2 days 3 hours 20 minutes', 21.40, 10,
  312418.0, 312450.0, 340, 255, 74, 56.0, 32.0, 10.6, 49.53, 1.78, 100,
  84.0, 'OPEN', 'a3333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;

-- --- Anomalies --------------------------------------------------------------
insert into public.anomalies (
  organization_id, depot_id, trip_id, bus_id, driver_id, route_id,
  kind, severity, score, observed_value, expected_value, variance_pct, unit,
  rule_code, threshold_snapshot, detail, review_status, detected_at)
values
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111',
   '63333333-3333-3333-3333-333333333333', '43333333-3333-3333-3333-333333333333',
   '53333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
   'DISTANCE_VARIANCE', 'HIGH', 72.0, 33.0, 24.1, 36.93, 'km',
   'distance.variance.v1',
   '{"tolerance_pct": 8}'::jsonb,
   '{"reasons": ["ROUTE_DEVIATION", "EXTRA_TRIP", "INCORRECT_READING", "UNSCHEDULED_OPERATION"]}'::jsonb,
   'OPEN', now() - interval '1 day 4 hours'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '64444444-4444-4444-4444-444444444444', '46666666-6666-6666-6666-666666666666',
   '58888888-8888-8888-8888-888888888888', '35555555-5555-5555-5555-555555555555',
   'RANGE_DROP', 'HIGH', 84.0, 85.0, 38.4, 121.35, 'km',
   'range.drop.v1',
   '{"tolerance_pct": 35, "baseline_range_drop_per_km": 1.2, "sample_size": 11}'::jsonb,
   '{"observed_drop_km": 85, "distance_km": 32, "expected_drop_km": 38.4}'::jsonb,
   'OPEN', now() - interval '2 days 3 hours'),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111',
   null, '42222222-2222-2222-2222-222222222222', null, null,
   'MISSING_END_READING', 'MEDIUM', 45.0, null, null, null, null,
   'trip.missing_end_reading.v1', '{"max_open_hours": 12}'::jsonb,
   '{"open_since_minutes": 55}'::jsonb,
   'OPEN', now() - interval '20 minutes')
on conflict do nothing;

-- One anomaly that has already been worked, so the review trail is not empty.
insert into public.anomalies (
  id, organization_id, depot_id, bus_id, kind, severity, score,
  observed_value, expected_value, variance_pct, unit, rule_code,
  threshold_snapshot, detail, review_status, detected_at, resolved_at, resolved_by)
values (
  '71111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
  'READING_CONFIDENCE', 'LOW', 22.0, 0.41, 0.60, null, null,
  'reading.low_confidence.v1', '{"medium_confidence": 0.6}'::jsonb,
  '{"field": "RANGE_KM"}'::jsonb,
  'FALSE_POSITIVE', now() - interval '3 days', now() - interval '2 days 20 hours',
  'a2222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.anomaly_reviews (organization_id, anomaly_id, previous_status, new_status, notes, reviewed_by)
values ('11111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111',
        'OPEN', 'FALSE_POSITIVE',
        'Glare on the instrument cluster made the range digits unreadable. Manager re-entered the value manually from the same photo; odometer and fuel were consistent.',
        'a2222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- --- Notifications ----------------------------------------------------------
insert into public.notifications (organization_id, depot_id, recipient_id, kind, severity,
                                  title_key, body_key, payload, entity_type, entity_id)
values
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111',
   'a2222222-2222-2222-2222-222222222222', 'LICENCE_EXPIRING', 'WARNING',
   'notifications.licenceExpiring.title', 'notifications.licenceExpiring.body',
   '{"employeeName": "Mohammed Irfan", "days": 25}'::jsonb, 'employee',
   '52222222-2222-2222-2222-222222222222'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'a3333333-3333-3333-3333-333333333333', 'HIGH_SEVERITY_ANOMALY', 'CRITICAL',
   'notifications.highSeverityAnomaly.title', 'notifications.highSeverityAnomaly.body',
   '{"registrationNumber": "KA 05 BC 7788"}'::jsonb, 'trip',
   '64444444-4444-4444-4444-444444444444')
on conflict do nothing;

-- --- Learned baselines ------------------------------------------------------
insert into public.bus_baselines (organization_id, bus_id, route_id, sample_size,
  median_efficiency_kmpl, mad_efficiency_kmpl, median_range_drop_per_km,
  mad_range_drop_per_km, median_distance_km, window_start, window_end)
values
  ('11111111-1111-1111-1111-111111111111', '41111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', 14, 5.31, 0.14, 1.050, 0.060, 27.80,
   current_date - 16, current_date),
  ('11111111-1111-1111-1111-111111111111', '46666666-6666-6666-6666-666666666666',
   '35555555-5555-5555-5555-555555555555', 11, 4.05, 0.22, 1.200, 0.090, 21.60,
   current_date - 30, current_date)
on conflict do nothing;
