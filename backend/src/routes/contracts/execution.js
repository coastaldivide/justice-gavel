/**
 * contracts/execution.js — Contract execution and lifecycle tracking
 *
 * POST /api/contracts/:id/sign       — mark a party as having signed
 * GET  /api/contracts/:id/signers    — get all signers and their status
 * GET  /api/contracts/expiring       — contracts expiring in next 30/60/90 days
 * GET  /api/contracts/dashboard      — aggregate dashboard stats
 */

import { err400, err404, safeInt,
         sanitizeStr, truncateStr }  from '../../utils/routeHelpers.js';
import { Router }                     from 'express';
import { authRequired }               from '../../middleware/auth.js';
import { getDb }                      from '../../db/index.js';
import { makeUserLimiter }            from '../../middleware/sharedAiLimiter.js';
import logger                         from '../../utils/logger.js';
import { ensureTables }               from './_helpers.js';

const router = Router();

const signLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 100, message: 'Signature limit reached.' });

// ── POST /api/contracts/:id/sign ──────────────────────────────────────────────
router.post('/:id/sign', authRequired, signLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const contract = await db.get(
      'SELECT id, status FROM contracts WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!contract) return err404(res, 'Contract not found.');

    const { signer_name, signer_email, signature_method = 'in-app' } = req.body || {};
    if (!signer_name) return err400(res, 'signer_name is required.');

    const safeName   = truncateStr(sanitizeStr(String(signer_name), 100), 100);
    const safeEmail  = signer_email ? truncateStr(sanitizeStr(String(signer_email), 200), 200) : null;
    const safeMethod = ['in-app','docusign','wet-ink'].includes(signature_method) ? signature_method : 'in-app';

    // Check if this signer already signed
    const existing = await db.get(
      'SELECT id FROM contract_executions WHERE contract_id=? AND signer_name=? AND status=?',
      [contract.id, safeName, 'signed']
    );
    if (existing) {
      return res.status(409).json({ error: `${safeName} has already signed this contract.` });
    }

    await db.run(
      `INSERT INTO contract_executions
        (contract_id, user_id, signer_name, signer_email, signed_at, signature_method, status)
       VALUES (?,?,?,?,datetime('now'),?,?)`,
      [contract.id, req.user.id, safeName, safeEmail, safeMethod, 'signed']
    );

    // Check if all parties have signed — update contract status to 'executed'
    const signers = await db.all(
      "SELECT status FROM contract_executions WHERE contract_id=? AND status='signed'",
      [contract.id]
    );

    // If at least 2 parties signed, mark as executed
    if (signers.length >= 2 && contract.status !== 'executed') {
      await db.run(
        "UPDATE contracts SET status='executed', execution_date=date('now') WHERE id=?",
        [contract.id]
      );
    }

    res.json({ signed: true, signer_name: safeName, total_signers: signers.length });
  } catch (e) {
    logger.error('[contracts/sign]', e.message);
    res.status(500).json({ error: 'Could not record signature.' });
  }
});

// ── GET /api/contracts/:id/signers ────────────────────────────────────────────
router.get('/:id/signers', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const contract = await db.get(
      'SELECT id FROM contracts WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!contract) return err404(res, 'Contract not found.');

    const signers = await db.all(
      'SELECT signer_name, signer_email, status, signed_at, signature_method FROM contract_executions WHERE contract_id=? ORDER BY signed_at ASC',
      [contract.id]
    );
    res.json(signers);
  } catch (e) {
    res.status(500).json({ error: 'Could not load signers.' });
  }
});

// ── GET /api/contracts/expiring — contracts expiring in N days ────────────────
router.get('/expiring', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const days = Math.min(safeInt(req.query.days || '30'), 365);

    const rows = await db.all(
      `SELECT id, contract_type, title, party_a, party_b, status, expiry_date, renewal_date,
              CAST((julianday(expiry_date) - julianday('now')) AS INTEGER) as days_until_expiry
       FROM contracts
       WHERE user_id=?
         AND expiry_date IS NOT NULL
         AND expiry_date > date('now')
         AND expiry_date <= date('now', '+' || ? || ' days')
       ORDER BY expiry_date ASC`,
      [req.user.id, days]
    );

    res.json({ contracts: rows, window_days: days });
  } catch (e) {
    logger.error('[contracts/expiring]', e.message);
    res.status(500).json({ error: 'Could not load expiring contracts.' });
  }
});

// ── GET /api/contracts/dashboard — aggregate stats ───────────────────────────
router.get('/dashboard', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const [
      totalContracts,
      byStatus,
      byType,
      expiringCount,
      recentReviews,
      avgRisk,
    ] = await Promise.all([
      db.get('SELECT COUNT(*) as n FROM contracts WHERE user_id=?', [req.user.id]),
      db.all('SELECT status, COUNT(*) as count FROM contracts WHERE user_id=? GROUP BY status', [req.user.id]),
      db.all('SELECT contract_type, COUNT(*) as count FROM contracts WHERE user_id=? GROUP BY contract_type ORDER BY count DESC LIMIT 5', [req.user.id]),
      db.get(
        "SELECT COUNT(*) as n FROM contracts WHERE user_id=? AND expiry_date > date('now') AND expiry_date <= date('now','+30 days')",
        [req.user.id]
      ),
      db.all(
        'SELECT risk_level, COUNT(*) as count FROM contract_reviews WHERE user_id=? GROUP BY risk_level',
        [req.user.id]
      ),
      db.get('SELECT COUNT(*) as total, SUM(CASE WHEN risk_level IN (\'high\',\'critical\') THEN 1 ELSE 0 END) as high_risk FROM contract_reviews WHERE user_id=?', [req.user.id]),
    ]);

    res.json({
      total_contracts:  totalContracts.n,
      by_status:        byStatus,
      top_contract_types: byType,
      expiring_in_30_days: expiringCount.n,
      review_risk_breakdown: recentReviews,
      high_risk_reviews: avgRisk?.high_risk || 0,
      total_reviews:    avgRisk?.total || 0,
    });
  } catch (e) {
    logger.error('[contracts/dashboard]', e.message);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

export default router;
