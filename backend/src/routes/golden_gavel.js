// Replacement for golden_gavel.js — full three-tier system
// Bronze (level 1) → Silver (level 2) → Golden (level 3)

import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { getDb }   from '../db/index.js';
import { authRequired }    from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const router      = Router();
const gavelLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Golden Gavel limit reached.' });

// ── Gavel level constants ─────────────────────────────────────────────────────
export const GAVEL_LEVELS = {
  NONE:   0,
  BRONZE: 1,
  SILVER: 2,
  GOLDEN: 3,
};
export const GAVEL_LABEL = { 0: 'None', 1: 'Bronze', 2: 'Silver', 3: 'Golden' };
export const GAVEL_EMOJI = { 0: '',    1: '🥉',      2: '🥈',     3: '🏆' };

// ── Criteria per user type per gavel level ────────────────────────────────────
const CRITERIA = {
  esquire: {
    bronze: {
      months_active:        3,
      consultations_booked: 5,
      avg_rating:           4.0,
      min_reviews:          1,
      compliance_flags:     0,
      bar_verified:         true,
    },
    silver: {
      months_active:        6,
      consultations_booked: 12,
      avg_rating:           4.5,
      min_reviews:          5,
      compliance_flags:     0,
      bar_verified:         true,
    },
    golden: {
      months_active:        12,
      consultations_booked: 25,
      avg_rating:           4.8,
      min_reviews:          10,
      compliance_flags:     0,
      bar_verified:         true,
    },
  },
  consumer: {
    bronze: {
      months_active:     6,
      paid_referrals:    1,
      lessons_started:   true,   // at least 1 lesson started
      compliance_flags:  0,
    },
    silver: {
      months_active:     12,
      paid_referrals:    2,
      lessons_completed: true,   // all lessons completed
      compliance_flags:  0,
    },
    golden: {
      months_active:     24,
      paid_referrals:    3,
      lessons_completed: true,
      compliance_flags:  0,
    },
  },
  bondsman: {
    bronze: {
      months_active:    3,
      leads_accepted:   10,
      compliance_flags: 0,
      license_verified: true,
    },
    silver: {
      months_active:    6,
      leads_accepted:   25,
      compliance_flags: 0,
      license_verified: true,
    },
    golden: {
      months_active:    12,
      leads_accepted:   50,
      compliance_flags: 0,
      license_verified: true,
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function monthsSince(isoDate) {
  if (!isoDate) return 0;
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

// ── Core evaluation — returns highest level earned ────────────────────────────
export async function evaluateGavelLevel(userId) {
  const db = await getDb();

  const user = await db.get('SELECT id, display_name, email, gavel_points, gavel_level, golden_gavel, hall_opt_in FROM users WHERE id = ? LIMIT 100', [userId]);
  if (!user) return { level: 0, reason: 'User not found' };

  const sub = await db.get(
    `SELECT tier, created_at, provider_type FROM subscriptions
     WHERE user_id = ? AND status IN ('active','trialing')
     ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );

  const isAttorney  = sub?.provider_type === 'lawyer';
  const isBondsman  = sub?.provider_type === 'bail_agent';
  const userType    = isAttorney ? 'attorney' : isBondsman ? 'bondsman' : 'consumer';
  const subStart    = sub?.created_at || user.created_at;
  const monthsActive = monthsSince(subStart);

  // ── Build progress snapshot ─────────────────────────────────────────────────
  const progress = {
    user_type:    userType,
    months_active: Math.floor(monthsActive),
    compliance_flags: user.compliance_flags || 0,
  };

  if (isAttorney) {
    const consult = await db.get(
      `SELECT COUNT(*) as n FROM consultation_bookings
       WHERE lawyer_id = ? AND status = 'completed'`, [userId]
    ).catch(() => ({ n: 0 }));
    progress.consultations_booked = consult?.n ?? 0;

    const ratingRow = await db.get(
      `SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews
       WHERE entity_type = 'lawyer' AND entity_id = ?`, [userId]
    ).catch(() => ({ avg: 0, cnt: 0 }));
    progress.avg_rating   = Math.round((ratingRow?.avg ?? 0) * 10) / 10;
    progress.review_count = ratingRow?.cnt ?? 0;
    progress.bar_verified = user.bar_verified === 1;
  }

  if (!isAttorney && !isBondsman) {
    const refs = await db.get(
      `SELECT SUM(credits) as total FROM referrals WHERE owner_user_id = ?`, [userId]
    ).catch(() => ({ total: 0 }));
    progress.paid_referrals = refs?.total ?? 0;

    const lessons = await db.get(`SELECT COUNT(*) as total FROM lessons`, []).catch(() => ({ total: 0 }));
    const completed = await db.get(
      `SELECT COUNT(DISTINCT lesson_id) as done FROM lesson_progress
       WHERE user_id = ? AND completed = 1`, [userId]
    ).catch(() => ({ done: 0 }));
    const started = await db.get(
      `SELECT COUNT(DISTINCT lesson_id) as started FROM lesson_progress
       WHERE user_id = ?`, [userId]
    ).catch(() => ({ started: 0 }));
    progress.lessons_completed = lessons.total > 0 && completed.done >= lessons.total;
    progress.lessons_started   = started?.started ?? 0 > 0;
  }

  if (isBondsman) {
    const leads = await db.get(
      `SELECT COUNT(*) as n FROM lead_purchases
       WHERE bondsman_user_id = ? AND status = 'delivered'`, [userId]
    ).catch(() => ({ n: 0 }));
    progress.leads_accepted   = leads?.n ?? 0;
    progress.license_verified = user.license_verified === 1;
  }

  // ── Check each tier level from highest down ─────────────────────────────────
  function meetsLevel(levelKey) {
    const c = CRITERIA[userType][levelKey];
    if (monthsActive < c.months_active) return false;
    if (progress.compliance_flags > 0) return false;

    if (isAttorney) {
      if (progress.consultations_booked < c.consultations_booked) return false;
      if (progress.avg_rating < c.avg_rating) return false;
      if (progress.review_count < c.min_reviews) return false;
      if (!progress.bar_verified) return false;
    }

    if (!isAttorney && !isBondsman) {
      if (progress.paid_referrals < c.paid_referrals) return false;
      if (levelKey === 'bronze' && !progress.lessons_started)   return false;
      if (levelKey !== 'bronze' && !progress.lessons_completed) return false;
    }

    if (isBondsman) {
      if (progress.leads_accepted < c.leads_accepted) return false;
      if (!progress.license_verified) return false;
    }

    return true;
  }

  // Find highest level earned
  let levelEarned = GAVEL_LEVELS.NONE;
  if (meetsLevel('golden')) levelEarned = GAVEL_LEVELS.GOLDEN;
  else if (meetsLevel('silver')) levelEarned = GAVEL_LEVELS.SILVER;
  else if (meetsLevel('bronze')) levelEarned = GAVEL_LEVELS.BRONZE;

  // Build missing criteria for NEXT level
  const nextLevel = levelEarned < GAVEL_LEVELS.GOLDEN
    ? ['bronze','silver','golden'][levelEarned]   // bronze=0, silver=1, golden=2 → next
    : null;
  const nextLevelKey = nextLevel;
  const missingNext = [];

  if (nextLevelKey) {
    const cn = CRITERIA[userType][nextLevelKey];
    if (monthsActive < cn.months_active)
      missingNext.push(`${cn.months_active - Math.floor(monthsActive)} more months active`);
    if (progress.compliance_flags > 0)
      missingNext.push(`${progress.compliance_flags} compliance flag(s) to resolve`);

    if (isAttorney) {
      if ((progress.consultations_booked || 0) < cn.consultations_booked)
        missingNext.push(`${cn.consultations_booked - progress.consultations_booked} more consultations`);
      if ((progress.avg_rating || 0) < cn.avg_rating)
        missingNext.push(`Rating ${progress.avg_rating} below ${cn.avg_rating} minimum`);
      if ((progress.review_count || 0) < cn.min_reviews)
        missingNext.push(`${cn.min_reviews - progress.review_count} more reviews needed`);
      if (!progress.bar_verified)
        missingNext.push('Bar license verification required');
    }

    if (!isAttorney && !isBondsman) {
      if ((progress.paid_referrals || 0) < cn.paid_referrals)
        missingNext.push(`${cn.paid_referrals - progress.paid_referrals} more paid referrals`);
      if (nextLevelKey === 'bronze' && !progress.lessons_started)
        missingNext.push('Start at least one lesson in the Legal Education track');
      if (nextLevelKey !== 'bronze' && !progress.lessons_completed)
        missingNext.push('Complete all lessons in the Legal Education track');
    }

    if (isBondsman) {
      if ((progress.leads_accepted || 0) < cn.leads_accepted)
        missingNext.push(`${cn.leads_accepted - progress.leads_accepted} more accepted leads`);
      if (!progress.license_verified)
        missingNext.push('License verification required');
    }
  }

  return {
    level:        levelEarned,
    level_label:  GAVEL_LABEL[levelEarned],
    level_emoji:  GAVEL_EMOJI[levelEarned],
    user_type:    userType,
    progress,
    next_level:      levelEarned < 3 ? GAVEL_LEVELS[['BRONZE','SILVER','GOLDEN'][levelEarned]] : null,
    next_level_label: nextLevelKey ? GAVEL_LABEL[levelEarned + 1] : null,
    missing_for_next: missingNext,
    criteria:     CRITERIA[userType],
    // Backward compat
    eligible:     levelEarned >= GAVEL_LEVELS.GOLDEN,
    tier_type:    userType,
    missing:      levelEarned >= GAVEL_LEVELS.GOLDEN ? [] : missingNext,
  };
}

// Backward compat wrapper
export async function evaluateGoldenGavel(userId) { return evaluateGavelLevel(userId); }

// ── Award / update gavel level ────────────────────────────────────────────────
export async function processGoldenGavelAward(userId) {
  const db     = await getDb();
  const result = await evaluateGavelLevel(userId);
  const user   = await db.get('SELECT id, display_name, email, gavel_points, gavel_level, golden_gavel, hall_opt_in FROM users WHERE id = ?', [userId]);
  if (!user) return;

  const currentLevel = user.gavel_level || 0;
  const newLevel     = result.level;

  if (newLevel === currentLevel) return { action: 'no_change', level: newLevel };

  // Always move up or down to the correct level
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users SET
       gavel_level = ?,
       gavel_level_awarded_at = ?,
       gavel_bronze_at = CASE WHEN ? >= 1 AND gavel_bronze_at IS NULL THEN ? ELSE gavel_bronze_at END,
       gavel_silver_at = CASE WHEN ? >= 2 AND gavel_silver_at IS NULL THEN ? ELSE gavel_silver_at END,
       golden_gavel = ?,
       golden_gavel_awarded_at = CASE WHEN ? = 3 AND golden_gavel_awarded_at IS NULL THEN ? ELSE golden_gavel_awarded_at END,
       golden_gavel_tier = ?,
       golden_gavel_revoked_at = CASE WHEN ? < 3 AND golden_gavel = 1 THEN ? ELSE golden_gavel_revoked_at END
     WHERE id = ?`,
    [
      newLevel, now,
      newLevel, now,
      newLevel, now,
      newLevel >= 3 ? 1 : 0,
      newLevel, now,
      result.user_type,
      newLevel, now,
      userId,
    ]
  );

  const action = newLevel > currentLevel ? 'upgraded' : 'downgraded';
  await db.run(
    `INSERT INTO golden_gavel_log (user_id, action, tier, reason, criteria)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      action,
      result.user_type,
      `${GAVEL_LABEL[currentLevel]} → ${GAVEL_LABEL[newLevel]}`,
      JSON.stringify({ level: newLevel, progress: result.progress }),
    ]
  );

  return { action, from: currentLevel, to: newLevel, level_label: GAVEL_LABEL[newLevel] };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/golden-gavel/status
router.get('/status', authRequired, gavelLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get(
      `SELECT gavel_level, gavel_level_awarded_at, gavel_bronze_at, gavel_silver_at,
              golden_gavel, golden_gavel_awarded_at, golden_gavel_tier
       FROM users WHERE id = ?`, [req.user.id]
    );
    if (!user) user = { gavel_level: 0 }; // default for new users
    const level = user.gavel_level || (user.golden_gavel ? 3 : 0);
    res.json({
      gavel_level:   level,
      level_label:   GAVEL_LABEL[level],
      level_emoji:   GAVEL_EMOJI[level],
      awarded_at:    user.gavel_level_awarded_at || user.golden_gavel_awarded_at || null,
      bronze_at:     user.gavel_bronze_at  || null,
      silver_at:     user.gavel_silver_at  || null,
      golden_at:     user.golden_gavel_awarded_at || null,
      tier_type:     user.golden_gavel_tier || null,
      // Backward compat
      golden_gavel:  level >= 3,
    });
  } catch (e) {
    logger.error({ msg: '[golden_gavel]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// GET /api/golden-gavel/eligibility
router.get('/eligibility', authRequired, gavelLimiter, async (req, res) => {
  try {
    const result = await evaluateGavelLevel(req.user.id);
    res.json(result);
  } catch (e) {
    logger.error({ msg: '[golden_gavel]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// POST /api/golden-gavel/hall/opt-in
router.post('/hall/opt-in', authRequired, gavelLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get('SELECT id, display_name, email, gavel_points, gavel_level, golden_gavel, hall_opt_in FROM users WHERE id = ?', [req.user.id]);

  if (!user) return res.status(404).json({ error: 'User not found.' });
    const level = user.gavel_level || (user.golden_gavel ? 3 : 0);
    if (level === 0) return res.status(403).json({ error: 'Gavel status required to join Hall of Justice' });

    const { display_name: rawDisplayName, state } = req.body;
    const display_name = rawDisplayName ? truncateStr(sanitizeStr(String(rawDisplayName), 100), 100) : null;
    const consult = await db.get(`SELECT COUNT(*) as n FROM consultation_bookings WHERE lawyer_id = ? AND status='completed'`, [req.user.id]).catch(() => ({ n:0 }));
    const motions = await db.get(`SELECT COUNT(*) as n FROM motions WHERE user_id = ?`, [req.user.id]).catch(() => ({ n:0 }));
    const fc      = await db.get(`SELECT COUNT(*) as n FROM payment_history WHERE user_id = ? AND product='family_connect'`, [req.user.id]).catch(() => ({ n: 0 })).catch(() => ({ n:0 }));
    const helped  = (consult?.n ?? 0) + (motions?.n ?? 0) + (fc?.n ?? 0);

    await db.run(
      `INSERT OR REPLACE INTO golden_gavel_hall
       (user_id, display_name, tier, state, people_helped, gavel_level, opted_in_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [req.user.id, display_name || user.name, user.golden_gavel_tier || 'consumer', state||'', helped, level]
    );
    res.json({ success: true, people_helped: helped, gavel_level: level, level_label: GAVEL_LABEL[level] });
  } catch (e) {
    logger.error({ msg: '[golden_gavel]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// GET /api/golden-gavel/hall
router.get('/hall', gavelLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT display_name, tier, state, people_helped, featured,
              COALESCE(gavel_level, 3) as gavel_level
       FROM golden_gavel_hall ORDER BY featured DESC, gavel_level DESC, people_helped DESC LIMIT 100`
    );
    res.json(rows.map(r => ({ ...r, level_label: GAVEL_LABEL[r.gavel_level], level_emoji: GAVEL_EMOJI[r.gavel_level] })));
  } catch (e) {
    logger.error({ msg: '[golden_gavel]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// POST /api/golden-gavel/evaluate/:id (admin)
router.post('/evaluate/:id', authRequired, gavelLimiter, async (req, res) => {
  try {
    const { timingSafeEqual } = await import('crypto');
    const provided = String(req.headers['x-admin-key'] || '');
    const expected = String(process.env.ADMIN_KEY || '');
    if (!expected || provided.length !== expected.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Admin key required.' });
    }
    const result = await processGoldenGavelAward(safeInt(req.params.id));
    res.json(result);
  } catch (e) {
    logger.error({ msg: '[golden_gavel]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

export default router;
