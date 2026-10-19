/**
 * pi_leads.js — Personal Injury & Civil Rights lead marketplace
 *
 * Routes:
 *   POST /api/pi-leads/submit          — consumer submits a lead (free)
 *   GET  /api/pi-leads                 — attorney views available leads
 *   POST /api/pi-leads/:id/accept      — attorney accepts lead (charged)
 *   POST /api/pi-leads/profile         — attorney sets up profile + payment
 *   GET  /api/pi-leads/profile         — attorney gets their profile
 *
 * Lead fee schedule:
 *   Personal Injury (incl. medical malpractice):
 *     flat fee: $200 per lead — no severity tiering (Rule 5.4/7.2 compliance)
 *   Civil Rights  — flat $200
 *   Employment    — $100 flat
 *   ICE Detention — $75 flat (time-critical, lower case value)
 */
import { err400, truncateStr, err404, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { attorneyLeadFeeCents } from './billing/attorneyLeadFee.js';
import { getDb }       from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

// ── Lead submission rate limiter (public endpoint — protect from spam) ────────
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
// Added: these names were used at module scope but never imported --
// an ESM ReferenceError at import time, which blocked the whole app.
import { validate, schemas } from '../validation/schemas.js';
import { stripeConfigured, PAYMENTS_UNAVAILABLE } from '../config.js';
const piLeadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 lead submissions per IP per hour
  message: { error: 'Too many submissions — please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const router = Router();
const stripeKey = () => process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';

// ── Who may see / buy leads (C2) ──────────────────────────────────────────────
// Leads describe people in crisis (injury, civil-rights violations, ICE
// detention). Browsing shows only NON-identifying fields and is limited to
// attorney accounts; the free-text summary and the contact details are released
// only to an attorney with a COMPLETED purchase (a succeeded Stripe charge).
// req.user.role / bar_verified are the live DB values (middleware/auth.js).
const ATTORNEY_ROLES = new Set(['attorney', 'defender', 'admin', 'super_admin']);
const isAttorney = (u) => ATTORNEY_ROLES.has(u?.role) || Number(u?.is_defender) === 1;
function requireLeadAttorney(req, res, next) {
  if (!isAttorney(req.user)) {
    return res.status(403).json({ error: 'attorney_required', message: 'Only attorney accounts can view case leads.' });
  }
  next();
}

// ── Lead fee schedule ─────────────────────────────────────────────────────────
// Flat fee per lead type — single source of truth in billing/attorneyLeadFee.js.
const calcCivilLeadFee = (leadType, severity) => attorneyLeadFeeCents(leadType, severity);

function feeLabel(cents) {
  return `$${(cents / 100).toFixed(0)}`;
}

// ── POST /submit — consumer submits a lead ────────────────────────────────────
router.post('/submit', validate(schemas.pi_leads.submit), piLeadLimiter, authRequired, async (req, res) => {
  try {
    const {
      lead_type, city, state, county = '',
      incident_type, incident_summary, incident_date = '',
      injury_severity = 'moderate',
      contact_name, contact_phone, contact_email = '',
    } = req.body || {};

    if (!lead_type || !city || !state || !incident_summary || !contact_name || !contact_phone) {
      return err400(res, 'lead_type, city, state, incident_summary, contact_name and contact_phone are required');
    }

    const db = await getDb();
    const feeCents = calcCivilLeadFee(lead_type, injury_severity);

    // Expire 30 days from now
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const r = await db.run(
      `INSERT INTO civil_leads
         (lead_type, submitter_user_id, city, state, county,
          incident_type, incident_summary, incident_date, injury_severity,
          contact_name, contact_phone, contact_email,
          lead_fee_cents, status, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        lead_type,
        req.user?.id ?? null,
        city, state, county,
        incident_type ?? lead_type,
        incident_summary, incident_date || null, injury_severity,
        contact_name, contact_phone, contact_email,
        feeCents, 'open', expiresAt,
      ]
    );

    res.json({
      ok: true,
      lead_id: r.lastID,
      message: 'Your case has been submitted. A local attorney will review it — usually within 24 hours.',
      lead_fee_display: feeLabel(feeCents),
    });
  } catch (e) {
    logger.error('[pi_leads] submit error:', e.message);
    res.status(500).json({ error: 'Could not submit lead' });
  }
});

// ── GET / — attorney views available leads ────────────────────────────────────
router.get('/', authRequired, requireLeadAttorney, async (req, res) => {
  try {
    const db = await getDb();
    const { type, state } = req.query;
    const limit = Math.min(Math.max(safeInt(req.query.limit || 30), 1), 100);

    let where = "cl.status = 'open' AND (cl.expires_at IS NULL OR cl.expires_at > NOW())";
    const params = [];

    if (type)  { where += ' AND cl.lead_type = ?';  params.push(type);  }
    if (state) { where += ' AND cl.state = ?';       params.push(state); }

    const rows = await db.all(
      `SELECT cl.*,
              clp.id as purchased_id
       FROM civil_leads cl
       LEFT JOIN civil_lead_purchases clp
         ON clp.lead_id = cl.id AND clp.attorney_id = ? AND clp.status = 'charged'
        AND COALESCE(clp.stripe_pi_id, '') NOT IN ('', 'pi_civil_demo')
       WHERE ${where}
       ORDER BY cl.created_at DESC
       LIMIT ?`,
      [req.user.id, ...params, Number(limit)]
    );

    const leads = rows.map(r => {
      const purchased = !!r.purchased_id;
      return {
        id:               r.id,
        lead_type:        r.lead_type,
        city:             r.city,
        state:            r.state,
        incident_type:    r.incident_type,
        injury_severity:  r.injury_severity,
        lead_fee_cents:   r.lead_fee_cents,
        lead_fee_display: feeLabel(r.lead_fee_cents),
        created_at:       r.created_at,
        purchased,
        // Free text and contact details only after a completed purchase.
        county:           purchased ? r.county           : null,
        incident_date:    purchased ? r.incident_date    : null,
        incident_summary: purchased ? r.incident_summary : null,
        contact_name:     purchased ? r.contact_name     : null,
        contact_phone:    purchased ? r.contact_phone    : null,
        contact_email:    purchased ? r.contact_email    : null,
      };
    });

    res.json({ leads, count: leads.length });
  } catch (e) {
    logger.error('[pi_leads] list error:', e.message);
    res.status(500).json({ error: 'Could not load leads' });
  }
});

// ── POST /:id/accept — attorney accepts a lead ────────────────────────────────
router.post('/:id/accept', authRequired, requireLeadAttorney, async (req, res) => {
  // Contact details are sold, never given away: no Stripe → 503, nothing revealed.
  if (!stripeConfigured()) return res.status(503).json({ ...PAYMENTS_UNAVAILABLE });
  if (Number(req.user.bar_verified) !== 1 && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'bar_verification_required', message: 'Verify your bar number before purchasing leads.' });
  }
  try {
    const db = await getDb();
    const leadId = safeInt(req.params.id);

    const lead = await db.get('SELECT id, lead_type, submitter_user_id, city, state, county, incident_type, incident_summary, incident_date, injury_severity, contact_name, contact_phone, contact_email, lead_fee_cents, status, expires_at, created_at FROM civil_leads WHERE id = ? LIMIT 1', [leadId]);
    if (!lead) return err404(res, 'Lead not found');
    if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is no longer available' });

    // Check not already purchased
    const existing = await db.get(
      "SELECT id FROM civil_lead_purchases WHERE attorney_id = ? AND lead_id = ? AND status = 'charged' AND COALESCE(stripe_pi_id, '') NOT IN ('', 'pi_civil_demo')",
      [req.user.id, leadId]
    );
    if (existing) return res.status(409).json({ error: 'You have already purchased this lead' });

    // Get attorney payment method
    const profile = await db.get(
      'SELECT stripe_cus_id, payment_method_id FROM civil_attorney_profiles WHERE user_id = ?',
      [req.user.id]
    );

    if (!profile?.stripe_cus_id || !profile?.payment_method_id) {
      return res.status(402).json({ error: 'payment_method_required', message: 'Add a payment method to your lead profile first.' });
    }

    let stripePiId;
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey(), { timeout: 20_000, maxNetworkRetries: 2 });
      const pi = await stripe.paymentIntents.create(
        {
          amount:               lead.lead_fee_cents,
          currency:             'usd',
          customer:             profile.stripe_cus_id,
          payment_method:       profile.payment_method_id,
          confirm:              true,
          off_session:          true,
          description:          `Civil lead #${lead.id} — ${lead.city}, ${lead.state}`,
          metadata:             { user_id: String(req.user.id), lead_id: String(lead.id), source: 'civil_leads' },
        },
        { idempotencyKey: `civil_lead_${req.user.id}_${lead.id}` }
      );
      // Only a completed charge unlocks the lead (requires_action etc. do not).
      if (pi?.status !== 'succeeded') {
        return res.status(402).json({ error: 'payment_incomplete', status: pi?.status || null });
      }
      stripePiId = pi.id;
    } catch {
      return res.status(402).json({ error: 'Payment failed. Check your payment method.' });
    }

    // Record purchase + reveal contact
    await db.run(
      `INSERT INTO civil_lead_purchases (attorney_id, lead_id, lead_fee_cents, status, stripe_pi_id, contact_revealed)
       VALUES (?,?,?,?,?,?)`,
      [req.user.id, leadId, lead.lead_fee_cents, 'charged', stripePiId, 1]
    );

    await db.run(
      'UPDATE civil_attorney_profiles SET leads_accepted = leads_accepted + 1 WHERE user_id = ?',
      [req.user.id]
    );

    res.json({
      ok: true,
      incident_summary: lead.incident_summary,
      contact_name:  lead.contact_name,
      contact_phone: lead.contact_phone,
      contact_email: lead.contact_email,
      lead_fee_display: feeLabel(lead.lead_fee_cents),
      message: 'Lead accepted. Contact information unlocked.',
    });
  } catch (e) {
    logger.error('[pi_leads] accept error:', e.message);
    res.status(500).json({ error: 'Could not process lead acceptance' });
  }
});

// ── POST /profile — attorney creates/updates profile ─────────────────────────
router.post('/profile', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const {
      firm_name, practice_type, bar_number = '', license_state = '',
      counties = [], max_lead_fee = 50000,
    } = req.body || {};
    const safeFirmName = firm_name ? truncateStr(sanitizeStr(String(firm_name), 200), 200) : '';
    if (!safeFirmName || !practice_type) {
      return err400(res, 'firm_name and practice_type are required');
    }

    await db.run(
      `INSERT INTO civil_attorney_profiles (user_id, firm_name, practice_type, bar_number, license_state, counties, max_lead_fee)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         firm_name = excluded.firm_name,
         practice_type = excluded.practice_type,
         bar_number = excluded.bar_number,
         license_state = excluded.license_state,
         counties = excluded.counties,
         max_lead_fee = excluded.max_lead_fee`,
      [req.user.id, safeFirmName, practice_type, bar_number, license_state, JSON.stringify(counties), max_lead_fee]
    );

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not save profile' });
  }
});

// ── GET /profile ──────────────────────────────────────────────────────────────
router.get('/profile', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.get(
      'SELECT id, user_id, firm_name, contact_name, contact_phone, contact_email, city, state, county, practice_areas, bio, website, fee_structure, accepts_contingency, created_at FROM civil_attorney_profiles WHERE user_id = ?',
      [req.user.id]
    );
    res.json({ profile: profile || null });
  } catch {
    res.status(500).json({ error: 'Could not load profile' });
  }
});

export default router;