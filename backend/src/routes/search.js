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

import { err400, escapeLike, safeInt } from '../utils/routeHelpers.js';
import { Router }      from 'express';
import { getDb }       from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import logger from '../utils/logger.js';

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

    // Detect SQLite vs Postgres — FTS5 is SQLite-only
    const useFts = db._type !== 'postgres';

    // LIKE fallback term (used by Postgres path and saved_lawyers which has no FTS5 table)
    const qSafe = escapeLike(raw, 100);
    const likeTerm = '%' + qSafe + '%';

    // FTS5 query: append * for prefix matching so "theft" matches "theft", "thefts"
    const ftsQuery = raw.replace(/[""]/g, '').trim() + '*';

    const [cases, messages, lawyers, lessons] = await Promise.all([

      // ── Cases ──────────────────────────────────────────────────────────────
      useFts
        ? db.all(
            `SELECT c.id, c.title, c.status, c.next_court_date,
                    rank
             FROM cases_fts
             JOIN cases c ON c.id = cases_fts.rowid
             WHERE cases_fts MATCH ? AND c.user_id = ?
             ORDER BY rank, c.next_court_date ASC
             LIMIT ?`,
            [ftsQuery, uid, limit]
          ).catch(() => [])
        : db.all(
            `SELECT id, title, status, next_court_date
             FROM cases
             WHERE user_id=? AND (title LIKE ? OR notes LIKE ?)
             ORDER BY next_court_date ASC LIMIT ?`,
            [uid, likeTerm, likeTerm, limit]
          ),

      // ── Messages ───────────────────────────────────────────────────────────
      useFts
        ? db.all(
            `SELECT m.id, m.content, m.created_at, c.id as case_id, c.title as case_title
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN cases c ON c.id = m.case_id
             WHERE messages_fts MATCH ? AND c.user_id = ?
             ORDER BY rank DESC LIMIT ?`,
            [ftsQuery, uid, limit]
          ).catch(() => [])
        : db.all(
            `SELECT m.id, m.content, m.created_at, c.id as case_id, c.title as case_title
             FROM messages m
             JOIN cases c ON c.id = m.case_id
             WHERE c.user_id=? AND m.content LIKE ?
             ORDER BY m.created_at DESC LIMIT ?`,
            [uid, likeTerm, limit]
          ),

      // ── Saved lawyers — LIKE only (joins saved_lawyers, no FTS5 content table) ──
      db.all(
        `SELECT l.id, l.name, l.address, l.specialties, l.availability,
                l.bar_verified, l.jtb_verified, l.rating, l.state as lawyer_state
         FROM saved_lawyers sl
         JOIN lawyers l ON l.id = sl.lawyer_id
         WHERE sl.user_id=?
           AND (l.name LIKE ? OR l.address LIKE ? OR l.specialties LIKE ?)
         ORDER BY
           CASE WHEN l.state = ? THEN 0 ELSE 1 END ASC,
           CASE l.availability WHEN 'accepting' THEN 0 WHEN 'limited' THEN 1 ELSE 2 END ASC,
           CASE WHEN l.bar_verified = 1 THEN 0 ELSE 1 END ASC,
           l.rating DESC
         LIMIT ?`,
        [uid, likeTerm, likeTerm, likeTerm, user_state || 'XX', limit]
      ).catch(() => []),

      // ── Lessons ────────────────────────────────────────────────────────────
      useFts
        ? db.all(
            `SELECT l.id, l.title, l.category, l.difficulty
             FROM lessons_fts
             JOIN lessons l ON l.id = lessons_fts.rowid
             WHERE lessons_fts MATCH ?
             ORDER BY rank DESC LIMIT ?`,
            [ftsQuery, limit]
          ).catch(() => [])
        : db.all(
            `SELECT id, title, category, difficulty
             FROM lessons WHERE title LIKE ? OR category LIKE ?
             ORDER BY difficulty ASC LIMIT ?`,
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
    return res.status(500).json({ error: 'Search unavailable. Please try again.' });
  }
});

export default router;
