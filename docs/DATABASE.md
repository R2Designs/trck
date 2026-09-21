# Database

PostgreSQL 16 (Supabase). **26 tables, all with `enable` _and_ `force row level
security`.** Fifteen migrations, applied in order, verified end to end by
`./scripts/db-test.sh` against a bare local Postgres — no Docker, no Supabase
account, no network.

## Migrations

| File                                   | Contains                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `…000100_extensions_and_enums`         | `pgcrypto`, `pg_trgm`, `btree_gist`; ~20 enums                                                |
| `…000200_tenancy`                      | `organizations`, `depots`, `profiles`, `user_roles`, `manager_depots`                         |
| `…000300_auth_helpers`                 | the `SECURITY DEFINER` claim readers, `fn_org_today`                                          |
| `…000400_fleet`                        | `buses`, `routes`, `route_stops`                                                              |
| `…000500_employees_biometrics`         | `employees`, `biometric_consents`, `employee_photos`, `face_embeddings`, `driver_assignments` |
| `…000600_trips_attendance`             | `trips`, `attendance_records`                                                                 |
| `…000700_captures_readings`            | `dashboard_captures`, `dashboard_readings`, `fuel_entries`                                    |
| `…000800_anomalies_baselines`          | `anomalies`, `anomaly_reviews`, `bus_baselines`                                               |
| `…000900_audit_settings_notifications` | `audit_logs`, `app_settings`, `user_preferences`, `notifications`, `analytics_events`         |
| `…001000_triggers`                     | `updated_at`, new-user handling, redaction, audit writers, mutation blocks, bus/trip sync     |
| `…001100_rls`                          | every policy, `revoke all … from anon`                                                        |
| `…001200_rpc`                          | the transactional operations                                                                  |
| `…001300_dashboards`                   | `rpc_manager_dashboard`, `rpc_admin_dashboard`                                                |
| `…001400_storage`                      | private buckets and their policies                                                            |
| `…001500_retention`                    | media purging, biometric deletion                                                             |

## Conventions

- `uuid` primary keys (`gen_random_uuid()`), except `audit_logs`, which uses an
  identity column so ids are sequential and not reusable.
- Enum values are **SCREAMING_SNAKE** and translated client-side only. The
  database never stores a user-visible sentence.
- `created_at` / `updated_at` on everything mutable, maintained by
  `fn_touch_updated_at`.
- **No hard deletes of operational entities.** `deactivated_at`, `revoked_at`,
  `unassigned_at`, `purged_at` — historical attendance must stay resolvable to a
  person, and a manager who left last year must still be attributable on the
  reviews they wrote.
- `numeric` with explicit precision for every measurement. Never `float` for a
  kilometre.
- Money and biometrics are absent from the schema by design: there is no
  payments table, and no image bytes anywhere.

## Tenancy

```
organizations ─┬─ depots ─┬─ buses
               │          ├─ routes ── route_stops
               │          ├─ employees ─┬─ biometric_consents
               │          │             ├─ employee_photos
               │          │             ├─ face_embeddings
               │          │             └─ driver_assignments
               │          └─ trips ─┬─ attendance_records
               │                    ├─ dashboard_captures ── dashboard_readings
               │                    ├─ fuel_entries
               │                    └─ anomalies ── anomaly_reviews
               ├─ profiles ── user_roles, manager_depots
               ├─ app_settings, audit_logs, notifications, analytics_events
               └─ bus_baselines
```

Every operational table carries `organization_id`; most also carry `depot_id`,
denormalised deliberately so a depot policy is an index lookup rather than a
join chain.

## Helper functions

`SECURITY DEFINER`, `set search_path = ''`, `stable`:

| Function                             | Returns                                         |
| ------------------------------------ | ----------------------------------------------- |
| `auth_org_id()`                      | The caller's organisation                       |
| `auth_role()`                        | `SUPER_ADMIN` / `ADMIN` / `MANAGER` / `DRIVER`  |
| `auth_is_admin()`, `auth_is_staff()` | Convenience predicates                          |
| `auth_depot_ids()`                   | Depots the caller may act in                    |
| `auth_can_access_depot(uuid)`        | The depot check used by most policies           |
| `fn_org_today(uuid)`                 | Today's date **in the organisation's timezone** |

`SECURITY DEFINER` is not laziness — it is what prevents policy recursion. A
policy on `user_roles` that queried `user_roles` would not terminate.

`fn_org_today` earns its own row because of a bug it fixed. "One attendance per
person per day" was implemented with `current_date`, which is UTC. At 05:00 in
Asia/Kolkata it is still yesterday in UTC, so the uniqueness check silently
allowed a second check-in every morning. Every date-bounded rule now goes
through the organisation's own timezone.

## Invariants enforced in the database

These are constraints and indexes, not application code, so no client can miss
them.

**Attendance**

- `attendance_unique_per_day` / `attendance_unique_per_trip` — partial unique
  indexes, on `fn_org_today()`.
- `attendance_face_requires_evidence` — a face-verified record must carry the
  match score and evidence.
- `attendance_override_requires_reason` — a manual record must state why.
- No DELETE policy, and `fn_block_mutation` raises on one.

**Trips**

- `trips_one_open_per_bus` — a partial unique index on in-progress trips. One
  bus, one open trip.
- `trips_odometer_not_regressed` — end ≥ start.
- `trips_time_order` — end ≥ start.
- `trips_override_needs_reason`.
- `expected_distance_km` and `distance_tolerance_pct` are **snapshotted** onto
  the trip, so editing a route later does not rewrite history.

**Anomalies**

- `anomalies_score_range` — 0 to 100.
- `anomalies_resolution_consistent` — an unresolved status has no
  `resolved_at`, and a resolved one must have it.
- `rule_code`, `rule_version`, `threshold_snapshot` on every row, so a finding
  stays explicable after the settings change.
- `anomaly_reviews` is append-only, with a note of at least 10 characters.

**Audit**

- `audit_logs_action_format` — `^[A-Z][A-Z0-9_.]{2,63}$`.
- **No UPDATE or DELETE policy exists at all**, plus `fn_block_mutation`.

**Readings**

- `dashboard_readings_correction_consistent` — `was_corrected` implies both
  `corrected_by` and `corrected_at`.
- `dashboard_readings_source_consistent`, `…_fuel_percent_range`, `…_nonneg`.

**Buses**

- Registration numbers are unique per organisation, **case- and
  space-insensitively** — `KA01AB1234` and `ka 01 ab 1234` are the same bus.

## RPCs

Operations that must be transactional, or must not be decided by the client:

| RPC                                             | Does                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `rpc_record_attendance`                         | Duplicate detection, **server-side re-check** of the similarity threshold and liveness, override-reason enforcement |
| `rpc_start_trip`                                | Opens a trip, snapshots expected distance and tolerance                                                             |
| `rpc_complete_trip`                             | Computes distance, variance and efficiency **in SQL**; enforces the override rule                                   |
| `rpc_face_candidates`                           | Depot-scoped candidate descriptors, drivers assigned to the bus or route first                                      |
| `rpc_recompute_bus_baseline`                    | `percentile_cont` medians and MAD, excluding `READING_ERROR` trips                                                  |
| `rpc_search`                                    | Cross-entity search within what the caller may see                                                                  |
| `rpc_manager_dashboard` / `rpc_admin_dashboard` | One JSONB document each, so a home screen is one request                                                            |
| `rpc_delete_biometric_data`                     | Removes an individual's embeddings and photographs, audited                                                         |

`rpc_record_attendance` re-checking the threshold is the important one: a client
that posts a flattering similarity score does not get a pass.

## Triggers

| Trigger                           | Purpose                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `fn_touch_updated_at`             | Maintains `updated_at`                                                                   |
| `fn_handle_new_user`              | Mirrors `auth.users` into `profiles`                                                     |
| `fn_redact`                       | Strips embeddings, raw OCR payloads, passwords and tokens before they reach an audit row |
| `fn_write_audit` / `fn_audit_row` | Before/after snapshots                                                                   |
| `fn_block_mutation`               | Makes `audit_logs` and `anomaly_reviews` immutable; blocks attendance deletion           |
| `fn_sync_bus_from_trip`           | A bus becomes `ON_TRIP` when a trip opens and `AVAILABLE` when it closes                 |
| `fn_guard_profile_self_update`    | Blocks self-service changes to `organization_id`, `status`, `email`                      |

## Storage

Private buckets `employee-faces` and `dashboard-captures`. `fn_storage_org(name)`
parses the organisation id from the **second** path segment, and the policies
restrict every object to staff of that organisation. The key layout is fixed by
those policies — see `src/providers/storage/types.ts`.

## Retention

`fn_purge_expired_media` deletes media past the configured windows
(`photo_retention_days` 365, `dashboard_capture_retention_days` 180,
`attendance_retention_days` 2555) but **never purges media attached to an open
anomaly**. Evidence outlives the routine retention clock.

## Running the tests

```bash
./scripts/db-test.sh
```

Recreates the database, applies `supabase/tests/00_supabase_shim.sql` (which
recreates `auth.users`, `auth.uid()`, `storage.objects`, `storage.foldername`
and the `anon`/`authenticated`/`service_role` roles so migrations run against
plain Postgres), then all fifteen migrations, the seed, and
`supabase/tests/10_rls_test.sql` — **32 assertions** across cross-tenant
isolation, forged-`organization_id` inserts, manager depot scoping, admin
visibility, audit immutability, privilege-escalation attempts, attendance rules,
trip lifecycle invariants and face-candidate scoping.

## Seed

`supabase/seed.sql` builds a realistic demo tenant: Sri Balaji Transport, two
Bengaluru depots, one administrator and two managers, 12 employees, 8 buses,
5 routes, 14 historical trips plus 4 notable ones, 4 anomalies across severities,
notifications and computed baselines. It is enough to see every screen populated
without touching real data.
