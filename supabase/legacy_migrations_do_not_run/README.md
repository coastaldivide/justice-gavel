# Legacy migrations — do not run

These 36 files were the incremental migration history. Measured against a clean
PostgreSQL 16, most of them fail: they were written against SQLite, assume
tables created by files that themselves fail, or duplicate objects the baseline
already creates.

They have been moved **out of `supabase/migrations/`** so that
`supabase db push` — which applies every `.sql` file in that directory in
name order — cannot pick them up. Nothing was deleted; the history is intact
here for reference.

## What to run instead

Two files, in this order, and nothing else:

```bash
psql "$DATABASE_URL" -f supabase/migrations/00000000000000_baseline_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/00000000000001_seed_reference_data.sql
```

The first creates the schema. The second loads the reference data — attorneys,
courthouses, bail schedules, statutes of limitation. Skip the second and every
search returns "no results" with no error to explain why.

## Before you resurrect any of these

The baseline schema is a squashed snapshot of the end state, so most of what is
here is already applied. Check whether the object already exists before running
anything from this directory, and write new changes as fresh migrations against
the baseline rather than editing these.
