/**
 * /api/search — Global in-app search
 *
 * GET /api/search?q=term&limit=20
 *
 * Searches: cases, messages, saved lawyers, lessons
 *
 * Strategy:
 *   SQLite: FTS5 virtual tables (porter stemmer + unicode61 tokenizer)
 *           → instant prefix match at any scale, ranked by relevance
 *   Postgres: ILIKE fallback (no FTS5 — use pg_trgm or tsvector in future)
 *
 * Auth: required.
 * Returns: { cases, messages, lawyers, lessons, total }
 */

import { escapeLike, safeInt } from '../utils/routeHelpers.js';
import { Router }      from 'express';
import { getDb }       from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { decrypt } from '../services/encryption.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    const user_state = String(req.query.user_state || req.user?.user_state || '').toUpperCase();
    if (raw.length < 2) {
      return res.json({ cases:[], messages:[], lawyers:[], lessons:[], total: 0 });
    }

    const limit = Math.min(safeInt(req.query.limit, 10), 30);
    const uid   = req.user.id;
    const db    = await getDb();

    // Postgres ILIKE search (case notes are encrypted at rest, so only titles
    // are searchable for cases).
    const qSafe = escapeLike(raw, 100);
    const likeTerm = '%' + qSafe + '%';

    const [cases, messages, lawyers, lessons] = await Promise.all([

      // ── Cases ──────────────────────────────────────────────────────────────
      db.all(
        `SELECT id, title, status, next_court_date
           FROM cases
          WHERE user_id = ? AND deleted_at IS NULL AND title ILIKE ?
          ORDER BY next_court_date ASC NULLS LAST LIMIT ?`,
        [uid, likeTerm, limit]
      ),

      // ── Messages on the user's own cases ───────────────────────────────────
      // Bodies are encrypted at rest, so the match runs on the decrypted text of
      // the user's most recent messages instead of in SQL.
      db.all(
        `SELECT m.id, COALESCE(m.body, m.content) AS content, m.created_at, c.id AS case_id, c.title AS case_title
           FROM case_messages m
           JOIN cases c ON c.id = m.case_id
          WHERE c.user_id = ? AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC LIMIT 500`,
        [uid]
      ).then(rows => {
        const needle = raw.slice(0, 100).toLowerCase();
        return rows
          .map(r => ({ ...r, content: decrypt(r.content) }))
          .filter(r => String(r.content || '').toLowerCase().includes(needle))
          .slice(0, limit);
      }),

      // ── Saved lawyers ──────────────────────────────────────────────────────
      db.all(
        `SELECT l.id, l.name, l.address, l.specialties, l.availability,
                l.bar_verified, l.jtb_verified, l.rating, l.state as lawyer_state
         FROM saved_lawyers sl
         JOIN lawyers l ON l.id = COALESCE(sl.lawyer_id, sl.provider_id)
         WHERE sl.user_id=?
           AND (l.name ILIKE ? OR l.address ILIKE ? OR l.specialties ILIKE ?)
         ORDER BY
           CASE WHEN l.state = ? THEN 0 ELSE 1 END ASC,
           CASE l.availability WHEN 'accepting' THEN 0 WHEN 'limited' THEN 1 ELSE 2 END ASC,
           CASE WHEN l.bar_verified = 1 THEN 0 ELSE 1 END ASC,
           l.rating DESC NULLS LAST
         LIMIT ?`,
        [uid, likeTerm, likeTerm, likeTerm, user_state || 'XX', limit]
      ),

      // ── Lessons ────────────────────────────────────────────────────────────
      db.all(
        `SELECT id, title, category, difficulty
           FROM lessons WHERE title ILIKE ? OR category ILIKE ?
          ORDER BY difficulty ASC NULLS LAST LIMIT ?`,
        [likeTerm, likeTerm, limit]
      ),
    ]);

    // ── Shape results ────────────────────────────────────────────────────────
    const shapedCases = cases.map(r => ({
      id: r.id, type: 'case',
      title: r.title,
      subtitle: [r.status, r.next_court_date].filter(Boolean).join(' · ') || 'Case',
      screen: 'Cases',
      params: { caseId: r.id },
    }));

    const shapedMessages = messages.map(r => ({
      id: r.id, type: 'message',
      title: r.case_title || 'Message',
      subtitle: String(r.content || '').slice(0, 80),
      screen: 'Messages',
      params: { caseId: r.case_id },
    }));

    const shapedLawyers = lawyers.map(r => ({
      id: r.id, type: 'lawyer',
      title: r.name,
      subtitle: [
        r.address,
        r.availability === 'accepting' ? 'Accepting clients' : null,
        r.bar_verified ? 'Bar verified' : null,
      ].filter(Boolean).join(' · ') || 'Lawyer',
      screen: 'SavedLawyers',
      params: {},
    }));

    const shapedLessons = lessons.map(r => ({
      id: r.id, type: 'lesson',
      title: r.title,
      subtitle: [r.category, r.difficulty].filter(Boolean).join(' · ') || 'Lesson',
      screen: 'Education',
      params: {},
    }));

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      cases:    shapedCases,
      messages: shapedMessages,
      lawyers:  shapedLawyers,
      lessons:  shapedLessons,
      total: shapedCases.length + shapedMessages.length + shapedLawyers.length + shapedLessons.length,
    });

  } catch (e) {
    logger.error({ msg: '[search] error', error: e?.message });
    const statusCode = e?.status || e?.statusCode || 500;
        const clientMsg = statusCode < 500 ? (e?.message || 'Request failed') : 'An error occurred. Please try again.';
        return res.status(statusCode).json({ error: clientMsg, code: e?.code || 'internal_error' });
  }
});

export default router;
