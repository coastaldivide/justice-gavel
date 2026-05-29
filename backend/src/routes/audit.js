/**
 * routes/audit.js — Audit log query endpoints
 *
 * GET /api/audit/me           — current user's own audit trail
 * GET /api/audit/matter/:id   — audit trail for a specific matter (partner+)
 * GET /api/audit/contract/:id — audit trail for a specific contract (partner+)
 * GET /api/audit/user/:id     — specific user's activity (firm_admin+)
 * GET /api/audit/firm         — firm-wide audit log (partner+) — alias for /firms/:id/audit
 */

import { err403, err404, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { Router }                                from 'express';
import { authRequired }                          from '../middleware/auth.js';
import { getDb }                                 from '../db/index.js';
import logger                                    from '../utils/logger.js';
import { getAuditLog, ensureAuditTable }         from '../middleware/audit.js';
import { hasMinRole }                            from '../middleware/rbac.js';
import { apiLimiter, writeLimiter, aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// ── Helper: get user's firm membership role ───────────────────────────────────
async function getFirmRole(db, userId) {
  const row = await db.get(
    'SELECT firm_id, role FROM firm_members WHERE user_id=? AND active=1',
    [userId]
  ).catch(() => null);
  return row;
}

// ── GET /api/audit/me — own activity ─────────────────────────────────────────
router.get('/me', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    await ensureAuditTable(db);
    const { limit = 30, offset = 0, resource, action, since } = req.query;

    const result = await getAuditLog(db, {
      user_id:  req.user.id,
      resource: resource ? sanitizeStr(resource, 50) : null,
      action:   action   ? sanitizeStr(action, 50)   : null,
      since:    since    ? sanitizeStr(since, 30)     : null,
      limit:    Math.min(safeInt(limit, 30), 100),
      offset:   safeInt(offset, 0),
    });

    res.json(result);
  } catch (e) {
    logger.error('[audit/me]', e.message);
    res.status(500).json({ error: 'Could not load audit trail.' });
  }
});

// ── GET /api/audit/matter/:id ─────────────────────────────────────────────────
router.get('/matter/:id', authRequired, apiLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    await ensureAuditTable(db);
    const matterId = safeInt(req.params.id);

    // Verify user is on the matter team or is firm admin
    const onTeam = await db.get(
      `SELECT mt.role FROM matter_teams mt WHERE mt.matter_id=? AND mt.user_id=? AND mt.active=1`,
      [matterId, req.user.id]
    ).catch(() => null);

    const firmRole = await getFirmRole(db, req.user.id);
    const isAdmin  = ['super_admin','firm_admin'].includes(req.user?.role) ||
                     ['firm_admin'].includes(firmRole?.role);

    if (!onTeam && !isAdmin) {
      return err403(res, 'Not a member of this matter team.');
    }

    if (!hasMinRole(onTeam?.role || firmRole?.role || 'viewer', 'partner') && !isAdmin) {
      return err403(res, 'Audit log requires partner role or higher.');
    }

    const { limit = 50, offset = 0, action } = req.query;
    const result = await getAuditLog(db, {
      resource:  'matter',
      record_id: matterId,
      action:    action ? sanitizeStr(action, 50) : null,
      limit:     Math.min(safeInt(limit, 50), 200),
      offset:    safeInt(offset, 0),
    });

    res.json({ ...result, matter_id: matterId });
  } catch (e) {
    logger.error('[audit/matter]', e.message);
    res.status(500).json({ error: 'Could not load audit trail.' });
  }
});

// ── GET /api/audit/contract/:id ───────────────────────────────────────────────
router.get('/contract/:id', authRequired, apiLimiter, async (req, res) => {
  try {
    const db         = await getDb();
    await ensureAuditTable(db);
    const contractId = safeInt(req.params.id);

    // Contract must belong to the requesting user or their firm
    const contract = await db.get(
      'SELECT id, user_id FROM contracts WHERE id=?',
      [contractId]
    ).catch(() => null);

    if (!contract) return err404(res, 'Contract not found.');

    const firmRole = await getFirmRole(db, req.user.id);
    const isOwner  = contract.user_id === req.user.id;
    const isFirmAdmin = ['firm_admin'].includes(firmRole?.role);

    if (!isOwner && !isFirmAdmin) {
      return err403(res, 'Access denied to contract audit log.');
    }

    const { limit = 30, offset = 0 } = req.query;
    const result = await getAuditLog(db, {
      resource:  'contract',
      record_id: contractId,
      limit:     Math.min(safeInt(limit, 30), 100),
      offset:    safeInt(offset, 0),
    });

    res.json({ ...result, contract_id: contractId });
  } catch (e) {
    logger.error('[audit/contract]', e.message);
    res.status(500).json({ error: 'Could not load audit trail.' });
  }
});

// ── GET /api/audit/user/:id — specific user's activity (firm_admin+) ─────────
router.get('/user/:id', authRequired, apiLimiter, async (req, res) => {
  try {
    const db       = await getDb();
    await ensureAuditTable(db);
    const targetId = safeInt(req.params.id);

    const firmRole = await getFirmRole(db, req.user.id);
    const isSelf   = targetId === req.user.id;
    const isAdmin  = ['super_admin','firm_admin'].includes(req.user?.role) ||
                     hasMinRole(firmRole?.role, 'firm_admin');

    if (!isSelf && !isAdmin) {
      return err403(res, 'Can only view your own audit trail unless you are a firm admin.');
    }

    // Verify target user is in same firm
    if (!isSelf && firmRole) {
      const targetFirm = await db.get(
        'SELECT firm_id FROM firm_members WHERE user_id=? AND active=1',
        [targetId]
      ).catch(() => null);
      if (!targetFirm || targetFirm.firm_id !== firmRole.firm_id) {
        return err403(res, 'Target user is not in your firm.');
      }
    }

    const { limit = 50, offset = 0, resource, action, since } = req.query;
    const result = await getAuditLog(db, {
      user_id:  targetId,
      resource: resource ? sanitizeStr(resource, 50) : null,
      action:   action   ? sanitizeStr(action, 50)   : null,
      since:    since    ? sanitizeStr(since, 30)     : null,
      limit:    Math.min(safeInt(limit, 50), 200),
      offset:   safeInt(offset, 0),
    });

    res.json({ ...result, target_user_id: targetId });
  } catch (e) {
    logger.error('[audit/user]', e.message);
    res.status(500).json({ error: 'Could not load audit trail.' });
  }
});

// ── GET /api/audit/firm — firm-wide audit log ─────────────────────────────────
router.get('/firm', authRequired, apiLimiter, async (req, res) => {
  try {
    const db = await getDb();
    await ensureAuditTable(db);

    const firmRow = await getFirmRole(db, req.user.id);
    if (!firmRow) return err403(res, 'Not a member of any firm.');
    if (!hasMinRole(firmRow.role, 'partner')) return err403(res, 'Requires partner role or higher.');

    const { resource, action, user_id, limit = 50, offset = 0, since } = req.query;
    const result = await getAuditLog(db, {
      firm_id:  firmRow.firm_id,
      resource: resource ? sanitizeStr(resource, 50) : null,
      action:   action   ? sanitizeStr(action, 50)   : null,
      user_id:  user_id  ? safeInt(user_id)           : null,
      since:    since    ? sanitizeStr(since, 30)     : null,
      limit:    Math.min(safeInt(limit, 50), 200),
      offset:   safeInt(offset, 0),
    });

    res.json({ ...result, firm_id: firmRow.firm_id });
  } catch (e) {
    logger.error('[audit/firm]', e.message);
    res.status(500).json({ error: 'Could not load firm audit log.' });
  }
});

export default router;
