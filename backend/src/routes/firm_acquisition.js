/**
 * routes/firm_acquisition.js — Self-serve firm onboarding funnel
 *
 * Public (no auth):
 *   GET  /api/firm-acquisition/plans          — pricing plans + feature matrix
 *   GET  /api/firm-acquisition/vertical-demo  — vertical-specific demo metrics
 *   POST /api/firm-acquisition/lead           — capture interest lead
 *
 * Authenticated:
 *   POST /api/firm-acquisition/trial          — activate trial (creates firm + member)
 *   GET  /api/firm-acquisition/status         — caller's firm trial/plan status
 *   POST /api/firm-acquisition/upgrade        — request tier upgrade
 *   GET  /api/firm-acquisition/checklist      — onboarding checklist completion
 *   POST /api/firm-acquisition/checklist/:key — mark checklist item done
 */

import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { loadFirmContext, hasMinRole } from '../middleware/rbac.js';
import { writeAuditLog } from '../middleware/audit.js';
import logger            from '../utils/logger.js';
import {
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user
  err400, err403, err404, err409,
  safeInt, sanitizeStr, truncateStr,
} from '../utils/routeHelpers.js';

const router = Router();

// ─── MODULE CONSTANTS ───────────────────────────────────────────────────────
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TRIAL_DAYS     = 14; // free trial length — single source of truth
const VALID_ORG_TYPES = ['nonprofit','public_defender','government','legal_aid','law_firm','solo','other'];
const VALID_TIERS     = ['standard','mission','government','enterprise'];

// ─── VERTICAL / ONBOARDING CONSTANTS ─────────────────────────────────────────
const VALID_VERTICALS = [
  'criminal_defense','civil_rights','white_collar','family','immigration',
  'personal_injury','public_defense','appellate','military','juvenile','general',
];

const VERTICAL_PITCH = {
  criminal_defense: {
    headline: 'Bail automation. Expungement pipeline. Speedy trial tracking.',
    stats: ['77% of criminal matters hit expungement eligibility', '34% arrive as emergencies — speed matters', 'Avg bail $1.04M — high-value clients expect the platform to match'],
    roi:   'One expunged record returned to employment = avg $48K lifetime earnings gain for your client.',
  },
  civil_rights: {
    headline: 'Class action coordination. SOL calendar. Damages modeling.',
    stats: ['75% of civil rights dockets are class actions', '$4.99M avg total damages per matter', '28.7% strong-evidence rate — walk in with facts, win with process'],
    roi:   'Class cert missed = entire case loss. One SOL alert is worth more than a year of subscription.',
  },
  white_collar: {
    headline: 'DPA negotiation tracker. Cooperation credit modeling. DOJ deadline stack.',
    stats: ['Avg base fine $256.7M — cooperation strategy is everything', '31.6% avg fine reduction through cooperation', '42.7% of matters reach DPA viable or signed status'],
    roi:   '1% additional fine reduction on a $100M matter = $1M saved. Platform pays for itself on a single case.',
  },
  family: {
    headline: 'Emergency TRO flow. QDRO specialist matching. Asset-tier routing.',
    stats: ['19.7% of docket is DV — 3-business-day TRO deadline is manual today', '34% high-asset matters requiring QDRO specialists', 'Avg team size 2 — every minute of admin is a minute not billing'],
    roi:   'Missed TRO hearing due to manual tracking = malpractice exposure. Platform eliminates the risk.',
  },
  immigration: {
    headline: 'Asylum clock surveillance. Detained-client alerts. Multi-language support.',
    stats: ['29.3% of clients are detained — urgency is constant', '6.7% already past the 1-year asylum bar — caught too late', 'Avg asylum clock 679 days — impossible to track manually across a full docket'],
    roi:   'One client saved from the 1-year bar = asylum granted instead of removal. Immeasurable client value.',
  },
  personal_injury: {
    headline: 'Emergency intake flow. Expert witness matching. Damages modeling.',
    stats: ['37.7% emergency-pressure cases — highest of any vertical', '$3.43M avg net damages per matter', '35.7% catastrophic or severe injuries requiring specialist coordination'],
    roi:   'Expert witness matched 2 weeks faster = trial-ready sooner = earlier settlement pressure.',
  },
  public_defense: {
    headline: 'Caseload dashboard. Diversion tracker. Expungement pipeline.',
    stats: ['264-case avg attorney caseload — every efficiency gains lives', '30% weak-evidence rate drives constant suppression motion workflow', 'Expungement eligibility missed on 70%+ of closed matters'],
    roi:   'Platform pays for itself in 40 hours of paralegal time recovered per attorney per year.',
  },
  appellate: {
    headline: 'AEDPA deadline tracking. Capital case flagging. Reversal scoring.',
    stats: ['12.3% capital cases — zero margin for missed deadlines', 'Avg reversal score 33.6/100 — fighting uphill, process discipline is everything', '60% of clients have 2+ prior appeals — long case histories to manage'],
    roi:   'One AEDPA deadline missed = permanent bar to habeas review. No amount of billing recovers it.',
  },
  military: {
    headline: 'UCMJ taxonomy. Article 32 deadlines. Security clearance workflow.',
    stats: ['32.3% security clearance revocation cases — no other platform covers this', '50% of clients have prior NJP history — complex disciplinary timelines', 'Avg service tenure 16.3 years — high-stakes, experienced clients with careers at risk'],
    roi:   'Security clearance revocation affects lifetime earning potential. Clients pay premium for specialized counsel.',
  },
  juvenile: {
    headline: 'Juvenile expungement. Transfer monitor. Diversion tracking.',
    stats: ['Average client age 13.5 — outcomes define entire life trajectories', '26% in crisis vulnerability — trauma-informed workflow is mandatory', 'Adult transfer risk at 16+ is the single most consequential decision in the case'],
    roi:   'One diversion outcome instead of adjudication = no juvenile record, stays in school, exits the system.',
  },
  general: {
    headline: 'Full platform access. No vertical restrictions.',
    stats: ['Access all 10 vertical feature sets', 'All deadline presets across all practice areas', 'Full RBAC, matter management, and client portal'],
    roi:   'General practice firms get the broadest coverage — switch to a focused vertical any time.',
  },
};

const ONBOARDING_CHECKLIST = [
  { key: 'vertical_set',    label: 'Choose your practice vertical',    required: true },
  { key: 'team_invited',    label: 'Invite at least one team member',   required: true },
  { key: 'first_matter',    label: 'Create your first matter',          required: true },
  { key: 'deadline_tested', label: 'Run a deadline calculation',        required: false },
  { key: 'tracker_created', label: 'Create a specialty tracker',        required: false },
  { key: 'billing_set',     label: 'Set your billing tier',             required: false },
];

// ─── PUBLIC ENDPOINTS ─────────────────────────────────────────────────────────

// GET /api/firm-acquisition/plans
router.get('/plans', async (_req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT tier_key, display_name, monthly_cents, annual_cents,
              seat_limit, matter_limit, ai_calls_daily, description
       FROM firm_pricing_configs WHERE active=1 ORDER BY monthly_cents ASC`
    );
    res.json({ plans: rows, verticals: VALID_VERTICALS });
  } catch (e) {
    logger.error('[firm-acq/plans]', e.message);
    res.status(500).json({ error: 'Could not load plans.' });
  }
});

// GET /api/firm-acquisition/vertical-demo?vertical=immigration
router.get('/vertical-demo', (req, res) => {
  const v = sanitizeStr(req.query.vertical || 'general', 50);
  if (!VALID_VERTICALS.includes(v)) return err400(res, `Invalid vertical. Options: ${VALID_VERTICALS.join(', ')}`);
  const pitch = VERTICAL_PITCH[v];
  res.json({ vertical: v, ...pitch });
});

// POST /api/firm-acquisition/lead — capture pre-auth interest
router.post('/lead', async (req, res) => {
  const { email, firm_name, vertical, org_size, message } = req.body || {};
  if (!email?.trim())     return err400(res, 'email is required.');
  if (!EMAIL_RE.test(email.trim())) return err400(res, 'email must be a valid email address.');
  if (!firm_name?.trim()) return err400(res, 'firm_name is required.');

  const v = vertical && VALID_VERTICALS.includes(vertical) ? vertical : 'general';

  try {
    const db = await getDb();
    // Idempotent: update if email+firm_name already exists
    const existing = await db.get(
      'SELECT id FROM acquisition_leads WHERE email=? AND firm_name=?',
      [sanitizeStr(email, 200).toLowerCase(), sanitizeStr(firm_name, 200)]
    ).catch(() => null);

    if (existing) {
      await db.run(
        'UPDATE acquisition_leads SET vertical=?, updated_at=? WHERE id=?',
        [v, new Date().toISOString(), existing.id]
      );
      return res.json({ captured: true, id: existing.id, existing: true });
    }

    const r = await db.run(
      `INSERT INTO acquisition_leads (email, firm_name, vertical, org_size, message)
       VALUES (?,?,?,?,?)`,
      [
        sanitizeStr(email, 200).toLowerCase(),
        sanitizeStr(truncateStr(firm_name, 200), 200),
        v,
        Math.max(0, safeInt(org_size, 0)),
        message ? sanitizeStr(truncateStr(message, 1000), 1000) : null,
      ]
    );
    res.status(201).json({ captured: true, id: r.lastID });
  } catch (e) {
    logger.error('[firm-acq/lead]', e.message);
    res.status(500).json({ error: 'Could not capture lead.' });
  }
});

// ─── AUTHENTICATED ENDPOINTS ──────────────────────────────────────────────────

// POST /api/firm-acquisition/trial — create firm + activate trial
router.post('/trial', authRequired, routeLimiter, async (req, res) => {
  const { firm_name, vertical = 'general', org_type } = req.body || {};
  if (!firm_name?.trim()) return err400(res, 'firm_name is required.');
  if (firm_name.trim().length < 2) return err400(res, 'firm_name must be at least 2 characters.');
  if (!VALID_VERTICALS.includes(vertical)) return err400(res, `Invalid vertical.`);
  if (org_type && !VALID_ORG_TYPES.includes(org_type)) return err400(res, `org_type must be one of: ${VALID_ORG_TYPES.join(', ')}`);

  try {
    const db = await getDb();

    // Prevent duplicate firm creation for active members
    const existingMembership = await db.get(
      "SELECT fm.firm_id FROM firm_members fm WHERE fm.user_id=? AND fm.status='active' LIMIT 1",
      [req.user.id]
    ).catch(() => null);
    if (existingMembership) {
      return err409(res, 'You are already a member of a firm. Leave your current firm before creating a new one.');
    }

    // Rate-limit: max 3 trial creations per user lifetime
    const { trial_count } = await db.get(
      'SELECT COUNT(*) as trial_count FROM firm_trials WHERE user_id=?',
      [req.user.id]
    ).catch(() => ({ trial_count: 0 }));
    if (trial_count >= 3) {
      return res.status(429).json({
        error: 'Trial limit reached. Contact support to discuss your options.',
        code: 'TRIAL_LIMIT_EXCEEDED',
      });
    }

    const now      = new Date().toISOString();
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();

    // Read seat_limit from standard pricing tier
    const stdTier = await db.get(
      "SELECT seat_limit FROM firm_pricing_configs WHERE tier_key='standard' AND active=1 LIMIT 1"
    ).catch(() => null);
    const trialSeatLimit = stdTier?.seat_limit ?? 10;

    // Create firm
    const firmRes = await db.run(
      `INSERT INTO firms (name, owner_id, vertical, pricing_tier, plan, seat_limit, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        truncateStr(firm_name.trim(), 200),
        req.user.id,
        vertical,
        'standard',
        'trial',
        trialSeatLimit,
        now, now,
      ]
    );
    const firmId = firmRes.lastID;

    // Add creator as firm_admin
    await db.run(
      `INSERT INTO firm_members (firm_id, user_id, firm_role, status, joined_at)
       VALUES (?,?,?,?,?)`,
      [firmId, req.user.id, 'firm_admin', 'active', now]
    );

    // Create default vertical config
    await db.run(
      `INSERT OR IGNORE INTO firm_vertical_config (firm_id, vertical, updated_at)
       VALUES (?,?,?)`,
      [firmId, vertical, now]
    );

    // Create trial record
    await db.run(
      `INSERT INTO firm_trials (firm_id, user_id, vertical, org_type, trial_start, trial_end, status)
       VALUES (?,?,?,?,?,?,?)`,
      [firmId, req.user.id, vertical,
       org_type ? sanitizeStr(org_type, 50) : null,
       now, trialEnd, 'active']
    ).catch(() => null); // table may not exist yet — non-blocking

    // Seed onboarding checklist — mark vertical_set if vertical is not general
    if (vertical !== 'general') {
      await db.run(
        `INSERT OR IGNORE INTO firm_onboarding (firm_id, checklist_key, completed_at)
         VALUES (?,?,?)`,
        [firmId, 'vertical_set', now]
      ).catch(() => null);
    }

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'create', resource: 'firm_trial',
      record_id: firmId,
      new_value: { firm_name: firm_name.trim(), vertical, org_type },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.status(201).json({
      created: true,
      firm_id: firmId,
      vertical,
      trial_end: trialEnd,
      message: `${TRIAL_DAYS}-day free trial activated for ${firm_name.trim()}. No credit card required.`,
    });
  } catch (e) {
    logger.error('[firm-acq/trial]', e.message);
    res.status(500).json({ error: 'Could not activate trial.' });
  }
});

// GET /api/firm-acquisition/status
router.get('/status', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return res.json({ has_firm: false, trial_active: false });

    const firm = await db.get(
      'SELECT id, name, vertical, pricing_tier, plan, seat_limit, mission_verified, created_at FROM firms WHERE id=?',
      [ctx.firm_id]
    );
    if (!firm) {
      // Membership record exists but firm was deleted — treat as no firm
      return res.json({ has_firm: false, trial_active: false });
    }
    const now_iso = new Date().toISOString();
    const trial = await db.get(
      `SELECT trial_end, status FROM firm_trials
       WHERE firm_id=? AND status='active' AND trial_end > ?
       ORDER BY trial_end DESC LIMIT 1`,
      [ctx.firm_id, now_iso]
    ).catch(() => null);

    const trialEndMs = trial ? new Date(trial.trial_end).getTime() : NaN;
    const daysLeft   = trial && !isNaN(trialEndMs)
      ? Math.max(0, Math.ceil((trialEndMs - Date.now()) / 86400000))
      : 0;

    // Member count
    const { member_count } = await db.get(
      "SELECT COUNT(*) as member_count FROM firm_members WHERE firm_id=? AND status='active'",
      [ctx.firm_id]
    ).catch(() => ({ member_count: 0 }));

    // Matter count
    const { matter_count } = await db.get(
      "SELECT COUNT(*) as matter_count FROM matters WHERE firm_id=?",
      [ctx.firm_id]
    ).catch(() => ({ matter_count: 0 }));

    res.json({
      has_firm:      true,
      firm,
      role:          ctx.firm_role,
      trial_active:  !!trial,
      trial_days_left: daysLeft,
      member_count,
      matter_count,
    });
  } catch (e) {
    logger.error('[firm-acq/status]', e.message);
    res.status(500).json({ error: 'Could not load status.' });
  }
});

// POST /api/firm-acquisition/upgrade
router.post('/upgrade', authRequired, routeLimiter, async (req, res) => {
  const { target_tier, notes } = req.body || {};
  if (!target_tier || !VALID_TIERS.includes(target_tier)) {
    return err400(res, `target_tier must be one of: ${VALID_TIERS.join(', ')}`);
  }

  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx)                    return err403(res, 'Not a firm member.');
    // Partner+ can request upgrades — managing_partner/lead_attorney resolve to
    // partner tier (level 4) via ROLE_ALIASES, which is sufficient for billing requests.
    // Only firm_admin (level 5) can directly apply changes; upgrade requests go to review.
    if (!hasMinRole(ctx.firm_role, 'partner')) {
      return err403(res, 'Requires partner+.');
    }

    const firm = await db.get('SELECT id, pricing_tier FROM firms WHERE id=?', [ctx.firm_id]);
    if (!firm) return err404(res, 'Firm not found.');
    if (firm.pricing_tier === target_tier) {
      return res.status(409).json({
        error: `Firm is already on the ${target_tier} tier.`,
        code: 'ALREADY_ON_TIER',
      });
    }

    const r = await db.run(
      `INSERT INTO firm_upgrade_requests (firm_id, requested_by, current_tier, target_tier, notes)
       VALUES (?,?,?,?,?)`,
      [ctx.firm_id, req.user.id, firm.pricing_tier, target_tier,
       notes ? sanitizeStr(truncateStr(notes, 1000), 1000) : null]
    ).catch(() => null);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: ctx.firm_id,
      action: 'create', resource: 'firm_upgrade_request',
      record_id: r?.lastID,
      new_value: { from: firm.pricing_tier, to: target_tier },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.status(201).json({
      submitted: true,
      from: firm.pricing_tier,
      to: target_tier,
      message: target_tier === 'mission' || target_tier === 'government'
        ? 'Upgrade request submitted. Verification required — typically reviewed within 1–3 business days.'
        : 'Upgrade request submitted. You will be contacted to complete billing setup.',
    });
  } catch (e) {
    logger.error('[firm-acq/upgrade]', e.message);
    res.status(500).json({ error: 'Could not submit upgrade request.' });
  }
});

// GET /api/firm-acquisition/checklist
router.get('/checklist', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return res.json({ checklist: ONBOARDING_CHECKLIST.map(c => ({ ...c, done: false })) });

    const done = await db.all(
      'SELECT checklist_key FROM firm_onboarding WHERE firm_id=?',
      [ctx.firm_id]
    ).catch(() => []);

    const doneKeys = new Set(done.map(d => d.checklist_key));
    const checklist = ONBOARDING_CHECKLIST.map(c => ({
      ...c, done: doneKeys.has(c.key),
    }));

    const pct = checklist.length > 0
      ? Math.round(checklist.filter(c => c.done).length / checklist.length * 100)
      : 0;
    const required_done = checklist.filter(c => c.required && c.done).length;
    const required_total = checklist.filter(c => c.required).length;

    res.json({
      checklist,
      completion_pct: pct,
      required_done,
      required_total,
      fully_onboarded: required_done === required_total,
    });
  } catch (e) {
    logger.error('[firm-acq/checklist]', e.message);
    res.status(500).json({ error: 'Could not load checklist.' });
  }
});

// POST /api/firm-acquisition/checklist/:key
router.post('/checklist/:key', authRequired, routeLimiter, async (req, res) => {
  const key = sanitizeStr(req.params.key, 50);
  if (!ONBOARDING_CHECKLIST.find(c => c.key === key)) {
    return err400(res, `Invalid checklist key. Options: ${ONBOARDING_CHECKLIST.map(c => c.key).join(', ')}`);
  }

  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return err403(res, 'Not a firm member.');

    await db.run(
      `INSERT OR IGNORE INTO firm_onboarding (firm_id, checklist_key, completed_at)
       VALUES (?,?,?)`,
      [ctx.firm_id, key, new Date().toISOString()]
    );

    res.json({ marked: true, key, firm_id: ctx.firm_id });
        res.json({ ok: true });
    } catch (e) {
    logger.error('[firm-acq/checklist POST]', e.message);
    res.status(500).json({ error: 'Could not mark checklist item.' });
  }
});

export default router;
