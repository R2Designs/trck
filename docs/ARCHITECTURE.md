# Architecture

## The shape of it

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (PWA)                                               │
│                                                              │
│  React app ──┬── src/features/*     screens & journeys       │
│              ├── src/components/*   UI kit, camera, charts   │
│              ├── src/providers/*    face · ocr · storage ·   │
│              │                      analytics · notifications│
│              └── src/lib/*          format, errors, queue    │
│                            │                                 │
│                            └── @domain ──────────────┐       │
└──────────────────────────────│───────────────────────│───────┘
                               │ supabase-js           │ same
                               ▼                       │ source
┌──────────────────────────────────────────────────────│───────┐
│  Supabase                                            │       │
│                                                      ▼       │
│  Edge Functions ── admin-users · trip-finalise · storage-sign│
│                            │                                 │
│  PostgreSQL ───────────────┴── RLS · RPCs · triggers · audit │
│  Storage ────────────────────── private buckets, signed URLs │
└──────────────────────────────────────────────────────────────┘
```

## The single most important decision

**The business rules exist once, in `supabase/functions/_shared/domain/`, and
both the browser and the Edge Functions import that same source.**

That directory is pure TypeScript with no I/O, no clock reads and no
dependencies: the anomaly rules, the OCR parser, the face-matching maths, the
trip metrics, the thresholds and the permission matrix. The browser reaches it
through the `@domain` alias (configured in `vite.config.ts`, `vitest.config.ts`
and `tsconfig.json`); Deno reaches it by relative path.

This matters because of what the app has to do with it. When a manager
completes a trip, the browser _explains_ the result — "this bus normally does
5.1 km/L on this route; this trip did 3.4" — and the Edge Function _decides_ it.
If those were two implementations, they would disagree eventually, and the
disagreement would surface as a manager being shown one thing and a reviewer
seeing another. One module, two call sites.

The division of labour is therefore:

| Where         | Does                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `@domain`     | Decides _what the numbers mean_. Pure, tested, shared.                             |
| Edge Function | Reads the facts from the database, runs `@domain`, writes the result.              |
| Browser       | Collects evidence, renders the explanation, never decides.                         |
| PostgreSQL    | Decides _who may see and write what_. Enforced by RLS, not by either of the above. |

## Why anything runs on the server at all

The browser already has the rules. It could compute the anomaly score itself and
post it. It must not, for one reason: **a value the browser computed is a value
the browser could have chosen.** The person whose trip is being evaluated is
often the person holding the phone.

So `trip-finalise` takes exactly one input — a trip id — and reads the readings,
the thresholds and the baseline out of the database itself. The `anomalies` rows
it writes are produced somewhere the reviewed party cannot reach.

The same logic explains the other two functions:

- **`admin-users`** exists because creating and disabling an auth user needs the
  service-role key, and that key must never be in a browser bundle. It is the
  _only_ code that holds it, and every action it takes is preceded by a check
  that the target user belongs to the caller's organisation — read from the
  database, never from the request body.
- **`storage-sign`** exists because S3 signing needs a secret. For the R2
  adapter there are no storage RLS policies, so this function is the tenant
  boundary: it refuses to sign any object key whose organisation segment is not
  the caller's. That check is `_shared/object-keys.ts`, tested directly.

## Adapters, and why everything has two

Every third-party capability is an interface in `src/providers/<capability>/`
with a `types.ts`, at least two implementations, a `get*Provider()` selector
driven by configuration, and a `__set*Provider()` seam for tests.

| Capability    | Default                                    | Alternative                                             |
| ------------- | ------------------------------------------ | ------------------------------------------------------- |
| Face          | `@vladmandic/human` in-browser             | `mock` (deterministic descriptors, for tests and demos) |
| OCR           | Tesseract.js in-browser                    | `mock`                                                  |
| Storage       | Supabase Storage (private buckets)         | Cloudflare R2 via `storage-sign`                        |
| Analytics     | The project's own `analytics_events` table | `console`, `noop`                                       |
| Notifications | In-app rows in `notifications`             | composable; an SMS adapter drops in                     |

Two consequences worth noting. First, there is **no paid API anywhere** —
recognition and OCR both run on the device, which also means no photograph is
transmitted for analysis. Second, the notification interface takes translation
_keys and parameters_, never rendered sentences, so a future SMS channel can
render them in the recipient's own language rather than the sender's.

## Data flow: completing a trip

1. The manager photographs the dashboard. `src/lib/image.ts` strips EXIF,
   downscales and compresses; `src/lib/face-image.ts` is not involved here.
2. The OCR provider returns words with bounding boxes and confidences.
3. `@domain/ocr-parse.ts` scores candidates by label proximity, glyph shape and
   plausibility against the bus's previous odometer, and returns readings with
   a confidence band — plus an explicit list of fields it could **not** find.
4. `OCRReview` shows every value for confirmation. A correction is recorded as
   a correction (`was_corrected`, `corrected_by`, `corrected_at`), not as if the
   machine had read it.
5. `rpc_complete_trip` writes the trip and computes distance, variance and
   efficiency **in SQL**, from the stored readings.
6. `trip-finalise` runs `@domain/anomaly-engine.ts` over the stored trip and
   writes any findings, each with the rule code, rule version and a snapshot of
   the thresholds in force — so a year-old anomaly is still explicable after the
   thresholds have been changed.
7. The browser renders the explanation from the finding's `detail` parameters,
   in the manager's language.

If step 6 fails, the trip is still saved. Anomaly evaluation is a separate step
precisely so a transient failure never costs a manager the reading they walked
out to the bus to take; the function is idempotent and re-running it replaces
open findings while leaving reviewed ones alone.

## Offline

`src/lib/offline-queue.ts` is an IndexedDB queue replayed oldest-first when the
`online` event fires, with handlers registered in `src/lib/offline-handlers.ts`
during bootstrap. It covers low-risk writes whose meaning does not change with
time: creating and editing drivers, buses and routes; resolving an alert;
analytics.

It deliberately does **not** cover attendance or anything biometric. A face scan
cannot be verified without the candidate descriptors, and caching a driver's
face image in browser storage to replay later would be both a privacy hazard and
a lie about when the check happened. A manager with no signal uses the explicit
manual-entry path, which they knowingly choose and which records a reason.

Replays go through the ordinary client, so RLS still applies — being offline is
not a way around a policy. A unique-violation on replay is treated as success,
because it means the server committed the first attempt and only the response
was lost.

## Rendering and routing

`src/App.tsx` lazy-loads every route, so the initial bundle carries the shell,
the design system and the first screen. The face model (~1.5 MB) and Tesseract
are both dynamically imported at the moment a camera screen opens, not at boot.

The layout is a bottom navigation bar on phones and a sidebar above `lg`, both
rendered from one `AppShell`. The design target is a mid-range Android phone
held in one hand in a depot yard; desktop is a projection of that, not the other
way round.

## State

- **Server state** is TanStack Query, with every key centralised in
  `src/app/query-client.ts` so an invalidation cannot miss a cache.
- **Identity** is one `AuthProvider` context holding the user, profile, role and
  accessible depots.
- **Theme** is a `data-theme` attribute on `<html>`, applied _before_ React
  mounts so a dark-themed phone never flashes white.
- **Language** is resolved profile → device preference → browser → English, and
  initialised before React mounts for the same reason.

There is no global store. Nothing needed one.
