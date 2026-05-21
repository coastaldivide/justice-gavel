import { Router }       from 'express';
import { authRequired }  from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import logger            from '../../utils/logger.js';
import { getDb }         from '../../db/index.js';
import { generateMotion, ensureTables } from './_helpers.js';
import { CONFIG }        from '../../config.js';

const router = Router();

// ── POST /api/motions/generate ─────────────────────────────────────────────
router.post('/generate', authRequired, perUserAiLimit, async (req, res) => {
  try {
    const db = await getDb();
    await ensureTables(db);

    const { motionType, caseId, facts, jurisdiction, additionalNotes } = req.body;
    if (!motionType) return res.status(400).json({ error: 'motionType is required' });
    if (!facts || facts.trim().length < 20)
      return res.status(400).json({ error: 'facts must be at least 20 characters' });

    if (!CONFIG.ANTHROPIC_API_KEY) {
      // Demo mode — return template placeholder
      const demo = db.prepare(
        `INSERT INTO motion_history
          (user_id, case_id, motion_type, content, status, jurisdiction)
         VALUES (?,?,?,?,'draft',?)`
      ).run(
        req.user.id,
        caseId || null,
        motionType,
        `[DEMO] ${motionType}\n\nThis motion requires ANTHROPIC_API_KEY to generate. Add the key to .env and regenerate.\n\nFacts: ${facts.slice(0,200)}`,
        jurisdiction || null
      );
      return res.status(202).json({
        motionId: demo.lastInsertRowid,
        status:   'draft',
        content:  '[DEMO] Motion generation requires ANTHROPIC_API_KEY.',
        _demo:    true,
      });
    }

    const result = await generateMotion({
      motionType,
      facts,
      jurisdiction:    jurisdiction    || 'Unknown',
      additionalNotes: additionalNotes || '',
      userId:   req.user.id,
      caseId:   caseId    || null,
      db,
    });

    res.status(202).json(result);
  } catch (e) {
    logger.error('[motions/generate POST]', e.message);
    res.status(500).json({ error: 'Motion generation failed', detail: e.message });
  }
});

export default router;
