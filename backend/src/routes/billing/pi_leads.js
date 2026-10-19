/**
 * billing/pi_leads.js — PI / Civil Rights lead marketplace — submit, browse, accept leads
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { logIgnored } from '../../utils/ignored.js';
import { billingLimiter } from './_shared.js';
import { err400, err404, safeInt } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { attorneyLeadFeeCents } from './attorneyLeadFee.js';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';
import { stripeConfigured, PAYMENTS_UNAVAILABLE } from '../../config.js';

const router = Router();

// C2: leads are browsed by attorney accounts only, with non-identifying fields;
// the description and the submitter's contact details are released only after a
// SUCCEEDED Stripe charge. req.user.* are live DB values (middleware/auth.js).
const ATTORNEY_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);
const isAttorney = (u) => ATTORNEY_ROLES.has(u?.role) || Number(u?.is_defender) === 1;
function requireLeadAttorney(req, res, next) {
  if (!isAttorney(req.user)) {
    return res.status(403).json({ error: 'attorney_required', message: 'Only attorney accounts can view case leads.' });
  }
  next();
}

// Flat fee per lead type — see billing/attorneyLeadFee.js (no severity tiering).
const piLeadFee = (caseType, severity) => attorneyLeadFeeCents(caseType, severity);

// ── Submit a PI/Civil Rights lead (from user who tapped "I Was Injured" or civil rights) ──
router.post('/pi-lead/submit', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const {
      case_type,      // 'Personal Injury' | 'Civil Rights' | 'Employment'
      incident_date,
      description,
      severity,       // 'minor' | 'moderate' | 'serious' | 'catastrophic'
      city,
      state,
      lat,
      lng,
    } = req.body;

    if (!case_type || !description) {
      return err400(res, 'case_type and description are required');
    }

    // pi_leads table managed by db/index.js

    const fee = piLeadFee(case_type, severity);
    const r = await db.run(
      `INSERT INTO pi_leads (user_id, case_type, incident_date, description, severity, city, state, lat, lng, lead_fee_cents)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, case_type, incident_date || null, description, severity || 'moderate',
       city || null, state || null, lat || null, lng || null, fee]
    );
    const lead = await db.get('SELECT id, case_type, incident_date, severity, city, state, lead_fee_cents, status, created_at FROM pi_leads WHERE id=? LIMIT 1', [r.lastID]);
    res.status(201).json({ ok: true, lead_id: r.lastID, lead });
  } catch (e) {
    logger.error('[pi-lead/submit]', e.message);
    res.status(500).json({ error: 'Could not submit lead' });
  }
});

// ── PI/Civil attorney views available leads in their area ──────────────────
router.get('/pi-leads', authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const db = await getDb();
    const { city, state, case_type } = req.query;
    const limit = Math.min(Math.max(safeInt(req.query.limit || 20), 1), 100);

    // Free-text description (it routinely contains names / phone numbers) is
    // never shown before a purchase — not even a prefix.
    let sql = `SELECT id, case_type, severity, city, state, lead_fee_cents, created_at,
                      CASE WHEN accepted_by = ? AND status = 'accepted' THEN incident_date ELSE NULL END AS incident_date,
                      CASE WHEN accepted_by = ? AND status = 'accepted' THEN description ELSE NULL END AS description,
                      CASE WHEN accepted_by = ? AND status = 'accepted' THEN 'accepted' ELSE status END AS display_status
               FROM pi_leads
               WHERE (status = 'open' OR accepted_by = ?)`;
    const params = [req.user.id, req.user.id, req.user.id, req.user.id];

    if (city)      { sql += ' AND city = ?';      params.push(city); }
    if (state)     { sql += ' AND state = ?';     params.push(state); }
    if (case_type) { sql += ' AND case_type = ?'; params.push(case_type); }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));

    const leads = await db.all(sql, params);
    res.json(leads);
  } catch (e) {
    logger.error('[pi-leads GET]', e.message);
    res.status(500).json({ error: 'Could not load leads' });
  }
});

// ── PI attorney accepts a lead — charges their saved payment method ─────────
router.post('/pi-lead/accept/:id', billingLimiter, authRequired, requireLeadAttorney, async (req, res) => {
  // Never reveal a lead without a completed charge (the router-level gate also
  // returns 503 without Stripe; this is defence in depth).
  if (!stripeConfigured()) return res.status(503).json({ ...PAYMENTS_UNAVAILABLE });
  if (Number(req.user.bar_verified) !== 1 && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'bar_verification_required', message: 'Verify your bar number before purchasing leads.' });
  }
  try {
    const db = await getDb();
    const lead = await db.get(
      'SELECT id, case_type, city, state, lead_fee_cents FROM pi_leads WHERE id=? AND status=? LIMIT 1',
      [safeInt(req.params.id), 'open']
    );
    if (!lead) return err404(res, 'Lead not available');

    // Charge the attorney's saved card via Stripe (either key name).
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
    const profile = await db.get(
      'SELECT stripe_cus_id, payment_method_id FROM attorney_profiles WHERE user_id=?',
      [req.user.id]
    );
    if (!profile?.stripe_cus_id || !profile?.payment_method_id) {
      return res.status(402).json({ error: 'No payment method on file. Add a card in your profile.' });
    }
    // Reserve the lead first so it can never be sold twice; release on failure.
    const reserved = await db.run(
      `UPDATE pi_leads SET status='reserved', accepted_by=? WHERE id=? AND status='open'`,
      [req.user.id, lead.id]
    );
    if (!reserved.changes) return res.status(409).json({ error: 'Lead is no longer available' });
    const release = () => db.run(
      `UPDATE pi_leads SET status='open', accepted_by=NULL WHERE id=? AND status='reserved' AND accepted_by=?`,
      [lead.id, req.user.id]).catch(logIgnored('routes/billing/pi_leads'));

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { timeout: 20_000, maxNetworkRetries: 2 });
    let pi;
    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: lead.lead_fee_cents,
          currency: 'usd',
          customer: profile.stripe_cus_id,
          payment_method: profile.payment_method_id,
          confirm: true,
          off_session: true,
          description: `PI Lead #${lead.id} — ${lead.case_type} — ${lead.city}, ${lead.state}`,
          metadata: { user_id: String(req.user.id), lead_id: String(lead.id), source: 'pi_leads' },
        },
        { idempotencyKey: `pi_lead_${req.user.id}_${lead.id}` }
      );
    } catch {
      await release();
      return res.status(402).json({ error: 'Payment failed. Check your payment method.' });
    }
    if (pi?.status !== 'succeeded') {
      await release();
      return res.status(402).json({ error: 'payment_incomplete', status: pi?.status || null });
    }

    await db.run(
      `UPDATE pi_leads SET status='accepted', accepted_at=NOW() WHERE id=? AND accepted_by=?`,
      [lead.id, req.user.id]
    );

    const full = await db.get(
      `SELECT pl.id, pl.case_type, pl.incident_date, pl.description, pl.severity, pl.city, pl.state,
              pl.lead_fee_cents, pl.accepted_at,
              u.display_name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
         FROM pi_leads pl LEFT JOIN users u ON u.id = pl.user_id
        WHERE pl.id=? LIMIT 1`, [lead.id]);
    res.json({ ok: true, lead: full, payment_intent: pi.id });
  } catch (e) {
    logger.error('[pi-lead/accept]', e.message);
    res.status(500).json({ error: 'Could not process lead acceptance. Check your payment method.' });
  }
});


export default router;
