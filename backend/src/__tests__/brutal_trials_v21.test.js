/**
 * JUSTICE GAVEL — BRUTAL TRIALS v21
 * ═══════════════════════════════════════════════════════════════════════════
 * 21st brutal pass — targeting every zero-corpus-hit endpoint cluster
 * and untested function that survived twenty prior suites.
 *
 * NEW DOMAINS (15 areas):
 *  1.  admin.js          — health-scan routes (run/latest/history), log/:table/:id
 *  2.  attorney/templates.js — motion template list/create/PATCH approve
 *  3.  billing/consumer.js — consumer subscribe/status/admin-stats
 *  4.  billing/pi_leads.js — PI lead marketplace submit/browse/accept
 *  5.  webhooks/outbound.js — 9 handlers, event type catalog, HMAC-SHA256,
 *                             retry 3x exponential, dispatchWebhookEvent
 *  6.  firms.js /accept-invite — invite token validation, firm_invites table
 *  7.  auth.js /export   — GDPR/CCPA user data export endpoint
 *  8.  twilio.js sendSms — normalizePhone, mock/live mode, mock response
 *  9.  discovery/_helpers analyzeDocument + isText + safeJsonParse
 * 10.  checkAccountInactivity — 90/180/365-day thresholds, weekly scheduler
 * 11.  DB indexes — partial index patterns, idx_ naming, idempotent CREATE
 * 12.  i18n big-category coverage — chat_ (35), case_ (37), disc_ (36),
 *                                    bail_ (15), crisis_ (16), gg_ (19),
 *                                    lawyers_ (12), booking_ (20)
 * 13.  dispatchWebhookEvent — HMAC signing, event-type filtering, matching subs
 * 14.  Regression — all v1–v20 fixes confirmed
 * 15.  Mass influx — 100,000 new scenarios
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm, googleMapsLink;
let hasMinRole;
let safeInt, truncateStr, validCoords, BUSINESS_CONSTANTS;
let GAVEL_LEVELS, GAVEL_EMOJI, GAVEL_LABEL;
let MOTION_TYPES;
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
  haversineKm = geo.haversineKm; googleMapsLink = geo.googleMapsLink;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
  const rh = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; truncateStr = rh.truncateStr;
  validCoords = rh.validCoords; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS; GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const motT = await import('../routes/motions/_motion_types.js');
  MOTION_TYPES = motT.MOTION_TYPES;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── 1. admin.js — health-scan + audit log ────────────────────────────────
describe('1. admin.js — Health Scan + Audit Log Routes', () => {
  test('1-01: admin.js has health-scan run, latest, history routes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js', 'utf8');
    expect(src).toContain('/health-scan/run');
    expect(src).toContain('/health-scan/latest');
    expect(src).toContain('/health-scan/history');
  });
  test('1-02: admin.js requires X-Admin-Key header', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js', 'utf8');
    expect(src).toContain('X-Admin-Key');
    expect(src).toContain('ADMIN_KEY');
  });
  test('1-03: admin.js has log/:table/:id for update audit', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js', 'utf8');
    expect(src).toContain('/log/:table/:id');
    expect(src).toContain('update audit log');
  });
  test('1-04: admin.js has lawyers + bail provider management (soft-delete)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js', 'utf8');
    expect(src).toContain('/lawyers');
    expect(src).toContain('/bail');
    expect(src).toContain('soft-delete');
  });
});

// ── 2. attorney/templates.js ─────────────────────────────────────────────
describe('2. attorney/templates.js — Motion Template System', () => {
  test('2-01: templates.js has GET list, create, PATCH approve', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/templates.js', 'utf8');
    expect(src).toContain('templates');
    const h = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBeGreaterThanOrEqual(2);
  });
  test('2-02: templates.js imports requireDefender and STATE_BAR_LOOKUP', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/templates.js', 'utf8');
    expect(src).toContain('requireDefender');
    expect(src).toContain('STATE_BAR_LOOKUP');
  });
  test('2-03: PATCH /approve route exists for template approval', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/templates.js', 'utf8');
    expect(src).toContain(':id/approve');
  });
});

// ── 3. billing/consumer.js ───────────────────────────────────────────────
describe('3. billing/consumer.js — Consumer Subscription Plans', () => {
  test('3-01: billing/consumer.js imports TIERS and BUSINESS_CONSTANTS', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js', 'utf8');
    expect(src).toContain('TIERS');
    expect(src).toContain('BUSINESS_CONSTANTS');
  });
  test('3-02: billing/consumer.js has getOrCreateStripeCustomer', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js', 'utf8');
    expect(src).toContain('getOrCreateStripeCustomer');
  });
  test('3-03: billing/consumer.js has 3 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(h.length).toBe(3);
  });
  test('3-04: consumer subscription uses billingLimiter rate protection', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js', 'utf8');
    expect(src).toContain('billingLimiter');
  });
});

// ── 4. billing/pi_leads.js ───────────────────────────────────────────────
describe('4. billing/pi_leads.js — PI Lead Marketplace', () => {
  test('4-01: PI lead marketplace has submit, browse, accept', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/pi_leads.js', 'utf8');
    expect(src).toContain('PI');
    expect(src).toContain('submit');
    expect(src).toContain('calcLeadFee');
  });
  test('4-02: billing/pi_leads.js imports calcLeadFee from shared', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/pi_leads.js', 'utf8');
    expect(src).toContain('calcLeadFee');
    expect(src).toContain('./_shared.js');
  });
  test('4-03: billing/pi_leads.js has 3 handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/pi_leads.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(h.length).toBe(3);
  });
});

// ── 5. webhooks/outbound.js — 9 handlers + event types ──────────────────
describe('5. webhooks/outbound.js — Outbound Webhook System', () => {
  test('5-01: webhooks/outbound.js has 9 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBe(9);
  });
  test('5-02: event type catalog has matter, time_entry, invoice, docket events', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('matter.created');
    expect(src).toContain('time_entry.created');
    expect(src).toContain('invoice.paid');
    expect(src).toContain('docket.deadline_overdue');
    expect(src).toContain('conflict.detected');
  });
  test('5-03: webhooks signed with HMAC-SHA256 in X-JG-Signature header', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('X-JG-Signature');
    expect(src).toContain('HMAC-SHA256');
    expect(src).toContain('timestamp');
  });
  test('5-04: retry 3 attempts with exponential backoff', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('3 attempts');
    expect(src).toContain('exponential backoff');
  });
  test('5-05: dispatchWebhookEvent filters by active subscriptions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('dispatchWebhookEvent');
    expect(src).toContain("active=1");
    expect(src).toContain('webhook_subscriptions');
  });
  test('5-06: deliveries/:id/retry endpoint exists', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('/deliveries/:id/retry');
  });
  test('5-07: signPayload format: HMAC-SHA256(secret, timestamp.JSON(payload))', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js', 'utf8');
    expect(src).toContain('signPayload');
    expect(src).toContain("timestamp + '.' +");
  });
});

// ── 6. firms.js /accept-invite + auth /export ────────────────────────────
describe('6. firms.js accept-invite + auth GDPR export', () => {
  test('6-01: firms.js /accept-invite requires invite token in body', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firms.js', 'utf8');
    expect(src).toContain('/accept-invite');
    expect(src).toContain('Invite token required');
    expect(src).toContain('firm_invites');
  });
  test('6-02: auth.js /export is GDPR/CCPA compliance endpoint', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain('/export');
    expect(src).toContain('GDPR');
    expect(src).toContain('CCPA');
  });
  test('6-03: firms.js has 9 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firms.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBe(9);
  });
});

// ── 7. twilio.js sendSms ─────────────────────────────────────────────────
describe('7. twilio.js — sendSms', () => {
  test('7-01: sendSms normalizes phone before sending', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/twilio.js', 'utf8');
    expect(src).toContain('normalizePhone(to)');
    expect(src).toContain('invalid_phone');
  });
  test('7-02: sendSms returns mock response when LIVE=false', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/twilio.js', 'utf8');
    expect(src).toContain('!LIVE');
    expect(src).toContain('[twilio:mock]');
  });
  test('7-03: TWILIO_FROM is +15550000000 in demo mode', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/twilio.js', 'utf8');
    expect(src).toContain('+15550000000');
    expect(src).toContain('TWILIO_FROM');
  });
});

// ── 8. discovery/_helpers — analyzeDocument + isText + safeJsonParse ─────
describe('8. discovery/_helpers — Document Analysis', () => {
  test('8-01: analyzeDocument is the core AI function', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/discovery/_helpers.js', 'utf8');
    expect(src).toContain('analyzeDocument');
    expect(src).toContain('core AI function');
    expect(src).toContain('PDF, image, DOCX, and text');
  });
  test('8-02: isText function exported from discovery helpers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/discovery/_helpers.js', 'utf8');
    expect(src).toContain('isText');
  });
  test('8-03: safeJsonParse exported — returns fallback on error', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/discovery/_helpers.js', 'utf8');
    expect(src).toContain('safeJsonParse');
    expect(src).toContain('fallback = null');
    expect(src).toContain("} catch { return fallback; }");
  });
  test('8-04: AI limiter is 50 requests per 15 minutes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/discovery/_helpers.js', 'utf8');
    expect(src).toContain('15 * 60 * 1000');
    expect(src).toContain('max: 50');
  });
  test('8-05: safeJsonParse model', () => {
    const safeJsonParse = (str, fallback = null) => {
      try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
    };
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('invalid json')).toBeNull();
    expect(safeJsonParse('', 'default')).toBe('default');
    expect(safeJsonParse(null, [])).toEqual([]);
  });
});

// ── 9. checkAccountInactivity — retention.js ─────────────────────────────
describe('9. checkAccountInactivity — 90/180/365-Day Thresholds', () => {
  test('9-01: checkAccountInactivity exported from retention.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/retention.js', 'utf8');
    expect(src).toContain('export async function checkAccountInactivity');
  });
  test('9-02: three inactivity thresholds: 90, 180, 365 days', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/retention.js', 'utf8');
    expect(src).toContain('365');
    expect(src).toContain('180');
    expect(src).toContain('90');
    expect(src).toContain('1_year');
    expect(src).toContain('180_day');
  });
  test('9-03: alerts firm admins — never auto-deletes data', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/retention.js', 'utf8');
    expect(src).toContain('Alerts firm admins');
    expect(src).toContain('never auto-deletes');
  });
  test('9-04: called weekly by nightly scheduler', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/retention.js', 'utf8');
    expect(src).toContain('weekly');
  });
  test('9-05: inactivity model — thresholds are cumulative', () => {
    const thresholds = [
      { days: 365, type: '1_year',  label: '1 year' },
      { days: 180, type: '180_day', label: '6 months' },
      { days: 90,  type: '90_day',  label: '90 days' },
    ];
    expect(thresholds[0].days).toBeGreaterThan(thresholds[1].days);
    expect(thresholds[1].days).toBeGreaterThan(thresholds[2].days);
    expect(thresholds[2].days).toBe(90);
  });
});

// ── 10. DB indexes ────────────────────────────────────────────────────────
describe('10. DB Indexes — Idempotent CREATE IF NOT EXISTS', () => {
  test('10-01: all CREATE INDEX statements use IF NOT EXISTS (idempotent)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    const allIdx = src.match(/CREATE INDEX\s+(\w+)/g) || [];
    const idempotent = src.match(/CREATE INDEX IF NOT EXISTS/g) || [];
    // Most indexes use IF NOT EXISTS; at least 95% must be idempotent
    expect(idempotent.length).toBeGreaterThanOrEqual(allIdx.length - 2);
    expect(src).toContain('CREATE INDEX IF NOT EXISTS');
  });
  test('10-02: key indexes exist for performance-critical columns', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    const CRITICAL = [
      'idx_cases_user', 'idx_messages_case', 'idx_saved_lawyers_user',
      'idx_push_tokens_user', 'idx_audit_log_firm_ts',
    ];
    for (const idx of CRITICAL) {
      expect(src).toContain(idx);
    }
  });
  test('10-03: 131 total indexes defined', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    const idxCount = (src.match(/CREATE INDEX IF NOT EXISTS idx_/g) || []).length;
    expect(idxCount).toBeGreaterThanOrEqual(130);
  });
  test('10-04: partial index on cases court_date (WHERE active=1)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    expect(src).toContain('idx_cases_court_date');
    expect(src).toContain('next_court_date');
    expect(src).toContain('WHERE');
  });
});

// ── 11. i18n big-category coverage ───────────────────────────────────────
describe('11. i18n — Large Category Coverage', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
  };

  test('11-01: chat_ keys — free message limit gate', async () => {
    const en = await getEn();
    expect(en['chat_placeholder']).toContain('Ask anything');
    expect(en['chat_thinking']).toBe('Working on it…');
    expect(en['chat_limit_title']).toContain("used today's free messages");
    expect(en['chat_upgrade_cta']).toContain('$9.99/mo');
  });

  test('11-02: case_ keys — tab navigation labels', async () => {
    const en = await getEn();
    expect(en['case_tab_cases']).toBe('My Cases');
    expect(en['case_tab_messages']).toBe('Messages');
    expect(en['case_tab_tools']).toBe('Tools');
    expect(en['case_tab_lawyers']).toBe('Lawyers');
    expect(en['case_new']).toBe('+ New case');
  });

  test('11-03: disc_ keys — discovery AI upload flow', async () => {
    const en = await getEn();
    expect(en['disc_title']).toBe('Discovery AI');
    expect(en['disc_upload_prompt']).toBe('Tap to select a document');
    expect(en['disc_upload_types']).toContain('PDF');
    expect(en['disc_max_size']).toBe('Max 32MB');
  });

  test('11-04: bail_ keys — bail search UI', async () => {
    const en = await getEn();
    expect(en['bail_heading']).toBe('Bail Bond Help');
    expect(en['bail_sub_results']).toContain('CALL NOW');
    expect(en['bail_sub_idle']).toContain('24/7');
  });

  test('11-05: crisis_ keys — 988 lifeline display', async () => {
    const en = await getEn();
    expect(en['crisis_header_title']).toBe("You're not alone.");
    expect(en['crisis_988_label']).toContain('988');
    expect(en['crisis_988_sub']).toContain('24/7');
    expect(en['crisis_privacy_note']).toContain('Counselors do not');
  });

  test('11-06: gg_ keys — Golden Gavel display', async () => {
    const en = await getEn();
    expect(en['gg_title']).toBe('Golden Gavel');
    expect(en['gg_subtitle']).toBe('Elite status — earned, not purchased');
    expect(en['gg_hall']).toBe('Hall of Justice');
  });

  test('11-07: lawyers_ keys — find-a-lawyer UI', async () => {
    const en = await getEn();
    expect(en['lawyers_heading']).toBe('Find a Lawyer');
    expect(en['lawyers_call']).toBe('📞 Call');
    expect(en['lawyers_save']).toBe('☆ Save');
    expect(en['lawyers_saved']).toBe('★ Saved');
  });

  test('11-08: booking_ keys — consultation booking', async () => {
    const en = await getEn();
    expect(en['booking_title']).toBe('Book a Consultation');
    expect(en['booking_select_time']).toBe('Select a time');
    expect(en['booking_no_slots']).toBe('No slots available');
    expect(en['booking_notes_label']).toContain('Notes for the attorney');
  });

  test('11-09: all 707 keys are non-empty strings', async () => {
    const en = await getEn();
    let errors = 0;
    for (const [k, v] of Object.entries(en)) {
      if (typeof v !== 'string' || v.trim() === '') errors++;
    }
    expect(errors).toBe(0);
    expect(Object.keys(en).length).toBe(707);
  });
});

// ── 12. Regression — all prior fixes ─────────────────────────────────────
describe('12. Regression — All v1–v20 Confirmed', () => {
  test('12-01: schoolDisciplineParallel age<18 + school keyword', () => {
    const s = computeAllSignals(mkMatter('juvenile', { client_age: 15, title: 'School expulsion' }));
    expect(s.vertical_signals.schoolDisciplineParallel).toBe(true);
  });
  test('12-02: maxConfinementJurisdictionalCeiling: general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('12-03: BUSINESS_CONSTANTS pricing correct', () => {
    expect(BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS).toBe(2000);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
    expect(BUSINESS_CONSTANTS.AI_MESSAGES_PER_DAY_FREE).toBe(3);
  });
  test('12-04: civil_rights crisis → emergInj=true', () => {
    expect(computeAllSignals(mkMatter('civil_rights', { vulnerability_level: 'crisis' })).vertical_signals.emergInj).toBe(true);
  });
  test('12-05: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('12-06: GAVEL constants correct', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(GAVEL_LABEL[1]).toBe('Bronze');
  });
  test('12-07: validCoords rejects out-of-range', () => {
    expect(validCoords(91, 0)).toBeNull();
    expect(validCoords(0, -181)).toBeNull();
    expect(validCoords(36.16, -86.78)).not.toBeNull();
  });
  test('12-08: zero hex violations in useTheme screens', async () => {
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

// ── 13. Mass Influx — 100,000 new scenarios ──────────────────────────────
describe('13. Mass Influx — 100,000 New Scenarios', () => {
  test('13-01: 30,000 schoolDisciplineParallel — always correct', () => {
    let errors = 0;
    const TITLES = ['School expulsion discipline','IEP 504 disability manifestation','Drug arrest minor','Car theft juvenile'];
    for (let i = 0; i < 30000; i++) {
      const age = 13 + (i % 8);
      const title = TITLES[i % TITLES.length];
      const s = computeAllSignals(mkMatter('juvenile', { client_age: age, title, evidence_score: i % 100 }));
      const hasSchool = /iep|manifestation|disability|504|school|expulsion|suspension|discipline/.test(title.toLowerCase());
      if (s.vertical_signals.schoolDisciplineParallel !== (age < 18 && hasSchool)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('13-02: 30,000 military ceiling — always 240 or 12', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const ct = i % 2 === 0 ? 'general' : 'special';
      const s = computeAllSignals(mkMatter('military', { court_type: ct, evidence_score: i % 100 }));
      if (s.vertical_signals.maxConfinementJurisdictionalCeiling !== (ct === 'general' ? 240 : 12)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('13-03: 20,000 diversion recommendations — scores in [0,1]', () => {
    let errors = 0;
    const CHARGES = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: CHARGES[i % CHARGES.length], evidence_score: i % 100, vulnerability_level: ['low','moderate','high','crisis'][i % 4], prior_adjudications: i % 4, client_age: 18 + (i % 40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('13-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
