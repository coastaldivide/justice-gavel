#!/bin/sh
# ══════════════════════════════════════════════════════════════════════════════
# staging-setup.sh — one command to prepare the STAGING database (docs/STAGING.md).
#
#   APP_ENV=staging sh scripts/staging-setup.sh --database-url "<staging db url>" [options]
#
# From the Render shell of justice-gavel-api-staging (APP_ENV and every key are already
# set there; you still type the database URL so the target is never implied):
#   sh scripts/staging-setup.sh --database-url "$DATABASE_URL"
#
# Steps, stopping at the first failure:
#   1. safety: APP_ENV must be "staging", --database-url must be given, and it must not equal
#      PROD_DATABASE_URL / PRODUCTION_DATABASE_URL when either is set;
#   2. scripts/migrate.sh — apply new supabase/migrations (each once; a no-op when up to date);
#   3. node scripts/check-env.js — the staging environment (keys, allow-lists, no live Stripe);
#   4. node scripts/seed-staging.mjs — demo consumer, Bond Desk agency, public-defender office;
#      prints the logins.
# Idempotent: run it again after every reset or whenever you want the logins printed again
# (each run without STAGING_DEMO_PASSWORD sets a new demo password).
#
# Options:
#   --database-url URL     required: the STAGING database
#   --migrations-url URL   optional direct (session-mode) connection for migrations only
#   --reset                remove ONLY the demo rows (no migrate / check-env)
#   --skip-check-env       skip step 3 (not recommended)
#   -h, --help             this text
# POSIX sh (the runtime image is Alpine/busybox).
# ══════════════════════════════════════════════════════════════════════════════
set -eu

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

URL=""
MURL=""
RESET=0
SKIP_ENV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --database-url) [ $# -ge 2 ] || { echo "[staging-setup] --database-url needs a value" >&2; exit 2; }; URL="$2"; shift 2 ;;
    --migrations-url) [ $# -ge 2 ] || { echo "[staging-setup] --migrations-url needs a value" >&2; exit 2; }; MURL="$2"; shift 2 ;;
    --reset) RESET=1; shift ;;
    --skip-check-env) SKIP_ENV=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[staging-setup] unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

refuse() { echo "[staging-setup] REFUSED: $1" >&2; exit 3; }

APP_ENV_NOW=$(printf '%s' "${APP_ENV:-}" | tr '[:upper:]' '[:lower:]')
[ "$APP_ENV_NOW" = "staging" ] || refuse "APP_ENV must be 'staging' (it is '${APP_ENV:-unset}'). This script writes demo accounts."
[ -n "$URL" ] || refuse "give the staging database explicitly: --database-url \"<url>\""
for P in "${PROD_DATABASE_URL:-}" "${PRODUCTION_DATABASE_URL:-}"; do
  [ -n "$P" ] || continue
  if [ "$URL" = "$P" ] || [ "$MURL" = "$P" ]; then
    refuse "the target equals PROD_DATABASE_URL / PRODUCTION_DATABASE_URL — that is the PRODUCTION database"
  fi
done

HERE=$(cd "$(dirname "$0")" && pwd)
BACKEND=$(cd "$HERE/.." && pwd)
export DATABASE_URL="$URL"
unset MIGRATIONS_DATABASE_URL || true
[ -z "$MURL" ] || export MIGRATIONS_DATABASE_URL="$MURL"
host=$(printf '%s' "$URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^/:?]+).*#\2#')
echo "[staging-setup] target database host: $host (APP_ENV=staging)"

cd "$BACKEND"
if [ "$RESET" = 1 ]; then
  echo "[staging-setup] removing demo data only"
  node scripts/seed-staging.mjs --reset
  exit $?
fi

echo "[staging-setup] 1/3 migrations"
sh "$HERE/migrate.sh"

if [ "$SKIP_ENV" = 1 ]; then
  echo "[staging-setup] 2/3 check-env skipped (--skip-check-env)"
else
  echo "[staging-setup] 2/3 environment check"
  node scripts/check-env.js
fi

echo "[staging-setup] 3/3 demo data"
node scripts/seed-staging.mjs
echo "[staging-setup] done. Next: the smoke test (docs/STAGING.md step 6)."
