import { Router }        from 'express';
import { authRequired }   from '../middleware/auth.js';
import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
import logger             from '../utils/logger.js';
import { getDb }          from '../db/index.js';
import { CONFIG }         from '../config.js';

const router = Router();

// ── GET /api/discovery/status — job status poll ───────────────────────────
router.get('/status', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const job = await db.get(
      `SELECT id, type, status, output, error, created_at, completed_at
       FROM ai_jobs WHERE id = ? AND user_id = ?`,
      [req.query.jobId, req.user.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      jobId:     job.id,
      status:    job.status,           // pending|running|done|failed
      output:    job.output ? JSON.parse(job.output) : null,
      error:     job.error  || null,
      createdAt: job.created_at,
      completedAt: job.completed_at || null,
    });
  } catch (e) {
    logger.error('[discovery/status GET]', e.message);
    res.status(500).json({ error: 'Could not fetch job status' });
  }
});

// ── GET /api/discovery/history — user's past analyses ─────────────────────
router.get('/history', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const jobs = await db.all(
      `SELECT id, type, status, created_at, completed_at,
              SUBSTR(output, 1, 200) as output_preview
       FROM ai_jobs
       WHERE user_id = ? AND type = 'discovery'
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(jobs || []);
  } catch (e) {
    logger.error('[discovery/history GET]', e.message);
    res.status(500).json({ error: 'Could not load history' });
  }
});

// ── POST /api/discovery/analyze — submit document for AI analysis ─────────
router.post('/analyze', authRequired, perUserAiLimit, async (req, res) => {
  try {
    const { text, documentType, caseId } = req.body;
    if (!text || text.trim().length < 10)
      return res.status(400).json({ error: 'Document text is required (min 10 chars)' });

    const db = await getDb();

    // If Anthropic key not configured → return helpful placeholder
    if (!CONFIG.ANTHROPIC_API_KEY) {
      const mockJob = db.prepare(
        `INSERT INTO ai_jobs (user_id, type, status, input, output, completed_at)
         VALUES (?, 'discovery', 'done', ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        req.user.id,
        JSON.stringify({ text: text.slice(0, 200), documentType }),
        JSON.stringify({
          summary:      'AI analysis requires ANTHROPIC_API_KEY. See ENVIRONMENT_VARS.md.',
          key_issues:   ['Add ANTHROPIC_API_KEY to .env to enable this feature'],
          risk_level:   'unknown',
          suggestions:  ['Contact your attorney to review this document manually'],
          _demo:        true,
        })
      );
      return res.status(202).json({
        jobId:   mockJob.lastInsertRowid,
        status:  'done',
        message: 'Demo mode — AI analysis not available without ANTHROPIC_API_KEY',
        _demo:   true,
      });
    }

    // Queue real AI job
    const job = db.prepare(
      `INSERT INTO ai_jobs (user_id, type, status, input)
       VALUES (?, 'discovery', 'pending', ?)`
    ).run(
      req.user.id,
      JSON.stringify({ text, documentType: documentType || 'unknown', caseId: caseId || null })
    );

    // Kick off async analysis (fire and forget — client polls /status)
    setImmediate(async () => {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client    = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });

        db.prepare(`UPDATE ai_jobs SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(job.lastInsertRowid);

        const msg = await client.messages.create({
          model:      'claude-opus-4-5',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `You are a criminal defense legal assistant. Analyze this ${documentType || 'legal document'} and provide:
1. Summary (2-3 sentences)
2. Key issues or concerns (bullet list)
3. Risk level (low/medium/high/critical)
4. Suggested actions for the defendant's attorney

Document:
${text.slice(0, 8000)}

Respond as JSON: { "summary": "...", "key_issues": [...], "risk_level": "...", "suggestions": [...] }`,
          }],
        });

        const raw = msg.content[0]?.text || '{}';
        const result = JSON.parse(raw.replace(/```json|```/g, '').trim());

        db.prepare(
          `UPDATE ai_jobs SET status='done', output=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`
        ).run(JSON.stringify(result), job.lastInsertRowid);
      } catch (err) {
        logger.error('[discovery async]', err.message);
        db.prepare(
          `UPDATE ai_jobs SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`
        ).run(err.message, job.lastInsertRowid);
      }
    });

    res.status(202).json({
      jobId:   job.lastInsertRowid,
      status:  'pending',
      message: 'Analysis queued — poll /api/discovery/status?jobId=' + job.lastInsertRowid,
    });
  } catch (e) {
    logger.error('[discovery/analyze POST]', e.message);
    res.status(500).json({ error: 'Could not start analysis' });
  }
});

export default router;
