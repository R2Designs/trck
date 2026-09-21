<div align="center">

# trck

**Bus fleet operations for depots that run on phones.**

Attendance by face. Odometer and fuel readings by camera. Discrepancies
surfaced for a human to judge — never a verdict, never an accusation.

English · தமிழ் · తెలుగు · ಕನ್ನಡ

</div>

---

## What it does

A depot manager opens trck on the phone in their pocket and, in a few taps:

- **takes attendance** by pointing the camera at the driver — matched against
  photographs enrolled with the driver's consent, with a manual path that is
  always one tap away;
- **starts a trip** by photographing the dashboard; the odometer, range and
  fuel gauge are read from the picture and shown for confirmation before
  anything is saved;
- **completes the trip** the same way, at which point the distance, fuel used
  and efficiency are computed **server-side** and compared against what this
  particular bus normally does on this particular route;
- **reviews anything unusual** — a distance that does not match the route, a
  fuel drop with no kilometres behind it, a reading the camera was unsure of —
  with the numbers, the threshold that was in force, and a plain-language
  explanation of why it was flagged.

An administrator sees the whole organisation, manages depots and managers,
tunes the thresholds, and reads an append-only audit log.

## What it deliberately does not do

- **It does not accuse anyone.** There is no word for fraud or theft anywhere in
  the product, in any of the four languages. The system reports a _discrepancy_
  and asks a person to look at it. Every review is recorded with the reviewer,
  the outcome and a written reason.
- **It does not trust the camera.** Every OCR value and every face match
  carries a confidence, a threshold, and a decision — and any of them can be
  overridden by a person, with the override recorded.
- **It does not profile people.** Age, gender and emotion estimation are
  explicitly disabled in the face pipeline. The only question ever asked of a
  photograph is "is this the person who enrolled?".
- **It does not enforce permissions in the browser.** Authorisation lives in
  PostgreSQL row-level security. The React app's guards exist to avoid showing
  someone a screen they cannot use — they are not the boundary.

## Quick start

```bash
git clone <your-fork> trck && cd trck
npm install
cp .env.example .env.local        # fill in your Supabase URL + anon key
npm run dev
```

Without a Supabase project you can still run everything that does not need one:

```bash
npm run verify        # typecheck · lint · i18n parity · 116 unit + integration tests
./scripts/db-test.sh  # applies all migrations + seed + 32 RLS assertions to a local Postgres
```

`scripts/db-test.sh` needs nothing but a local PostgreSQL 16 — no Docker, no
Supabase account, no network. It is what CI runs.

For a real deployment, including the three Edge Functions and the storage
buckets, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Stack

| Layer      | Choice                                                | Why                                                          |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| UI         | React 18 · TypeScript (strict) · Vite 6               | Mobile-first PWA; installs to a home screen                  |
| Styling    | Tailwind + HSL design tokens                          | One token set drives light and dark                          |
| Components | Radix primitives · lucide icons                       | Accessible by construction, not by retrofit                  |
| Data       | TanStack Query 5                                      | Cache, retry and offline behaviour in one place              |
| Backend    | Supabase (Postgres · Auth · Storage · Edge Functions) | Generous free tier; no vendor lock beyond Postgres           |
| Face       | `@vladmandic/human`, in-browser                       | No image leaves the device for recognition; no per-call cost |
| OCR        | Tesseract.js, in-browser                              | Same                                                         |
| i18n       | react-i18next                                         | One namespace per language, loaded on demand                 |

Every third-party capability sits behind an interface with at least two
implementations (`src/providers/*`), so replacing one is a new adapter rather
than a rewrite.

## Documentation

| Document                                        | What it covers                                  |
| ----------------------------------------------- | ----------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)         | How the pieces fit, and the shared domain layer |
| [DATABASE.md](docs/DATABASE.md)                 | Schema, invariants, and what each table is for  |
| [SECURITY.md](docs/SECURITY.md)                 | RLS model, biometric handling, threat notes     |
| [FACE_RECOGNITION.md](docs/FACE_RECOGNITION.md) | The pipeline, and performance across skin tones |
| [OCR.md](docs/OCR.md)                           | Dashboard reading, parsing and correction       |
| [ANOMALY_ENGINE.md](docs/ANOMALY_ENGINE.md)     | Every rule, its threshold and its scoring       |
| [I18N.md](docs/I18N.md)                         | Adding a language, and the rules for strings    |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)             | Supabase setup, Edge Functions, hosting, CI     |

## Commands

```bash
npm run dev           # dev server
npm run build         # typecheck, then production build
npm run verify        # typecheck + lint + i18n parity + tests
npm run test          # unit + integration (vitest)
npm run test:e2e      # Playwright, against a seeded project
npm run i18n:check    # every locale has every key, with matching placeholders
./scripts/db-test.sh  # migrations + seed + RLS assertions on local Postgres
```

## Licence

See `LICENSE`.
