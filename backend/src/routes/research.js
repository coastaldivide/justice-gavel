/**
 * research.js — AI Legal Research ($49/mo add-on)
 *
 * POST /api/research/ask          — run a legal research query
 * GET  /api/research/history      — past research sessions
 * GET  /api/research/session/:id  — full session with all queries
 * DELETE /api/research/session/:id
 * POST /api/research/subscribe    — subscribe to $49/mo add-on
 * GET  /api/research/status       — check subscription status
 *
 * Model: Claude claude-sonnet-4-20250514 with a legal research system prompt.
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
import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere, API_URLS } from '../utils/routeHelpers.js';
import express         from 'express';
import { enqueue }     from '../services/aiQueue.js';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

// ── AI-specific rate limiter (50 requests / 15 min per user/IP) ─────────────
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests — please wait before trying again.' },
  keyGenerator: (req) => req.user?.id ? `user_${req.user.id}` : req.ip,
});

const router = express.Router();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const STRIPE_SECRET  = process.env.STRIPE_SECRET;

// Tables are defined in db/index.js Year 2 block — no per-request DDL needed.

// ── Check research subscription ───────────────────────────────────────────────
async function hasResearchAccess(db, userId) {
  // No demo bypass — subscription required in all environments
  const sub = await db.get(
    `SELECT id FROM subscriptions
     WHERE user_id=? AND tier IN ('legal_research','legal_research_annual')
     AND status IN ('active','trialing')
     ORDER BY id DESC LIMIT 1`,
    [userId]
  ).catch(() => null);
  return !!sub;
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

RESPONSE FORMAT:
- Lead with the direct answer to the question
- For appellate issues: always identify the standard of review first — it determines everything
- Cite specific cases with full citations: Case Name, Volume Reporter Page (Court Year)
- Distinguish controlling authority (binding) from persuasive authority (other circuits, other states)
- Note circuit splits and identify the majority and minority positions
- Flag when an area of law is evolving or recently decided
- Use precise legal language — clear and direct, not unnecessarily complex
- For habeas issues: flag AEDPA procedural requirements explicitly

CITATION FORMAT:
  Binding: Terry v. Ohio, 392 U.S. 1 (1968) [U.S. Supreme Court — binding]
  Circuit: United States v. Jones, 565 U.S. 400 (2012) [binding in all circuits]
  State:   State v. Smith, 456 S.W.3d 789 (Tenn. Crim. App. 2015) [binding in Tennessee]

IMPORTANT:
- Always note that attorneys should verify citations independently — case law changes
- Flag when there is a circuit split or unsettled area of law
- For AEDPA/habeas work: note the one-year statute of limitations and exhaustion requirement prominently
- For Notice of Appeal work: emphasize the deadline (federal: 14 days; most states: 30 days) — missing it waives appellate rights permanently
- Recommend checking local rules for jurisdiction-specific procedure

You are a comprehensive legal research partner for the full arc of criminal defense — from arrest through direct appeal through post-conviction. Be thorough, cite precisely, and be honest about uncertainty.`;

// ── Claude research call ──────────────────────────────────────────────────────
async function callResearch(history, query) {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to backend/.env to enable legal research.');
  }

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: query },
  ];

  const res = await fetch(API_URLS.ANTHROPIC, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.2,    // 0.2: precision drafting

      system:     RESEARCH_SYSTEM,
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Claude error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'No response generated.';
}

// ── POST /api/research/ask ────────────────────────────────────────────────────
// ── API key guard — fail fast with clear error rather than cryptic undefined ─
if (!process.env.ANTHROPIC_API_KEY) {
  logger.error('[research.js] ANTHROPIC_API_KEY not set — all AI routes will fail');
}

router.post('/ask', aiLimiter, authRequired, perUserAiLimit, async (req, res) => {
  try {
    const db = await getDb();
    if (!await hasResearchAccess(db, req.user.id)) {
      return res.status(402).json({
        error: 'Legal Research subscription required',
        code:  'research_required',
        upgrade_url: '/subscribe/legal_research',
      });
    }

    const { query, session_id } = req.body;
    if (!query?.trim()) return err400(res, 'query is required');
    if (query.trim().length > 2000) return err400(res, 'Query too long');

    // Get or create session
    let sessionId = session_id;
    if (!sessionId) {
      // New session — title from first 60 chars of query
      const title = query.trim().slice(0, 60) + (query.trim().length > 60 ? '…' : '');
      const r = await db.run(
        `INSERT INTO research_sessions (user_id, title) VALUES (?,?)`,
        [req.user.id, title]
      );
      sessionId = r.lastID;
    } else {
      // Verify session belongs to user
      const sess = await db.get(
        'SELECT id FROM research_sessions WHERE id=? AND user_id=?',
        [sessionId, req.user.id]
      );
      if (!sess) return err404(res, 'Session not found');
    }

    // Load history for this session
    const history = await db.all(
      `SELECT role, content FROM research_messages WHERE session_id=? ORDER BY created_at ASC LIMIT 20`,
      [sessionId]
    );

    // Save user message
    await db.run(
      `INSERT INTO research_messages (session_id, role, content) VALUES (?,?,?)`,
      [sessionId, 'user', query.trim()]
    );

    // Call Claude
    let answer;
    try {
      const _q = query.trim(); const _h = [...history]; const _sid = sessionId;
      const jobId = await enqueue('research', async () => {
        const a = await callResearch(_h, _q);
        const db2 = await getDb();
        await db2.run('INSERT INTO research_messages (session_id, role, content) VALUES (?,?,?)', [_sid, 'assistant', a]);
        return {
          session_id: _sid,
          answer: a,
          disclaimer: 'AI-generated legal research is general information only — not legal advice. Verify all citations independently. Consult a licensed attorney for advice specific to your situation.',
          not_legal_advice: true,
        };
      });
      return res.json({ jobId, session_id: sessionId, status: 'pending', async: true });
    } catch (e) {
      return res.status(502).json({ error: 'Upstream service error. Please try again.' });
    }
  } catch (e) {
    logger.error('[research/ask]', e.message);
    res.status(500).json({ error: 'Research error. Try again.' });
  }
});

// ── GET /api/research/history ─────────────────────────────────────────────────
router.get('/history', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const _histPage = Math.max(0, safeInt(req.query.page || '0'));
    const sessions = await db.all(
      `SELECT id, title, created_at, updated_at FROM research_sessions
       WHERE user_id=? ORDER BY updated_at DESC LIMIT 20 OFFSET ?`,
      [req.user.id, Math.max(0, safeInt(req.query.page || '0')) * 20]
    );
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: 'Could not load history' });
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
    if (!sess) return err404(res, 'Session not found');
    const messages = await db.all(
      'SELECT id, session_id, role, content, created_at FROM research_messages WHERE session_id=? ORDER BY created_at ASC',
      [safeInt(req.params.id)]
    );
    res.json({ ...sess, messages });
  } catch (e) {
    res.status(500).json({ error: 'Could not load session' });
  }
});

// ── DELETE /api/research/session/:id ─────────────────────────────────────────
router.delete('/session/:id', authRequired, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = await getDb();
    await db.run('DELETE FROM research_messages WHERE session_id=?', [safeInt(req.params.id)]);
    await db.run('DELETE FROM research_sessions WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete session' });
  }
});

// ── GET /api/research/status — check subscription ────────────────────────────
router.get('/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const hasAccess = await hasResearchAccess(db, req.user.id);
    const sub = await db.get(
      `SELECT tier, status, created_at FROM subscriptions
       WHERE user_id=? AND tier IN ('legal_research','legal_research_annual')
       AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    ).catch(() => null);
    res.json({ has_access: hasAccess, subscription: sub || null });
  } catch (e) {
    res.json({ has_access: false, subscription: null, demo: false });
  }
});

export default router;
