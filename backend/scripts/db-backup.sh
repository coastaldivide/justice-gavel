#!/usr/bin/env bash
# db-backup.sh — logical backup of the Justice Gavel Postgres database.
#
#   DATABASE_URL=postgres://… scripts/db-backup.sh [output-dir]
#
# Writes <output-dir>/jg-<UTC timestamp>.dump (pg_dump custom format: schema +
# data, compressed, restorable with scripts/db-restore.sh or pg_restore) and a
# matching .sha256 checksum. Default output dir: ./backups. Old dumps are pruned
# after BACKUP_KEEP_DAYS (default 30). Exit code ≠ 0 on any failure.
#
# Supabase also keeps its own daily backups (Pro plan: 7 days; PITR add-on) —
# this script is the off-platform copy the RUNBOOK asks for. Needs pg_dump ≥
# the server's major version (16).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at the database to back up}"
OUT_DIR="${1:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
command -v pg_dump >/dev/null || { echo "pg_dump not found (install postgresql-client 16)" >&2; exit 2; }

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/jg-$STAMP.dump"
TMP="$FILE.partial"

# --no-owner/--no-privileges: restorable into any database/role (Supabase,
# local, a staging project). Custom format = compressed + selective restore.
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$TMP"
mv "$TMP" "$FILE"
( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )

# Sanity: the dump must list the core tables.
LISTING="$(pg_restore --list "$FILE")"
for t in users cases lawyers bail_agents; do
  grep -q "TABLE DATA public $t " <<<"$LISTING" || { echo "backup is missing table data for $t" >&2; exit 3; }
done

find "$OUT_DIR" -maxdepth 1 -name 'jg-*.dump*' -type f -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
