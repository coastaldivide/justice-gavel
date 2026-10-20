import { CLAUDE_MODEL } from '../../utils/ai.js';
/**
 * chat/_helpers.js — shared by POST /chat/ask (job) and POST /chat/stream (SSE)
 *
 * chatContext()           — who is asking: defender mode allowed?, unlimited?, quota left
 * readChatBody()          — validate the request body (400 messages in the request language)
 * buildChatRequest()      — system prompt + messages for the Anthropic call
 * findReplay()            — a retry of a question that was already answered
 * saveExchange()          — persist the question + answer (complete | stopped)
 * callClaude()            — non-streamed call (job path)
 * getHistory()            — this user's turns of a session
 * detectLawyerHandoff(), classifyIntent(), buildCaseNote(), buildJurisdictionNote()
 */
import { safeJson } from '../../utils/routeHelpers.js';
import { anthropicFetch, aiHttpError } from '../../services/aiClient.js';
import logger               from '../../utils/logger.js';
import { randomUUID }       from 'crypto';
import { rightsPromptBlock } from '../../services/rightsContent.js';
import { msg, resolveLang } from '../../i18n/index.js';
import { isValidTimeZone, todayInZone, zonedDateTimeToUtc, addDays, DEFAULT_TIME_ZONE } from '../../utils/timezone.js';
import { SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT } from './_prompts.js';

/** Free accounts: AI chat questions per local calendar day (the app says "3 per day"). */
export const FREE_CHAT_MESSAGES_PER_DAY = 3;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CASE_CONTEXT_CHARS = 8000;

const LANG_NAMES = { en: 'English', es: 'Spanish', pt: 'Brazilian Portuguese', vi: 'Vietnamese' };
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
    const sub = await db.get(
      `SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') LIMIT 1`, [req.user.id]);
    if (sub) { ctx.unlimited = true; return ctx; }
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
    + (lang === 'en' ? '' : ' (plain, everyday words; formal "usted" in Spanish, "você" in Portuguese)')
    + '. Keep phone numbers, names of laws and courts, and any words they must say out loud exactly as given.';
}

/** System prompt + messages for one question. */
export function buildChatRequest({ history, body, lang, defender }) {
  const contextParts = [];
  if (body.city) contextParts.push(`City: ${body.city}`);
  if (body.lat != null && body.lng != null) contextParts.push(`Coords: ${body.lat.toFixed(4)}, ${body.lng.toFixed(4)}`);
  const contextNote = contextParts.length ? `\n\n[User location context: ${contextParts.join(' ')}]` : '';
  const caseNote = buildCaseNote(body.caseContext, defender ? 'defender' : 'consumer');
  const jurisdictionNote = buildJurisdictionNote(body.user_state, body.user_state_name);
  // Consumer answers about rights are grounded in the verified rights card
  // (services/rightsContent.js) and cite it; "talk to a lawyer" otherwise.
  const system = (defender ? DEFENDER_SYSTEM_PROMPT : SYSTEM_PROMPT + '\n\n' + rightsPromptBlock(body.user_state))
    + languageInstruction(lang);
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: caseNote + body.message + contextNote + jurisdictionNote },
  ];
  return { system, messages, max_tokens: defender ? 1500 : 800 };
}

export async function getHistory(db, sessionId, limit = 20, userId = null) {
  const rows = await db.all(
    `SELECT role, content, content AS text, COALESCE(status, 'complete') AS status, client_msg_id FROM chat_sessions
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
    `SELECT id, role, content, COALESCE(status, 'complete') AS status FROM chat_sessions
      WHERE user_id = ? AND session_id = ? AND client_msg_id = ? LIMIT 10`,
    [userId, sessionId, clientMessageId]);
  const answer = rows.find(r => r.role === 'assistant' && r.status === 'complete');
  if (answer) return answer.content;
  if (rows.length) {
    await db.run('DELETE FROM chat_sessions WHERE user_id = ? AND session_id = ? AND client_msg_id = ?',
      [userId, sessionId, clientMessageId]);
  }
  return null;
}

/** Store the question and the answer the person saw. status: 'complete' | 'stopped'. */
export async function saveExchange(db, { sessionId, userId, question, answer, clientMessageId = null, status = 'complete' }) {
  const t0 = Date.now();
  await db.run(
    `INSERT INTO chat_sessions (id, session_id, role, content, user_id, client_msg_id, status, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, 'complete', ?)`,
    [randomUUID(), sessionId, question, userId, clientMessageId, new Date(t0).toISOString()]);
  await db.run(
    `INSERT INTO chat_sessions (id, session_id, role, content, user_id, client_msg_id, status, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
    [randomUUID(), sessionId, answer, userId, clientMessageId, status, new Date(t0 + 1).toISOString()]);
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

/** Non-streamed answer (job path). Throws an AI error with a code (aiClient.aiErrorCode). */
export async function callClaude({ system, messages, max_tokens, defender, userId }) {
  // Per-attempt timeout, transient-failure retries, budget check and metering:
  // services/aiClient.js. This AbortController is the overall 45 s deadline
  // across all attempts (the queued job's own timeout is 45 s too).
  const route = defender ? 'chat_defender' : 'chat';
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), 45_000);
  const response = await anthropicFetch({
    signal: deadline.signal,
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens, system, messages }),
  }, { route, userId: userId ?? null, timeoutMs: 40_000 })
    .finally(() => clearTimeout(deadlineTimer));

  if (!response.ok) throw await aiHttpError(response, route);
  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw Object.assign(new Error('empty AI answer'), { code: 'ai_failed' });
  return text;
}

export function classifyIntent(message) {
  const m = message.toLowerCase();
  if (/arrested|handcuff|booking|jail|bond|bail|arrest|detenid|cárcel|fianza|preso|cadeia|fiança|bị bắt|nhà tù|tại ngoại/.test(m)) return 'post_arrest';
  if (/charged|charge|indicted|warrant|summons|arraign|acusad|cargo|orden de arresto|acusação|mandado|cáo buộc|lệnh bắt/.test(m)) return 'charges';
  if (/search|stop|pull over|detain|rights|miranda|silent|derecho|registr|silencio|direito|silêncio|quyền|im lặng/.test(m)) return 'know_rights';
  if (/lawyer|attorney|represent|counsel|legal help|abogad|advogad|luật sư/.test(m)) return 'find_lawyer';
  return 'general';
}
