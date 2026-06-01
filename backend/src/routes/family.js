/**
 * routes/family.js — Family contacts for emergency share
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { apiLimiter, writeLimiter, aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// GET /api/family/contacts
router.get('/contacts', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      'SELECT * FROM family_contacts WHERE user_id = ? ORDER BY created_at ASC',
      [req.user.id]
    ).catch(() => []);
    res.json({ contacts });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

// POST /api/family/contacts
router.post('/contacts', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { name, phone, email, relationship } = req.body || {};
    if (!name || (!phone && !email)) {
      return res.status(400).json({ error: 'name and phone or email required' });
    }
    const r = await db.run(
      'INSERT INTO family_contacts (user_id, name, phone, email, relationship) VALUES (?,?,?,?,?)',
      [req.user.id, name, phone||null, email||null, relationship||'family']
    );
    res.json({ id: r.lastID, name, phone, email, relationship });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

// DELETE /api/family/contacts/:id
router.delete('/contacts/:id', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'DELETE FROM family_contacts WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

export default router;
