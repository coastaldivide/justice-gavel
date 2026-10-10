import { Router }       from 'express';
import { authRequired }  from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { requireAi }     from '../../utils/ai.js';
import logger            from '../../utils/logger.js';
import { getDb }         from '../../db/index.js';
import { generateMotion } from './_helpers.js';
import { MOTION_TYPES }  from './_motion_types.js';
import { enqueueAIJob as enqueue } from '../../services/aiQueue.js';

const router = Router();

// ── POST /api/motions/generate ─────────────────────────────────────────────
// Body (app): { motion_type, fields: { defendant_name, state, case_number, ... } }
// Legacy:     { motionType, facts, jurisdiction, additionalNotes, caseId }
// Returns 202 { jobId } — poll GET /api/jobs/:jobId → result { content, draft, motion_id }
router.post('/generate', authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  try {
    const body       = req.body || {};
    const motionType = String(body.motion_type || body.motionType || '').trim();
    if (!motionType) return res.status(400).json({ error: 'motion_type is required' });
    if (!MOTION_TYPES[motionType]) return res.status(400).json({ error: 'Unknown motion type' });

    const fields = (body.fields && typeof body.fields === 'object') ? { ...body.fields } : {};
    if (body.facts)           fields.facts = String(body.facts).slice(0, 10_000);
    if (body.jurisdiction)    fields.state = fields.state || String(body.jurisdiction).slice(0, 50);
    if (body.additionalNotes) fields.additional_notes = String(body.additionalNotes).slice(0, 5_000);
    for (const k of Object.keys(fields)) {
      fields[k] = typeof fields[k] === 'string' ? fields[k].slice(0, 10_000) : fields[k];
    }
    const caseId = Number.isInteger(Number(body.caseId ?? body.case_id)) ? Number(body.caseId ?? body.case_id) || null : null;
    const userId = req.user.id;

    const jobId = await enqueue('motion', async () => {
      const draft = await generateMotion(motionType, fields);
      let motionId = null;
      try {
        const db = await getDb();
        const r = await db.run(
          `INSERT INTO motions (user_id, case_id, motion_type, type, title, draft, fields, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [userId, caseId, motionType, motionType, MOTION_TYPES[motionType].label || motionType,
           draft, JSON.stringify(fields)]
        );
        motionId = r.lastID || null;
      } catch (e) {
        logger.warn('[motions/generate] could not persist draft:', e.message);
      }
      return { content: draft, draft, motion_id: motionId, motion_type: motionType };
    }, userId);

    res.status(202).json({ jobId, status: 'pending', async: true });
  } catch (e) {
    logger.error('[motions/generate POST]', e.message);
    res.status(500).json({ error: 'Motion generation failed' });
  }
});

export default router;
