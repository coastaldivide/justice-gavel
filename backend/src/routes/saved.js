/**
 * saved.js — Saved lawyers (personal attorney contact list)
 * GET  /api/saved/lawyers          — list user's saved lawyers
 * POST /api/saved/lawyers          — save a lawyer
 * DELETE /api/saved/lawyers/:id    — unsave a lawyer
 */
import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';

const router = Router();
const savedLimiter = makeUserLimiter({ windowMs: 3600000, max: 50, message: 'Too many save operations. Try again later.' });


router.get('/lawyers', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const lawyers = await db.all(
      `SELECT id, user_id, provider_id, name = '', phone = '', address, specialties,
              rating, notes, saved_at, gavel_level, golden_gavel,
              bar_verified, jtb_verified
       FROM saved_lawyers WHERE user_id = ? ORDER BY saved_at DESC`,
      [req.user.id]
    );
    return res.json(lawyers.map(l => ({
      ...l,
      specialties:  (() => { try { return JSON.parse(l.specialties); } catch { return []; } })(),
      gavel_level:  l.gavel_level  || 0,
      golden_gavel: !!(l.golden_gavel || l.gavel_level >= 3),
    })));
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.post('/lawyers', authRequired, savedLimiter, async (req, res) => {
  const { provider_id, name = '', phone = '', address, specialties = [], rating, notes } = req.body;
  if (name) name = truncateStr(String(name), 200);
  if (address) address = truncateStr(String(address), 300);
  if (notes) notes = truncateStr(String(notes), 2000);
  if (!name) return err400(res, 'name required');
  try {
    const db = await getDb();
    const existing = provider_id
      ? await db.get('SELECT id FROM saved_lawyers WHERE user_id=? AND provider_id=?', [req.user.id, provider_id])
      : null;
    if (existing) return res.status(201).json({ already_saved: true, id: existing.id });
    const r = await db.run(
      'INSERT INTO saved_lawyers (user_id, provider_id, name, phone, address, specialties, rating, notes) VALUES (?,?,?,?,?,?,?,?)',
      [req.user.id, provider_id || null, name, phone || null, address || null,
       JSON.stringify(specialties), rating || null, notes || null]
    );
    return res.status(201).json({ saved: true, id: r.lastID });
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.patch('/lawyers/:id', authRequired, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = await getDb();
    const { notes = '' } = req.body;
  if (notes) notes = truncateStr(String(notes), 2000);
    await db.run(
      'UPDATE saved_lawyers SET notes=? WHERE id=? AND user_id=?',
      [notes.trim(), safeInt(req.params.id), req.user.id]
    );
    return res.json({ updated: true });
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.delete('/lawyers/:id', authRequired, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = await getDb();
    await db.run('DELETE FROM saved_lawyers WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    return res.json({ removed: true });
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

export default router;
