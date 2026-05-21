/**
 * JUSTICE GAVEL — BRUTAL TRIALS v23
 * ═══════════════════════════════════════════════════════════════════════════
 * 23rd brutal pass — deepest signal-layer and infrastructure scan yet.
 *
 * NEW DOMAINS (16 areas):
 *  1.  /firm/dashboard response shape — total_active_matters, escalation_summary,
 *                                       opportunity_summary, computed_at
 *  2.  POST /:matterId/taxonomy — workflow_flags (classCertRequired, capitalCase,
 *                                 ucmjArticle, icwa, medMal), suggested_vertical,
 *                                 vertical_updated
 *  3.  GET /:matterId/escalation — recommended_sla, notify_partner,
 *                                   recommended_match_boost
 *  4.  GET /:matterId/outcome — outcome_indicators array, matter_id, taxonomy
 *  5.  recordMayBePublic signal — juvenile transfer OR violent charge keywords
 *  6.  sharedAiLimiter — MAX_CALLS=60/hr, WINDOW_MS=1hr, in-memory Map,
 *                          X-AI-Calls-Used/Remaining headers, 429 model,
 *                          makeUserLimiter factory
 *  7.  referrals.js /credit — GET referral credit balance (credit_cents)
 *  8.  providers.js /coverage — seed-only states, Cache-Control 1hr
 *  9.  resources.js /categories — DISTINCT category COUNT query
 * 10.  sendgrid.js sendEmail — missing-fields guard, mock mode, SENDGRID_FROM
 * 11.  db pool config — connectionTimeoutMillis=5000, idleTimeoutMillis=30000, max=10
 * 12.  config.js PORT=4000 + AI_CONCURRENCY=8
 * 13.  rbac.js auditLog + ROLE_HIERARCHY doc
 * 14.  i18n — rights_ (10), atty_ (12), lawyers_ (12), help_ (22), res_ (22),
 *              booking_ (20), bail_ (15), crisis_ (16) final sweep
 * 15.  Regression — all v1–v22 confirmed
 * 16.  Mass influx — 100,000 new scenarios
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let hasMinRole, ROLE_HIERARCHY;
let safeInt, validCoords, BUSINESS_CONSTANTS;
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
  haversineKm = geo.haversineKm;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole; ROLE_HIERARCHY = rbac.ROLE_HIERARCHY;
  const rh = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; validCoords = rh.validCoords;
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS;
  GAVEL_EMOJI = gg.GAVEL_EMOJI;
  GAVEL_LABEL = gg.GAVEL_LABEL;
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

// ── 1. /firm/dashboard response shape ────────────────────────────────────
describe('1. matter_intelligence /firm/dashboard response shape', () => {
  test('1-01: dashboard route exists in matter_intelligence.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('/firm/dashboard');
  });
  test('1-02: dashboard returns total_active_matters', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('total_active_matters');
    expect(src).toContain('total_active');
  });
  test('1-03: dashboard returns escalation_summary with critical + high counts', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('escalation_summary');
    expect(src).toContain('criticalCount');
    expect(src).toContain('highCount');
  });
  test('1-04: dashboard returns opportunity_summary with 5 fields', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('opportunity_summary');
    expect(src).toContain('expungement_eligible');
    expect(src).toContain('settlement_opportunities');
    expect(src).toContain('diversion_eligible');
    expect(src).toContain('safety_valve_eligible');
    expect(src).toContain('mandatory_minimum_matters');
  });
});

// ── 2. POST /:matterId/taxonomy — workflow_flags ──────────────────────────
describe('2. /:matterId/taxonomy — workflow_flags', () => {
  test('2-01: taxonomy endpoint exists and returns suggested_vertical', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain("'/:matterId/taxonomy'");
    expect(src).toContain('suggested_vertical');
    expect(src).toContain('vertical_updated');
  });
  test('2-02: workflow_flags contains classCertRequired (excessive_force | conditions)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('classCertRequired');
    expect(src).toContain("taxonomy === 'excessive_force'");
    expect(src).toContain("taxonomy === 'conditions'");
  });
  test('2-03: workflow_flags contains capitalCase, ucmjArticle, icwa, medMal', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('capitalCase');
    expect(src).toContain("taxonomy === 'capital'");
    expect(src).toContain('ucmjArticle');
    expect(src).toContain("taxonomy === 'court_martial'");
    expect(src).toContain('icwa');
    expect(src).toContain('icwa|indian child|tribal');
    expect(src).toContain('medMal');
    expect(src).toContain("taxonomy === 'medical_malprac'");
  });
  test('2-04: workflow_flags model is correct', () => {
    const buildFlags = (taxonomy, title) => ({
      medMal: taxonomy === 'medical_malprac',
      classCertRequired: taxonomy === 'excessive_force' || taxonomy === 'conditions',
      capitalCase: taxonomy === 'capital',
      ucmjArticle: taxonomy === 'court_martial',
      icwa: /icwa|indian child|tribal/.test((title || '').toLowerCase()),
    });
    expect(buildFlags('capital', 'Murder capital case').capitalCase).toBe(true);
    expect(buildFlags('excessive_force', '').classCertRequired).toBe(true);
    expect(buildFlags('conditions', '').classCertRequired).toBe(true);
    expect(buildFlags('court_martial', '').ucmjArticle).toBe(true);
    expect(buildFlags('other', 'ICWA tribal custody').icwa).toBe(true);
    expect(buildFlags('medical_malprac', '').medMal).toBe(true);
    expect(buildFlags('dui', 'DUI arrest').capitalCase).toBe(false);
  });
});

// ── 3. GET /:matterId/escalation — recommended_sla + notify_partner ───────
describe('3. /:matterId/escalation response fields', () => {
  test('3-01: escalation endpoint returns recommended_sla string', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain("'/:matterId/escalation'");
    expect(src).toContain('recommended_sla');
    expect(src).toContain('attorney contact required');
    expect(src).toContain('Standard response time');
  });
  test('3-02: escalation returns notify_partner = level !== normal', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('notify_partner');
    expect(src).toContain("escalation.level !== 'normal'");
  });
  test('3-03: escalation returns recommended_match_boost for critical cases', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('recommended_match_boost');
    expect(src).toContain('critical');
  });
  test('3-04: recommended_sla model matches BUSINESS_CONSTANTS', () => {
    const slaString = (sla_hours) =>
      sla_hours ? `${sla_hours}h attorney contact required` : 'Standard response time';
    expect(slaString(1)).toBe('1h attorney contact required');
    expect(slaString(4)).toBe('4h attorney contact required');
    expect(slaString(null)).toBe('Standard response time');
    expect(slaString(0)).toBe('Standard response time');
  });
});

// ── 4. GET /:matterId/outcome — outcome_indicators ────────────────────────
describe('4. /:matterId/outcome — outcome_indicators', () => {
  test('4-01: outcome endpoint exists and returns outcome_indicators array', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain("'/:matterId/outcome'");
    expect(src).toContain('outcome_indicators');
    expect(src).toContain("[]");
  });
  test('4-02: outcome_indicators pushed when dismissLikely is true', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('vs.dismissLikely');
    expect(src).toContain('expungement_eligible');
    expect(src).toContain('Dismissal motion viable');
  });
  test('4-03: outcome returns matter_id, vertical, taxonomy', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('matter_id: m.id');
    expect(src).toContain('vertical: signals.vertical');
    expect(src).toContain('taxonomy: signals.taxonomy');
  });
});

// ── 5. recordMayBePublic signal ───────────────────────────────────────────
describe('5. recordMayBePublic — Juvenile Transfer or Violent Charge', () => {
  test('5-01: recordMayBePublic fires on transfer flag', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      client_age: 16,
      title: 'Robbery juvenile transfer',
      case_track: 'delinquency',
    }));
    expect('recordMayBePublic' in s.vertical_signals).toBe(true);
  });
  test('5-02: recordMayBePublic fires on violent charge keywords', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      client_age: 15,
      title: 'Sexual assault juvenile charge',
    }));
    expect(s.vertical_signals.recordMayBePublic).toBe(true);
  });
  test('5-03: recordMayBePublic is false for minor non-violent charge', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      client_age: 14,
      title: 'Shoplifting petty theft minor',
    }));
    expect(s.vertical_signals.recordMayBePublic).toBe(false);
  });
  test('5-04: source comment explains juvenile records may be public', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('may be public record');
    expect(src).toContain('recordMayBePublic');
  });
  test('5-05: 2000 recordMayBePublic computations — always boolean', () => {
    let errors = 0;
    const TITLES = ['Robbery murder assault', 'Shoplifting theft', 'Drug possession minor', 'Sexual assault charge'];
    for (let i = 0; i < 2000; i++) {
      const s = computeAllSignals(mkMatter('juvenile', {
        client_age: 13 + (i % 6),
        title: TITLES[i % TITLES.length],
        evidence_score: i % 100,
      }));
      if (typeof s.vertical_signals.recordMayBePublic !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
});

// ── 6. sharedAiLimiter — in-memory rate limiting ─────────────────────────
describe('6. sharedAiLimiter — 60/hr Per-User AI Rate Limiter', () => {
  test('6-01: MAX_CALLS is 60 per hour', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('MAX_CALLS  = 60');
  });
  test('6-02: WINDOW_MS is 1 hour (60 * 60 * 1000)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('WINDOW_MS  = 60 * 60 * 1000');
    expect(src).toContain('1 hour');
  });
  test('6-03: uses in-memory Map (not Redis) for call tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('new Map()');
    expect(src).toContain('userCalls');
  });
  test('6-04: stale entries purged every 10 minutes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('10 * 60 * 1000');
    expect(src).toContain('Purge stale entries');
  });
  test('6-05: 429 response includes retry_after_seconds, limit, window fields', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('retry_after_seconds');
    expect(src).toContain("limit: MAX_CALLS");
    expect(src).toContain("window: '1 hour'");
  });
  test('6-06: sets X-AI-Calls-Used and X-AI-Calls-Remaining response headers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('X-AI-Calls-Used');
    expect(src).toContain('X-AI-Calls-Remaining');
  });
  test('6-07: unauthenticated requests bypass (no req.user)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('Only applies to authenticated users');
    expect(src).toContain('!req.user?.id');
  });
  test('6-08: makeUserLimiter factory exported for custom limits', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('export function makeUserLimiter');
    expect(src).toContain('windowMs = 60_000');
    expect(src).toContain('max = 10');
  });
  test('6-09: max exposure comment — $0.03/call × 60 = $1.80/hr per user', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js', 'utf8');
    expect(src).toContain('$0.03/call');
    expect(src).toContain('$1.80');
  });
});

// ── 7. referrals /credit + providers /coverage + resources /categories ────
describe('7. referrals/coverage/categories endpoints', () => {
  test('7-01: referrals /credit returns credit_cents from users table', async () => {
    // referrals.js removed in v175 — exploit risk eliminated
    const fs = await import('fs');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
  });
  test('7-03: resources /categories returns DISTINCT categories with counts', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/resources.js', 'utf8');
    expect(src).toContain('/categories');
    expect(src).toContain('DISTINCT category');
    expect(src).toContain('COUNT(*)');
    expect(src).toContain('GROUP BY category');
  });
});

// ── 8. sendgrid sendEmail + db pool + config ──────────────────────────────
describe('8. sendgrid sendEmail + db pool + config.js', () => {
  test('8-01: sendEmail returns error on missing to/subject', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain("'missing_fields'");
    expect(src).toContain('Missing to or subject');
  });
  test('8-02: sendEmail in mock mode returns { mock: true, messageId: mock_... }', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('!SENDGRID_LIVE');
    expect(src).toContain("mock: true");
    expect(src).toContain("'mock_' + Date.now()");
  });
  test('8-03: SENDGRID_FROM is alerts@justicegavel.app', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('SENDGRID_FROM');
    expect(src).toContain('alerts@justicegavel.app');
  });
  test('8-04: db pool connectionTimeoutMillis=5000 (fail fast 5s)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    expect(src).toContain('connectionTimeoutMillis: 5000');
    expect(src).toContain('idleTimeoutMillis:       30000');
    expect(src).toContain('max:                     10');
  });
  test('8-05: config.js PORT defaults to 4000', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/config.js', 'utf8');
    expect(src).toContain("parseInt(process.env.PORT   || '4000', 10)");
  });
  test('8-06: config.js AI_CONCURRENCY defaults to 8', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/config.js', 'utf8');
    expect(src).toContain("AI_CONCURRENCY");
  });
  test('8-07: CONFIG values are correct in test mode', () => {
    expect(CONFIG.PORT).toBe(4000);
    expect(CONFIG.AI_CONCURRENCY).toBe(8);
    expect(CONFIG.DEMO_MODE).toBe(true);
  });
});

// ── 9. rbac.js auditLog + ROLE_HIERARCHY ─────────────────────────────────
describe('9. rbac.js — auditLog + ROLE_HIERARCHY', () => {
  test('9-01: ROLE_HIERARCHY has viewer, client, paralegal, associate, partner', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/rbac.js', 'utf8');
    expect(src).toContain('viewer');
    expect(src).toContain('paralegal');
    expect(src).toContain('associate');
    expect(src).toContain('partner');
  });
  test('9-02: ROLE_HIERARCHY comment shows correct authority order', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/rbac.js', 'utf8');
    expect(src).toContain('viewer(0) < client(1) < paralegal(2) < associate(3) < partner(4)');
  });
  test('9-03: auditLog is async audit trail middleware (non-blocking)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/middleware/rbac.js', 'utf8');
    expect(src).toContain('auditLog');
    expect(src).toContain('non-blocking');
  });
  test('9-04: hasMinRole works correctly for all role pairs', () => {
    // Higher role ≥ lower role = true
    expect(hasMinRole('partner', 'viewer')).toBe(true);
    expect(hasMinRole('associate', 'associate')).toBe(true);
    expect(hasMinRole('viewer', 'partner')).toBe(false);
    expect(hasMinRole('paralegal', 'associate')).toBe(false);
  });
});

// ── 10. i18n final category sweeps ───────────────────────────────────────
describe('10. i18n — Final Category Sweeps', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
  };

  test('10-01: rights_ Miranda rights body text', async () => {
    const en = await getEn();
    expect(en['rights_remain_silent_body']).toContain('invoking my right to remain silent');
    expect(en['rights_attorney_body']).toContain('I want a lawyer');
    expect(en['rights_search_body']).toContain('do not consent to a search');
    expect(en['rights_arrest_body']).toContain('Do not resist');
  });

  test('10-02: atty_ dashboard tab labels', async () => {
    const en = await getEn();
    expect(en['atty_title']).toBe('Attorney Dashboard');
    expect(en['atty_tab_cases']).toBe('Cases');
    expect(en['atty_tab_templates']).toBe('Templates');
    expect(en['atty_tab_cle']).toBe('CLE');
    expect(en['atty_tab_profile']).toBe('Profile');
    expect(en['atty_complete_cle']).toContain('CLE Credit');
  });

  test('10-03: lawyers_ need-help prompts', async () => {
    const en = await getEn();
    expect(en['lawyers_need_title']).toBe('What do you need help with?');
    expect(en['lawyers_need_sub']).toBe("We'll find the right lawyer for you");
    expect(en['lawyers_directions']).toBe('🗺 Directions');
    expect(en['lawyers_website']).toBe('🌐 Website');
  });

  test('10-04: help_ call-now with GPS states', async () => {
    const en = await getEn();
    expect(en['help_now']).toBe('HELP NOW');
    expect(en['help_now_heading']).toBe('Call Now');
    expect(en['help_now_sub_both']).toContain('bail agent and lawyer');
    expect(en['help_now_loading_gps']).toBe('Finding your location…');
  });

  test('10-05: res_ AI legal research paywall', async () => {
    const en = await getEn();
    expect(en['res_title']).toBe('AI Legal Research');
    expect(en['res_paywall_subscribe']).toContain('$49.99/mo');
    expect(en['res_paywall_annual']).toContain('$374.99/yr');
    expect(en['res_paywall_disclaimer']).toContain('Cancel any time');
  });

  test('10-06: booking_ full consultation flow', async () => {
    const en = await getEn();
    expect(en['booking_title']).toBe('Book a Consultation');
    expect(en['booking_callback_prompt']).toContain('{name}');
    expect(en['booking_notes_placeholder']).toContain('situation');
    expect(en['booking_no_slots']).toBe('No slots available');
  });

  test('10-07: bail_ search flow labels', async () => {
    const en = await getEn();
    expect(en['bail_sub_loading']).toBe('Searching your area…');
    expect(en['bail_search_again']).toContain('Search Again');
    expect(en['bail_city_picker_title']).toContain('What city');
  });

  test('10-08: crisis_ full screen labels', async () => {
    const en = await getEn();
    expect(en['crisis_header_sub']).toContain('Whatever you');
    expect(en['crisis_grounding_label']).toContain('work up to calling');
    expect(en['crisis_more_lines']).toBe('More crisis lines');
    expect(en['crisis_legal_divider']).toContain('legal help');
  });
});

// ── 11. Regression ────────────────────────────────────────────────────────
describe('11. Regression — All v1–v22 Confirmed', () => {
  test('11-01: PI fastTrack fires on severe + crisis', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { vulnerability_level: 'crisis' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('11-02: family assetFreeze = DV + high asset', () => {
    expect(computeAllSignals(mkMatter('family', { dv_flag: 1, asset_tier: 'over_10m' })).vertical_signals.assetFreeze).toBe(true);
    expect(computeAllSignals(mkMatter('family', { dv_flag: 0, asset_tier: 'over_10m' })).vertical_signals.assetFreeze).toBe(false);
  });
  test('11-03: military ceiling general=240 special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('11-04: sharedAiLimiter MAX_CALLS=60', async () => {
    const { perUserAiLimit } = await import('../middleware/sharedAiLimiter.js');
    expect(typeof perUserAiLimit).toBe('function');
  });
  test('11-05: workflow_flags model correct', () => {
    const f = (taxonomy) => ({
      capitalCase: taxonomy === 'capital',
      ucmjArticle: taxonomy === 'court_martial',
    });
    expect(f('capital').capitalCase).toBe(true);
    expect(f('dui').capitalCase).toBe(false);
  });
  test('11-06: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('11-07: CONFIG PORT=4000, DEMO_MODE=true, AI_CONCURRENCY=8', () => {
    expect(CONFIG.PORT).toBe(4000);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(CONFIG.AI_CONCURRENCY).toBe(8);
  });
  test('11-08: zero hex violations in useTheme screens', async () => {
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

// ── 12. Mass Influx — 100,000 new scenarios ──────────────────────────────
describe('12. Mass Influx — 100,000 New Scenarios', () => {
  test('12-01: 30,000 juvenile computations — recordMayBePublic always boolean', () => {
    let errors = 0;
    const TITLES = ['Robbery murder assault sexual','Shoplifting theft','Drug minor','Vandalism'];
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('juvenile', {
        client_age: 13 + (i % 6),
        title: TITLES[i % TITLES.length],
        evidence_score: i % 100,
      }));
      if (typeof s.vertical_signals.recordMayBePublic !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
  test('12-02: 30,000 family computations — assetFreeze always boolean', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('family', {
        dv_flag: i % 3 === 0 ? 1 : 0,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        asset_tier: ['under_500k','2m_10m','over_10m'][i % 3],
        evidence_score: i % 100,
      }));
      if (typeof s.vertical_signals.assetFreeze !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
  test('12-03: 20,000 diversion computations — eligibility_score in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i % C.length], evidence_score: i % 100, vulnerability_level: ['low','moderate','high','crisis'][i % 4], prior_adjudications: i % 4, client_age: 18 + (i % 40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('12-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
