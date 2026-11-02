import { aiErrorCode, sendAiError } from '../services/aiClient.js';
import { isStaff } from '../utils/staff.js';
import { requireAi } from '../utils/ai.js';
import { requireDisclaimer } from '../middleware/disclaimer.js';
import { asyncRoute, safeInt } from '../utils/routeHelpers.js';
import { hasFeature } from '../services/entitlements.js';
import { TIERS, FEATURES, planFeatures } from './billing/plans.js';
import { msg, resolveLang, LANG_NAMES } from '../i18n/index.js';
/**
 * research.js — AI Legal Research (included in the paid plans that list
 * `legal_research` in routes/billing/plans.js PLAN_FEATURES; attorneys and
 * public defenders always)
 *
 * POST /api/research/ask          — run a legal research query → { jobId, session_id }
 * GET  /api/research/history      — past research sessions
 * GET  /api/research/session/:id  — full session with all queries
 * DELETE /api/research/session/:id
 * GET  /api/research/status       — { has_access, plans } (plans that include research)
 *
 * Model: the gateway's 'deep' class (ai/tasks.js: AI_MODEL_DEEP, default claude-opus-5-5) with a
 * legal research system prompt (prompt-cached, 5 minutes).
 * Sources: every answer is grounded (services/rag.js sourcedResearch): the research library's
 * passages and the app's sourced legal content go to Claude as citable search results; each
 * citation is verified against what was sent, uncited legal statements are withheld, and with
 * nothing relevant the AI is not asked (no answer from model memory). Answers come back as
 * `answer` (plain text with [n] markers + the source list) and `sourced` (segments + sources),
 * and are saved with their citations (migration 45).
 * Optimised for:
 *   - Case law queries with jurisdiction awareness
 *   - Statutory interpretation
 *   - Motion precedent research
 *   - Element-of-offense analysis
 *   - Sentencing range lookups
 *
 * NOT a replacement for Westlaw on appellate work.
 * IS a replacement for the 80% of routine research that doesn't need it.
 */

import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import express         from 'express';
import { enqueueAIJob as enqueue }     from '../services/aiQueue.js';
import { getDb } from '../db/index.js';
import { ragSearch, sourcedResearch } from '../services/rag.js';
import { plainText, publicAnswer, CITATION_RULES } from '../ai/citations.js';
import { authRequired } from '../middleware/auth.js';

// ── AI-specific rate limiter (50 requests / 15 min per user/IP) ─────────────
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => refuse(res, req, 429, 'rate'),
  keyGenerator: (req) => req.user?.id ? `user_${req.user.id}` : req.ip,
});

const router = express.Router();
const say = (req, key) => msg(resolveLang(req), `research.err.${key}`);
const refuse = (res, req, status, code) => res.status(status).json({ error: code, code, message: say(req, code) });

const PROFESSIONAL_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);
/** The plans whose subscribers get research (for the paywall). */
export const RESEARCH_PLANS = Object.freeze(Object.keys(TIERS).filter(k => !TIERS[k].legacy && !TIERS[k].matches_monthly && planFeatures(k).includes(FEATURES.LEGAL_RESEARCH)));

// ── Research access: an attorney / public defender, or an active paid plan that includes it ──
async function hasResearchAccess(db, user) {
  if (PROFESSIONAL_ROLES.has(user?.role) || Number(user?.is_defender) === 1) return true;
  return await hasFeature(db, user.id, FEATURES.LEGAL_RESEARCH);
}

// ── Legal research system prompt ──────────────────────────────────────────────
const RESEARCH_SYSTEM = `You are an expert AI legal research assistant for criminal defense attorneys and public defenders in the United States. You cover both trial-level and appellate practice.

Your role is to assist attorneys with legal research — case law, statutes, procedural rules, and legal standards. You are NOT providing legal advice to defendants; you are a professional research tool for licensed attorneys.

TRIAL-LEVEL RESEARCH CAPABILITIES:
1. CASE LAW — Find and summarize relevant cases with full citations: case name, citation, court, year, and exact holding.
2. STATUTES — Interpret and cite relevant federal and state statutes. Note jurisdiction and effective date.
3. CONSTITUTIONAL LAW — 4th Amendment (searches, seizures, stops, probable cause); 5th Amendment (Miranda, self-incrimination, double jeopardy); 6th Amendment (right to counsel, speedy trial, confrontation); 8th Amendment (bail, cruel and unusual punishment).
4. MOTION PRECEDENT — What arguments have courts accepted or rejected? Current trend in this circuit? Split among jurisdictions?
5. ELEMENTS OF OFFENSE — Break down what prosecution must prove for each charge, including mens rea requirements.
6. SENTENCING — Guidelines ranges, mandatory minimums, mitigating and aggravating factors, departures, variances, and alternatives to incarceration.
7. PROCEDURE — Filing deadlines, timing rules, local court rules, and standing orders.

APPELLATE RESEARCH CAPABILITIES:
8. STANDARDS OF REVIEW — Apply the correct standard to each issue:
   - De novo: questions of law, constitutional issues, sufficiency of indictment
   - Abuse of discretion: evidentiary rulings, sentencing decisions, continuances
   - Clearly erroneous: factual findings
   - Plain error: unpreserved issues (Olano factors: error, plain, affects substantial rights, seriously impairs fairness)
   - Structural error (automatic reversal): denial of counsel, biased judge, public trial, reasonable doubt instruction
9. PRESERVATION OF ERROR — Was the issue properly preserved? What objection was required? Is there a plain error argument?
10. HARMLESS ERROR vs REVERSIBLE ERROR — Apply the correct test. Constitutional errors: Chapman v. California (beyond reasonable doubt). Non-constitutional: whether error more probably than not affected verdict.
11. INEFFECTIVE ASSISTANCE — Strickland v. Washington two-prong test (deficient performance + prejudice). When does the presumption of prejudice apply (Cronic)?
12. BRADY / GIGLIO — Materiality standard. What must be disclosed? Impeachment evidence. Cumulative effect analysis.
13. HABEAS CORPUS — AEDPA deference (28 U.S.C. § 2254/2255). Exhaustion. Procedural default. Actual innocence gateway. Statute of limitations tolling. Successive petitions.
14. POST-CONVICTION RELIEF — State-specific PCR procedures. First Step Act. Compassionate release. Sentence modifications under 18 U.S.C. § 3582. Retroactive guideline amendments.
15. NEWLY DISCOVERED EVIDENCE — Standards for new trial motions. Actual innocence claims. DNA evidence procedures.

SOURCES (this overrides everything above): every question comes with search results — passages from the research library and from Justice Gavel's checked legal information, each with its citation, jurisdiction and source page. Every case, statute, rule, standard, deadline or number you state must come from those search results and be cited from them. The topics above say what you can help analyze when the sources cover it; they are not a licence to answer from memory. If the search results do not cover a point, say plainly that no source was found for it and that the attorney should check a primary source — do not fill the gap from memory, and never invent or complete a citation.

RESPONSE FORMAT:
- Lead with the direct answer the sources support
- For appellate issues: identify the standard of review first when the sources state it
- Distinguish controlling authority (binding) from persuasive authority (other circuits, other states), as far as the sources show it
- Note when a source is from a different jurisdiction than the question
- Flag circuit splits, unsettled or evolving law only when a source says so
- Use precise legal language — clear and direct, not unnecessarily complex
- Do not add a disclaimer or a list of sources: the app shows the sources and the notice under every answer

Be thorough, cite precisely, and be honest about what the sources do not cover.`;


// ── Claude research call ──────────────────────────────────────────────────────
const languageLine = (lang) => (lang === 'en' ? '' : `LANGUAGE: Write the answer in ${LANG_NAMES[lang]}. Keep case names, citations, statute numbers and quoted holdings exactly as published (do not translate them).`);

/** One sourced research answer (services/rag.js sourcedResearch). */
async function callResearch(history, query, lang, context, userId) {
  return await sourcedResearch({
    query, history, lang, context, userId, task: 'research', route: 'research',
    system: [{ text: `${RESEARCH_SYSTEM}\n\n${CITATION_RULES}`, cache: '5m' }, { text: languageLine(lang) }],
  });
}

// ── POST /api/research/ask ────────────────────────────────────────────────────
// The question and the answer are saved together when the answer is ready, so
// a failed attempt leaves nothing behind and a retry is not a duplicate.
router.post('/ask', aiLimiter, authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  try {
    const db = await getDb();
    if (!await hasResearchAccess(db, req.user)) {
      return res.status(402).json({ error: 'research_required', code: 'research_required', message: say(req, 'research_required'), plans: RESEARCH_PLANS });
    }

    const { query, session_id, context } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) return refuse(res, req, 400, 'query_required');
    if (query.trim().length > 2000) return refuse(res, req, 400, 'query_too_long');
    const ctx = typeof context === 'string' ? context.trim().slice(0, 300) : '';

    let sessionId = null;
    if (session_id != null && session_id !== '') {
      const sess = await db.get('SELECT id FROM research_sessions WHERE id=? AND user_id=?', [safeInt(session_id), req.user.id]);
      if (!sess) return refuse(res, req, 404, 'session_not_found');
      sessionId = sess.id;
    } else {
      const title = query.trim().slice(0, 60) + (query.trim().length > 60 ? '…' : '');
      sessionId = (await db.run('INSERT INTO research_sessions (user_id, title) VALUES (?,?)', [req.user.id, title])).lastID;
    }

    const history = (await db.all(
      `SELECT role, content, ai_sent FROM research_messages WHERE session_id=? ORDER BY created_at DESC, id DESC LIMIT 20`, [sessionId])).reverse();
    const q = query.trim();
    const lang = resolveLang(req);
    const jobId = await enqueue('research', async () => {
      const r = await callResearch(history, q, lang, ctx, req.user.id);
      const sourced = publicAnswer(r.answer);
      const answer = plainText(r.answer, lang, { markers: true });
      const db2 = await getDb();
      await db2.run('INSERT INTO research_messages (session_id, role, content, ai_sent) VALUES (?,?,?,?::jsonb)', [sessionId, 'user', q, JSON.stringify(r.sent)]);
      await db2.run('INSERT INTO research_messages (session_id, role, content, ai_answer) VALUES (?,?,?,?::jsonb)',
        [sessionId, 'assistant', plainText(r.answer, lang, { markers: false }), JSON.stringify(sourced)]);
      await db2.run('UPDATE research_sessions SET updated_at = NOW() WHERE id = ?', [sessionId]);
      return { session_id: sessionId, answer, sourced, not_legal_advice: true };
    }, req.user.id);
    return res.json({ jobId, session_id: sessionId, status: 'pending', async: true });
  } catch (e) {
    logger.error('[research/ask]', e.message);
    refuse(res, req, 500, 'server');
  }
});

// ── GET /api/research/history ─────────────────────────────────────────────────
router.get('/history', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    // Only sessions with at least one answer (a failed first question leaves an empty one)
    const sessions = await db.all(
      `SELECT s.id, s.title, s.created_at, s.updated_at FROM research_sessions s
        WHERE s.user_id=? AND EXISTS (SELECT 1 FROM research_messages m WHERE m.session_id = s.id)
        ORDER BY s.updated_at DESC NULLS LAST, s.id DESC LIMIT 20 OFFSET ?`,
      [req.user.id, Math.max(0, safeInt(req.query.page || '0')) * 20]
    );
    res.json(sessions);
  } catch (e) {
    logger.error('[research/history]', e.message);
    refuse(res, req, 500, 'server');
  }
});

// ── GET /api/research/session/:id ────────────────────────────────────────────
router.get('/session/:id', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sess = await db.get(
      'SELECT id, user_id, title, created_at, updated_at FROM research_sessions WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!sess) return refuse(res, req, 404, 'session_not_found');
    const rows = await db.all(
      'SELECT id, session_id, role, content, created_at, ai_answer FROM research_messages WHERE session_id=? ORDER BY created_at ASC, id ASC LIMIT 500',
      [sess.id]
    );
    // sourced: the saved answer with its verified citations, rendered as first shown (null for older answers)
    const lang = resolveLang(req);
    const messages = rows.map(({ ai_answer, ...m }) => ({
      ...m,
      ...(ai_answer?.segments ? { content: plainText(ai_answer, lang, { markers: true }) } : {}),
      sourced: ai_answer || null,
    }));
    res.json({ ...sess, messages });
  } catch (e) {
    logger.error('[research/session]', e.message);
    refuse(res, req, 500, 'server');
  }
});

// ── DELETE /api/research/session/:id ─────────────────────────────────────────
// Only the owner's session (another account's id → 404, nothing deleted).
router.delete('/session/:id', authRequired, async (req, res) => {
  const idVal = safeInt(req.params.id);
  if (!idVal) return refuse(res, req, 404, 'session_not_found');
  try {
    const db = await getDb();
    const sess = await db.get('SELECT id FROM research_sessions WHERE id=? AND user_id=?', [idVal, req.user.id]);
    if (!sess) return refuse(res, req, 404, 'session_not_found');
    await db.run('DELETE FROM research_messages WHERE session_id=?', [sess.id]);
    await db.run('DELETE FROM research_sessions WHERE id=? AND user_id=?', [sess.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[research/delete]', e.message);
    refuse(res, req, 500, 'server');
  }
});

// ── GET /api/research/status — check subscription ────────────────────────────
router.get('/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    res.json({ has_access: await hasResearchAccess(db, req.user), plans: RESEARCH_PLANS });
  } catch (e) {
    logger.error('[research/status]', e.message);
    refuse(res, req, 500, 'server');
  }
});


// ── RAG Legal Research — grounded in retrieved case law ────────────────────
// Replaces plain Claude queries with retrieval-augmented generation.
// Embeds the user query → searches pgvector index → Claude cites real docs.
router.post('/rag', aiLimiter, authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  const { query, practice_area, jurisdiction } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length < 5) return refuse(res, req, 400, 'query_required');
  if (query.length > 2000) return refuse(res, req, 400, 'query_too_long');
  if (!await hasResearchAccess(await getDb(), req.user)) {
    return res.status(402).json({ error: 'research_required', code: 'research_required', message: say(req, 'research_required'), plans: RESEARCH_PLANS });
  }

  try {
    const lang = resolveLang(req);
    const result = await ragSearch(query.trim(), {
      practiceArea: typeof practice_area === 'string' ? practice_area.slice(0, 40) : null,
      jurisdiction: typeof jurisdiction === 'string' ? jurisdiction.slice(0, 40) : null,
      userId:       req.user.id,
      lang,
      languageLine: languageLine(lang),
    });

    return res.json({
      answer:    plainText(result.answer, lang, { markers: true }),
      sourced:   publicAnswer(result.answer),
      citations: result.citations,
      docs_used: result.docsUsed,
      from_rag:  result.fromRAG,
      nothing_found: result.mode === 'nothing_found',
      latency_ms:result.latencyMs,
      not_legal_advice: true,
    });
  } catch (e) {
    logger?.warn('[research/rag]', e?.message);
    if (['ai_refused', 'ai_too_large'].includes(aiErrorCode(e))) return sendAiError(res, resolveLang(req), e);
    return refuse(res, req, 503, 'unavailable');
  }
});

// ── Index a legal document (admin only) ────────────────────────────────────
router.post('/index', authRequired, asyncRoute(async (req, res) => {
  // The JWT carries no is_admin claim, so this check always failed; read the role from the DB.
  if (!(await isStaff(await getDb(), req.user))) return res.status(403).json({ error: 'Admin only' });
  const { doc_type, citation, title, content, jurisdiction, practice_area, year, source_url } = req.body || {};
  const texts = { citation, title, content };
  if (Object.values(texts).some(v => typeof v !== 'string' || !v.trim()) || content.length > 200_000) {
    return refuse(res, req, 400, 'index_fields');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return refuse(res, req, 503, 'unavailable');
  try {
    const { indexLegalDocument } = await import('../services/rag.js');
    const doc = await indexLegalDocument({ docType: doc_type, citation, title, content, jurisdiction, practiceArea: practice_area, year, sourceUrl: source_url });
    return res.json(doc);
  } catch (e) {
    logger.error('[research/index]', e?.message);
    return refuse(res, req, 500, 'server');
  }
}));

// ── GET /research/topics — discovery entry point ──────────────────────────
router.get('/topics', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    topics: [
      { category: 'Know Your Rights',   practice_area: 'criminal',    questions: ['What are my Miranda rights?','Can police search my car?','What if I am arrested?'] },
      { category: 'Bail & Bond',        practice_area: 'bail',        questions: ['How is bail amount set?','What is a bail bondsman?','Can I get bail reduced?'] },
      { category: 'Expungement',        practice_area: 'expungement', questions: ['Am I eligible for expungement?','How long does it take?','What does it cost?'] },
      { category: 'Court Process',      practice_area: 'criminal',    questions: ['What happens at arraignment?','What is a preliminary hearing?','What is a plea deal?'] },
      { category: 'Immigration Rights', practice_area: 'immigration', questions: ['What are my rights if detained by ICE?','What is voluntary departure?','How do I request asylum?'] },
      { category: 'Child Support',      practice_area: 'family',      questions: ['How is child support calculated?','Can I modify a child support order?','What if the other parent does not pay?'] },
      { category: 'Domestic Violence',  practice_area: 'dv',          questions: ['How do I get a protective order?','What evidence do I need?','Will my children be affected?'] },
      { category: 'Drug Charges',       practice_area: 'drug',        questions: ['What is the difference between possession and trafficking?','Can drug charges be expunged?','What are diversion programs?'] },
    ]
  });
});

export default router;