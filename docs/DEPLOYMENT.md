# Deployment

Everything here fits inside free tiers: Supabase's free project, any static host
for the frontend, and no paid third-party API. Recognition and OCR run on the
device.

## 1. Supabase project

Create a project, then note the **Project URL** and the **anon (publishable)
key**. The anon key belongs in the browser — that is what it is for, and it is
safe there precisely because every table is protected by row-level security.

The **service-role key belongs nowhere except Supabase secrets.** If it ever
appears in a file with a `VITE_` prefix, rotate it.

## 2. Schema

```bash
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/* in order
```

Optionally seed a demo tenant:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

Verify locally first, without touching the project:

```bash
./scripts/db-test.sh      # migrations + seed + 32 RLS assertions on local Postgres
```

## 3. Storage buckets

Create **`employee-faces`** and **`dashboard-captures`**, both **private**.
Migration `…001400_storage.sql` creates the policies; if you create the buckets
by hand afterwards, re-run that migration so the policies attach.

Do not make either bucket public. The application never needs a public URL — it
signs short-lived ones.

## 4. Edge Functions

```bash
supabase functions deploy admin-users
supabase functions deploy trip-finalise
supabase functions deploy storage-sign
```

Then the secrets:

```bash
supabase secrets set \
  ALLOWED_ORIGINS="https://trck.example.com" \
  APP_URL="https://trck.example.com"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform — do not set them yourself.

**`ALLOWED_ORIGINS` is not optional.** These functions act with elevated
privilege; a wildcard CORS policy would let any page a signed-in manager visits
drive them with that manager's session. Set it to your real origins, comma
separated.

Only if you use the R2 storage adapter:

```bash
supabase secrets set \
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  R2_REGION=auto R2_BUCKET_FACES=... R2_BUCKET_DASHBOARDS=...
```

## 5. Authentication settings

In the Supabase dashboard:

- **Site URL** → your deployed origin.
- **Redirect URLs** → add `<origin>/auth/set-password` and
  `<origin>/auth/reset-password`. `admin-users` sends invitations and recovery
  links to these; without them an invited manager lands nowhere.
- Email confirmations **on**. Managers are invited, never self-registered.

## 6. First administrator

There is no self-service sign-up, by design. Create the first administrator
directly:

```sql
-- after creating the auth user in the dashboard
insert into public.organizations (name, slug, timezone)
values ('Your Transport Co', 'your-transport-co', 'Asia/Kolkata')
returning id;

update public.profiles
   set organization_id = '<org-id>', full_name = 'Your Name', status = 'ACTIVE'
 where email = 'you@example.com';

insert into public.user_roles (user_id, organization_id, role)
select id, '<org-id>', 'ADMIN' from public.profiles where email = 'you@example.com';

insert into public.app_settings (organization_id) values ('<org-id>');
```

Set `timezone` correctly. Every "per day" rule in the product — one attendance
per person per day, today's dashboard figures — is evaluated in the
organisation's timezone via `fn_org_today()`, not in UTC.

From there, every other manager is invited through the app.

## 7. Frontend

```bash
cp .env.example .env.local     # fill in URL + anon key
npm run build                  # typecheck, then vite build → dist/
```

Deploy `dist/` to any static host. It is a single-page app, so:

- rewrite all unmatched routes to `/index.html`;
- serve `/sw.js` with `Cache-Control: no-cache` — a cached service worker is how
  a PWA gets stuck on an old build;
- serve hashed assets under `/assets/` with a long immutable max-age.

Recommended headers:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), geolocation=(), microphone=()
Content-Security-Policy: default-src 'self';
  connect-src 'self' https://<project-ref>.supabase.co https://cdn.jsdelivr.net;
  img-src 'self' data: blob: https://<project-ref>.supabase.co;
  worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'
```

Two notes on that CSP. `wasm-unsafe-eval` is required by the face model and by
Tesseract, both of which are WebAssembly. `cdn.jsdelivr.net` is only needed if
you use the default `VITE_FACE_MODEL_BASE_PATH`; self-host the weights (see
below) and you can drop it.

**HTTPS is mandatory**, not advisory: `getUserMedia` does not exist on an
insecure origin, so the camera — and therefore most of the product — simply does
not work over plain HTTP.

## 8. Self-hosting the models (optional, recommended)

By default the ~1.5 MB face model is fetched from jsDelivr on first use. For a
depot on a metered or restricted connection, host it yourself:

1. Copy `node_modules/@vladmandic/human/models/` into `public/models/`.
2. Set `VITE_FACE_MODEL_BASE_PATH=/models/`.
3. Do the same for Tesseract via `VITE_OCR_WORKER_PATH`, `VITE_OCR_CORE_PATH`
   and `VITE_OCR_LANG_PATH`.

The PWA precache deliberately excludes `**/models/**` and `**/*.wasm`, so the
service worker does not try to cache several megabytes on first load.

## 9. CI

```yaml
- run: npm ci
- run: npm run verify # typecheck · lint · i18n parity · tests
- run: ./scripts/db-test.sh # migrations + RLS assertions
  env:
    PGHOST: localhost
    PGUSER: postgres
- run: deno test supabase/functions/_shared/ # SigV4 + object-key guards
- run: npm run build
```

The database job needs only a `postgres:16` service container. Nothing in
`verify` or `db-test.sh` reaches the network or needs Supabase credentials,
which is the point — a fork can run the whole suite.

The E2E suite is separate and needs a seeded project:

```bash
E2E_BASE_URL=https://staging.trck.example.com \
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
npm run test:e2e
```

## 10. After deploying

- Sign in and change the seeded passwords if you loaded the demo seed.
- Set `VITE_SHOW_DEMO_CREDENTIALS=false` anywhere real.
- Review the thresholds on the admin screen against your fleet — the defaults
  are tuned for a mixed diesel city fleet and are deliberately conservative.
- Schedule `rpc_recompute_bus_baseline` (a nightly `pg_cron` job is enough);
  baselines are what stop the anomaly engine comparing every bus to an average.
- Schedule `fn_purge_expired_media` for the retention policy.
- Check that a photograph taken on a real depot phone, in real light, passes the
  face quality gate. If it does not, the thresholds are per organisation and
  editable — see [FACE_RECOGNITION.md](FACE_RECOGNITION.md).

## Rollback

Migrations are forward-only. To roll back the frontend, redeploy the previous
`dist/` — it is a static bundle, and the API surface it talks to (RLS policies
and RPCs) is versioned by migration, not by build.
