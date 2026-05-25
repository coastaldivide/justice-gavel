/**
 * chat/_helpers.js — Chat utility functions and Claude API call
 *
 * buildCaseNote()         — build structured case context block for AI prompt injection
 * buildJurisdictionNote() — build jurisdiction awareness block for AI prompt injection
 * callClaude()            — core AI call, builds messages array, calls Anthropic
 * getHistory()            — fetch recent messages for a session
 * saveMessage()           — persist a message to the DB
 * detectLawyerHandoff()   — detect when user should be referred to a human attorney
 * classifyIntent()        — classify message intent for routing
 */
import { API_URLS }        from '../../utils/routeHelpers.js';
import logger               from '../../utils/logger.js';
import { SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT, RESPONSE_FOOTER_INSTRUCTION }
  from './_prompts.js';

export async function getHistory(db, sessionId, limit = 20) {
  const rows = await db.all(
    `SELECT role, content FROM chat_sessions
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [sessionId, limit]
  );
  return rows.reverse(); // DB returns newest-first; reverse to chronological for AI context
}

export async function saveMessage(db, sessionId, role, content, userId = null) {
  await db.run(
    `INSERT INTO chat_sessions (session_id, role, content, user_id) VALUES (?, ?, ?, ?)`,
    [sessionId, role, content, userId]
  );
}

export function detectLawyerHandoff(userMessage, reply) {
  const combined = (userMessage + ' ' + reply).toLowerCase();
  const triggers = [
    'find a lawyer', 'connect you with a lawyer', 'connect you with an attorney', 'recommend a lawyer', 'speak with an attorney',
    'consult an attorney', 'need legal representation', 'look for a lawyer',
    'search for lawyers', 'match you with a lawyer', 'match you with an attorney', 'criminal defense attorney',
    'hire an attorney',
  ];
  return triggers.some(t => combined.includes(t));
}

// ── Shared case context builder — used by callClaude() and stream.js ────────
// Converts a caseContext payload (JSON string or object) into a structured
// prompt block. Centralised here so both code paths stay in sync.
export function buildCaseNote(caseContext, mode = 'consumer') {
  if (!caseContext) return '';
  try {
    const ctx = typeof caseContext === 'string' ? JSON.parse(caseContext) : caseContext;
    const parts = ['\n\n[ACTIVE CASE CONTEXT]'];

    if (ctx.title)           parts.push(`Case: ${ctx.title}`);
    if (ctx.status)          parts.push(`Status: ${ctx.status}`);
    if (ctx.charges && (!Array.isArray(ctx.charges) || ctx.charges.length > 0))
      parts.push(`Charges: ${Array.isArray(ctx.charges) ? ctx.charges.join(', ') : String(ctx.charges)}`);
    if (ctx.next_court_date) parts.push(`Next court date: ${ctx.next_court_date}`);
    if (ctx.notes && typeof ctx.notes !== 'object') parts.push(`Notes: ${String(ctx.notes).slice(0, 300)}`);
    if (ctx.attorney_name)   parts.push(`Attorney: ${ctx.attorney_name}`);
    // != null catches both null and undefined (is_pre_trial is boolean | null | undefined)
    if (ctx.is_pre_trial != null) parts.push(`Stage: ${ctx.is_pre_trial ? 'Pre-trial' : 'Post-conviction'}`);
    const _bail = Number(ctx.bail_amount);
    // toLocaleString locale pinned to en-US — server OS locale must not affect AI prompt formatting
    if (Number.isFinite(_bail)) parts.push(`Bail: $${_bail.toLocaleString('en-US')}`);
    if (ctx.financial_situation) parts.push(`Financial situation: ${ctx.financial_situation}`);

    // Only inject the block if at least one field was actually populated
    if (parts.length === 1) return '';
    parts.push('[END CASE CONTEXT]');
    parts.push("Use this context to make your responses specific to this person's actual situation.");
    return parts.join('\n') + '\n\n';
  } catch (e) {
    logger.warn('[chat/buildCaseNote] non-JSON context:', e?.message);
    // caseContext was not valid JSON — use raw text only in defender mode
    return mode === 'defender'
      ? `\n\n[CASE CONTEXT]\n${caseContext}\n[END CASE CONTEXT]\n\n`
      : '';
  }
}

// ── Shared jurisdiction note builder — used by callClaude() and stream.js ─────
// Injects user's state jurisdiction context so the AI tailors legal info.
// When user_state is unknown, instructs the AI to flag state-specific variation.
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

export async function callClaude(opts) {
  const {
    history, newMessage, locationContext,
    mode = 'consumer', caseContext = null,
    user_state      = null,
    user_state_name = null,
  } = opts;

  const contextNote = locationContext
    ? `\n\n[User location context: ${locationContext}]`
    : '';

  // ── Case context — delegates to shared buildCaseNote() ────────────────────
  const caseNote = buildCaseNote(caseContext, mode);

  const isDefender   = mode === 'defender';
  const systemPrompt = (isDefender ? DEFENDER_SYSTEM_PROMPT : SYSTEM_PROMPT) + RESPONSE_FOOTER_INSTRUCTION;

  // ── Jurisdiction awareness — delegates to shared buildJurisdictionNote() ──
  const jurisdictionNote = buildJurisdictionNote(user_state, user_state_name);

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: caseNote + newMessage + contextNote + jurisdictionNote },
  ];

  const maxTokens   = isDefender ? 1500 : 600;  // defenders get fuller responses
  const temperature = isDefender ? 0.3  : 0.4;  // defenders: precise; consumers: conversational

  const _chatAC = new AbortController();
  const _chatTO = setTimeout(() => _chatAC.abort(), 45_000);
  let response;
  try {
    response = await fetch(API_URLS.ANTHROPIC, {
      signal: _chatAC.signal,
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:       'claude-sonnet-4-20250514',
      max_tokens:  maxTokens,
      temperature,
      system:      systemPrompt,
      messages,
    })
  });

  } finally { clearTimeout(_chatTO); }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic API error: ${response.status} — ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "I'm having trouble responding right now. Please try again.";
}

export function classifyIntent(message) {
  const m = message.toLowerCase();
  if (/arrested|handcuff|booking|jail|bond|bail/.test(m)) return 'post_arrest';
  if (/charged|charge|indicted|warrant|summons|arraign/.test(m)) return 'charges';
  if (/search|stop|pull over|detain|rights|miranda|silent/.test(m)) return 'know_rights';
  if (/lawyer|attorney|represent|counsel|legal help/.test(m)) return 'find_lawyer';
  return 'general';
}
