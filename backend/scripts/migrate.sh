#!/bin/sh
# ══════════════════════════════════════════════════════════════════════════════
# migrate.sh — apply supabase/migrations/*.sql to the database, each file once.
#
# Used as the Render preDeployCommand (render.yaml): it runs after the image is
# built and before the new version starts, so a failed migration stops the
# deploy and the previous version keeps serving traffic.
#
#   sh scripts/migrate.sh                 apply every file not applied yet
#   sh scripts/migrate.sh --status        list applied / pending files, change nothing
#   sh scripts/migrate.sh --baseline F    record files up to and including F as
#                                         already applied (without running them),
#                                         then apply the rest
#
# Database: MIGRATIONS_DATABASE_URL if set (e.g. a direct / session-mode
# connection), else DATABASE_URL. Files: MIGRATIONS_DIR if set, else
# ../../supabase/migrations relative to this script (repo layout; the Docker
# image copies the migrations to /supabase/migrations so the same path works).
#
# How it stays safe:
#   - files run in filename order with psql -v ON_ERROR_STOP=1; the first error
#     exits non-zero (the deploy fails; nothing after the failing file runs);
#   - every applied file is recorded in jg_meta.schema_migrations (filename,
#     sha256), so later deploys run only NEW files. Every migration is also
#     written to be idempotent (CI applies the whole set twice), so an existing
#     database that has no ledger yet is brought up to date by replaying the set
#     once — or use --baseline to skip the replay;
#   - a recorded file whose contents changed is reported, never re-run.
# POSIX sh (the runtime image is Alpine/busybox); needs psql and sha256sum.
# ══════════════════════════════════════════════════════════════════════════════
set -eu

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

STATUS=0
BASELINE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --status|--dry-run) STATUS=1; shift ;;
    --baseline) [ $# -ge 2 ] || { echo "[migrate] --baseline needs a filename" >&2; exit 2; }; BASELINE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[migrate] unknown argument: $1" >&2; exit 2 ;;
  esac
done

DB_URL="${MIGRATIONS_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "[migrate] DATABASE_URL (or MIGRATIONS_DATABASE_URL) is not set" >&2
  exit 2
fi
HERE=$(cd "$(dirname "$0")" && pwd)
DIR="${MIGRATIONS_DIR:-$HERE/../../supabase/migrations}"
if [ ! -d "$DIR" ]; then
  echo "[migrate] migrations directory not found: $DIR" >&2
  exit 2
fi
command -v psql >/dev/null 2>&1 || { echo "[migrate] psql not found" >&2; exit 2; }

export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
export LC_ALL=C

# psql reading SQL from stdin, so :'var' interpolation works.
sql() { psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1 "$@" -f -; }

FILES=$(ls "$DIR" | grep -E '\.sql$' | sort)
[ -n "$FILES" ] || { echo "[migrate] no .sql files in $DIR" >&2; exit 2; }
for f in $FILES; do
  case "$f" in
    *[!A-Za-z0-9._-]*) echo "[migrate] refusing unexpected filename: $f" >&2; exit 2 ;;
  esac
done
if [ -n "$BASELINE" ] && ! printf '%s\n' "$FILES" | grep -qx "$BASELINE"; then
  echo "[migrate] --baseline $BASELINE is not a file in $DIR" >&2
  exit 2
fi

HAS_LEDGER=$(echo "SELECT to_regclass('jg_meta.schema_migrations') IS NOT NULL;" | sql)
if [ "$STATUS" = 1 ]; then
  APPLIED=""
  [ "$HAS_LEDGER" = t ] && APPLIED=$(echo "SELECT filename FROM jg_meta.schema_migrations;" | sql)
  for f in $FILES; do
    if printf '%s\n' "$APPLIED" | grep -qx "$f"; then echo "applied  $f"; else echo "pending  $f"; fi
  done
  exit 0
fi

sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS jg_meta;
REVOKE ALL ON SCHEMA jg_meta FROM PUBLIC;
CREATE TABLE IF NOT EXISTS jg_meta.schema_migrations (
  filename   TEXT        PRIMARY KEY,
  sha256     TEXT        NOT NULL,
  mode       TEXT        NOT NULL DEFAULT 'applied',   -- applied | baseline
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE jg_meta.schema_migrations ENABLE ROW LEVEL SECURITY;
SQL

record() {  # filename sha mode
  sql -v fn="$1" -v sha="$2" -v mode="$3" <<'SQL'
INSERT INTO jg_meta.schema_migrations (filename, sha256, mode) VALUES (:'fn', :'sha', :'mode')
ON CONFLICT (filename) DO NOTHING;
SQL
}

if [ -n "$BASELINE" ]; then
  for f in $FILES; do
    record "$f" "$(sha256sum "$DIR/$f" | cut -d' ' -f1)" baseline
    echo "[migrate] baseline $f (recorded, not run)"
    [ "$f" = "$BASELINE" ] && break
  done
fi

LEDGER=$(echo "SELECT filename || ' ' || sha256 FROM jg_meta.schema_migrations;" | sql)
applied=0; skipped=0
for f in $FILES; do
  sha=$(sha256sum "$DIR/$f" | cut -d' ' -f1)
  prev=$(printf '%s\n' "$LEDGER" | awk -v f="$f" '$1 == f { print $2 }')
  if [ -n "$prev" ]; then
    skipped=$((skipped + 1))
    [ "$prev" != "$sha" ] && echo "[migrate] WARNING $f changed since it was applied (not re-run)" >&2
    continue
  fi
  echo "[migrate] apply $f"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$DIR/$f" >/dev/null
  record "$f" "$sha" applied
  applied=$((applied + 1))
done
echo "[migrate] done: $applied applied, $skipped already applied"
