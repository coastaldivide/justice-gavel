/**
 * refundAndBarVerify.test.js
 *
 * Tests: refund eligibility windows (7-day trial, 48hr, 30-day, billing error),
 *        refund route validation, bar number submission validation,
 *        bar verification state gate, approve-verification admin gate
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id, role='user') {
  return jwt.sign({ id, role, email:`u${id}@test.com` }, SECRET, { expiresIn:'1h' });
}
function adminTok(id) { return tok(id, 'admin'); }

// ─── Inline refund + bar verify logic (mirrors real routes) ─────────────────
async function buildApp(db) {
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  // ── Refund policy logic (mirrors billing.js) ───────────────────────────────
  function getRefundEligibility(chargedAt, reason) {
    const daysSinceCharge = (Date.now() - new Date(chargedAt).getTime()) / (1000 * 60 * 60 * 24);
    const isBillingError  = reason === 'billing_error';
    const isIn7DayWindow  = daysSinceCharge <= 7;
    const isIn48HrWindow  = daysSinceCharge <= 2;
    const isIn30DayWindow = daysSinceCharge <= 30;
    const autoApprove     = isIn7DayWindow || isIn48HrWindow || isBillingError;
    return { daysSinceCharge, isBillingError, isIn7DayWindow, isIn48HrWindow, isIn30DayWindow, autoApprove };
  }

  router.post('/refund', auth, async (req, res) => {
    const { reason, test_days_override } = req.body || {};
    const VALID_REASONS = ['billing_error','unsatisfied','accidental','duplicate','other'];
    if (!reason) return res.status(400).json({ error:'reason required' });
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error:`Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}` });
    }

    const sub = await db.get(
      'SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1',
      [req.user.id]
    );
    if (!sub) return res.status(404).json({ error:'No subscription found for your account.' });

    // Allow test_days_override to simulate different time windows without waiting
    const chargedAt = test_days_override !== undefined
      ? new Date(Date.now() - test_days_override * 24 * 60 * 60 * 1000).toISOString()
      : (sub.created_at || new Date().toISOString());

    const elig = getRefundEligibility(chargedAt, reason);

    await db.run(
      `INSERT INTO refund_requests
         (user_id, subscription_id, reason, days_since_charge, auto_approve, status, created_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [req.user.id, sub.id, reason, Math.round(elig.daysSinceCharge),
       elig.autoApprove?1:0, elig.autoApprove?'pending_stripe':'pending_review']
    ).catch(()=>{});

    if (!elig.autoApprove && !elig.isIn30DayWindow) {
      return res.json({
        ok: true, status: 'denied',
        message: 'Refunds are available within 30 days of charge. Your subscription has been active for more than 30 days.',
        days_since_charge: Math.round(elig.daysSinceCharge),
      });
    }

    const status = elig.autoApprove ? 'pending_stripe' : 'pending_review';
    const message = elig.autoApprove
      ? 'Refund approved. Funds will appear within 5–10 business days.'
      : 'Your refund request is under review. Our team will respond within 1–2 business days.';

    return res.json({
      ok: true, status, message,
      auto_approve: elig.autoApprove,
      days_since_charge: Math.round(elig.daysSinceCharge),
      reason,
    });
  });

  // ── Bar verification (mirrors attorney_platform.js) ─────────────────────────
  const STATE_BAR_LOOKUP = {
    TN: 'https://www.tba.org/member-services/find-an-attorney/',
    CA: 'https://apps.calbar.ca.gov/attorney/Licensee/Detail/',
    NY: 'https://iapps.courts.state.ny.us/attorneyservices/search',
  };

  const VALID_STATES = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
    'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VT','VA','WA','WV','WI','WY',
  ]);

  router.post('/verify-bar', auth, async (req, res) => {
    const { bar_number, state } = req.body || {};
    if (!bar_number || !state) {
      return res.status(400).json({ error:'bar_number and state required' });
    }
    const stateUpper = state.trim().toUpperCase();
    if (!VALID_STATES.has(stateUpper)) {
      return res.status(400).json({ error:'Invalid state code. Use a 2-letter US state abbreviation (e.g. TN, CA).' });
    }
    const cleanBar = bar_number.trim().toUpperCase().replace(/[^A-Z0-9-]/g,'');
    if (cleanBar.length < 3 || cleanBar.length > 20) {
      return res.status(400).json({ error:'Bar number must be 3–20 characters.' });
    }

    // Check if already verified
    const current = await db.get('SELECT bar_verified, pending_bar_verification FROM users WHERE id=?', [req.user.id]);
    if (current?.bar_verified) {
      return res.json({ ok:true, status:'already_verified', message:'Your bar number is already verified.' });
    }

    // Store as PENDING — badge NOT granted
    await db.run(
      `UPDATE users SET bar_number=?, bar_state=?, pending_bar_verification=1, bar_verified=0 WHERE id=?`,
      [cleanBar, stateUpper, req.user.id]
    );

    const lookupUrl = STATE_BAR_LOOKUP[stateUpper] || 'https://www.americanbar.org/tools/find-a-lawyer/';
    return res.json({
      ok:true, status:'pending_review',
      message:"Bar number submitted. Our team verifies each submission against your state bar's official records. You will receive a notification within 1–2 business days.",
      bar_number: cleanBar, state: stateUpper, lookup_url: lookupUrl,
    });
  });

  router.post('/approve-verification', auth, async (req, res) => {
    const user = await db.get('SELECT role FROM users WHERE id=?', [req.user.id]);
    if (user?.role !== 'admin') return res.status(403).json({ error:'Admin access required.' });

    const { attorney_user_id, approved, rejection_reason } = req.body || {};
    if (!attorney_user_id || typeof approved !== 'boolean') {
      return res.status(400).json({ error:'attorney_user_id and approved (boolean) required' });
    }
    const attorney = await db.get('SELECT id FROM users WHERE id=?', [attorney_user_id]);
    if (!attorney) return res.status(404).json({ error:'Attorney not found.' });

    if (approved) {
      await db.run(
        `UPDATE users SET bar_verified=1, pending_bar_verification=0, bar_verified_at=datetime('now') WHERE id=?`,
        [attorney_user_id]
      );
    } else {
      await db.run(
        `UPDATE users SET pending_bar_verification=0, bar_rejection_reason=? WHERE id=?`,
        [rejection_reason || 'Could not verify bar status.', attorney_user_id]
      );
    }
    return res.json({ ok:true, approved, attorney_user_id });
  });

  const a = express();
  a.use(express.json());
  a.use('/api/billing', router);
  a.use('/api/attorney', router);
  return a;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
let db, app;
const U1=10, U2=11, ADMIN=99;
const T1=tok(U1), T2=tok(U2), TADMIN=adminTok(ADMIN);

beforeAll(async () => {
  db = await makeTestDb();
  await createSchema(db);

  // Seed users
  for (const [id, role] of [[U1,'user'],[U2,'user'],[ADMIN,'admin']]) {
    await db.run(
      'INSERT OR IGNORE INTO users (id,email,role,password_hash,bar_verified,pending_bar_verification) VALUES (?,?,?,?,0,0)',
      [id, `u${id}@test.com`, role, 'hashed_pw_test']
    );
  }

  // Ensure refund_requests table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, subscription_id INTEGER, reason TEXT NOT NULL,
      days_since_charge REAL, auto_approve INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending_review', created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed a subscription for U1
  await db.run(
    'INSERT INTO subscriptions (user_id,plan,status,created_at) VALUES (?,?,?,datetime("now"))',
    [U1,'pro','active']
  );

  app = await buildApp(db);
});

// ═══════════════════════════════════════════════════════════════════════════════
// REFUND POLICY
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/billing/refund — eligibility windows', () => {
  it('trial window (1 day): auto-approves full refund', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'unsatisfied', test_days_override:1 });
    expect(res.status).toBe(200);
    expect(res.body.auto_approve).toBe(true);
    expect(res.body.status).toBe('pending_stripe');
    expect(res.body.message).toMatch(/5.10 business days/i);
  });

  it('within 48 hours (0.5 day): auto-approves', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'accidental', test_days_override:0.5 });
    expect(res.status).toBe(200);
    expect(res.body.auto_approve).toBe(true);
  });

  it('billing error: auto-approves regardless of timing (25 days)', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'billing_error', test_days_override:25 });
    expect(res.status).toBe(200);
    expect(res.body.auto_approve).toBe(true);
    expect(res.body.reason).toBe('billing_error');
  });

  it('3–30 day window (15 days): pending_review, not auto-approved', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'unsatisfied', test_days_override:15 });
    expect(res.status).toBe(200);
    expect(res.body.auto_approve).toBe(false);
    expect(res.body.status).toBe('pending_review');
    expect(res.body.message).toMatch(/review/i);
  });

  it('after 30 days (45 days): denied', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'unsatisfied', test_days_override:45 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.message).toMatch(/30 days/i);
  });

  it('requires valid reason', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ reason:'i_just_want_money_back', test_days_override:1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid reason/i);
  });

  it('requires reason field', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T1}`)
      .send({ test_days_override:1 });
    expect(res.status).toBe(400);
  });

  it('404 for user with no subscription', async () => {
    const res = await request(app)
      .post('/api/billing/refund')
      .set('Authorization', `Bearer ${T2}`)
      .send({ reason:'unsatisfied', test_days_override:1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no subscription/i);
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/billing/refund').send({ reason:'other' })).status).toBe(401);
  });

  it('all valid reasons are accepted', async () => {
    for (const reason of ['billing_error','unsatisfied','accidental','duplicate','other']) {
      const res = await request(app)
        .post('/api/billing/refund')
        .set('Authorization', `Bearer ${T1}`)
        .send({ reason, test_days_override:1 });
      expect(res.status).toBe(200);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BAR VERIFICATION — SUBMISSION (PHASE 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/attorney/verify-bar — submission (Phase 1)', () => {
  it('accepts valid bar number and state — stores as PENDING (not verified)', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'TN12345', state:'TN' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_review');
    expect(res.body.bar_number).toBe('TN12345');
    expect(res.body.state).toBe('TN');

    // CRITICAL: badge must NOT be granted
    const user = await db.get('SELECT bar_verified, pending_bar_verification FROM users WHERE id=?', [U1]);
    expect(user.bar_verified).toBe(0);           // badge NOT granted
    expect(user.pending_bar_verification).toBe(1); // flagged for admin review
  });

  it('returns state bar lookup URL', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'TN12345', state:'TN' });
    expect(res.body.lookup_url).toContain('tba.org');
  });

  it('rejects invalid state code', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'123456', state:'XX' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid state code/i);
  });

  it('rejects bar number too short (< 3 chars)', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'AB', state:'TN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3.20 characters/i);
  });

  it('rejects bar number too long (> 20 chars)', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'ABCDEFGHIJKLMNOPQRSTUVWXYZ', state:'CA' });
    expect(res.status).toBe(400);
  });

  it('requires both bar_number and state', async () => {
    expect((await request(app).post('/api/attorney/verify-bar').set('Authorization',`Bearer ${T1}`).send({ state:'TN' })).status).toBe(400);
    expect((await request(app).post('/api/attorney/verify-bar').set('Authorization',`Bearer ${T1}`).send({ bar_number:'12345' })).status).toBe(400);
  });

  it('normalises bar number to uppercase', async () => {
    const res = await request(app)
      .post('/api/attorney/verify-bar')
      .set('Authorization', `Bearer ${T1}`)
      .send({ bar_number:'tn-98765', state:'tn' });
    expect(res.status).toBe(200);
    expect(res.body.bar_number).toBe('TN-98765');
    expect(res.body.state).toBe('TN');
  });

  it('accepts all 50 states (spot check)', async () => {
    for (const state of ['AL','CA','NY','TX','FL','WA','OR','CO','IL','OH']) {
      const res = await request(app)
        .post('/api/attorney/verify-bar')
        .set('Authorization', `Bearer ${T1}`)
        .send({ bar_number:'TEST123', state });
      expect(res.status).toBe(200);
    }
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/attorney/verify-bar').send({ bar_number:'123', state:'TN' })).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BAR VERIFICATION — APPROVAL (PHASE 2, ADMIN ONLY)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/attorney/approve-verification — admin grant (Phase 2)', () => {
  const ATTORNEY_ID = 50;

  beforeAll(async () => {
    await db.run(
      'INSERT OR IGNORE INTO users (id,email,role,password_hash,bar_verified,bar_number,pending_bar_verification) VALUES (?,?,?,?,?,?,?)',
      [ATTORNEY_ID,'atty@test.com','defender','hashed_pw_test',0,'TN99999',1]
    );
  });

  it('non-admin is rejected with 403', async () => {
    const res = await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization', `Bearer ${T1}`)
      .send({ attorney_user_id:ATTORNEY_ID, approved:true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('admin can reject — bar_verified stays 0', async () => {
    const res = await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization', `Bearer ${TADMIN}`)
      .send({ attorney_user_id:ATTORNEY_ID, approved:false, rejection_reason:'Name does not match bar records.' });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(false);

    const user = await db.get('SELECT bar_verified, pending_bar_verification FROM users WHERE id=?', [ATTORNEY_ID]);
    expect(user.bar_verified).toBe(0);           // still not verified
    expect(user.pending_bar_verification).toBe(0); // cleared
  });

  it('admin can approve — grants bar_verified=1', async () => {
    // Reset to pending first
    await db.run('UPDATE users SET pending_bar_verification=1 WHERE id=?', [ATTORNEY_ID]);

    const res = await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization', `Bearer ${TADMIN}`)
      .send({ attorney_user_id:ATTORNEY_ID, approved:true });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);

    const user = await db.get('SELECT bar_verified, pending_bar_verification FROM users WHERE id=?', [ATTORNEY_ID]);
    expect(user.bar_verified).toBe(1);           // badge granted
    expect(user.pending_bar_verification).toBe(0); // cleared
  });

  it('returns 404 for nonexistent attorney', async () => {
    const res = await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization', `Bearer ${TADMIN}`)
      .send({ attorney_user_id:99999, approved:true });
    expect(res.status).toBe(404);
  });

  it('requires attorney_user_id and approved boolean', async () => {
    expect((await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization',`Bearer ${TADMIN}`)
      .send({ attorney_user_id:ATTORNEY_ID })).status).toBe(400);
    expect((await request(app)
      .post('/api/attorney/approve-verification')
      .set('Authorization',`Bearer ${TADMIN}`)
      .send({ approved:true })).status).toBe(400);
  });
});
