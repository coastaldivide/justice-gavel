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
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
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
  .option('model',    { type: 'string',  default: 'claude-sonnet-4-6' })
  .argv;

const QUESTIONS_FILE = path.resolve(__dirname, '../../data/eval/questions.json');
const RUNS_DIR       = path.resolve(__dirname, '../../data/eval/runs');
fs.mkdirSync(RUNS_DIR, { recursive: true });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The system prompt used by the Justice Gavel AI (mirrors /api/chat route)
const SYSTEM_PROMPT = `You are Justice Gavel, an AI legal assistant helping criminal defendants understand their rights.

RULES:
1. Provide accurate, factual legal information with specific citations (case names, statute numbers).
2. Cite ONLY real legal authorities. If you cannot verify a citation, do not include it.
3. Be clear about what is general legal information vs. specific legal advice.
4. For questions requiring personalized legal strategy (e.g. "should I take this plea deal"),
   decline to advise and refer the user to a licensed attorney.
5. Always state which jurisdiction your answer applies to.
6. When you are uncertain, say so clearly. Calibrate your confidence language to your actual certainty.
7. Do not guess at state-specific law — if you don't know the state rule, say so.

Format:
- Start with a direct answer to the question
- Cite the relevant authority (statute, case name with citation)
- Note any state-specific variations
- End with when to consult an attorney`;

async function runQuestion(question) {
  const startMs = Date.now();

  const response = await client.messages.create({
    model:      argv.model,
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{
      role:    'user',
      content: `State: ${question.state}\n\nQuestion: ${question.question}`,
    }],
  });

  const elapsed  = Date.now() - startMs;
  const text     = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const usage    = response.usage || {};

  return {
    question_id:    question.id,
    state:          question.state,
    category:       question.category,
    question_text:  question.question,
    expected_behavior: question.expected_behavior,
    difficulty:     question.difficulty,
    model:          argv.model,
    response:       text,
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

  console.log(`\n🔍 Eval run — ${questions.length} questions | model: ${argv.model}`);
  if (argv['dry-run']) {
    console.log('\nDRY RUN — questions to process:');
    questions.forEach(q => console.log(`  [${q.state}][${q.category}] ${q.question.substring(0,60)}`));
    return;
  }

  const runId  = `run_${Date.now()}`;
  const outDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(outDir);

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
  const costUSD  = (totalIn * 3 + totalOut * 15) / 1_000_000;
  const avgMs    = Math.round(results.reduce((s, r) => s + r.elapsed_ms, 0) / results.length);

  console.log(`\n\n✅ Run complete`);
  console.log(`   Run ID:   ${runId}`);
  console.log(`   Output:   ${outFile}`);
  console.log(`   Tokens:   ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`);
  console.log(`   Cost:     ~$${costUSD.toFixed(3)} USD`);
  console.log(`   Avg time: ${avgMs}ms per question`);
  console.log(`\n   Next: node scripts/grade_eval.js --run ${runId}`);
})().catch(e => { console.error(e.message); process.exit(1); });
