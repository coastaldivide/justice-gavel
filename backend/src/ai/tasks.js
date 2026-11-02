/**
 * ai/tasks.js — task classes and the task registry. Every AI call names a task; the task
 * names a class; the class decides model, effort, thinking, fallback and cache settings.
 * No call site picks a model.
 *
 *   class      default model        effort   thinking     used for
 *   quick      claude-haiku-5-5     low      disabled     short translation, note tidy-up, match blurbs, eval grading
 *   standard   CLAUDE_MODEL         medium   adaptive     chat, explanations, extraction, tagging, privilege logs
 *              (claude-sonnet-5-5)
 *   deep       claude-opus-5-5      high     adaptive     motions, petitions, contracts, document review, research
 *
 * Env (per class, <C> = QUICK | STANDARD | DEEP):
 *   AI_MODEL_<C>              model id
 *   AI_EFFORT_<C>             low | medium | high | xhigh | max | default (omit the field)
 *   AI_THINKING_<C>           adaptive | disabled | default (omit the field)
 *   AI_THINKING_HEADROOM_<C>  extra max_tokens when thinking is on (thinking counts toward
 *                             max_tokens). Defaults 0 / 2000 / 6000.
 *
 * Effort — https://platform.claude.com/docs/en/build-with-claude/effort (read 2026-11-02):
 *   `output_config.effort`, no beta header; not supported on Claude Haiku 4.5 / Sonnet 4.5;
 *   Opus 5.5 and Haiku 5.5 default to medium, most others to high.
 * Thinking — https://platform.claude.com/docs/en/build-with-claude/thinking (read 2026-11-02):
 *   Claude 5.x thinks adaptively by default and `display` defaults to "omitted" (we always send
 *   "omitted" explicitly: thinking text is never shown to anyone). Opus 5.5 rejects every value
 *   except adaptive; Sonnet 5.5 rejects "disabled" (its lowest setting is "between_tools", only
 *   at effort ≤ high, with no other field); Haiku 5.5 accepts "disabled" only at effort ≤ high.
 *   normalizeThinking() maps the class setting onto what the chosen model accepts, so a model
 *   change by env can never turn into a 400.
 *   Opus 5.5 / Sonnet 5.5 also reject forced tool use and prefill: structured output therefore
 *   uses output_config.format (ai/schemas), never tool_choice.
 */
import { CLAUDE_MODEL } from '../utils/ai.js';

export const CLASSES = Object.freeze(['quick', 'standard', 'deep']);

const DEFAULTS = Object.freeze({
  quick:    { model: 'claude-haiku-5-5', effort: 'low',    thinking: 'disabled', headroom: 0 },
  standard: { model: null,               effort: 'medium', thinking: 'adaptive', headroom: 2000 },
  deep:     { model: 'claude-opus-5-5',  effort: 'high',   thinking: 'adaptive', headroom: 6000 },
});
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const THINKING = new Set(['adaptive', 'disabled']);

const t = (v) => String(v ?? '').trim();
/** The raw env settings of a class (literal reads, so the env-docs test sees every variable). */
function classEnv(c) {
  if (c === 'quick') return { model: process.env.AI_MODEL_QUICK, effort: process.env.AI_EFFORT_QUICK, thinking: process.env.AI_THINKING_QUICK, headroom: process.env.AI_THINKING_HEADROOM_QUICK };
  if (c === 'deep') return { model: process.env.AI_MODEL_DEEP, effort: process.env.AI_EFFORT_DEEP, thinking: process.env.AI_THINKING_DEEP, headroom: process.env.AI_THINKING_HEADROOM_DEEP };
  return { model: process.env.AI_MODEL_STANDARD, effort: process.env.AI_EFFORT_STANDARD, thinking: process.env.AI_THINKING_STANDARD, headroom: process.env.AI_THINKING_HEADROOM_STANDARD };
}

/** The settings for one class, read from env each call (tests and ops can change them live). */
export function classConfig(cls) {
  const c = CLASSES.includes(cls) ? cls : 'standard';
  const d = DEFAULTS[c];
  const e = classEnv(c);
  const effort = t(e.effort).toLowerCase();
  const thinking = t(e.thinking).toLowerCase();
  const headroom = Number(t(e.headroom));
  return {
    cls: c,
    model: t(e.model) || d.model || CLAUDE_MODEL,
    effort: effort === 'default' ? null : EFFORTS.has(effort) ? effort : d.effort,
    thinking: thinking === 'default' ? null : THINKING.has(thinking) ? thinking : d.thinking,
    headroom: t(e.headroom) !== '' && Number.isFinite(headroom) && headroom >= 0 ? Math.round(headroom) : d.headroom,
  };
}

/**
 * Task registry. maxTokens = the visible answer's budget; thinking headroom is added on top.
 * `schema` names a JSON Schema in ai/schemas (structured output). `fallback: false` keeps a
 * task off the refusal fallback: only the batch-only tasks (the Message Batches API rejects
 * `fallbacks`); every interactive task is legal information the app is allowed to give, so a
 * classifier false positive is retried on the fallback model.
 */
export const TASKS = Object.freeze({
  chat:                  { cls: 'standard', maxTokens: 800 },
  chat_defender:         { cls: 'standard', maxTokens: 1500 },
  bar_explain:           { cls: 'standard', maxTokens: 600 },
  queue_job:             { cls: 'standard', maxTokens: 1000 },
  discovery_intake:      { cls: 'standard', maxTokens: 600,  schema: 'discovery_intake' },
  speaker_tags:          { cls: 'standard', maxTokens: 4000, schema: 'speaker_tags' },
  privilege_log:         { cls: 'standard', maxTokens: 4000, schema: 'privilege_entries' },
  motion_refine:         { cls: 'standard', maxTokens: 8000 },
  translate:             { cls: 'quick',    maxTokens: 1200 },
  note_structure:        { cls: 'quick',    maxTokens: 600,  schema: 'note_structure' },
  match_reports:         { cls: 'quick',    maxTokens: 1000, schema: 'match_reports' },
  eval_grade:            { cls: 'quick',    maxTokens: 400 },   // schema per dimension: eval_<dimension>
  eval_answer:           { cls: 'standard', maxTokens: 1024 },
  research:              { cls: 'deep',     maxTokens: 1500 },
  research_rag:          { cls: 'deep',     maxTokens: 2048 },
  motion_generate:       { cls: 'deep',     maxTokens: 2000 },
  motion_generate_appeal:{ cls: 'deep',     maxTokens: 8000 },
  motion_review:         { cls: 'deep',     maxTokens: 800,  schema: 'motion_review' },
  discovery_analysis:    { cls: 'deep',     maxTokens: 2000, schema: 'discovery_analysis' },
  expungement_petition:  { cls: 'deep',     maxTokens: 4000 },
  contract_generate:     { cls: 'deep',     maxTokens: 6000 },
  contract_review:       { cls: 'deep',     maxTokens: 3000, schema: 'contract_review' },
  contract_redline:      { cls: 'deep',     maxTokens: 3000, schema: 'contract_redline' },
  contract_negotiation:  { cls: 'deep',     maxTokens: 2500, schema: 'contract_negotiation' },
  // AI step 3 — batch-only tasks (services/aiBatch.js; Message Batches reject `fallbacks`, so these
  // never use server-side fallback: a refusal is recorded and the row goes to the review queue).
  source_check:          { cls: 'standard', maxTokens: 1200, schema: 'source_check',      fallback: false },
  source_propose:        { cls: 'standard', maxTokens: 1200, schema: 'source_proposal',   fallback: false },
  translate_keys:        { cls: 'standard', maxTokens: 8000, schema: 'translation_draft', fallback: false },
  // AI step 4 — documents (vision / PDF): a court paper read into a court date the person checks and
  // confirms (services/courtPaper.js), and field-mapping suggestions for an agency's surety PDF that
  // staff accept field by field (services/bondDesk/formMapping.js).
  court_paper_read:      { cls: 'standard', maxTokens: 1500, schema: 'court_paper' },
  form_field_map:        { cls: 'standard', maxTokens: 6000, schema: 'form_field_map' },
  // AI step 5 — the recap that lets a long chat / research conversation continue (services/conversationMemory.js).
  chat_memory:           { cls: 'quick',    maxTokens: 900,  schema: 'chat_memory' },
});

export function taskDef(task) {
  const t = TASKS[task];
  if (!t) throw Object.assign(new Error(`unknown AI task: ${task}`), { code: 'ai_failed' });
  return { task, ...t };
}

// ── What each model accepts ──────────────────────────────────────────────────
const fam = (model) => {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('claude-opus-5-5')) return 'opus-5-5';
  if (m.startsWith('claude-sonnet-5-5')) return 'sonnet-5-5';
  if (m.startsWith('claude-haiku-5-5')) return 'haiku-5-5';
  if (/^claude-(haiku-4-5|sonnet-4-5)/.test(m) || /^claude-3/.test(m)) return 'no-effort';
  return 'other';
};
const LOW_EFFORT = new Set([null, 'low', 'medium', 'high']);

/** output_config.effort for this model, or null to leave it out. */
export function normalizeEffort(model, effort) {
  if (!effort) return null;
  if (fam(model) === 'no-effort') return null;
  return effort;
}

/** The `thinking` request field for this model (null = omit; the model's default applies). */
export function normalizeThinking(model, thinking, effort) {
  if (!thinking) return null;
  const f = fam(model);
  if (thinking === 'adaptive') return { type: 'adaptive', display: 'omitted' };
  // thinking === 'disabled'
  if (f === 'opus-5-5') return null;                                  // always adaptive
  if (f === 'sonnet-5-5') return LOW_EFFORT.has(effort) ? { type: 'between_tools' } : null;
  if (f === 'haiku-5-5') return LOW_EFFORT.has(effort) ? { type: 'disabled' } : null;
  if (f === 'no-effort') return null;
  return { type: 'disabled' };
}

/** Models with server-side fallback (refusals-and-fallback page: every classifier model but Haiku 5.5). */
export function serverFallbackSupported(model) {
  const f = fam(model);
  return f === 'opus-5-5' || f === 'sonnet-5-5' || /^claude-(opus-5|sonnet-5|fable|mythos)/.test(String(model || '').toLowerCase());
}

/**
 * Refusal fallback (AI_FALLBACK, default "auto"):
 *   auto  — models that support it: server-side fallback, `fallbacks: "default"` with beta header
 *           server-side-fallback-2026-07-01 (the API retries a classifier decline on a fallback
 *           model inside the same call, streams included). Models without it (Haiku 5.5): one
 *           client-side retry of the same request on AI_FALLBACK_MODEL (default: the standard
 *           class model). reasoning_extraction refusals are never retried (the docs: change the
 *           prompt instead).
 *   off   — no fallback; a refusal goes straight to the person as "can't be answered here".
 */
export function fallbackMode() {
  return t(process.env.AI_FALLBACK).toLowerCase() === 'off' ? 'off' : 'auto';
}
export function clientFallbackModel() {
  return t(process.env.AI_FALLBACK_MODEL) || classConfig('standard').model;
}
