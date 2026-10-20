/**
 * routes/family.js — Family contacts for emergency share
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
import { resolveLang, msg } from '../i18n/index.js';

const router = Router();

// GET /api/family/contacts
router.get('/contacts', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      'SELECT id, name, phone, email, relationship, created_at FROM family_contacts WHERE user_id = ? ORDER BY created_at ASC LIMIT 100',
      [req.user.id]
    ).catch(() => []);
    res.json({ contacts });
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

// POST /api/family/contacts
router.post('/contacts', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const name = str(b.name, 120); const phone = str(b.phone, 30); const email = str(b.email, 254); const relationship = str(b.relationship, 40);
    if (!name || (!phone && !email)) {
      return res.status(400).json({ error: msg(resolveLang(req), 'family.err.contact_required') });
    }
    const r = await db.run(
      'INSERT INTO family_contacts (user_id, name, phone, email, relationship) VALUES (?,?,?,?,?)',
      [req.user.id, name, phone || null, email || null, relationship || 'family']
    );
    res.json({ id: r.lastID, name, phone, email, relationship });
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

// DELETE /api/family/contacts/:id
router.delete('/contacts/:id', authRequired, apiLimiter, async (req, res) => {
  if (!/^\d{1,15}$/.test(String(req.params.id))) return res.status(404).json({ error: msg(resolveLang(req), 'family.err.contact_not_found') });
  try {
    const db = await getDb();
    const r = await db.run('DELETE FROM family_contacts WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
    if (!r.changes) return res.status(404).json({ error: msg(resolveLang(req), 'family.err.contact_not_found') });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

export default router;
