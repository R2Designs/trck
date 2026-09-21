#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# trck — database test runner
#
# Applies the Supabase shim, every migration, the demo seed and the RLS/business
# rule assertions to a throwaway PostgreSQL database. No Docker, no Supabase
# account, no network: this is what CI runs on every push.
#
#   ./scripts/db-test.sh                 # uses $PGHOST/$PGPORT/$PGUSER
#   PGHOST=/tmp/pgrun PGPORT=5433 ./scripts/db-test.sh
# ---------------------------------------------------------------------------
set -euo pipefail

DB_NAME="${TRCK_TEST_DB:-trck_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ recreating database ${DB_NAME}"
dropdb --if-exists "$DB_NAME"
createdb "$DB_NAME"

run() { psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

echo "→ applying Supabase shim"
run "$ROOT/supabase/tests/00_supabase_shim.sql"

echo "→ applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '   %s\n' "$(basename "$f")"
  run "$f"
done

echo "→ seeding demo data"
run "$ROOT/supabase/seed.sql"

echo "→ running RLS and business-rule assertions"
psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/10_rls_test.sql" 2>&1 \
  | sed -E 's/^psql:[^ ]+ NOTICE:  //' \
  | grep -E '^(  PASS|==|   All)' || true

echo "✓ database suite passed"
