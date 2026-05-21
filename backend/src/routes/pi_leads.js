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
 *   Personal Injury — by severity:
 *     minor ($50) | moderate ($150) | serious ($300) | catastrophic ($500)
 *   Civil Rights  — flat $200 (wrongful arrest is high-value case)
 *   Employment    — $100 flat
 *   ICE Detention — $75 flat (time-critical, lower case value)
 */
import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb }       from '../db/index.js';
import { authRequired } from '../middleware/auth.js';

// ── Lead submission rate limiter (public endpoint — protect from spam) ────────
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
const piLeadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 lead submissions per IP per hour
  message: { error: 'Too many submissions — please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const ALLOWED_PI_COLS = new Set(['state','type','status','assigned_attorney_id']);
const router = Router();
const STRIPE_KEY = process.env.STRIPE_SECRET || '';

// ── Lead fee schedule ─────────────────────────────────────────────────────────
function calcCivilLeadFee(leadType, severity = 'moderate') {
  if (leadType === 'personal_injury') {
    const fees = { minor: 5000, moderate: 15000, serious: 30000, catastrophic: 50000 };
    return fees[severity] ?? 15000;
  }
  if (leadType === 'civil_rights')  return 20000;  // $200
  if (leadType === 'employment')    return 10000;  // $100
  if (leadType === 'ice_detention') return  7500;  // $75
  return 10000;
}

function feeLabel(cents) {
  return `$${(cents / 100).toFixed(0)}`;
}

// ── POST /submit — consumer submits a lead ────────────────────────────────────
router.post('/submit', piLeadLimiter, authRequired, async (req, res) => {
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
        incident_summary, incident_date, injury_severity,
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
router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { type, state, limit = 30 } = req.query;

    let where = "cl.status = 'open' AND (cl.expires_at IS NULL OR cl.expires_at > datetime('now'))";
    const params = [];

    if (type)  { where += ' AND cl.lead_type = ?';  params.push(type);  }
    if (state) { where += ' AND cl.state = ?';       params.push(state); }

    const rows = await db.all(
      `SELECT cl.*,
              clp.id as purchased_id
       FROM civil_leads cl
       LEFT JOIN civil_lead_purchases clp
         ON clp.lead_id = cl.id AND clp.attorney_id = ?
       WHERE ${where}
       ORDER BY cl.created_at DESC
       LIMIT ?`,
      [req.user.id, ...params, Number(limit)]
    );

    const leads = rows.map(r => ({
      id:               r.id,
      lead_type:        r.lead_type,
      city:             r.city,
      state:            r.state,
      county:           r.county,
      incident_type:    r.incident_type,
      incident_summary: r.incident_summary,   // visible before purchase
      incident_date:    r.incident_date,
      injury_severity:  r.injury_severity,
      lead_fee_cents:   r.lead_fee_cents,
      lead_fee_display: feeLabel(r.lead_fee_cents),
      created_at:       r.created_at,
      purchased:        !!r.purchased_id,
      // Contact only revealed after purchase
      contact_name:     r.purchased_id ? r.contact_name  : null,
      contact_phone:    r.purchased_id ? r.contact_phone : null,
      contact_email:    r.purchased_id ? r.contact_email : null,
    }));

    res.json({ leads, count: leads.length });
  } catch (e) {
    logger.error('[pi_leads] list error:', e.message);
    res.status(500).json({ error: 'Could not load leads' });
  }
});

// ── POST /:id/accept — attorney accepts a lead ────────────────────────────────
router.post('/:id/accept', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const leadId = safeInt(req.params.id);

    const lead = await db.get('SELECT id, lead_type, submitter_user_id, city, state, county, incident_type, incident_summary, incident_date, injury_severity, contact_name, contact_phone, contact_email, lead_fee_cents, status, expires_at, created_at FROM civil_leads WHERE id = ? LIMIT 1', [leadId]);
    if (!lead) return err404(res, 'Lead not found');
    if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is no longer available' });

    // Check not already purchased
    const existing = await db.get(
      'SELECT id FROM civil_lead_purchases WHERE attorney_id = ? AND lead_id = ?',
      [req.user.id, leadId]
    );
    if (existing) return res.status(409).json({ error: 'You have already purchased this lead' });

    // Get attorney payment method
    const profile = await db.get(
      'SELECT stripe_cus_id, payment_method_id FROM civil_attorney_profiles WHERE user_id = ?',
      [req.user.id]
    );

    let stripePiId = 'pi_civil_demo';

    if (STRIPE_KEY && profile?.stripe_cus_id && profile?.payment_method_id) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(STRIPE_KEY);
        const pi = await stripe.paymentIntents.create({
          amount:               lead.lead_fee_cents,
          currency:             'usd',
          customer:             profile.stripe_cus_id,
          payment_method:       profile.payment_method_id,
          confirm:              true,
          off_session:          true,
          description:          `Civil lead: ${lead.incident_type} — ${lead.city}, ${lead.state}`,
        });
        stripePiId = pi.id;
      } catch (stripeErr) {
        return res.status(402).json({ error: 'Payment failed. Check your payment method.' });
      }
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
  } catch (e) {
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
  } catch (e) {
    res.status(500).json({ error: 'Could not load profile' });
  }
});

export default router;
