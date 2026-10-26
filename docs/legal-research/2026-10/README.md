# Legal research records — October 2026

Raw output of the legal accuracy review (see ../../LEGAL_ACCURACY_REVIEW.md). One JSON file per
topic and state group. Every record has `status` (verified | corrected | unverifiable), `citation`,
`source_url` (the page actually read) and `issue` (what was wrong, or why it could not be checked,
including when only a secondary source was available). `RESEARCH_BRIEF.md` is the instruction
every researcher followed.

Generated app data comes from these files:
- `expungement_g*.json` → backend/src/routes/expungement/rules_data.js
- `recording_tips.json` → backend/src/routes/recordingLaws_data.js and the tip.* strings
- `sol_*.json`, `drugs_*.json`, `contacts_vc_bar.json`, `hague_specialty.json`, `hotlines.json`
  → supabase/migrations/00000000000030_legal_accuracy_data.sql
- `bail_recovery.json` → backend/src/routes/recovery_agents.js (bail-law part not wired yet)
- `deadlines.json`, `dui.json` → not applied yet (no record fully confirmed); proposals inside
  are unverified and must not be shown to users as they are.
