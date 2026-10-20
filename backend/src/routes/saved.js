import { safeJson, truncateStr, safeInt } from '../utils/routeHelpers.js';
/**
 * saved.js — Saved lawyers (personal attorney contact list)
 * GET  /api/saved/lawyers          — list user's saved lawyers
 * POST /api/saved/lawyers          — save a lawyer
 * DELETE /api/saved/lawyers/:id    — unsave a lawyer
 */
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { resolveLang, msg } from '../i18n/index.js';

const router = Router();
const savedLimiter = makeUserLimiter({ windowMs: 3600000, max: 50, message: 'Too many save operations. Try again later.' });


router.get('/lawyers', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    // Live directory fields (phone, website, location) override the snapshot taken when saved.
    const lawyers = await db.all(
      `SELECT s.id, s.user_id, s.provider_id, COALESCE(l.name, s.name) AS name, COALESCE(l.phone, s.phone) AS phone,
              COALESCE(l.address, s.address) AS address, s.specialties, COALESCE(l.rating, s.rating) AS rating,
              s.notes, s.saved_at, s.gavel_level, s.golden_gavel, s.bar_verified, s.jtb_verified,
              l.website, l.lat, l.lng, l.city, l.state
         FROM saved_lawyers s
         LEFT JOIN lawyers l ON l.id = s.provider_id AND COALESCE(l.active, 1) = 1
        WHERE s.user_id = ? ORDER BY s.saved_at DESC LIMIT 200`,
      [req.user.id]
    );
    return res.json(lawyers.map(l => ({
      ...l,
      specialties:  (() => { try { return safeJson(l.specialties) || []; } catch { return []; } })(),
      gavel_level:  l.gavel_level  || 0,
      golden_gavel: !!(l.golden_gavel || l.gavel_level >= 3),
    })));
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: msg(lang, 'saved.err.server'), code: 'server_error' }); }
});

router.post('/lawyers', authRequired, savedLimiter, async (req, res) => {
  const lang = resolveLang(req);
  let { provider_id, lawyer_id, name = '', phone = '', address, specialties = [], rating, notes } = req.body || {};
  provider_id = provider_id || lawyer_id || null;
  if (provider_id !== null && (!safeInt(provider_id) || safeInt(provider_id) <= 0)) return res.status(400).json({ error: msg(lang, 'saved.err.bad_id'), code: 'bad_id' });
  provider_id = provider_id === null ? null : safeInt(provider_id);
  // A directory lawyer: the snapshot always comes from the listing itself.
  if (provider_id) {
    try {
      const l = await (await getDb()).get('SELECT name, phone, address, specialties, rating FROM lawyers WHERE id = ? AND COALESCE(active, 1) = 1', [provider_id]);
      if (!l) return res.status(404).json({ error: msg(lang, 'saved.err.not_found'), code: 'not_found' });
      name = l.name || ''; phone = l.phone || '';
      address = l.address; rating = l.rating;
      specialties = l.specialties ? safeJson(l.specialties, []) : [];
    } catch (e) {
      logger.error({ msg: '[saved] lawyer lookup failed', error: e?.message });
      return res.status(500).json({ error: msg(lang, 'saved.err.server'), code: 'server_error' });
    }
  }
  if (name) name = truncateStr(String(name), 200);
  if (address) address = truncateStr(String(address), 300);
  if (notes) notes = truncateStr(String(notes), 2000);
  if (!name) return res.status(400).json({ error: msg(lang, 'saved.err.name_required'), code: 'name_required' });
  try {
    const db = await getDb();
    const existing = provider_id
      ? await db.get('SELECT id FROM saved_lawyers WHERE user_id=? AND provider_id=?', [req.user.id, provider_id])
      : null;
    if (existing) return res.status(201).json({ already_saved: true, id: existing.id });
    const r = await db.run(
      'INSERT INTO saved_lawyers (user_id, provider_id, lawyer_id, name, phone, address, specialties, rating, notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.user.id, provider_id || null, provider_id || null, name, phone || null, address || null,
       JSON.stringify(specialties), rating || null, notes || null]
    );
    return res.status(201).json({ saved: true, id: r.lastID });
  } catch (e) {
    // Two taps raced past the check above: the unique index
    // (uq_saved_lawyers_user_provider) kept one row — answer like a re-save.
    if (e?.code === '23505' && provider_id) {
      const row = await (await getDb()).get('SELECT id FROM saved_lawyers WHERE user_id=? AND provider_id=?', [req.user.id, provider_id]).catch(() => null);
      if (row) return res.status(201).json({ already_saved: true, id: row.id });
    }
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: msg(lang, 'saved.err.server'), code: 'server_error' }); }
});

router.patch('/lawyers/:id', authRequired, async (req, res) => {
    const lang = resolveLang(req);
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: msg(lang, 'saved.err.bad_id'), code: 'bad_id' });
  try {
    const db = await getDb();
    let { notes = '' } = req.body || {};
  if (notes) notes = truncateStr(String(notes), 2000);
    const r = await db.run(
      'UPDATE saved_lawyers SET notes=? WHERE id=? AND user_id=?',
      [String(notes).trim(), idVal, req.user.id]
    );
    if (!r.changes) return res.status(404).json({ error: msg(lang, 'saved.err.not_saved'), code: 'not_found' });
    return res.json({ updated: true });
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: msg(lang, 'saved.err.server'), code: 'server_error' }); }
});

router.delete('/lawyers/:id', authRequired, async (req, res) => {
    const lang = resolveLang(req);
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: msg(lang, 'saved.err.bad_id'), code: 'bad_id' });
  try {
    const db = await getDb();
    const r = await db.run('DELETE FROM saved_lawyers WHERE id=? AND user_id=?', [idVal, req.user.id]);
    if (!r.changes) return res.status(404).json({ error: msg(lang, 'saved.err.not_saved'), code: 'not_found' });
    return res.json({ removed: true });
  } catch (e) {
    logger.error({ msg: '[saved]', error: e?.message }); res.status(500).json({ error: msg(lang, 'saved.err.server'), code: 'server_error' }); }
});

export default router;
