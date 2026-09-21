# Security

## The model in one sentence

**Authorisation is PostgreSQL row-level security.** Everything else — the React
route guards, the role checks in `@domain/roles.ts`, the shape of the API —
exists to avoid showing someone a screen they cannot use. None of it is the
boundary.

That distinction is testable, and it is tested. `supabase/tests/10_rls_test.sql`
runs 32 assertions as real database roles with real JWT claims, and
`tests/e2e/tenant-isolation.spec.ts` attacks the deployed app from a signed-in
session using the manager's own access token — deliberately bypassing React.

## Tenancy

```
organization
  └── depot
        ├── manager  (via manager_depots)
        ├── bus
        ├── route
        ├── employee
        └── trip → attendance, captures, readings, anomalies
```

Every operational table carries `organization_id`, and most also carry
`depot_id`. Policies are built from five `SECURITY DEFINER` helper functions —
`auth_org_id()`, `auth_role()`, `auth_is_admin()`, `auth_depot_ids()`,
`auth_can_access_depot()` — which read the caller's claims once. They are
`SECURITY DEFINER` specifically to avoid policy recursion: a policy on
`user_roles` that queried `user_roles` would not terminate.

Three rules hold across all 26 tables:

1. `enable row level security` **and** `force row level security`, so the table
   owner is subject to its own policies.
2. `revoke all … from anon` — nothing is readable without a session.
3. An INSERT's `organization_id` must equal `auth_org_id()`. A forged value in a
   request body is rejected by the `WITH CHECK` clause, not by application code.

An administrator sees their whole organisation. A manager sees only depots
listed in `manager_depots` with `unassigned_at is null`. Neither sees another
tenant, and `SUPER_ADMIN` grants no cross-tenant power through any API —
cross-tenant support work is done with database access, deliberately.

## Things that cannot be done, by construction

| Attempt                                                   | Stopped by                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Read another tenant's buses, trips, employees, embeddings | RLS SELECT policies                                                                                                     |
| Insert a row with someone else's `organization_id`        | RLS `WITH CHECK`                                                                                                        |
| Move yourself into another organisation                   | `fn_guard_profile_self_update` blocks self-service changes to `organization_id`, `status`, `email`                      |
| Grant yourself `ADMIN`                                    | No INSERT/UPDATE policy on `user_roles` for non-admins                                                                  |
| Edit or delete an audit row                               | **No UPDATE or DELETE policy exists on `audit_logs` at all**, plus `fn_block_mutation`                                  |
| Delete an attendance record                               | `fn_block_mutation`                                                                                                     |
| Edit an anomaly review after the fact                     | `anomaly_reviews` is append-only                                                                                        |
| Record attendance below the confidence threshold          | `rpc_record_attendance` re-checks server-side                                                                           |
| Record a manual attendance with no reason                 | `attendance_override_requires_reason` CHECK                                                                             |
| Record attendance twice for one person in one day         | partial unique index, on the **organisation's** local date (`fn_org_today`)                                             |
| Start a second concurrent trip for one bus                | `trips_one_open_per_bus` partial unique index                                                                           |
| Complete a trip with an end odometer below the start      | `trips_odometer_not_regressed` CHECK                                                                                    |
| Complete a trip with no end reading and no override       | `rpc_complete_trip`                                                                                                     |
| Clear your own trip's anomaly score                       | No policy permits a manager to write `anomaly_score` / `review_status`; only `trip-finalise` does, with the service key |
| Sign a storage URL for another tenant's object            | `assertOwnedObjectKey` in `storage-sign`, plus storage RLS via `fn_storage_org` for the Supabase adapter                |
| Disable an administrator in another organisation          | `admin-users` loads the target's profile and compares organisations                                                     |

## The service-role key

It exists in exactly one place: Supabase secrets, read by the Edge Functions.

- It is **never** in the browser bundle, never in a response body, never logged.
- `src/lib/supabase/client.ts` is constructed with the anon key only.
- Each function that uses it (`_shared/auth.ts`) builds **two** clients: one
  carrying the caller's JWT (`asCaller`) and one with the service key
  (`asService`). Reads that should be filtered use `asCaller`, so RLS applies.
  `asService` is used only for what RLS cannot express — creating an auth user,
  writing a system-attributed anomaly — and every such use is preceded by an
  explicit organisation check derived from the verified JWT.
- The caller's role is read from the database by verified user id. A role
  claimed in a request body is never trusted.

## Biometric data

Treated as the most sensitive thing in the system.

- **Consent first.** `biometric_consents` must hold an unrevoked row before
  enrolment. The camera does not open without it.
- **Never in an ordinary response.** `face_embeddings` is not part of any
  employee `select`. The single read path is `rpc_face_candidates`, depot-scoped.
- **Never in a log.** `src/lib/logger.ts` redacts descriptor-shaped keys at any
  depth and collapses long numeric arrays to `[vector]`. `fn_redact` does the
  same for audit rows, also stripping `ocr_raw_response`, passwords and tokens.
- **Never in Postgres as an image.** Photographs go to private object storage;
  the database holds coordinates only.
- **Deletion on request.** `rpc_delete_biometric_data` removes an individual's
  embeddings and photographs and records the deletion.
- **Retention.** `fn_purge_expired_media` enforces the configured windows, and
  will not purge media attached to an open anomaly — evidence outlives the
  routine retention clock.
- **No profiling.** Age, gender and emotion estimation are explicitly disabled.

See [FACE_RECOGNITION.md](FACE_RECOGNITION.md) for the pipeline itself.

## Audit

`audit_logs` is append-only at three levels: no UPDATE or DELETE policy exists,
`fn_block_mutation` raises on either, and the table uses an identity column so
ids are not reusable. `fn_audit_row` writes before/after snapshots through
`fn_redact`. Only administrators can read it; a manager cannot, which the RLS
suite asserts.

Every override is audited with its reason: manual attendance, a corrected OCR
value, a trip completed without a reading, an anomaly resolution.

## Storage

Two private buckets, `employee-faces` and `dashboard-captures`. Keys are

```
organizations/{orgId}/employees/{employeeId}/faces/{fileId}.jpg
organizations/{orgId}/buses/{busId}/trips/{tripId}/dashboard/{fileId}.jpg
```

The organisation id is the **second segment** because `fn_storage_org()` parses
it from there for the storage policies. Changing the layout means changing those
policies — the comment in `src/providers/storage/types.ts` says so.

For the R2 adapter there are no storage policies, so `storage-sign` is the
boundary. `assertOwnedObjectKey` rejects traversal, absolute paths, empty
segments, backslashes and control characters, and then compares the organisation
segment **as a whole segment** — a key beginning with the caller's org id
followed by more characters does not pass. Signed URLs are capped at one hour
and default to five minutes. Deletion is performed by the function itself rather
than by handing the browser a signed DELETE.

## Input handling

- All forms validate with zod before submission; the database validates again
  with CHECK constraints, which are the ones that count.
- CSV exports escape a leading `=`, `+`, `-` or `@` so an exported field cannot
  become a formula when the file is opened in a spreadsheet.
- Edge Functions return **error codes**, never messages. A raw Postgres string in
  a response body leaks schema detail and is unreadable in Tamil. The real error
  is logged server-side with a correlation id that _is_ returned, so a support
  request is traceable without exposing anything.
- CORS is allow-listed via `ALLOWED_ORIGINS`, not `*`. These functions act with
  elevated privilege; an open policy would let any page a signed-in manager
  visits drive them with that manager's session.

## Language

A deliberate constraint, enforced in review and asserted in
`tests/e2e/manager-journey.spec.ts`: **the product never accuses anyone.** There
is no string in any of the four languages containing fraud, theft, stealing or
cheating. The vocabulary is "anomaly", "requires review", "distance mismatch",
"unusual", "needs a look". The system reports a discrepancy; a person decides
what it means, and their decision is recorded with a written reason.

This is a security property as much as an ethical one. A system that labels
people generates pressure to act on the label; one that surfaces discrepancies
keeps the human accountable for the judgement.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
