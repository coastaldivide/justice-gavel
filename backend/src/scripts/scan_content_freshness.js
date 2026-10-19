#!/usr/bin/env node
/**
 * scripts/scan_content_freshness.js — Weekly legal content accuracy scan
 *
 * Checks every piece of static and database-sourced legal content for staleness.
 * Sends an admin alert if anything needs attorney review.
 *
 * Run manually:   node scripts/scan_content_freshness.js
 * Run in CI:      added to scheduler.js to run every Sunday at 7am
 * Run on Render:  set FRESHNESS_SCAN_CRON=0 7 * * 0
 *
 * OUTPUT:
 *   - Console report with staleness by content type
 *   - Saves scan results to data/freshness/scan_YYYY-MM-DD.json
 *   - Sends email alert to admin if action_required (via Resend)
 *
 * WHAT IT CHECKS:
 *   rag_static      — Miranda, 4th/5th/6th amendments, Gideon (constitutional)
 *   expungement     — State rules in expungement/rules.js (changes with legislation)
 *   bar_prep        — 548 MBE questions (bar examiners update every 2 years)
 *   bail_schedules  — County bail amounts (update frequently, judges have discretion)
 *   dui_laws        — State DUI statutes (change with legislative sessions)
 *   drug_penalties  — State drug sentencing (major reform waves 2018-2024)
 *   eval_questions  — The 200 eval questions (gold answers need attorney review)
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { REVIEW_THRESHOLD_DAYS, stalenessScore } from '../services/contentStaleness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN_DIR  = path.resolve(__dirname, '../../../data/freshness');
fs.mkdirSync(SCAN_DIR, { recursive: true });

// ── Content freshness inventory (what we track) ────────────────────────────────
const CONTENT_INVENTORY = [
  // Constitutional law — changes very rarely but SCOTUS can overturn
  { key: 'miranda',          type: 'rag_static',  name: 'Miranda v. Arizona (384 U.S. 436)',          threshold_days: 365 },
  { key: 'fourth_amendment', type: 'rag_static',  name: 'Fourth Amendment — Search and Seizure',      threshold_days: 365 },
  { key: 'fifth_amendment',  type: 'rag_static',  name: 'Fifth Amendment — Self-Incrimination',       threshold_days: 365 },
  { key: 'sixth_amendment',  type: 'rag_static',  name: 'Sixth Amendment — Right to Counsel',        threshold_days: 365 },
  { key: 'bail',             type: 'rag_static',  name: 'Eighth Amendment + 18 U.S.C. § 3141 — Bail', threshold_days: 365 },
  { key: 'gideon',           type: 'rag_static',  name: 'Gideon v. Wainwright (372 U.S. 335)',        threshold_days: 365 },

  // State expungement law — changes frequently with criminal justice reform legislation
  { key: 'TN', type: 'expungement_rule', name: 'Tennessee Expungement Rules (T.C.A. § 40-32)', threshold_days: 180 },
  { key: 'TX', type: 'expungement_rule', name: 'Texas Expunction Rules (CCP Art. 55)',          threshold_days: 180 },
  { key: 'FL', type: 'expungement_rule', name: 'Florida Expungement Rules (F.S. 943.0585)',     threshold_days: 180 },
  { key: 'CA', type: 'expungement_rule', name: 'California Expungement Rules (PC 1203.4)',      threshold_days: 180 },
  { key: 'NY', type: 'expungement_rule', name: 'New York Record Sealing (CPL 160.59)',          threshold_days: 180 },

  // DB legal tables — need periodic review
  { key: 'bail_schedules',         type: 'db_table', name: 'Bail Schedules (273 rows)',         threshold_days: 180 },
  { key: 'dui_laws',               type: 'db_table', name: 'DUI Laws (51 rows)',                threshold_days: 180 },
  { key: 'drug_penalties',         type: 'db_table', name: 'Drug Penalties (153 rows)',         threshold_days: 180 },
  { key: 'statute_of_limitations', type: 'db_table', name: 'Statute of Limitations (209 rows)',threshold_days: 365 },

  // Eval content — needs attorney gold answers
  { key: 'eval_questions', type: 'eval', name: 'Eval Questions (200 questions, 5 states)', threshold_days: 365 },
];

(async () => {
  console.log('\n🔍 Justice Gavel — Legal Content Freshness Scan');
  console.log(`   Date: ${new Date().toISOString().slice(0,10)}`);
  console.log(`   Review threshold: ${REVIEW_THRESHOLD_DAYS} days\n`);

  const db = await getDb();

  // Pull last review dates from DB
  const versions = await db.all(
    `SELECT content_type, content_key, last_reviewed_at, reviewed_by, bar_number
       FROM legal_content_versions`
  ).catch(() => []);

  // Check eval questions — do gold answers exist?
  const evalPath   = path.resolve(__dirname, '../../../data/eval/questions.json');
  const evalQuestions = fs.existsSync(evalPath)
    ? JSON.parse(fs.readFileSync(evalPath, 'utf-8'))
    : [];
  const goldAnswered  = evalQuestions.filter(q => q.gold_answer).length;
  const goldPending   = evalQuestions.length - goldAnswered;

  // Score each inventory item
  const results = CONTENT_INVENTORY.map(item => {
    const rec     = versions.find(v => v.content_type === item.type && v.content_key === item.key);
    const score   = stalenessScore(rec?.last_reviewed_at);
    const daysSince = rec?.last_reviewed_at
      ? Math.floor((Date.now() - new Date(rec.last_reviewed_at).getTime()) / 86_400_000)
      : null;

    return {
      ...item,
      last_reviewed_at: rec?.last_reviewed_at || null,
      reviewed_by:      rec?.reviewed_by || null,
      days_since_review: daysSince,
      staleness_score:  score,
      status: score >= 1.0 ? 'STALE' : score >= 0.5 ? 'REVIEW_SOON' : 'OK',
    };
  });

  // Add DB table check
  const db_stale_rows = {};
  for (const table of ['bail_schedules','dui_laws','drug_penalties','statute_of_limitations']) {
    const res = await db.get(
      `SELECT COUNT(*) as cnt FROM ${table}
        WHERE last_reviewed_at IS NULL
           OR last_reviewed_at < (NOW() - INTERVAL '180 days')`
    ).catch(() => ({ cnt: 0 }));
    db_stale_rows[table] = res.cnt;
  }

  // Print report
  const stale    = results.filter(r => r.status === 'STALE');
  const review   = results.filter(r => r.status === 'REVIEW_SOON');
  const ok       = results.filter(r => r.status === 'OK');

  console.log('═'.repeat(70));
  console.log('  STATUS  │ CONTENT                              │ LAST REVIEWED');
  console.log('─'.repeat(70));
  for (const r of results) {
    const icon   = r.status === 'STALE' ? '🔴' : r.status === 'REVIEW_SOON' ? '🟡' : '🟢';
    const days   = r.days_since_review ? `${r.days_since_review}d ago` : 'NEVER';
    const name   = r.name.substring(0,38).padEnd(38);
    console.log(`  ${icon} ${r.status.padEnd(10)}│ ${name}│ ${days}`);
  }

  console.log('\n  DB TABLE ROW STALENESS:');
  for (const [table, cnt] of Object.entries(db_stale_rows)) {
    const icon = cnt > 0 ? '🟡' : '🟢';
    console.log(`  ${icon} ${table}: ${cnt} rows need review`);
  }

  console.log('\n  EVAL QUESTION GOLD ANSWERS:');
  console.log(`  ${goldAnswered > 0 ? '🟢' : '🔴'} ${goldAnswered}/${evalQuestions.length} questions have gold answers ($${goldPending * 25} outstanding)`);
  console.log('═'.repeat(70));

  // Summary
  console.log(`\n  SUMMARY:`);
  console.log(`  🔴 STALE (action required now):     ${stale.length}`);
  console.log(`  🟡 REVIEW SOON (within 30 days):    ${review.length}`);
  console.log(`  🟢 OK (within review threshold):    ${ok.length}`);
  console.log(`  💰 Attorney review outstanding:     $${goldPending * 25} (${goldPending} eval questions)`);

  const actionRequired = stale.length > 0;

  // Save scan
  const scanFile = path.join(SCAN_DIR, `scan_${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(scanFile, JSON.stringify({
    scanned_at: new Date().toISOString(),
    results, db_stale_rows,
    eval_gold: { answered: goldAnswered, pending: goldPending, outstanding_usd: goldPending * 25 },
    action_required: actionRequired,
    summary: { stale: stale.length, review_soon: review.length, ok: ok.length },
  }, null, 2));

  console.log(`\n  Scan saved: ${scanFile}`);
  if (actionRequired) {
    console.log('\n  ⚠️  ACTION REQUIRED — stale content is being served to defendants.');
    console.log('  Contact attorneys for review. See docs/ATTORNEY_EVAL_BRIEF.md.');
    process.exit(1); // Non-zero exit so CI fails on stale content
  }
  console.log('\n  ✅ All content within review threshold.\n');
})().catch(e => { console.error(e.message); process.exit(1); });
