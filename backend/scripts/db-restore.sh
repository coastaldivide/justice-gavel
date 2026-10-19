#!/usr/bin/env bash
# db-restore.sh — restore a db-backup.sh dump into a database and verify it.
#
#   TARGET_DATABASE_URL=postgres://…/jg_restore scripts/db-restore.sh backups/jg-….dump
#
# Restores into TARGET_DATABASE_URL (must be an EMPTY database — create it
# first; never point this at production unless you mean to replace it), then
# verifies the checksum file (when present) and prints row counts of the core
# tables so they can be compared with the source. With SOURCE_DATABASE_URL set
# it compares those counts and the md5 of the provider directory rows and
# fails on any mismatch.
set -euo pipefail

DUMP="${1:?usage: db-restore.sh <dump-file>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL must point at an empty database}"
command -v pg_restore >/dev/null || { echo "pg_restore not found (install postgresql-client 16)" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

if [ -f "$DUMP.sha256" ]; then
  ( cd "$(dirname "$DUMP")" && sha256sum --check --quiet "$(basename "$DUMP").sha256" ) || { echo "checksum mismatch: $DUMP" >&2; exit 3; }
fi

existing=$(psql "$TARGET_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$existing" != "0" ]; then
  echo "target database is not empty ($existing tables) — restore into a fresh database" >&2; exit 4
fi

pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-privileges --exit-on-error "$DUMP"

SQL="select 'users', count(*) from users union all select 'cases', count(*) from cases
     union all select 'lawyers', count(*) from lawyers union all select 'bail_agents', count(*) from bail_agents
     union all select 'case_messages', count(*) from case_messages
     union all select 'providers_md5', 0 from (select 1) x
     order by 1"
MD5="select md5(coalesce((select string_agg(t::text,'|' order by id) from lawyers t),'') || coalesce((select string_agg(t::text,'|' order by id) from bail_agents t),''))"

echo "restored row counts:"
psql "$TARGET_DATABASE_URL" -Atc "$SQL" | grep -v providers_md5
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  a=$(psql "$SOURCE_DATABASE_URL" -Atc "$SQL"; psql "$SOURCE_DATABASE_URL" -Atc "$MD5")
  b=$(psql "$TARGET_DATABASE_URL" -Atc "$SQL"; psql "$TARGET_DATABASE_URL" -Atc "$MD5")
  if [ "$a" != "$b" ]; then
    echo "MISMATCH between source and restored database" >&2
    diff <(echo "$a") <(echo "$b") >&2 || true
    exit 5
  fi
  echo "verified: row counts and provider checksums match the source"
fi
echo "restore ok"
