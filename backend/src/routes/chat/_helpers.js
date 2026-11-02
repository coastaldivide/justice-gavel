/**
 * chat/_helpers.js — shared by POST /chat/ask (job) and POST /chat/stream (SSE)
 *
 * chatContext()           — who is asking: defender mode allowed?, unlimited?, quota left
 * readChatBody()          — validate the request body (400 messages in the request language)
 * buildChatRequest()      — system prompt parts (cached) + sourced passages (citable search results,
 *                           services/sourcedAnswers.js) + messages for the AI gateway call
 * findReplay()            — a retry of a question that was already answered
 * saveExchange()          — persist the question + answer (complete | stopped)
 * callClaude()            — non-streamed call (job path)
 * getHistory()            — this user's turns of a session
 * detectLawyerHandoff(), classifyIntent(), buildCaseNote(), buildJurisdictionNote()
 */
import { safeJson } from '../../utils/routeHelpers.js';
import { aiMessage } from '../../services/aiClient.js';
import logger               from '../../utils/logger.js';
import { hasFeature }       from '../../services/entitlements.js';
import { FEATURES }         from '../billing/plans.js';
import { randomUUID }       from 'crypto';
import { rightsPromptParts } from '../../services/rightsContent.js';
import { CITATION_RULES, plainText, publicAnswer } from '../../ai/citations.js';
import { planSources, userTurn, historyMessages, sentInOrder, recordsFor, finishAnswer } from '../../services/sourcedAnswers.js';
import { msg, resolveLang, LANG_NAMES } from '../../i18n/index.js';
import { isValidTimeZone, todayInZone, zonedDateTimeToUtc, addDays, DEFAULT_TIME_ZONE } from '../../utils/timezone.js';
import { SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT } from './_prompts.js';

/** Free accounts: AI chat questions per local calendar day (the app says "3 per day"). */
export const FREE_CHAT_MESSAGES_PER_DAY = 3;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CASE_CONTEXT_CHARS = 8000;

const PROFESSIONAL_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);

/** Defender mode (no consumer guard rails, no daily cap) is for attorneys and public defenders only. */
export function isProfessional(user) {
  return PROFESSIONAL_ROLES.has(user?.role) || Number(user?.is_defender) === 1;
}

/** Start of the person's calendar day (their X-Timezone, else the default zone) as a UTC instant. */
export function startOfLocalDay(req, now = new Date()) {
  const raw = typeof req?.get === 'function' ? req.get('X-Timezone') : null;
  const tz = isValidTimeZone(raw) ? raw : DEFAULT_TIME_ZONE;
  const today = todayInZone(tz, now);
  return { tz, start: zonedDateTimeToUtc(today, 0, 0, tz), next: zonedDateTimeToUtc(addDays(today, 1), 0, 0, tz) };
}

/**
 * Who is asking, and may they ask now?
 *   { lang, defender, unlimited, used, limit, resetsAt, limited }
 * A database error never blocks a question (logged, treated as allowed).
 */
export async function chatContext(db, req) {
  const lang = resolveLang(req);
  const defender = req.body?.mode === 'defender' && isProfessional(req.user);
  const ctx = { lang, defender, unlimited: defender, used: 0, limit: FREE_CHAT_MESSAGES_PER_DAY, resetsAt: null, limited: false };
  if (defender) return ctx;
  try {
    if (await hasFeature(db, req.user.id, FEATURES.AI_CHAT_UNLIMITED)) { ctx.unlimited = true; return ctx; }
    const { start, next } = startOfLocalDay(req);
    const row = await db.get(
      `SELECT COUNT(*) AS n FROM chat_sessions WHERE user_id = ? AND role = 'user' AND created_at >= ?`,
      [req.user.id, start.toISOString()]);
    ctx.used = Number(row?.n || 0);
    ctx.resetsAt = next.toISOString();
    ctx.limited = ctx.used >= FREE_CHAT_MESSAGES_PER_DAY;
  } catch (e) {
    logger.warn({ err: e.message }, '[chat] daily limit check failed — question allowed');
  }
  return ctx;
}

/** The 402 body for a free account that used today's questions. */
export function limitBody(ctx) {
  return {
    error: 'chat_limit_reached',
    code: 'chat_limit_reached',
    message: msg(ctx.lang, 'chat.err.limit', { n: ctx.limit }),
    upgrade_url: '/subscribe',
    limit: ctx.limit,
    used: ctx.used,
    remaining: 0,
    resets_at: ctx.resetsAt,
  };
}

const CLIENT_MSG_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Validate the body shared by /ask and /stream. Returns { error } (a 400 body) or the fields. */
export function readChatBody(req, lang) {
  const b = req.body || {};
  const bad = (key) => ({ error: { error: 'validation_failed', code: key, message: msg(lang, `chat.err.${key}`) } });
  if (b.message != null && typeof b.message !== 'string') return bad('message_required');
  const message = String(b.message ?? '').trim();
  if (String(b.message ?? '').length > MAX_MESSAGE_CHARS) return bad('message_too_long');
  if (!message) return bad('message_required');
  if (typeof b.sessionId !== 'string' || !b.sessionId.trim() || b.sessionId.length > 64) return bad('session_required');
  if (b.caseContext != null && typeof b.caseContext === 'string' && b.caseContext.length > MAX_CASE_CONTEXT_CHARS) return bad('context_too_long');
  if (b.clientMessageId != null && !CLIENT_MSG_ID.test(String(b.clientMessageId))) return bad('bad_message_id');
  const lat = Number(b.lat), lng = Number(b.lng);
  return {
    message,
    sessionId: b.sessionId.trim(),
    clientMessageId: b.clientMessageId ? String(b.clientMessageId) : null,
    city: typeof b.city === 'string' ? b.city.trim().slice(0, 80) : '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    caseContext: b.caseContext ?? null,
    user_state: typeof b.user_state === 'string' ? b.user_state.slice(0, 40) : null,
    user_state_name: typeof b.user_state_name === 'string' ? b.user_state_name.slice(0, 60) : null,
  };
}

/** Answer in the app's language; keep names, numbers and quoted phrases exact. */
export function languageInstruction(lang) {
  const name = LANG_NAMES[lang] || LANG_NAMES.en;
  return `\n\nLANGUAGE: The person's app is set to ${name}. Write your whole answer in ${name}`
    + (lang === 'en' ? '' : ' (plain, everyday words; formal "usted" in Spanish, "você" in Portuguese, Haitian Creole and not French, Simplified characters for Chinese, "po/opo" politeness in Tagalog)')
    + '. Keep phone numbers, names of laws and courts, and any words they must say out loud exactly as given.';
}

/**
 * System prompt parts + messages for one question (services/aiClient.js systemBlocks()).
 * Prompt caching: the big stable part (rules + the sources rules, identical for every person)
 * is the first block and carries the chat cache breakpoint (AI_CHAT_CACHE_TTL, 1 hour by
 * default — docs/AI_PLATFORM.md has the break-even); the small per-person part (state note,
 * language) follows uncached. The citable passages (rights card, court guide, case steps,
 * verified legal tables — ai/legalCorpus.js) go in the user turn, AFTER that breakpoint, as
 * search_result blocks. The conversation is cached automatically (cacheConversation): earlier
 * turns are rebuilt byte-for-byte from what was stored (ai_sent), so a follow-up re-reads them.
 *
 * → { task, system, messages, max_tokens, mode, sent, fresh, userText }
 *   mode: grounded | nothing_found (no model call) | plain — services/sourcedAnswers.js
 */
export function buildChatRequest({ history, body, lang, defender }) {
  const contextParts = [];
  if (body.city) contextParts.push(`City: ${body.city}`);
  if (body.lat != null && body.lng != null) contextParts.push(`Coords: ${body.lat.toFixed(4)}, ${body.lng.toFixed(4)}`);
  const contextNote = contextParts.length ? `\n\n[User location context: ${contextParts.join(' ')}]` : '';
  const caseNote = buildCaseNote(body.caseContext, defender ? 'defender' : 'consumer');
  const jurisdictionNote = buildJurisdictionNote(body.user_state, body.user_state_name);
  // Legal answers cite the app's sourced content (the rights card is one of the passages now,
  // not part of the prompt); nothing relevant → "no source found", never an answer from memory.
  const rights = rightsPromptParts(body.user_state);
  const stable = (defender ? DEFENDER_SYSTEM_PROMPT : SYSTEM_PROMPT) + '\n\n' + CITATION_RULES;
  const perPerson = (!defender && rights.stateNote ? rights.stateNote + '\n' : '') + languageInstruction(lang).trim();
  const system = [{ text: stable, cache: 'chat' }, { text: perPerson }];
  const plan = planSources({ question: body.message, lang, state: body.user_state, history, limit: defender ? 8 : 6 });
  const fresh = recordsFor(plan.fresh);
  const userText = caseNote + body.message + contextNote + jurisdictionNote;
  const messages = [...historyMessages(history), userTurn(userText, fresh)];
  const sentBlocks = sentInOrder(messages);
  const records = [...plan.sentBefore, ...fresh];
  // search_result_index → record (the request order; dedupe keeps each passage once)
  const byId = new Map(records.map(r => [`jg:${r.id}`, r]));
  const sent = sentBlocks.map(b => byId.get(b.source)).filter(Boolean);
  return { task: defender ? 'chat_defender' : 'chat', system, messages, max_tokens: defender ? 1500 : 800, mode: plan.mode, sent, fresh, userText };
}

/** A finished sourced answer → { answer (public, stored), reply (plain text with markers), content (stored words) } */
export function sourcedOf(answer, lang = 'en') {
  return { answer: publicAnswer(answer), reply: plainText(answer, lang, { markers: true }), content: plainText(answer, lang, { markers: false }), raw: answer };
}

/** The model output (or nothing, for nothing_found) → sourcedOf(). */
export function sourcedReply(request, { content = [], text = '' } = {}, lang = 'en') {
  return sourcedOf(finishAnswer({ mode: request.mode, content, text, sent: request.sent, lang, kind: 'chat' }), lang);
}

/** What is stored with the question (migration 45 ai_sent). */
export const sentOf = (request) => ({ text: request.userText, sources: request.fresh });

/** A stored answer replayed: { reply, answer }. */
export function replayOf(replay, lang = 'en') {
  if (replay?.ai_answer?.segments) return { reply: plainText(replay.ai_answer, lang, { markers: true }), answer: replay.ai_answer };
  return { reply: replay?.content ?? '', answer: null };
}

export async function getHistory(db, sessionId, limit = 20, userId = null) {
  const rows = await db.all(
    `SELECT role, content, content AS text, COALESCE(status, 'complete') AS status, client_msg_id, ai_answer, ai_sent FROM chat_sessions
     WHERE session_id = ? AND role IN ('user','assistant')${userId ? ' AND user_id = ?' : ''}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    userId ? [sessionId, userId, limit] : [sessionId, limit]
  );
  return rows.reverse(); // DB returns newest-first; reverse to chronological for AI context
}

/**
 * A retry of a question already asked (same clientMessageId):
 *   finished answer → returned (replayed, not asked or counted again);
 *   partial answer from a dropped attempt → removed, so the retry replaces it.
 */
export async function findReplay(db, userId, sessionId, clientMessageId) {
  if (!clientMessageId) return null;
  const rows = await db.all(
    `SELECT id, role, content, COALESCE(status, 'complete') AS status, ai_answer FROM chat_sessions
      WHERE user_id = ? AND session_id = ? AND client_msg_id = ? LIMIT 10`,
    [userId, sessionId, clientMessageId]);
  const answer = rows.find(r => r.role === 'assistant' && r.status === 'complete');
  if (answer) return { content: answer.content, ai_answer: answer.ai_answer || null };
  if (rows.length) {
    await db.run('DELETE FROM chat_sessions WHERE user_id = ? AND session_id = ? AND client_msg_id = ?',
      [userId, sessionId, clientMessageId]);
  }
  return null;
}

/**
 * Store the question and the answer the person saw. status: 'complete' | 'stopped'.
 * aiSent { text, sources } (the exact question sent + its passages) and aiAnswer (the sourced
 * answer: segments + citations) keep history rendering as first shown (migration 45).
 */
export async function saveExchange(db, { sessionId, userId, question, answer, clientMessageId = null, status = 'complete', aiSent = null, aiAnswer = null }) {
  const t0 = Date.now();
  await db.run(
    `INSERT INTO chat_sessions (id, session_id, role, content, user_id, client_msg_id, status, created_at, ai_sent)
     VALUES (?, ?, 'user', ?, ?, ?, 'complete', ?, ?::jsonb)`,
    [randomUUID(), sessionId, question, userId, clientMessageId, new Date(t0).toISOString(), aiSent ? JSON.stringify(aiSent) : null]);
  await db.run(
    `INSERT INTO chat_sessions (id, session_id, role, content, user_id, client_msg_id, status, created_at, ai_answer)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?::jsonb)`,
    [randomUUID(), sessionId, answer, userId, clientMessageId, status, new Date(t0 + 1).toISOString(), aiAnswer ? JSON.stringify(aiAnswer) : null]);
}

export function detectLawyerHandoff(userMessage, reply) {
  const combined = (userMessage + ' ' + reply).toLowerCase();
  const triggers = [
    'find a lawyer', 'connect you with a lawyer', 'connect you with an attorney', 'recommend a lawyer', 'speak with an attorney',
    'consult an attorney', 'need legal representation', 'look for a lawyer',
    'search for lawyers', 'match you with a lawyer', 'match you with an attorney', 'criminal defense attorney',
    'hire an attorney',
    'buscar un abogado', 'hablar con un abogado', 'consulte a un abogado', 'abogado defensor',
    'procurar um advogado', 'falar com um advogado', 'consulte um advogado',
    'tìm luật sư', 'nói chuyện với luật sư', 'tham khảo ý kiến luật sư',
  ];
  return triggers.some(t => combined.includes(t));
}

// ── Shared case context builder: the case context block for AI prompt injection ──────────────────────────────────────────────
// Converts a caseContext payload (JSON string or object) into a structured
// prompt block.
export function buildCaseNote(caseContext, mode = 'consumer') {
  if (!caseContext) return '';
  try {
    const ctx = typeof caseContext === 'string' ? safeJson(caseContext) : caseContext;
    if (!ctx || typeof ctx !== 'object') throw new Error('not an object');
    const parts = ['\n\n[ACTIVE CASE CONTEXT]'];

    if (ctx.title)           parts.push(`Case: ${ctx.title}`);
    if (ctx.status)          parts.push(`Status: ${ctx.status}`);
    if (ctx.charges && (!Array.isArray(ctx.charges) || ctx.charges.length > 0))
      parts.push(`Charges: ${Array.isArray(ctx.charges) ? ctx.charges.join(', ') : String(ctx.charges)}`);
    if (ctx.next_court_date) parts.push(`Next court date: ${ctx.next_court_date}`);
    if (ctx.notes && typeof ctx.notes !== 'object') parts.push(`Notes: ${String(ctx.notes).slice(0, 300)}`);
    if (ctx.attorney_name)   parts.push(`Attorney: ${ctx.attorney_name}`);
    if (ctx.is_pre_trial != null) parts.push(`Stage: ${ctx.is_pre_trial ? 'Pre-trial' : 'Post-conviction'}`);
    const _bail = Number(ctx.bail_amount);
    if (ctx.bail_amount != null && Number.isFinite(_bail)) parts.push(`Bail: $${_bail.toLocaleString('en-US')}`);
    if (ctx.financial_situation) parts.push(`Financial situation: ${ctx.financial_situation}`);

    if (parts.length === 1) return '';
    parts.push('[END CASE CONTEXT]');
    parts.push("Use this context to make your responses specific to this person's actual situation.");
    return parts.join('\n') + '\n\n';
  } catch {
    // Plain text (e.g. research notes handed to defender mode): only defenders get it verbatim.
    return mode === 'defender'
      ? `\n\n[CASE CONTEXT]\n${String(caseContext).slice(0, MAX_CASE_CONTEXT_CHARS)}\n[END CASE CONTEXT]\n\n`
      : '';
  }
}

// ── Jurisdiction note ────────────────────────────────────────────────────────
export function buildJurisdictionNote(user_state, user_state_name) {
  if (user_state) {
    const jName = user_state_name || user_state;
    return [
      `\n\n[USER JURISDICTION: ${jName}]`,
      `Tailor ALL legal information to ${jName} state law specifically.`,
      `If a right, procedure, or eligibility rule differs in ${jName} from`,
      'the general US standard, say so explicitly. Do NOT give generic national guidance',
      "when the user's state law is more specific or different.",
    ].join('\n');
  }
  return [
    '\n\n[USER JURISDICTION: Unknown — user has not selected a state]',
    'Note that laws vary by state. When discussing rights, procedures, or eligibility,',
    'always remind the user that their specific state may differ and they should verify',
    "local rules with an attorney or their state court's self-help center.",
  ].join('\n');
}

/** Non-streamed answer (job path): the gateway result ({ text, content, … }). Throws an AI error with a code (aiClient.aiErrorCode). */
export async function callClaude({ task, system, messages, max_tokens, defender, userId }) {
  // Routing, caching, refusal handling, per-attempt timeout, retries, budget and metering:
  // services/aiClient.js. This AbortController is the overall 45 s deadline across all
  // attempts (the queued job's own timeout is 45 s too).
  const route = defender ? 'chat_defender' : 'chat';
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), 45_000);
  const out = await aiMessage({
    task: task || route, system, messages, maxTokens: max_tokens, cacheConversation: true,
    route, userId: userId ?? null, signal: deadline.signal, timeoutMs: 40_000,
  }).finally(() => clearTimeout(deadlineTimer));
  return out;
}

export function classifyIntent(message) {
  const m = message.toLowerCase();
  if (/arrested|handcuff|booking|jail|bond|bail|arrest|detenid|cárcel|fianza|preso|cadeia|fiança|bị bắt|nhà tù|tại ngoại/.test(m)) return 'post_arrest';
  if (/charged|charge|indicted|warrant|summons|arraign|acusad|cargo|orden de arresto|acusação|mandado|cáo buộc|lệnh bắt/.test(m)) return 'charges';
  if (/search|stop|pull over|detain|rights|miranda|silent|derecho|registr|silencio|direito|silêncio|quyền|im lặng/.test(m)) return 'know_rights';
  if (/lawyer|attorney|represent|counsel|legal help|abogad|advogad|luật sư/.test(m)) return 'find_lawyer';
  return 'general';
}
