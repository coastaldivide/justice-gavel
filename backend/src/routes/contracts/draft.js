/**
 * contracts/draft.js — POST /api/contracts/draft
 *
 * Generates a new contract from structured fields using Claude.
 * Follows the same async-enqueue pattern as motions and discovery.
 *
 * POST /api/contracts/draft     — generate a new contract
 * GET  /api/contracts           — list user's contracts
 * GET  /api/contracts/:id       — get a specific contract
 * PUT  /api/contracts/:id       — update status or fields
 * DELETE /api/contracts/:id     — delete a contract
 * GET  /api/contracts/types     — list all available contract types
 */

import { err400, err401, err403, err404, err500, safeInt,
         sanitizeStr, truncateStr }          from '../../utils/routeHelpers.js';
import { Router }                             from 'express';
import { authRequired }                       from '../../middleware/auth.js';
import { getDb }                              from '../../db/index.js';
import { perUserAiLimit }                     from '../../middleware/sharedAiLimiter.js';
import { makeUserLimiter }                    from '../../middleware/sharedAiLimiter.js';
import { enqueue }                            from '../../services/aiQueue.js';
import logger                                 from '../../utils/logger.js';
import { ensureTables, generateContract,
         hasContractPro }                     from './_helpers.js';
import { CONTRACT_TYPES, getContractsByCategory } from './_contract_types.js';

const router = Router();

// Rate: 20 contract generations per hour per user
const draftLimiter = makeUserLimiter({
  windowMs: 3_600_000,
  max:      20,
  message:  'Contract generation limit reached. Try again later.',
});

// ── GET /api/contracts/types — list all contract types ────────────────────────
router.get('/types', authRequired, (req, res) => {
  const byCategory = getContractsByCategory();
  // Strip the verbose prompt_suffix from the response
  const clean = {};
  for (const [cat, types] of Object.entries(byCategory)) {
    clean[cat] = types.map(({ key, label, description, required, optional, tier_required }) => ({
      key, label, description, required, optional, tier_required,
    }));
  }
  res.json(clean);
});

// ── POST /api/contracts/draft — generate a new contract ──────────────────────
router.post('/draft', authRequired, draftLimiter, perUserAiLimit, async (req, res) => {
  try {
    const db = await getDb();
    const { contract_type, fields = {}, title } = req.body || {};

    if (!contract_type) return err400(res, 'contract_type is required');
    if (!CONTRACT_TYPES[contract_type]) return err400(res, `Unknown contract type: ${contract_type}`);

    const def = CONTRACT_TYPES[contract_type];

    // Check tier requirement
    if (def.tier_required) {
      const hasPro = await hasContractPro(db, req.user.id);
      if (!hasPro) {
        return res.status(402).json({
          error:         `This contract type requires Contract Pro subscription.`,
          code:          'subscription_required',
          tier_required: def.tier_required,
          upgrade_url:   '/billing/contract-pro',
        });
      }
    }

    // Validate required fields
    const missing = def.required.filter(f => !fields[f] || !String(fields[f]).trim());
    if (missing.length) {
      return err400(res, `Missing required fields: ${missing.join(', ')}`);
    }

    // Sanitize all text fields
    const safeFields = {};
    for (const [k, v] of Object.entries(fields)) {
      safeFields[k] = truncateStr(sanitizeStr(String(v), 500), 500);
    }

    const contractTitle = truncateStr(
      title || `${def.label} — ${safeFields.disclosing_party || safeFields.employer_name || safeFields.company_name || safeFields.buyer_name || safeFields.client_name || 'Draft'}`,
      200
    );

    const partyA = safeFields.disclosing_party || safeFields.employer_name || safeFields.company_name ||
                   safeFields.buyer_name       || safeFields.licensor_name || safeFields.landlord_name ||
                   safeFields.settling_party_1 || safeFields.assignor_name || null;
    const partyB = safeFields.receiving_party  || safeFields.employee_name || safeFields.contractor_name ||
                   safeFields.target_name      || safeFields.licensee_name || safeFields.tenant_name ||
                   safeFields.settling_party_2 || safeFields.assignee_name || null;

    const _uid   = req.user.id;
    const _type  = contract_type;
    const _title = contractTitle;
    const _flds  = safeFields;
    const _pA    = partyA;
    const _pB    = partyB;
    const _def   = def;

    const jobId = await enqueue('contract_draft', async () => {
      const draft = await generateContract(_type, _flds);

      const db2 = await getDb();
      const row = await db2.run(
        `INSERT INTO contracts
          (user_id, contract_type, title, party_a, party_b, fields, draft, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        [_uid, _type, _title, _pA, _pB, JSON.stringify(_flds), draft, 'draft']
      );

      return {
        ok:            true,
        id:            row.lastID,
        title:         _title,
        contract_type: _type,
        label:         _def.label,
        draft,
        status:        'draft',
        party_a:       _pA,
        party_b:       _pB,
      };
    });

    res.json({
      jobId,
      status:  'pending',
      async:   true,
      message: `Contract generation queued. Poll /api/jobs/${jobId} for the draft.`,
    });
  } catch (e) {
    logger.error('[contracts/draft]', e.message);
    res.status(500).json({ error: 'Contract generation failed. Please try again.' });
  }
});

// ── GET /api/contracts — list user's contracts ────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { status, contract_type, limit = 20, offset = 0 } = req.query;

    let sql    = `SELECT id, contract_type, title, party_a, party_b, status,
                         execution_date, expiry_date, renewal_date, value_cents, created_at
                  FROM contracts WHERE user_id=?`;
    const params = [req.user.id];

    if (status) { sql += ' AND status=?'; params.push(sanitizeStr(status, 20)); }
    if (contract_type) { sql += ' AND contract_type=?'; params.push(sanitizeStr(contract_type, 50)); }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Math.min(safeInt(limit, 20), 50), safeInt(offset, 0));

    const rows  = await db.all(sql, params);
    const total = await db.get(
      'SELECT COUNT(*) as n FROM contracts WHERE user_id=?', [req.user.id]
    );

    res.json({ contracts: rows, total: total.n, limit: safeInt(limit, 20) });
  } catch (e) {
    logger.error('[contracts/list]', e.message);
    res.status(500).json({ error: 'Could not load contracts.' });
  }
});

// ── GET /api/contracts/:id — get a specific contract with full draft ──────────
router.get('/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      `SELECT c.*,
              (SELECT COUNT(*) FROM contract_executions WHERE contract_id=c.id) as signer_count,
              (SELECT COUNT(*) FROM contract_reviews WHERE contract_id=c.id) as review_count
       FROM contracts c WHERE c.id=? AND c.user_id=?`,
      [safeInt(req.params.id), req.user.id]
    );
    if (!row) return err404(res, 'Contract not found.');

    // Parse JSON fields
    try { row.fields = JSON.parse(row.fields); } catch { row.fields = {}; }

    // Load execution status
    const signers = await db.all(
      'SELECT signer_name, signer_email, status, signed_at FROM contract_executions WHERE contract_id=?',
      [row.id]
    ).catch(() => []);

    res.json({ ...row, signers });
  } catch (e) {
    logger.error('[contracts/get]', e.message);
    res.status(500).json({ error: 'Could not load contract.' });
  }
});

// ── PUT /api/contracts/:id — update status, execution date, expiry ────────────
router.put('/:id', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const existing = await db.get(
      'SELECT id FROM contracts WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!existing) return err404(res, 'Contract not found.');

    const allowed = ['status','execution_date','expiry_date','renewal_date','value_cents','title'];
    const updates = [];
    const params  = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key}=?`);
        params.push(
          typeof req.body[key] === 'string'
            ? truncateStr(sanitizeStr(req.body[key], 200), 200)
            : req.body[key]
        );
      }
    }

    if (!updates.length) return err400(res, 'No valid fields to update.');

    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id), req.user.id);

    await db.run(
      `UPDATE contracts SET ${updates.join(',')} WHERE id=? AND user_id=?`,
      params
    );

    const updated = await db.get('SELECT id, user_id, contract_type, title, party_a, party_b, fields, draft, status, execution_date, expiry_date, renewal_date, value_cents, paid_cents, created_at, updated_at FROM contracts WHERE id=? LIMIT 1', [safeInt(req.params.id)]);
    try { updated.fields = JSON.parse(updated.fields); } catch { updated.fields = {}; }
    res.json(updated);
  } catch (e) {
    logger.error('[contracts/update]', e.message);
    res.status(500).json({ error: 'Could not update contract.' });
  }
});

// ── DELETE /api/contracts/:id ─────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await db.get(
      'SELECT id FROM contracts WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!existing) return err404(res, 'Contract not found.');

    await db.run('DELETE FROM contract_executions WHERE contract_id=?', [existing.id]);
    await db.run('DELETE FROM contract_reviews    WHERE contract_id=?', [existing.id]);
    await db.run('DELETE FROM contract_redlines   WHERE contract_id=?', [existing.id]);
    await db.run('DELETE FROM contracts WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]);

    res.json({ deleted: true });
  } catch (e) {
    logger.error('[contracts/delete]', e.message);
    res.status(500).json({ error: 'Could not delete contract.' });
  }
});

export default router;
