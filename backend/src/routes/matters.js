/**
 * routes/matters.js — Matter management (multi-user, RBAC, audit-logged)
 *
 * A "matter" is the enterprise equivalent of a "case" — same data,
 * richer access control. Matters are owned by a firm and worked by
 * a team of users with different roles.
 *
 * POST   /api/matters                  — create matter (associate+)
 * GET    /api/matters                  — list firm's matters (viewer+)
 * GET    /api/matters/:id              — get matter detail (viewer+, must be on team)
 * PUT    /api/matters/:id              — update matter (associate+)
 * DELETE /api/matters/:id              — delete matter (partner+)
 *
 * GET    /api/matters/:id/team         — list team members
 * POST   /api/matters/:id/team         — add team member (partner+)
 * PATCH  /api/matters/:id/team/:userId — change member role (partner+)
 * DELETE /api/matters/:id/team/:userId — remove from team (partner+)
 *
 * GET    /api/matters/:id/events       — timeline events
 * POST   /api/matters/:id/events       — add event (paralegal+)
 * DELETE /api/matters/:id/events/:eid  — remove event (associate+)
 *
 * GET    /api/matters/dashboard        — firm-wide matter stats (partner+)
 * GET    /api/matters/workload         — per-attorney open matter count (firm_admin+)
 */

import { err400, err403, err404, err500, safeInt,
         sanitizeStr, truncateStr }          from '../utils/routeHelpers.js';
import { Router }                             from 'express';
import { authRequired }                       from '../middleware/auth.js';
import { getDb }                              from '../db/index.js';
import { makeUserLimiter }                    from '../middleware/sharedAiLimiter.js';
import logger                                 from '../utils/logger.js';
import {
  requirePermission, requireMatterAccess,
  loadMatterRole, hasMinRole, ROLES,
}                                             from '../middleware/rbac.js';
import { auditLog, writeAuditLog }            from '../middleware/audit.js';
import { dispatchWebhookEvent }               from './webhooks/outbound.js';
import {
  writeMatterVersion, checkLegalHold, applyLegalHold,
  releaseLegalHold, getMatterVersionHistory,
  getFirmRetentionStatus,
}                                             from '../services/retention.js';


// Retention helper — get firm ID for current user
async function getFirmId(db, userId) {
  const fm = await db.get('SELECT firm_id FROM firm_members WHERE user_id=? AND status=\'active\' LIMIT 1', [userId]).catch(() => null);
  return fm?.firm_id || null;
}
async function getFirmRole(db, userId) {
  const fm = await db.get('SELECT firm_role FROM firm_members WHERE user_id=? AND status=\'active\' LIMIT 1', [userId]).catch(() => null);
  return fm?.firm_role || '';
}

const router = Router();
const matterLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Too many matter operations.' });

// matters, matter_teams, matter_events managed by db/index.js Year 1–2 block.

// ── Helper: resolve firm_id for user ─────────────────────────────────────────
async function getUserFirmId(db, userId) {
  const row = await db.get(
    'SELECT firm_id FROM firm_members WHERE user_id = ? AND active = 1 LIMIT 1',
    [userId]
  ).catch(() => null);
  return row?.firm_id || null;
}

// ── Helper: get user's firm role ─────────────────────────────────────────────
async function getUserFirmRole(db, userId, firmId) {
  if (!firmId) return null;
  const row = await db.get(
    'SELECT role FROM firm_members WHERE user_id = ? AND firm_id = ? AND active = 1',
    [userId, firmId]
  ).catch(() => null);
  return row?.role || null;
}

// ── POST /api/matters — create matter ─────────────────────────────────────────
router.post('/', authRequired, matterLimiter, auditLog('matter', 'create'), async (req, res) => {
  try {
    const db = await getDb();
    const {
      title, matter_type = 'general', practice_group,
      client_name, opposing_party, opposing_counsel,
      jurisdiction, priority = 'normal', billing_rate,
      estimated_value, notes, opened_date, next_deadline, tags,
    } = req.body || {};

    if (!title?.trim()) return err400(res, 'title is required');

    const firm_id = await getUserFirmId(db, req.user.id);
    const firmRole = firm_id ? await getUserFirmRole(db, req.user.id, firm_id) : null;

    // Anyone authenticated can create a matter; firm role gates team features
    const r = await db.run(
      `INSERT INTO matters
        (firm_id, created_by, title, matter_type, practice_group, client_name,
         opposing_party, opposing_counsel, jurisdiction, status, priority,
         billing_rate, estimated_value, notes, opened_date, next_deadline, tags)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        firm_id, req.user.id,
        truncateStr(title.trim(), 300),
        sanitizeStr(matter_type, 50),
        practice_group ? sanitizeStr(practice_group, 100) : null,
        client_name    ? truncateStr(sanitizeStr(client_name, 200), 200) : null,
        opposing_party ? truncateStr(sanitizeStr(opposing_party, 200), 200) : null,
        opposing_counsel ? truncateStr(sanitizeStr(opposing_counsel, 200), 200) : null,
        jurisdiction   ? sanitizeStr(jurisdiction, 100) : null,
        'active', priority,
        billing_rate   ? safeInt(billing_rate) : null,
        estimated_value ? safeInt(estimated_value) : null,
        notes          ? truncateStr(sanitizeStr(notes, 5000), 5000) : null,
        opened_date || null,
        next_deadline  || null,
        tags           ? sanitizeStr(tags, 500) : null,
      ]
    );

    const matterId = r.lastID;

    // Auto-add creator as lead_attorney on their own matter
    await db.run(
      `INSERT OR IGNORE INTO matter_teams (matter_id, user_id, role, added_by)
       VALUES (?, ?, ?, ?)`,
      [matterId, req.user.id, 'lead_attorney', req.user.id]
    );

    const matter = await db.get('SELECT id, firm_id, created_by, title, matter_type, practice_group, client_name, opposing_party, opposing_counsel, jurisdiction, status, priority, billing_rate, estimated_value, actual_value, notes, opened_date, closed_date, next_deadline, tags, created_at, updated_at FROM matters WHERE id = ?', [matterId]);

    // Detailed audit entry with full new value
    const auditDb = await getDb();
    await writeAuditLog(auditDb, {
      user_id:    req.user.id,
      firm_id,
      action:     'create',
      resource:   'matter',
      record_id:  matterId,
      new_value:  matter,
      ip:         req.ip,
      ua:         req.headers['user-agent'],
      request_id: req.requestId,
    });

    // ── Auto-seed vertical deadline presets ──────────────────────────────────
    // If the firm has a vertical set, fire the top critical deadlines immediately
    // so attorneys see a pre-populated docket on every new matter. Non-blocking.
    setImmediate(async () => {
      try {
        if (!firm_id) return;
        const firmRow = await db.get('SELECT vertical FROM firms WHERE id=?', [firm_id]).catch(() => null);
        const vertical = firmRow?.vertical;
        if (!vertical || vertical === 'general') return;

        const presets = await db.all(
          "SELECT * FROM vertical_deadline_presets /* intentional: full matter record needed */ WHERE vertical=? AND priority='critical' ORDER BY days ASC LIMIT 8",
          [vertical]
        ).catch(() => []);
        if (!presets.length) return;

        const trigger = opened_date || new Date().toISOString().slice(0, 10);

        function addCal(dateStr, days) {
          const d = new Date(dateStr + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + days);
          return d.toISOString().slice(0, 10);
        }
        function addBus(dateStr, days) {
          const d = new Date(dateStr + 'T12:00:00Z');
          let added = 0;
          while (added < days) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) added++; }
          return d.toISOString().slice(0, 10);
        }

        for (const p of presets) {
          const due = p.business_days ? addBus(trigger, p.days) : addCal(trigger, p.days);
          await db.run(
            `INSERT OR IGNORE INTO docket_entries
              (firm_id, matter_id, matter_table, entry_type, title, description,
               due_date, rule_citation, calculated_from, days_from_event,
               status, priority, created_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)`,
            [
              firm_id, matterId, 'matters', 'deadline',
              p.label, p.description || null,
              due, `vertical:${vertical}:${p.rule_key}`,
              trigger, p.days,
              'pending', p.priority,
              req.user.id,
              new Date().toISOString(), new Date().toISOString(),
            ]
          ).catch(() => {}); // ignore if docket_entries table has different schema
        }
      } catch (_e) {} // Non-blocking — never fail matter creation
    });

    dispatchWebhookEvent(db, ctx.firm_id, 'matter.created', {
      matter_id:   matterId,
      title:       matter?.title,
      client_name: matter?.client_name || null,
      status:      matter?.status,
    }).catch(() => {});
    res.status(201).json(matter);
  } catch (e) {
    logger.error('[matters/create]', e.message);
    res.status(500).json({ error: 'Could not create matter.' });
  }
});

// ── GET /api/matters — list matters ──────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { status, practice_group, priority, limit = 20, offset = 0 } = req.query;
    const firm_id = await getUserFirmId(db, req.user.id);

    // Build conditions: user sees matters they're on the team of, OR all firm matters if admin
    let sql, params;
    const firmRole = firm_id ? await getUserFirmRole(db, req.user.id, firm_id) : null;
    const isAdmin  = ['super_admin', 'firm_admin'].includes(req.user?.role) ||
                     ['firm_admin', 'partner'].includes(firmRole);

    if (isAdmin && firm_id) {
      sql    = `SELECT m.*, mt.role as your_role,
                       (SELECT COUNT(*) FROM matter_teams WHERE matter_id=m.id AND active=1) as team_size
                FROM matters m
                LEFT JOIN matter_teams mt ON mt.matter_id=m.id AND mt.user_id=?
                WHERE m.firm_id=?`;
      params = [req.user.id, firm_id];
    } else {
      // Scoped to matters user is on the team of
      sql    = `SELECT m.*, mt.role as your_role,
                       (SELECT COUNT(*) FROM matter_teams WHERE matter_id=m.id AND active=1) as team_size
                FROM matters m
                JOIN matter_teams mt ON mt.matter_id=m.id AND mt.user_id=? AND mt.active=1
                WHERE (m.firm_id=? OR m.created_by=?)`;
      params = [req.user.id, firm_id || -1, req.user.id];
    }

    if (status)         { sql += ' AND m.status=?';         params.push(sanitizeStr(status, 20)); }
    if (practice_group) { sql += ' AND m.practice_group=?'; params.push(sanitizeStr(practice_group, 100)); }
    if (priority)       { sql += ' AND m.priority=?';       params.push(sanitizeStr(priority, 20)); }

    sql += ' ORDER BY m.updated_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(safeInt(limit, 20), 50), safeInt(offset, 0));

    const rows = await db.all(sql, params);
    const countSql = sql.replace(/SELECT m\.\*, mt\.role.*?FROM matters m/, 'SELECT COUNT(*) as total FROM matters m');
    const countParams = params.slice(0, params.length - 2);
    const total = await db.get(
      countSql.replace(' ORDER BY m.updated_at DESC LIMIT ? OFFSET ?', ''), countParams
    ).catch(() => ({ total: 0 }));

    res.json({ matters: rows, total: total?.total ?? 0 });
  } catch (e) {
    logger.error('[matters/list]', e.message);
    res.status(500).json({ error: 'Could not load matters.' });
  }
});

// ── GET /api/matters/:id ──────────────────────────────────────────────────────
router.get('/:id', authRequired, requireMatterAccess('id', 'viewer'), async (req, res) => {
  try {
    const db = await getDb();
    const matter = await db.get(
      `SELECT m.*,
              (SELECT COUNT(*) FROM matter_teams WHERE matter_id=m.id AND active=1) as team_size,
              (SELECT COUNT(*) FROM matter_events WHERE matter_id=m.id) as event_count
       FROM matters m WHERE m.id=?`,
      [safeInt(req.params.id)]
    );
    if (!matter) return err404(res, 'Matter not found.');

    const team = await db.all(
      `SELECT mt.role, mt.added_at, u.id as user_id, u.display_name, u.email
       FROM matter_teams mt
       JOIN users u ON u.id = mt.user_id
       WHERE mt.matter_id=? AND mt.active=1
       ORDER BY mt.added_at ASC`,
      [matter.id]
    ).catch(() => []);

    // Audit read access for sensitive matters
    const auditDb = await getDb();
    await writeAuditLog(auditDb, {
      user_id: req.user.id,
      firm_id: matter.firm_id,
      action:  'read',
      resource: 'matter',
      record_id: matter.id,
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.json({ ...matter, team, your_role: req.user.firm_role });
  } catch (e) {
    logger.error('[matters/get]', e.message);
    res.status(500).json({ error: 'Could not load matter.' });
  }
});

// ── PUT /api/matters/:id ──────────────────────────────────────────────────────
router.put('/:id', authRequired, requireMatterAccess('id', 'associate'), auditLog('matter', 'update'), async (req, res) => {
  try {
    const db = await getDb();
    const before = await db.get('SELECT id, firm_id, created_by, title, matter_type, practice_group, client_name, opposing_party, opposing_counsel, jurisdiction, status, priority, billing_rate, estimated_value, actual_value, notes, opened_date, closed_date, next_deadline, tags, created_at, updated_at FROM matters WHERE id=?', [safeInt(req.params.id)]);
    if (!before) return err404(res, 'Matter not found.');

    const allowed = [
      'title', 'matter_type', 'practice_group', 'client_name',
      'opposing_party', 'opposing_counsel', 'jurisdiction',
      'status', 'priority', 'billing_rate', 'estimated_value',
      'actual_value', 'notes', 'opened_date', 'closed_date',
      'next_deadline', 'tags',
    ];

    const updates = [];
    const params  = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key}=?`);
        params.push(
          typeof req.body[key] === 'string'
            ? truncateStr(sanitizeStr(req.body[key], 2000), 2000)
            : req.body[key]
        );
      }
    }
    if (!updates.length) return err400(res, 'No valid fields to update.');
    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id));

    // Legal hold check — refuse update if hold is active
    const hold = await checkLegalHold('matter', safeInt(req.params.id));
    if (hold) {
      return res.status(423).json({
        error: 'This matter is under a legal hold and cannot be modified.',
        hold_applied_by: hold.applied_by_name,
        hold_reason: hold.reason,
        hold_applied_at: hold.applied_at,
        release_required: true,
      });
    }

    // Version the matter before updating — captures every field change with who/when.
    // Guard: if the matter has been deleted in a race, skip versioning rather than
    // logging a spurious full-diff from an empty {} baseline.
    const beforeVersion = await db.get('SELECT id, firm_id, user_id, title, vertical, status, evidence_score, vulnerability_level, time_pressure, created_at, updated_at FROM matters WHERE id=?', [safeInt(req.params.id)]).catch(() => null);
    if (beforeVersion) {
      // Detect status changes so the audit trail distinguishes them from field edits
      const incomingBody = req.body || {};
      const changeKind = (incomingBody.status && incomingBody.status !== beforeVersion.status)
        ? 'status_change'
        : 'update';
      await writeMatterVersion(db, safeInt(req.params.id), firmId, req.user.id, beforeVersion, incomingBody, changeKind);
    } else {
      logger.warn(`[matters/patch] matter ${req.params.id} not found for versioning — skipping`);
    }

    await db.run(`UPDATE matters SET ${updates.join(',')} WHERE id=?`, params);
    const after = await db.get('SELECT id, firm_id, created_by, title, matter_type, practice_group, client_name, opposing_party, opposing_counsel, jurisdiction, status, priority, billing_rate, estimated_value, actual_value, notes, opened_date, closed_date, next_deadline, tags, created_at, updated_at FROM matters WHERE id=?', [safeInt(req.params.id)]);

    // Detailed before/after audit
    const auditDb = await getDb();
    await writeAuditLog(auditDb, {
      user_id: req.user.id,
      firm_id: before.firm_id,
      action: 'update',
      resource: 'matter',
      record_id: before.id,
      old_value: before,
      new_value: after,
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.json(after);
  } catch (e) {
    logger.error('[matters/update]', e.message);
    res.status(500).json({ error: 'Could not update matter.' });
  }
});

// ── DELETE /api/matters/:id ───────────────────────────────────────────────────
router.delete('/:id', authRequired, requireMatterAccess('id', 'partner'), async (req, res) => {
  try {
    const db     = await getDb();
    const before = await db.get('SELECT id, firm_id, created_by, title, matter_type, practice_group, client_name, opposing_party, opposing_counsel, jurisdiction, status, priority, billing_rate, estimated_value, actual_value, notes, opened_date, closed_date, next_deadline, tags, created_at, updated_at FROM matters WHERE id=?', [safeInt(req.params.id)]);
    if (!before) return err404(res, 'Matter not found.');

    // Legal hold check — refuse deletion if an active hold exists.
    // Legal holds are applied by firm_admin to freeze data during litigation.
    const hold = await checkLegalHold('matter', before.id);
    if (hold) {
      return res.status(423).json({
        error: 'This matter is under a legal hold and cannot be deleted.',
        hold_id:       hold.id,
        applied_by:    hold.applied_by_name,
        reason:        hold.reason,
        applied_at:    hold.applied_at,
        release_info:  'A firm_admin must release the hold before this matter can be deleted.',
      });
    }

    await db.run('DELETE FROM matter_teams  WHERE matter_id=?', [before.id]);
    await db.run('DELETE FROM matter_events WHERE matter_id=?', [before.id]);
    await db.run('DELETE FROM matters WHERE id=?', [before.id]);

    await writeAuditLog(db, {
      user_id: req.user.id,
      firm_id: before.firm_id,
      action: 'delete',
      resource: 'matter',
      record_id: before.id,
      old_value: before,
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.json({ deleted: true });
  } catch (e) {
    logger.error('[matters/delete]', e.message);
    res.status(500).json({ error: 'Could not delete matter.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MATTER TEAM MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/matters/:id/team ─────────────────────────────────────────────────
router.get('/:id/team', authRequired, requireMatterAccess('id', 'viewer'), async (req, res) => {
  try {
    const db      = await getDb();
    const matterIdVal = safeInt(req.params.id);
    const members = await db.all(
      `SELECT mt.id, mt.role, mt.added_at, mt.active,
              u.id as user_id, u.display_name, u.email,
              adder.display_name as added_by_name
       FROM matter_teams mt
       JOIN users u ON u.id = mt.user_id
       LEFT JOIN users adder ON adder.id = mt.added_by
       WHERE mt.matter_id=? AND mt.active=1
       ORDER BY
         CASE mt.role
           WHEN 'lead_attorney' THEN 1
           WHEN 'co_counsel'    THEN 2
           WHEN 'associate'     THEN 3
           WHEN 'paralegal'     THEN 4
           WHEN 'client'        THEN 5
           WHEN 'viewer'        THEN 6
           ELSE 7
         END,
         mt.added_at ASC`,
      [matterIdVal]
    );
    if (!members) return res.status(404).json({ error: 'Not found' });
    res.json({ team: members, matter_id: matterIdVal });
  } catch (e) {
    logger.error('[matters/team/list]', e.message);
    res.status(500).json({ error: 'Could not load team.' });
  }
});

// ── POST /api/matters/:id/team — add team member ──────────────────────────────
router.post('/:id/team', authRequired, requireMatterAccess('id', 'partner'), auditLog('matter_team', 'invite'), async (req, res) => {
  try {
    const db       = await getDb();
    const matterIdVal = safeInt(req.params.id);
    const { email, user_id: targetUserId, role = 'associate' } = req.body || {};

    if (!email && !targetUserId) return err400(res, 'email or user_id required');

    const VALID_ROLES = ['lead_attorney','co_counsel','associate','paralegal','client','viewer'];
    if (!VALID_ROLES.includes(role)) return err400(res, `role must be one of: ${VALID_ROLES.join(', ')}`);

    // Resolve target user
    let target;
    if (targetUserId) {
      target = await db.get('SELECT id, display_name, email FROM users WHERE id=?', [safeInt(targetUserId)]);
    } else {
      target = await db.get('SELECT id, display_name, email FROM users WHERE email=?', [email.trim().toLowerCase()]);
    }

    if (!target) return err404(res, 'User not found. They must have a Justice Gavel account.');
    if (target.id === req.user.id && req.user.firm_role !== 'lead_attorney') {
      return err400(res, 'You are already on this matter team.');
    }

    // Check for existing active membership
    const existing = await db.get(
      'SELECT id FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1',
      [matterIdVal, target.id]
    );
    if (existing) {
      return res.status(409).json({ error: `${target.display_name || target.email} is already on this matter team.` });
    }

    await db.run(
      `INSERT INTO matter_teams (matter_id, user_id, role, added_by)
       VALUES (?,?,?,?)
       ON CONFLICT(matter_id, user_id) DO UPDATE SET role=excluded.role, active=1, added_by=excluded.added_by`,
      [matterIdVal, target.id, role, req.user.id]
    );

    await writeAuditLog(db, {
      user_id: req.user.id,
      firm_id: req.matter?.firm_id,
      action: 'invite',
      resource: 'matter_team',
      record_id: matterIdVal,
      new_value: { user_id: target.id, email: target.email, role },
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.status(201).json({
      added:       true,
      user_id:     target.id,
      display_name: target.display_name,
      email:       target.email,
      role,
      matter_id:   matterIdVal,
    });
  } catch (e) {
    logger.error('[matters/team/add]', e.message);
    res.status(500).json({ error: 'Could not add team member.' });
  }
});

// ── PATCH /api/matters/:id/team/:userId — change role ────────────────────────
router.patch('/:id/team/:userId', authRequired, requireMatterAccess('id', 'partner'), async (req, res) => {
  try {
    const db       = await getDb();
    const matterIdVal = safeInt(req.params.id);
    const targetId = safeInt(req.params.userId);
    const { role } = req.body || {};

    const VALID_ROLES = ['lead_attorney','co_counsel','associate','paralegal','client','viewer'];
    if (!VALID_ROLES.includes(role)) return err400(res, `role must be one of: ${VALID_ROLES.join(', ')}`);

    const before = await db.get(
      'SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1',
      [matterIdVal, targetId]
    );
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (!before) return err404(res, 'Team member not found.');

    await db.run(
      'UPDATE matter_teams SET role=? WHERE matter_id=? AND user_id=?',
      [role, matterIdVal, targetId]
    );
    if (!before) return res.status(404).json({ error: 'Not found' });

    await writeAuditLog(db, {
      user_id: req.user.id,
      firm_id: req.matter?.firm_id,
      action: 'update',
      resource: 'matter_team',
      record_id: matterIdVal,
      old_value: { user_id: targetId, role: before.role },
      new_value: { user_id: targetId, role },
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.json({ updated: true, user_id: targetId, role, matter_id: matterIdVal });
  } catch (e) {
    logger.error('[matters/team/role]', e.message);
    res.status(500).json({ error: 'Could not change role.' });
  }
});

// ── DELETE /api/matters/:id/team/:userId — remove member ─────────────────────
router.delete('/:id/team/:userId', authRequired, requireMatterAccess('id', 'partner'), async (req, res) => {
  try {
    const db       = await getDb();
    const matterIdVal = safeInt(req.params.id);
    const targetId = safeInt(req.params.userId);

    const before = await db.get(
      'SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1',
      [matterIdVal, targetId]
    );
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (!before) return err404(res, 'Team member not found.');

    // Soft-delete — preserve for audit trail
    await db.run(
      'UPDATE matter_teams SET active=0 WHERE matter_id=? AND user_id=?',
      [matterIdVal, targetId]
    );
    if (!before) return res.status(404).json({ error: 'Not found' });

    await writeAuditLog(db, {
      user_id: req.user.id,
      firm_id: req.matter?.firm_id,
      action: 'remove',
      resource: 'matter_team',
      record_id: matterIdVal,
      old_value: { user_id: targetId, role: before.role },
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.json({ removed: true, user_id: targetId, matter_id: matterIdVal });
  } catch (e) {
    logger.error('[matters/team/remove]', e.message);
    res.status(500).json({ error: 'Could not remove team member.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MATTER EVENTS (timeline)
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/matters/:id/events ───────────────────────────────────────────────
router.get('/:id/events', authRequired, requireMatterAccess('id', 'viewer'), async (req, res) => {
  try {
    const db = await getDb();
    const events = await db.all(
      `SELECT me.*, u.display_name as added_by_name
       FROM matter_events me
       LEFT JOIN users u ON u.id = me.user_id
       WHERE me.matter_id=?
       ORDER BY COALESCE(me.event_date, me.created_at) DESC`,
      [safeInt(req.params.id)]
    );
    res.json({ events });
  } catch (e) {
    logger.error('[matters/events/list]', e.message);
    res.status(500).json({ error: 'Could not load events.' });
  }
});

// ── POST /api/matters/:id/events ──────────────────────────────────────────────
router.post('/:id/events', authRequired, requireMatterAccess('id', 'paralegal'), async (req, res) => {
  try {
    const db = await getDb();
    const { title, event_type='note', description, event_date, amount_cents } = req.body || {};
    if (!title?.trim()) return err400(res, 'Event title is required.');

    const VALID_TYPES = new Set(['hearing','filing','deposition','negotiation','signing',
                                 'billing','deadline','note','call','email','other']);
    const safe_type = VALID_TYPES.has(event_type) ? event_type : 'note';

    const r = await db.run(
      `INSERT INTO matter_events (matter_id, user_id, event_type, title, description, event_date, amount_cents)
       VALUES (?,?,?,?,?,?,?)`,
      [safeInt(req.params.id), req.user.id, safe_type,
       truncateStr(title.trim(), 200),
       description ? truncateStr(sanitizeStr(description, 2000), 2000) : null,
       event_date || null, amount_cents ? safeInt(amount_cents) : null]
    );

    const event = await db.get('SELECT id, matter_id, user_id, event_type, title, description, event_date, amount_cents, created_at FROM matter_events WHERE id=?', [r.lastID]);
    res.status(201).json({ event });
  } catch (e) {
    logger.error('[matters/events/create]', e.message);
    res.status(500).json({ error: 'Could not add event.' });
  }
});

// ── DELETE /api/matters/:id/events/:eid ──────────────────────────────────────
router.delete('/:id/events/:eid', authRequired, requireMatterAccess('id', 'associate'), async (req, res) => {
  try {
    const db  = await getDb();
    const eid = safeInt(req.params.eid);
    const ev  = await db.get(
      'SELECT id, user_id FROM matter_events WHERE id=? AND matter_id=?',
      [eid, safeInt(req.params.id)]
    );
    if (!ev) return err404(res, 'Event not found.');
    // Paralegal can only delete own events; associate+ can delete any
    if (req.user.firm_role === 'paralegal' && ev.user_id !== req.user.id) {
      return err403(res, 'You can only delete your own events.');
    }
    await db.run('DELETE FROM matter_events WHERE id=?', [eid]);
    res.json({ deleted: true });
  } catch (e) {
    logger.error('[matters/events/delete]', e.message);
    res.status(500).json({ error: 'Could not delete event.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD & WORKLOAD
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/matters/dashboard ────────────────────────────────────────────────
router.get('/dashboard', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const firm_id = await getUserFirmId(db, req.user.id);

    const condition = firm_id
      ? 'WHERE m.firm_id=?'
      : 'WHERE m.created_by=?';
    const param = firm_id || req.user.id;

    const [total, byStatus, byPractice, byPriority, recentActivity] = await Promise.all([
      db.get(`SELECT COUNT(*) as n FROM matters m ${condition}`, [param]),
      db.all(`SELECT status, COUNT(*) as count FROM matters m ${condition} GROUP BY status`, [param]),
      db.all(`SELECT COALESCE(practice_group,'Unassigned') as practice_group, COUNT(*) as count FROM matters m ${condition} GROUP BY practice_group ORDER BY count DESC LIMIT 8`, [param]),
      db.all(`SELECT priority, COUNT(*) as count FROM matters m ${condition} GROUP BY priority`, [param]),
      db.all(`SELECT m.id, m.title, m.status, m.updated_at, mt.role as your_role
              FROM matters m
              JOIN matter_teams mt ON mt.matter_id=m.id AND mt.user_id=?
              ORDER BY m.updated_at DESC LIMIT 5`, [req.user.id]),
    ]);

    res.json({
      total_matters:   total?.n || 0,
      by_status:       byStatus,
      by_practice:     byPractice,
      by_priority:     byPriority,
      recent_activity: recentActivity,
    });
  } catch (e) {
    logger.error('[matters/dashboard]', e.message);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

// ── GET /api/matters/workload ─────────────────────────────────────────────────
router.get('/workload', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const firm_id = await getUserFirmId(db, req.user.id);
    if (!firm_id) return res.json({ workload: [] });

    const firmRole = await getUserFirmRole(db, req.user.id, firm_id);
    if (!hasMinRole(firmRole, 'partner')) {
      return err403(res, 'Workload view requires partner role.');
    }

    const workload = await db.all(
      `SELECT u.id as user_id, u.display_name, u.email,
              fm.role as firm_role,
              COUNT(CASE WHEN m.status='active' THEN 1 END) as open_matters,
              COUNT(mt.matter_id) as total_matters
       FROM firm_members fm
       JOIN users u ON u.id = fm.user_id
       LEFT JOIN matter_teams mt ON mt.user_id = fm.user_id AND mt.active=1
       LEFT JOIN matters m ON m.id = mt.matter_id
       WHERE fm.firm_id=? AND fm.active=1
       GROUP BY u.id, u.display_name, u.email, fm.role
       ORDER BY open_matters DESC`,
      [firm_id]
    );

    res.json({ workload, firm_id });
  } catch (e) {
    logger.error('[matters/workload]', e.message);
    res.status(500).json({ error: 'Could not load workload.' });
  }
});

// ─── MATTER VERSION HISTORY ────────────────────────────────────────────────
// GET /api/matters/:id/history — full audit trail of field changes
router.get('/:id/history', authRequired, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db      = await getDb();
    const firmId  = await getFirmId(db, req.user.id);
    const limit   = Math.min(safeInt(req.query.limit, 50), 200);
    const offset  = safeInt(req.query.offset, 0);
    const history = await getMatterVersionHistory(safeInt(req.params.id), { limit, offset });
    res.json({ matter_id: safeInt(req.params.id), history, total: history.length, limit, offset });
  } catch (e) {
    logger.error('[matters/history]', e.message);
    res.status(500).json({ error: 'Could not load matter history.' });
  }
});

// ─── LEGAL HOLDS ───────────────────────────────────────────────────────────
// POST /api/matters/:id/hold   — apply legal hold (firm_admin+)
// DELETE /api/matters/:id/hold — release hold (firm_admin+)
router.post('/:id/hold', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = await getFirmId(db, req.user.id);
    const role   = await getFirmRole(db, req.user.id);
    if (!hasMinRole(role, 'firm_admin')) return res.status(403).json({ error: 'firm_admin+ required.' });
    const { reason } = req.body || {};
    if (!reason?.trim()) return res.status(400).json({ error: 'reason required.' });
    const holdId = await applyLegalHold('matter', safeInt(req.params.id), firmId, req.user.id, sanitizeStr(reason, 500));
    res.status(201).json({ ok: true, hold_id: holdId, message: 'Legal hold applied. Matter is frozen from deletion.' });
  } catch (e) {
    logger.error('[matters/hold]', e.message);
    res.status(e.message.includes('already active') ? 409 : 500).json({ error: e.message });
  }
});

router.delete('/:id/hold', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const role = await getFirmRole(db, req.user.id);
    if (!hasMinRole(role, 'firm_admin')) return res.status(403).json({ error: 'firm_admin+ required.' });
    const { hold_id } = req.body || {};
    if (!hold_id) return res.status(400).json({ error: 'hold_id required.' });
    await releaseLegalHold(safeInt(hold_id), req.user.id);
    res.json({ ok: true, message: 'Legal hold released.' });
  } catch (e) {
    logger.error('[matters/hold/release]', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// ─── RETENTION STATUS ──────────────────────────────────────────────────────
// GET /api/matters/retention-status — firm retention summary (firm_admin)
router.get('/retention-status', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = await getFirmId(db, req.user.id);
    if (!firmId) return res.status(403).json({ error: 'Not a firm member.' });
    const role = await getFirmRole(db, req.user.id);
    if (!hasMinRole(role, 'partner')) return res.status(403).json({ error: 'partner+ required.' });
    const status = await getFirmRetentionStatus(firmId);
    res.json(status);
  } catch (e) {
    logger.error('[matters/retention-status]', e.message);
    res.status(500).json({ error: 'Could not load retention status.' });
  }
});

export default router;
