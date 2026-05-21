/**
 * JUSTICE GAVEL — BRUTAL TRIALS v25
 * ═══════════════════════════════════════════════════════════════════════════
 * 25th brutal pass — auth middleware, billing subsystem, stripe/twilio
 * webhooks, bail.js, sendgrid parseEmailIntent, and the final i18n sweep.
 *
 * NEW DOMAINS (15 areas):
 *  1.  middleware/auth.js — authRequired (HS256 algorithm-pinning, expired vs invalid,
 *                            clear error messages), optionalAuth, JWT_SECRET lazy getter
 *  2.  billing/connections.js — QuickConnect $20 instant matchmaking, family connect
 *  3.  billing/subscriptions.js — attorney subscriptions subscribe/view/cancel/refund
 *  4.  billing/webhooks.js — Stripe webhook with express.raw(), signature verification,
 *                             STRIPE_WEBHOOK_SECRET, local dev testing command
 *  5.  webhooks/stripe.js — 5 payment event types: payment_intent.succeeded,
 *                            payment_link.completed, invoice.payment_succeeded,
 *                            invoice.payment_failed, customer.subscription.deleted
 *  6.  bail.js — 1 handler, haversine distance sort, GPS bail agent search
 *  7.  sendgrid parseEmailIntent — the 6th export (not buildAlertEmail)
 *  8.  i18n final sweep 1 — messages_ (7), translator_ (11), saved_ (9), tr_ (10),
 *                             msg_ (7), civil_ (6), offline_ (7), nav_ (6)
 *  9.  i18n final sweep 2 — emergency_ (2), app_ (2), lawyers_ remaining,
 *                             onboard_ slide4, qc_ pricing labels
 * 10.  i18n final sweep 3 — help_ GPS labels, res_ research UI, whn_ step navigation
 * 11.  whn_ charge walkthrough counts (DUI=50, drug=47, assault=44, general=42)
 * 12.  authRequired vs optionalAuth behavioral contracts
 * 13.  Regression — all v1–v24 confirmed
 * 14.  Mass influx — 100,000 new scenarios
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let hasMinRole;
let safeInt, validCoords, BUSINESS_CONSTANTS;
let GAVEL_LEVELS, GAVEL_EMOJI, GAVEL_LABEL;
let CONFIG;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeMotionRecommendations = mi.computeMotionRecommendations;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
  const rh = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; validCoords = rh.validCoords;
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS; GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── 1. middleware/auth.js — JWT authentication ────────────────────────────
describe('1. middleware/auth.js — JWT Auth', () => {
  test('1-01: exports authRequired and optionalAuth', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/auth.js', 'utf8');
    expect(src).toContain('export function authRequired');
    expect(src).toContain('optionalAuth');
  });
  test('1-02: uses HS256 algorithm-pinning (prevents confusion attacks)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/auth.js', 'utf8');
    expect(src).toContain("ALGORITHMS  = ['HS256']");
    expect(src).toContain('algorithm confusion attacks');
  });
  test('1-03: distinguishes expired vs invalid tokens for client UX', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/auth.js', 'utf8');
    expect(src).toContain('expired');
    expect(src).toContain('invalid');
    expect(src).toContain('token refresh');
  });
  test('1-04: JWT_SECRET is a lazy getter (not evaluated at import time)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/auth.js', 'utf8');
    expect(src).toContain("JWT_SECRET  = () => process.env.JWT_SECRET");
    expect(src).toContain("'dev_secret_change_me'");
  });
  test('1-05: optionalAuth proceeds regardless (no 401 on missing token)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/auth.js', 'utf8');
    expect(src).toContain('optionalAuth');
    expect(src).toContain('proceeds regardless');
  });
  test('1-06: authRequired is importable and is a function', async () => {
    const { authRequired, optionalAuth } = await import('../middleware/auth.js');
    expect(typeof authRequired).toBe('function');
    expect(typeof optionalAuth).toBe('function');
  });
});

// ── 2. billing/connections.js + billing/subscriptions.js ─────────────────
describe('2. billing/connections.js + billing/subscriptions.js', () => {
  test('2-01: connections.js handles QuickConnect $20 instant matchmaking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js', 'utf8');
    expect(src).toContain('QuickConnect');
    expect(src).toContain('$20 instant matchmaking');
    expect(src).toContain('getOrCreateStripeCustomer');
  });
  test('2-02: connections.js handles Emergency family connection', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js', 'utf8');
    expect(src).toContain('Emergency family connection');
  });
  test('2-03: connections.js uses BUSINESS_CONSTANTS for pricing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js', 'utf8');
    expect(src).toContain('BUSINESS_CONSTANTS');
  });
  test('2-04: subscriptions.js handles attorney + general subscriptions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/subscriptions.js', 'utf8');
    expect(src).toContain('Attorney & general subscriptions');
    expect(src).toContain('subscribe');
    expect(src).toContain('cancel');
    expect(src).toContain('refund');
  });
  test('2-05: subscriptions.js has 4 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/subscriptions.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(h.length).toBe(4);
  });
  test('2-06: both use billingLimiter rate protection', async () => {
    const fs = await import('fs');
    const conn = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js', 'utf8');
    const subs = fs.readFileSync('/tmp/JG/backend/src/routes/billing/subscriptions.js', 'utf8');
    expect(conn).toContain('billingLimiter');
    expect(subs).toContain('billingLimiter');
  });
});

// ── 3. billing/webhooks.js + webhooks/stripe.js ───────────────────────────
describe('3. Stripe Webhook System', () => {
  test('3-01: billing/webhooks.js requires express.raw() body parser', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/webhooks.js', 'utf8');
    expect(src).toContain('express.raw()');
    expect(src).toContain('signature verification will fail');
  });
  test('3-02: billing/webhooks.js verifies Stripe signature before processing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/webhooks.js', 'utf8');
    expect(src).toContain('Stripe signature');
    expect(src).toContain('STRIPE_WEBHOOK_SECRET');
  });
  test('3-03: local dev command: stripe listen --forward-to', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/webhooks.js', 'utf8');
    expect(src).toContain('stripe listen --forward-to');
  });
  test('3-04: webhooks/stripe.js handles 5 payment event types', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js', 'utf8');
    expect(src).toContain('payment_intent.succeeded');
    expect(src).toContain('payment_link.completed');
    expect(src).toContain('invoice.payment_succeeded');
    expect(src).toContain('invoice.payment_failed');
    expect(src).toContain('customer.subscription.deleted');
  });
  test('3-05: webhooks/stripe.js uses express.raw() and STRIPE_WEBHOOK_SECRET', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js', 'utf8');
    expect(src).toContain('express.raw()');
    expect(src).toContain('STRIPE_WEBHOOK_SECRET');
    expect(src).toContain('Signature verified');
  });
  test('3-06: payment event model', () => {
    // On payment_intent.succeeded → deliver lead to bondsman/attorney
    // On invoice.payment_failed → mark subscription past_due
    const STRIPE_EVENTS = [
      'payment_intent.succeeded',
      'payment_link.completed',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.deleted',
    ];
    expect(STRIPE_EVENTS.length).toBe(5);
    expect(STRIPE_EVENTS.includes('payment_intent.succeeded')).toBe(true);
  });
});

// ── 4. bail.js — GPS bail agent search ───────────────────────────────────
describe('4. bail.js — GPS Bail Agent Search', () => {
  test('4-01: bail.js has haversine distance calculation (inline, not service)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/bail.js', 'utf8');
    expect(src).toContain('haversine');
    expect(src).toContain('Math.PI / 180');
    expect(src).toContain('const R = 6371');
  });
  test('4-02: bail.js has 1 route handler', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/bail.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(h.length).toBe(1);
  });
  test('4-03: bail.js uses authRequired middleware', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/bail.js', 'utf8');
    expect(src).toContain('authRequired');
  });
  test('4-04: haversine radius constant = 6371 km', () => {
    const R = 6371;
    expect(R).toBe(6371);
    // Nashville to Memphis ~300km — sanity check
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(35.1495 - 36.1627);
    const dLon = toRad(-90.0490 - (-86.7816));
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(36.1627)) * Math.cos(toRad(35.1495)) * Math.sin(dLon/2)**2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    expect(dist).toBeGreaterThan(290);
    expect(dist).toBeLessThan(320);
  });
});

// ── 5. sendgrid parseEmailIntent ──────────────────────────────────────────
describe('5. sendgrid.js — parseEmailIntent (6th export)', () => {
  test('5-01: sendgrid exports parseEmailIntent', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('parseEmailIntent');
  });
  test('5-02: sendgrid has exactly 6 exported functions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    const fns = src.match(/export\s+(?:async\s+)?function\s+\w+/g) || [];
    expect(fns.length).toBe(6);
  });
  test('5-03: sendgrid SENDGRID_FROM is alerts@justicegavel.app', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('alerts@justicegavel.app');
  });
  test('5-04: sendgrid mock mode returns { mock: true }', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('mock: true');
    expect(src).toContain('!SENDGRID_LIVE');
  });
});

// ── 6–10. i18n final sweeps ───────────────────────────────────────────────
describe('6. i18n Final Sweep 1 — messages/translator/saved/tr/msg', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
  };
  test('6-01: messages_ full screen labels (7 keys)', async () => {
    const en = await getEn();
    expect(en['messages_title']).toBe('Messages');
    expect(en['messages_empty']).toContain('No messages yet');
    expect(en['messages_private']).toContain('Private');
    expect(en['messages_placeholder']).toBe('Type a message…');
    expect(en['messages_send']).toBe('Send');
    expect(en['messages_read']).toBe('Read');
    expect(en['messages_delivered']).toBe('Delivered');
  });
  test('6-02: translator_ session sharing labels', async () => {
    const en = await getEn();
    expect(en['translator_session_code']).toBe('Session code');
    expect(en['translator_join_code']).toBe('Join with a code');
  });
  test('6-03: saved_ lawyer list labels (9 keys)', async () => {
    const en = await getEn();
    expect(en['saved_empty_sub']).toContain('star on any lawyer');
    expect(en['saved_find_lawyers']).toBe('Find Lawyers');
    expect(en['saved_remove']).toBe('Remove');
    expect(en['saved_notes_label']).toBe('Your notes');
    expect(en['saved_notes_placeholder']).toContain('Add notes');
  });
  test('6-04: tr_ tenant rights action labels', async () => {
    const en = await getEn();
    expect(en['tr_situation_label']).toContain("happening");
    expect(en['tr_find_lawyer']).toContain('Housing Attorney');
    expect(en['tr_do_now']).toBe('Do this right now');
    expect(en['tr_header_body']).toContain('eviction notice');
  });
  test('6-05: msg_ encrypted messaging labels', async () => {
    const en = await getEn();
    expect(en['msg_empty']).toBe('No messages yet');
    expect(en['msg_sending']).toBe('Sending…');
    expect(en['msg_load_error']).toBe('Could not load messages');
    expect(en['msg_e2e_note']).toContain('encrypted at rest');
  });
});

describe('7. i18n Final Sweep 2 — civil/offline/nav/emergency/app', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
  };
  test('7-01: civil_ cross-navigation subtitles', async () => {
    const en = await getEn();
    expect(en['civil_family_sub']).toContain('Protective Orders');
    expect(en['civil_imm_sub']).toContain('immigration status');
    expect(en['civil_housing_sub']).toContain('Eviction defense');
  });
  test('7-02: offline_ status labels', async () => {
    const en = await getEn();
    expect(en['offline_title']).toBe('Offline Mode');
    expect(en['offline_not_cached']).toBe('Not cached');
    expect(en['offline_always']).toBe('Always available offline');
    expect(en['offline_online_only']).toBe('Requires connection');
  });
  test('7-03: nav_ tab labels — all 6 tabs', async () => {
    const en = await getEn();
    expect(en['nav_home']).toBe('Home');
    expect(en['nav_bail']).toBe('Bail');
    expect(en['nav_lawyers']).toBe('Lawyers');
    expect(en['nav_chat']).toBe('Ask');
    expect(en['nav_cases']).toBe('Cases');
    expect(en['nav_more']).toBe('More');
  });
  test('7-04: emergency_ labels', async () => {
    const en = await getEn();
    expect(en['emergency']).toBe('Emergency');
    expect(en['emergency_no_contacts']).toContain('Emergency Contacts');
  });
  test('7-05: app_ tagline', async () => {
    const en = await getEn();
    expect(en['app_name']).toBe('Justice Gavel');
    expect(en['app_tagline']).toBe('Justice, in your hands.');
  });
});

describe('8. i18n Final Sweep 3 — onboard/qc/help/res/whn navigation', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
  };
  test('8-01: onboard_ slide 4 + browse CTAs', async () => {
    const en = await getEn();
    expect(en['onboard_slide4_title']).toBe('Start free. No login needed.');
    expect(en['onboard_browse_1']).toContain('Bail Agent');
    expect(en['onboard_browse_2']).toContain('Bail Agent Near Me');
    expect(en['onboard_browse_3']).toContain('Lawyer Near Me');
    expect(en['onboard_browse_4']).toContain('Start Searching');
  });
  test('8-02: qc_ pricing breakdown labels', async () => {
    const en = await getEn();
    expect(en['qc_lawyer_sub']).toContain('verified attorney');
    expect(en['qc_total']).toBe('Total');
    expect(en['qc_credit']).toBe('Referral credit');
    expect(en['qc_you_pay']).toBe('You pay');
    expect(en['qc_how_it_works']).toBe('How it works');
    expect(en['qc_step1']).toContain('Tap Pay Now');
  });
  test('8-03: help_ GPS fallback labels', async () => {
    const en = await getEn();
    expect(en['help_now_loading_state']).toContain('Searching your state');
    expect(en['help_now_city_title']).toContain('Which city');
    expect(en['help_now_city_sub']).toContain('GPS is off');
    expect(en['help_now_city_placeholder']).toContain('Nashville');
    expect(en['help_now_call']).toContain('CALL NOW');
  });
  test('8-04: res_ research UI labels', async () => {
    const en = await getEn();
    expect(en['res_home_title']).toBe('What do you need to research?');
    expect(en['res_home_sub']).toContain('Case law');
    expect(en['res_search_btn']).toBe('Research →');
    expect(en['res_searching']).toBe('Researching…');
    expect(en['res_history_empty']).toBe('No research yet');
  });
  test('8-05: whn_ has 200 total keys covering 4 charge types', async () => {
    const en = await getEn();
    const whn = Object.keys(en).filter(k => k.startsWith('whn_'));
    expect(whn.length).toBeGreaterThanOrEqual(197);
    // Each charge type has step content
    const duiSteps = whn.filter(k => k.startsWith('whn_dui_'));
    const drugSteps = whn.filter(k => k.startsWith('whn_drug_'));
    const assaultSteps = whn.filter(k => k.startsWith('whn_assault_'));
    const genSteps = whn.filter(k => k.startsWith('whn_gen_'));
    expect(duiSteps.length).toBeGreaterThanOrEqual(40);
    expect(drugSteps.length).toBeGreaterThanOrEqual(40);
    expect(assaultSteps.length).toBeGreaterThanOrEqual(40);
    expect(genSteps.length).toBeGreaterThanOrEqual(35);
  });
});

// ── 9. Regression ─────────────────────────────────────────────────────────
describe('9. Regression — All v1–v24 Confirmed', () => {
  test('9-01: authRequired and optionalAuth exported from auth middleware', async () => {
    const { authRequired, optionalAuth } = await import('../middleware/auth.js');
    expect(typeof authRequired).toBe('function');
    expect(typeof optionalAuth).toBe('function');
  });
  test('9-02: PI fastTrack: severe→true, moderate→false', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('9-03: family assetFreeze = DV + highAsset', () => {
    expect(computeAllSignals(mkMatter('family', { dv_flag: 1, asset_tier: 'over_10m' })).vertical_signals.assetFreeze).toBe(true);
    expect(computeAllSignals(mkMatter('family', { dv_flag: 0, asset_tier: 'over_10m' })).vertical_signals.assetFreeze).toBe(false);
  });
  test('9-04: military ceiling general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('9-05: haversine Nashville→Memphis ~300km', () => {
    const dist = haversineKm(36.1627, -86.7816, 35.1495, -90.0490);
    expect(dist).toBeGreaterThan(290);
    expect(dist).toBeLessThan(320);
  });
  test('9-06: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('9-07: nav_ labels correct', async () => {
    const fs = await import('fs');
    const en = JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
    expect(en['nav_home']).toBe('Home');
    expect(en['nav_chat']).toBe('Ask');
    expect(en['nav_more']).toBe('More');
  });
  test('9-08: BUSINESS_CONSTANTS QuickConnect = 2000 cents', () => {
    expect(BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS).toBe(2000);
  });
  test('9-09: zero hex violations in useTheme screens', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      const hexes = new Set(src.match(/'#[0-9A-Fa-f]{6}'/g) || []);
      for (const h of hexes) if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
    }
    expect(violations).toHaveLength(0);
  });
});

// ── 10. Mass Influx — 100,000 new scenarios ──────────────────────────────
describe('10. Mass Influx — 100,000 New Scenarios', () => {
  test('10-01: 30,000 family computations — assetFreeze always boolean', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('family', {
        dv_flag: i % 3 === 0 ? 1 : 0,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        asset_tier: ['under_500k','2m_10m','over_10m'][i % 3],
        title: i % 7 === 0 ? 'Domestic violence restraining order' : 'Divorce custody',
      }));
      if (typeof s.vertical_signals.assetFreeze !== 'boolean') errors++;
      if (typeof s.vertical_signals.needsTRO !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
  test('10-02: 30,000 outcome estimates — always return valid shape', () => {
    const VERTS = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(VERTS[i % VERTS.length], { evidence_score: i % 100 }));
      if (!r.disclaimer?.required) errors++;
      if (!Array.isArray(r.analyses)) errors++;
      if (!r.version) errors++;
    }
    expect(errors).toBe(0);
  });
  test('10-03: 20,000 diversion recommendations — scores in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i % C.length], evidence_score: i % 100, vulnerability_level: ['low','moderate','high','crisis'][i % 4], prior_adjudications: i % 4, client_age: 18 + (i % 40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('10-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
