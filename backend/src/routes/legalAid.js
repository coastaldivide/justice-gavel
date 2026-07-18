/**
 * routes/legalAid.js — Legal Aid B2B tier
 *
 * $199/month/attorney — gives public defenders and legal aid organizations
 * AI-assisted case prep, expungement petitions, client intake, and review workflows.
 *
 * Market: 80,000 public defenders in the US
 * 1% penetration = $19.2M ARR
 */

import { Router } from 'express';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';
import { enqueueAIJob } from '../services/aiQueue.js';

const router = Router();

/** GET /api/legal-aid/clients — public defender's client queue */
router.get('/clients', authRequired, asyncRoute(async (req, res) => {
  const { status = 'active', page = 1 } = req.query;
  const limit  = 20;
  const offset = (page - 1) * limit;

  const clients = await req.db.all(`
    SELECT
      c.id, c.user_id, u.full_name, u.phone, u.email,
      cs.case_type, cs.charge, cs.state, cs.status AS case_status, cs.next_court_date,
      -- Expungement eligibility preview
      cs.closed_at,
      CASE WHEN cs.status = 'closed' THEN true ELSE false END AS expungement_candidate
    FROM cases cs
    JOIN users u ON u.id = cs.user_id
    LEFT JOIN client_assignments c ON c.case_id = cs.id AND c.attorney_id = ?
    WHERE cs.status = ?
    ORDER BY cs.next_court_date ASC NULLS LAST
    LIMIT ? OFFSET ?
  `, [req.user.id, status, limit, offset]);

  return res.json({ data: clients, meta: { page: parseInt(page), limit } });
}));

/** POST /api/legal-aid/expungement-petition — AI-assisted petition drafting */
router.post('/expungement-petition', authRequired, asyncRoute(async (req, res) => {
  const {
    client_id, case_id, charge_type, disposition,
    sentence_completed, years_since_completion, state,
  } = req.body;

  const client = await req.db.get('SELECT * FROM users WHERE id = ?', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Queue AI petition drafting
  const job = await enqueueAIJob('motion', {
    prompt: `Draft an expungement petition for the following case:
Client: ${client.full_name}
State: ${state}
Charge: ${charge_type}
Disposition: ${disposition}
Sentence completed: ${sentence_completed ? 'Yes' : 'No'}
Years since completion: ${years_since_completion}

Generate a complete expungement petition following ${state} state law requirements.
Include: petition header, factual background, legal grounds for expungement,
verification, and signature block. Format for court filing.`,
    systemPrompt: `You are an expert legal document drafter specializing in expungement petitions.
Generate formal, court-ready legal documents following state-specific requirements.
Always include the required verification language and proper legal formatting.`,
    maxTokens: 3000,
  }, req.user.id);

  return res.status(202).json({
    data: { ...job, client_id, case_id },
    message: 'Petition drafting in progress. Check /api/jobs/' + job.job_id + ' for result.',
  });
}));

/** POST /api/legal-aid/intake — client intake automation */
router.post('/intake', authRequired, asyncRoute(async (req, res) => {
  const { client_id, case_type, interview_notes } = req.body;

  const job = await enqueueAIJob('research', {
    prompt: `Based on these intake interview notes, generate a structured case summary:
${interview_notes}

Provide:
1. Key facts and timeline
2. Potential defenses
3. Recommended next steps
4. Evidence to gather
5. Witnesses to contact`,
    systemPrompt: 'You are an experienced public defender providing case analysis.',
    maxTokens: 2000,
  }, req.user.id);

  return res.status(202).json({ data: job });
}));

export default router;
