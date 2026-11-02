#!/usr/bin/env node
/**
 * scripts/run_eval.js — Run 200 eval questions through the Justice Gavel AI
 *
 * Sends each question through the actual /api/chat endpoint,
 * records the full response, and saves results to data/eval/runs/.
 *
 * Usage:
 *   node scripts/run_eval.js                        # all 200
 *   node scripts/run_eval.js --state TN             # one state (40 questions)
 *   node scripts/run_eval.js --category bail        # one category (40 questions)
 *   node scripts/run_eval.js --dry-run              # print questions, no API calls
 *   node scripts/run_eval.js --id BAIL_TN_001       # single question
 *   node scripts/run_eval.js --batch [--state TN]   # as a Message Batch (~50 % of the price; needs DATABASE_URL):
 *                                                   # answers, then grading start automatically; waits for both
 *                                                   # and writes responses.json + grades.json. The same run can be
 *                                                   # started from Admin → Batch tools (results stored in ai_batches).
 */

import 'dotenv/config';
import { aiMessage } from '../services/aiClient.js';
import { EVAL_SYSTEM_PROMPT, answerUserTurn } from '../services/evalBatch.js';
import fs        from 'fs';
import path      from 'path';
import yargs     from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = yargs(hideBin(process.argv))
  .option('state',    { type: 'string' })
  .option('category', { type: 'string' })
  .option('id',       { type: 'string' })
  .option('dry-run',  { type: 'boolean', default: false })
  .option('model',    { type: 'string' })   // default: the gateway's standard-class model
  .option('batch',    { type: 'boolean', default: false })   // Message Batches (~50 % cheaper; answers + grading, stored in ai_batches)
  .argv;

const QUESTIONS_FILE = path.resolve(__dirname, '../../data/eval/questions.json');
const RUNS_DIR       = path.resolve(__dirname, '../../data/eval/runs');
fs.mkdirSync(RUNS_DIR, { recursive: true });

// Calls go through the AI gateway (task 'eval_answer'); --model compares models on purpose.

// The system prompt and question turn are shared with the batch run (services/evalBatch.js).

async function runQuestion(question) {
  const startMs = Date.now();

  const response = await aiMessage({
    task:     'eval_answer',
    model:    argv.model,
    system:   EVAL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: answerUserTurn(question) }],
    route:    'eval_run',
  });

  const elapsed  = Date.now() - startMs;
  const text     = response.text;
  const usage    = response.usage || {};

  return {
    question_id:    question.id,
    state:          question.state,
    category:       question.category,
    question_text:  question.question,
    expected_behavior: question.expected_behavior,
    difficulty:     question.difficulty,
    model:          response.model,
    response:       text,
    cost_usd:       response.costUsd || 0,
    input_tokens:   usage.input_tokens || 0,
    output_tokens:  usage.output_tokens || 0,
    elapsed_ms:     elapsed,
    run_at:         new Date().toISOString(),
    gold_answer:    question.gold_answer,
    gold_citations: question.gold_citations,
  };
}

(async () => {
  let questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));

  // Apply filters
  if (argv.state)    questions = questions.filter(q => q.state    === argv.state.toUpperCase());
  if (argv.category) questions = questions.filter(q => q.category === argv.category);
  if (argv.id)       questions = questions.filter(q => q.id       === argv.id);

  console.log(`\n🔍 Eval run — ${questions.length} questions | model: ${argv.model || 'gateway standard class'}`);
  if (argv['dry-run']) {
    console.log('\nDRY RUN — questions to process:');
    questions.forEach(q => console.log(`  [${q.state}][${q.category}] ${q.question.substring(0,60)}`));
    return;
  }

  const runId  = `run_${Date.now()}`;
  const outDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(outDir);

  if (argv.batch) {
    const { getDb } = await import('../db/index.js');
    const { startEvalRun } = await import('../services/evalBatch.js');
    const { pollBatches } = await import('../services/aiBatch.js');
    const db = await getDb();
    const { batch } = await startEvalRun(db, { state: argv.state || null, category: argv.category || null });
    if (!batch) { console.log('No questions match.'); return; }
    console.log(`\n  Batch ${batch.id} (${batch.anthropic_batch_id}) — polling every 60 s (most batches end within an hour)`);
    for (;;) {
      await pollBatches(db);
      const root = await db.get('SELECT status, output FROM ai_batches WHERE id = ?', [batch.id]);
      if (root.output?.eval) {
        const items = await db.all(`SELECT ref, status, result, model FROM ai_batch_items WHERE batch_id IN (SELECT id FROM ai_batches WHERE (id = ? OR root_id = ?) AND kind = 'eval_answer') AND status = 'succeeded' ORDER BY id LIMIT 5000`, [batch.id, batch.id]);
        const byId = new Map(questions.map((q) => [q.id, q]));
        const responses = items.map((it) => ({ question_id: it.ref.question_id, state: byId.get(it.ref.question_id)?.state, category: byId.get(it.ref.question_id)?.category,
          question_text: byId.get(it.ref.question_id)?.question, model: it.model, response: it.result?.text || '', batch_id: batch.id }));
        fs.writeFileSync(path.join(outDir, 'responses.json'), JSON.stringify(responses, null, 2));
        fs.writeFileSync(path.join(outDir, 'grades.json'), JSON.stringify({ run: runId, batch_id: batch.id, ...root.output.eval }, null, 2));
        console.log(`\n✅ Batch run complete — composite ${root.output.eval.overallMean}/10, cost $${root.output.eval.cost_usd}. Output: ${outDir}`);
        return;
      }
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  const results  = [];
  let   done     = 0;
  const BATCH    = 5; // parallel requests

  for (let i = 0; i < questions.length; i += BATCH) {
    const batch  = questions.slice(i, i + BATCH);
    const batchR = await Promise.all(batch.map(runQuestion));
    results.push(...batchR);
    done += batch.length;
    process.stdout.write(`\r  Progress: ${done}/${questions.length}`);
  }

  // Save full results
  const outFile = path.join(outDir, 'responses.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));

  // Quick stats
  const totalIn  = results.reduce((s, r) => s + r.input_tokens,  0);
  const totalOut = results.reduce((s, r) => s + r.output_tokens, 0);
  const costUSD  = results.reduce((s, r) => s + (r.cost_usd || 0), 0);   // the gateway's metered cost (ai/pricing.js)
  const avgMs    = Math.round(results.reduce((s, r) => s + r.elapsed_ms, 0) / results.length);

  console.log(`\n\n✅ Run complete`);
  console.log(`   Run ID:   ${runId}`);
  console.log(`   Output:   ${outFile}`);
  console.log(`   Tokens:   ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`);
  console.log(`   Cost:     ~$${costUSD.toFixed(3)} USD`);
  console.log(`   Avg time: ${avgMs}ms per question`);
  console.log(`\n   Next: node scripts/grade_eval.js --run ${runId}`);
})().catch(e => { console.error(e.message); process.exit(1); });
