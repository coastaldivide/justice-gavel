#!/usr/bin/env node
/**
 * scripts/grade_eval.js — Grade eval responses on 5 legal-AI dimensions
 *
 * DIMENSIONS:
 *   1. Factual accuracy     — Does the answer contain the key facts from the gold standard?
 *   2. Citation validity    — Does every cited authority exist and say what's claimed?
 *   3. Refusal correctness  — Did it refuse UPL questions? Did it answer information questions?
 *   4. Calibration          — Is stated confidence matched to actual certainty?
 *   5. State-specificity    — Did it give jurisdiction-specific law, not generic federal law?
 *
 * Usage:
 *   node scripts/grade_eval.js --run run_1234567890
 *   node scripts/grade_eval.js --run run_1234567890 --dimension citation_validity
 *   node scripts/grade_eval.js --run run_1234567890 --no-gold  # grade without attorney answers
 *   node scripts/grade_eval.js --run run_1234567890 --batch    # one Message Batch (~50 % of the price; stored in ai_batches)
 */

import 'dotenv/config';
import { aiMessage } from '../services/aiClient.js';
import { DIMENSIONS, composite as compositeOf } from '../services/evalBatch.js';
import fs        from 'fs';
import path      from 'path';
import yargs     from 'yargs';
import { hideBin }     from 'yargs/helpers';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = yargs(hideBin(process.argv))
  .option('run',       { type: 'string', required: true })
  .option('dimension', { type: 'string' })
  .option('no-gold',   { type: 'boolean', default: false })
  .option('batch',     { type: 'boolean', default: false })   // grade as one Message Batch (~50 % cheaper; needs DATABASE_URL)
  .argv;

const RUNS_DIR  = path.resolve(__dirname, '../../data/eval/runs');
// Calls go through the AI gateway (task 'eval_grade', class 'quick'; one schema per dimension).

// The grading rubrics (5 dimensions, weights) are shared with the batch run (services/evalBatch.js).

// ── Grade a single response ───────────────────────────────────────────────────
async function gradeResponse(response, dimensionKeys) {
  const scores = {};
  for (const key of dimensionKeys) {
    const dim = DIMENSIONS[key];
    try {
      const out = await aiMessage({
        task:     'eval_grade',
        schema:   `eval_${key}`,
        messages: [{ role: 'user', content: dim.prompt(response) }],
        route:    'eval_grade',
      });
      scores[key] = out.json;
    } catch (e) {
      scores[key] = { score: -1, rationale: `Grade error: ${e.code || e.message}` };
    }
  }

  return { ...scores, composite: compositeOf(scores) };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const runDir    = path.join(RUNS_DIR, argv.run);
  const responses = JSON.parse(fs.readFileSync(path.join(runDir, 'responses.json'), 'utf-8'));

  const dimensionKeys = argv.dimension
    ? [argv.dimension]
    : Object.keys(DIMENSIONS);

  console.log(`\n📊 Grading ${responses.length} responses on: ${dimensionKeys.join(', ')}`);
  console.log(`   Run: ${argv.run}`);

  if (argv.batch) {
    const { getDb } = await import('../db/index.js');
    const { createBatch, pollBatches } = await import('../services/aiBatch.js');
    const { gradeItems } = await import('../services/evalBatch.js');
    const db = await getDb();
    const { batch } = await createBatch(db, { kind: 'eval_grade', items: gradeItems(responses, dimensionKeys), idempotencyKey: `eval_grade:file:${argv.run}:${dimensionKeys.join(',')}` });
    console.log(`   Batch ${batch.id} — polling every 60 s`);
    for (;;) {
      await pollBatches(db);
      const b = await db.get('SELECT output FROM ai_batches WHERE id = ?', [batch.id]);
      if (b.output?.eval) {
        fs.writeFileSync(path.join(runDir, 'grades.json'), JSON.stringify({ run: argv.run, batch_id: batch.id, ...b.output.eval }, null, 2));
        console.log(`\n  OVERALL COMPOSITE SCORE: ${b.output.eval.overallMean}/10 (cost $${b.output.eval.cost_usd}) — grades.json written`);
        return;
      }
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  const graded = [];
  let done = 0;
  const BATCH = 3;

  for (let i = 0; i < responses.length; i += BATCH) {
    const batch   = responses.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(r => gradeResponse(r, dimensionKeys)));
    batch.forEach((r, j) => graded.push({ ...r, grades: results[j] }));
    done += batch.length;
    process.stdout.write(`\r  Graded: ${done}/${responses.length}`);
  }

  // Aggregate stats
  const stats = {};
  for (const key of dimensionKeys) {
    const validScores = graded.filter(r => r.grades[key]?.score >= 0).map(r => r.grades[key].score);
    stats[key] = {
      name:    DIMENSIONS[key].name,
      mean:    (validScores.reduce((s, v) => s + v, 0) / validScores.length).toFixed(2),
      min:     Math.min(...validScores),
      max:     Math.max(...validScores),
      below5:  validScores.filter(v => v < 5).length,
      n:       validScores.length,
    };
  }

  const composites = graded.map(r => r.grades.composite || 0);
  const overallMean = (composites.reduce((s, v) => s + v, 0) / composites.length).toFixed(2);

  // By-state breakdown
  const byState = {};
  for (const r of graded) {
    (byState[r.state] = byState[r.state] || []).push(r.grades.composite || 0);
  }

  // Save grades
  const gradesFile = path.join(runDir, 'grades.json');
  fs.writeFileSync(gradesFile, JSON.stringify({ run: argv.run, graded, stats, overallMean, byState }, null, 2));

  // Print summary
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  EVAL RESULTS — ${argv.run}`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log(`  OVERALL COMPOSITE SCORE: ${overallMean}/10\n`);
  console.log(`  By dimension:`);
  for (const [, s] of Object.entries(stats)) {
    const bar = '█'.repeat(Math.round(parseFloat(s.mean))).padEnd(10, '░');
    console.log(`    ${s.name.padEnd(22)} ${bar} ${s.mean}/10  (${s.below5} below 5)`);
  }
  console.log(`\n  By state:`);
  for (const [st, scores] of Object.entries(byState)) {
    const mean = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    console.log(`    ${st}: ${mean}/10`);
  }
  console.log(`\n  Grades saved: ${gradesFile}`);
  console.log(`  Next: node scripts/eval_report.js --run ${argv.run}`);
})().catch(e => { console.error(e.message); process.exit(1); });
