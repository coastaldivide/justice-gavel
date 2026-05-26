/**
 * billing/pi_leads.js — PI / Civil Rights lead marketplace — submit, browse, accept leads
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { stripe, LIVE, TIERS, billingLimiter, getOrCreateStripeCustomer, calcLeadFee }
  from './_shared.js';
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';

const router = Router();

function piLeadFee(caseType, severity) {
  if (caseType === 'Civil Rights') return 9999; // $100
  if (!severity) return 5000;
  if (severity === 'minor')   return 4999;   // $50
  if (severity === 'moderate')return 14999;  // $150
  if (severity === 'serious') return 29999;  // $300
  return 49999;                               // $499.99 catastrophic
}

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
    const lead = await db.get('SELECT id, attorney_id, firm_name, practice_type, bar_number, license_state, counties, max_lead_fee, leads_accepted, created_at FROM pi_leads WHERE id=? LIMIT 1', [r.lastID]);
    res.status(201).json({ ok: true, lead_id: r.lastID, lead });
  } catch (e) {
    logger.error('[pi-lead/submit]', e.message);
    res.status(500).json({ error: 'Could not submit lead' });
  }
});

// ── PI/Civil attorney views available leads in their area ──────────────────
router.get('/pi-leads', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { city, state, case_type, limit = 20 } = req.query;

    // pi_leads table managed by db/index.js

    let sql = `SELECT id, case_type, incident_date, severity, city, state,
                      lead_fee_cents, created_at,
                      -- Mask description until purchased
                      CASE WHEN accepted_by = ? THEN description
                           ELSE substr(description, 1, 60) || '…' END AS description,
                      CASE WHEN accepted_by = ? THEN 'accepted' ELSE status END AS display_status
               FROM pi_leads
               WHERE status = 'open' OR accepted_by = ?`;
    const params = [req.user.id, req.user.id, req.user.id];

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
router.post('/pi-lead/accept/:id', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const lead = await db.get(
      'SELECT id, attorney_id, firm_name, practice_type, bar_number, license_state, counties, max_lead_fee, leads_accepted, created_at FROM pi_leads WHERE id=? AND status=? LIMIT 1',
      [safeInt(req.params.id), 'open']
    );
    if (!lead) return err404(res, 'Lead not available');

    // Charge the attorney's saved card via Stripe
    const stripeKey = process.env.STRIPE_SECRET;
    if (stripeKey) {
      const profile = await db.get(
        'SELECT stripe_cus_id, payment_method_id FROM attorney_profiles WHERE user_id=?',
        [req.user.id]
      );
      if (!profile?.payment_method_id) {
        return res.status(402).json({ error: 'No payment method on file. Add a card in your profile.' });
      }
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);
      await stripe.paymentIntents.create({
        amount: lead.lead_fee_cents,
        currency: 'usd',
        customer: profile.stripe_cus_id,
        payment_method: profile.payment_method_id,
        confirm: true,
        off_session: true,
        description: `PI Lead #${lead.id} — ${lead.case_type} — ${lead.city}, ${lead.state}`,
        metadata: { user_id: String(req.user.id), source: 'pi_leads' },
      metadata: { user_id: String(req.user.id), lead_id: String(lead.id) },
    });
    }

    // Mark accepted + reveal full description
    await db.run(
      `UPDATE pi_leads SET status='accepted', accepted_by=?, accepted_at=datetime('now') WHERE id=?`,
      [req.user.id, lead.id]
    );

    const full = await db.get('SELECT id, attorney_id, firm_name, practice_type, bar_number, license_state, counties, max_lead_fee, leads_accepted, created_at FROM pi_leads WHERE id=? LIMIT 1', [lead.id]);
    res.json({ ok: true, lead: full });
  } catch (e) {
    logger.error('[pi-lead/accept]', e.message);
    res.status(500).json({ error: 'Could not process lead acceptance. Check your payment method.' });
  }
});


export default router;
