/**
 * attorney/inbox.js — Unified attorney inbox
 *
 * GET /api/attorney/inbox
 *   Returns a single merged feed combining:
 *     • Upcoming consultations (next 7 days)
 *     • Unread case messages from clients
 *     • Today's hearings / court dates
 *     • Pending case assignments awaiting acceptance
 *
 * This is the attorney's "command center" — one request on dashboard open
 * tells them everything they need to act on today.
 *
 * All data is scoped to the authenticated attorney (defender_id = req.user.id).
 */

import { Router }           from 'express';
import { authRequired }     from '../../middleware/auth.js';
import { getDb }            from '../../db/index.js';
import { err403, safeInt }  from '../../utils/routeHelpers.js';
import { makeUserLimiter }   from '../../middleware/sharedAiLimiter.js';
import logger               from '../../utils/logger.js';
import { requireDefender }  from './_helpers.js';

const router = Router();
const inboxLimiter      = makeUserLimiter({ windowMs: 60_000,   max: 30,  message: 'Inbox rate limit — try again shortly.' });
const markReadLimiter   = makeUserLimiter({ windowMs: 60_000,   max: 60,  message: 'Rate limit.' });
const acceptLimiter     = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: 'Rate limit.' });


// ── GET /api/attorney/inbox ───────────────────────────────────────────────────
router.get('/inbox', authRequired, inboxLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;
  const attorneyId = req.user.id;

  try {
    const [
      upcomingConsults,
      unreadMessages,
      todayHearings,
      pendingAssignments,
      recentActivity,
    ] = await Promise.all([

      // ── Upcoming consultations (next 7 days) ────────────────────────────────
      db.all(
        `SELECT cb.id, cb.date_slot, cb.time_slot, cb.duration_min,
                cb.status, cb.meeting_link, cb.notes,
                u.display_name AS client_name,
                u.email        AS client_email,
                c.id           AS case_id,
                c.title        AS case_title,
                c.state        AS case_state
           FROM consultation_bookings cb
           JOIN users u ON u.id = cb.user_id
           LEFT JOIN case_assignments ca ON ca.user_id = cb.user_id AND ca.defender_id = ?
           LEFT JOIN cases c ON c.id = ca.case_id
          WHERE cb.lawyer_id IN (
                  SELECT lawyer_id FROM attorney_profiles WHERE user_id = ?
                )
             OR cb.lawyer_id = ?
          AND cb.status = 'confirmed'
          AND cb.date_slot >= date('now')
          AND cb.date_slot <= date('now', '+7 days')
          ORDER BY cb.date_slot ASC, cb.time_slot ASC
          LIMIT 20`,
        [attorneyId, attorneyId, attorneyId]
      ),

      // ── Unread case messages from clients ───────────────────────────────────
      db.all(
        `SELECT cm.id, cm.case_id, cm.body, cm.sent_at, cm.message_type,
                u.display_name AS client_name,
                c.title        AS case_title,
                c.state        AS case_state,
                c.status       AS case_status
           FROM case_messages cm
           JOIN cases c ON c.id = cm.case_id
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ?
           JOIN users u ON u.id = cm.sender_id
          WHERE cm.read_at IS NULL
            AND cm.sender_type = 'user'
            AND cm.deleted_at IS NULL
          ORDER BY cm.sent_at DESC
          LIMIT 30`,
        [attorneyId]
      ),

      // ── Today's hearings ─────────────────────────────────────────────────────
      db.all(
        `SELECT c.id AS case_id, c.title, c.next_court_date, c.state, c.status,
                u.display_name AS client_name, u.email AS client_email,
                ce.description AS next_event
           FROM cases c
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ?
           JOIN users u ON u.id = c.user_id
           LEFT JOIN case_events ce ON ce.case_id = c.id
                                   AND ce.id = (
                                     SELECT id FROM case_events
                                      WHERE case_id = c.id AND event_date >= date('now')
                                      ORDER BY event_date ASC LIMIT 1
                                   )
          WHERE c.next_court_date = date('now')
          ORDER BY c.next_court_date ASC`,
        [attorneyId]
      ),

      // ── Pending case assignments (not yet accepted) ──────────────────────────
      db.all(
        `SELECT ca.id AS assignment_id, ca.assigned_at, ca.notes AS referral_notes,
                c.id AS case_id, c.title, c.state, c.status,
                c.next_court_date,
                u.display_name AS client_name,
                u.email        AS client_email
           FROM case_assignments ca
           JOIN cases c ON c.id = ca.case_id
           JOIN users u ON u.id = c.user_id
          WHERE ca.defender_id = ?
            AND ca.status = 'pending'
          ORDER BY ca.assigned_at DESC
          LIMIT 10`,
        [attorneyId]
      ),

      // ── Recent activity (last 5 days of assigned cases) ─────────────────────
      db.all(
        `SELECT c.id AS case_id, c.title, c.state, c.status,
                c.updated_at,  c.next_court_date,
                u.display_name AS client_name,
                (SELECT COUNT(*) FROM case_messages cm
                  WHERE cm.case_id = c.id
                    AND cm.read_at IS NULL
                    AND cm.sender_type = 'user') AS unread_count
           FROM cases c
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ?
           JOIN users u ON u.id = c.user_id
          WHERE ca.status = 'active'
          ORDER BY c.updated_at DESC
          LIMIT 15`,
        [attorneyId]
      ),
    ]);

    // Compute summary badge counts
    const totalUnread   = unreadMessages.length;
    const todayCount    = (upcomingConsults.filter(c => c.date_slot === new Date().toISOString().slice(0,10))).length
                        + todayHearings.length;
    const pendingCount  = pendingAssignments.length;
    const urgentCount   = todayCount + pendingCount;

    res.json({
      summary: {
        unread_messages: totalUnread,
        today_events:    todayCount,
        pending_assignments: pendingCount,
        urgent_count:    urgentCount,
      },
      upcoming_consultations: upcomingConsults,
      unread_messages:        unreadMessages,
      today_hearings:         todayHearings,
      pending_assignments:    pendingAssignments,
      recent_cases:           recentActivity,
      fetched_at:             new Date().toISOString(),
    });

  } catch (e) {
    logger.error({ msg: '[attorney/inbox]', error: e?.message });
    res.status(e?.status || 500).json({ error: e?.message || 'Could not load inbox' });
  }
});

// ── POST /api/attorney/inbox/mark-read ──────────────────────────────────────
// Mark all messages in a case as read by the attorney
router.post('/inbox/mark-read/:caseId', authRequired, markReadLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;

  const caseId = safeInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'Invalid caseId' });

  try {
    // Verify attorney is assigned to this case
    const assignment = await db.get(
      `SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? AND status = 'active'`,
      [caseId, req.user.id]
    );
    if (!assignment) return err403(res, 'Not assigned to this case');

    await db.run(
      `UPDATE case_messages
          SET read_at = datetime('now')
        WHERE case_id = ?
          AND read_at IS NULL
          AND sender_type = 'user'`,
      [caseId]
    );

    res.json({ success: true, case_id: caseId });
  } catch (e) {
    logger.warn('[mark-read]', e?.message);
    res.status(500).json({ error: 'Could not mark messages as read' });
  }
});

// ── POST /api/attorney/inbox/accept/:assignmentId ────────────────────────────
// Attorney accepts a pending case assignment
router.post('/inbox/accept/:assignmentId', authRequired, acceptLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;

  const assignmentId = safeInt(req.params.assignmentId);
  if (!assignmentId) return res.status(400).json({ error: 'Invalid assignmentId' });

  try {
    const assignment = await db.get(
      `SELECT ca.*, c.title, u.display_name AS client_name, u.id AS client_id
         FROM case_assignments ca
         JOIN cases c ON c.id = ca.case_id
         JOIN users u ON u.id = c.user_id
        WHERE ca.id = ? AND ca.defender_id = ? AND ca.status = 'pending'`,
      [assignmentId, req.user.id]
    );
    if (!assignment) return err403(res, 'Assignment not found or already actioned');

    await db.run(
      `UPDATE case_assignments SET status = 'active', accepted_at = datetime('now') WHERE id = ?`,
      [assignmentId]
    );

    // Notify the client their attorney accepted
    const { sendPushToUser } = await import('../../services/pushDelivery.js');
    await sendPushToUser(assignment.client_id, {
      title: '✅ Attorney Accepted Your Case',
      body: `${req.user.display_name || 'Your attorney'} accepted your case: ${assignment.title}`,
      data: { screen: 'Messages', caseId: assignment.case_id },
      channelId: 'case_updates',
    }).catch(() => {});

    res.json({ success: true, assignment_id: assignmentId, status: 'active' });
  } catch (e) {
    logger.error('[inbox/accept]', e?.message);
    res.status(500).json({ error: 'Could not accept assignment' });
  }
});

export default router;
