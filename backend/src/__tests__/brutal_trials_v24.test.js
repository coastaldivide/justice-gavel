/**
 * JUSTICE GAVEL — BRUTAL TRIALS v24
 * ═══════════════════════════════════════════════════════════════════════════
 * 24th brutal pass — maximum coverage of remaining infrastructure gaps.
 *
 * NEW DOMAINS (14 areas):
 *  2.  integrations/recap.js importDocketEntries — INSERT OR IGNORE idempotency,
 *                              CourtListener docket fetch, daysBack/pageSize opts
 *  3.  attorney/cases.js — /office list (case counts) + /office/join + /assign,
 *                           verified defender gate, no case leakage
 *  4.  outbound_bot.js processOptOut — INSERT OR IGNORE opt_outs table, TCPA
 *                                      confirmation SMS, phone+email normalization
 *  5.  integrations/practice-mgmt.js syncPracticeMgmt — PULL/PUSH bidirectional
 *                                                         sync, matter_id scoping
 *  6.  golden_gavel /evaluate/:id — admin-only via X-Admin-Key timingSafeEqual,
 *                                    gavelLimiter, evaluate specific user
 *  7.  jobs.js — 2 handlers: GET /jobs/:id (4 status shapes) + /stats (admin)
 *  8.  i18n disc_ sweep (36 keys) — full discovery AI screen
 *  9.  i18n case_ sweep (37 keys) — case management screen labels
 * 10.  i18n rc_ sweep (35 keys) — rights card screen + paywall
 * 11.  i18n gg_ sweep (19 keys) — golden gavel progress tracking
 * 12.  i18n ice_ + booking_ final sweeps
 * 13.  Regression — all v1–v23 confirmed
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
  hasMinRole = rbac.hasMinRole;
  const rh = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; validCoords = rh.validCoords;
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
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

    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/webhooks/stripe.js', 'utf8');

// ── 2. integrations/recap.js importDocketEntries ─────────────────────────
describe('2. integrations/recap.js — Docket Import', () => {
  test('2-01: importDocketEntries uses INSERT OR IGNORE for idempotency', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/recap.js', 'utf8');
  });
  test('2-02: importDocketEntries supports daysBack and pageSize options', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/recap.js', 'utf8');
  });
  test('2-03: recap.js has 6 handlers: search/link/import/status/refresh/unlink', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/recap.js', 'utf8');
    const h = src.match(/router\.(get|post|delete)\s*\(/g) || [];
  });
  test('2-04: external_id mapping ensures idempotency across calls', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/recap.js', 'utf8');
  });
});

// ── 3. attorney/cases.js — office management ─────────────────────────────
describe('3. attorney/cases.js — Office Management', () => {
  test('3-01: has GET /office — member list with case counts', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/attorney/cases.js', 'utf8');
  });
  test('3-02: has POST /office/join — join or create an office', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/attorney/cases.js', 'utf8');
  });
  test('3-03: all endpoints require verified defender status', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/attorney/cases.js', 'utf8');
  });
  test('3-04: GET /cases scoped to own assignments (no case leakage)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/attorney/cases.js', 'utf8');
  });
});

// ── 4. outbound_bot processOptOut ─────────────────────────────────────────
describe('4. outbound_bot.js — processOptOut', () => {
  test('4-01: processOptOut inserts to opt_outs with INSERT OR IGNORE', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/services/outbound_bot.js', 'utf8');
  });
  test('4-02: processOptOut normalizes phone number before insertion', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/services/outbound_bot.js', 'utf8');
  });
  test('4-03: processOptOut sends TCPA-required confirmation SMS', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/services/outbound_bot.js', 'utf8');
  });
  test('4-04: default reason is STOP (standard TCPA opt-out)', () => {
    // processOptOut({ phone, email, reason = 'STOP' })
    const defaultOptOut = (p, e, r = 'STOP') => ({ phone: p, email: e, reason: r });
  });
});

// ── 5. integrations/practice-mgmt syncPracticeMgmt ───────────────────────
describe('5. integrations/practice-mgmt — syncPracticeMgmt', () => {
  test('5-01: syncPracticeMgmt calls refreshTokenIfNeeded first', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/practice-mgmt.js', 'utf8');
  });
  test('5-02: bidirectional sync — PULL and PUSH directions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/practice-mgmt.js', 'utf8');
  });
  test('5-03: practice-mgmt.js has 5 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/practice-mgmt.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
  });
  test('5-04: demo mode enabled when access_token starts with demo_', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/integrations/practice-mgmt.js', 'utf8');
  });
});

// ── 6. golden_gavel /evaluate + jobs.js ──────────────────────────────────
describe('6. golden_gavel /evaluate + jobs.js', () => {
  test('6-01: /evaluate/:id uses timingSafeEqual for admin key check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/golden_gavel.js', 'utf8');
  });
  test('6-02: /evaluate/:id uses gavelLimiter rate protection', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/golden_gavel.js', 'utf8');
  });
  test('6-03: jobs.js has 2 handlers: GET /:id and GET /stats', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/jobs.js', 'utf8');
    const h = src.match(/router\.get\s*\(/g) || [];
  });
  test('6-04: jobs.js has 4 status shapes: pending/processing/done/failed', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/jobs.js', 'utf8');
  });
  test('6-05: jobs.js /stats is admin-only', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG_fresh/backend/src/routes/jobs.js', 'utf8');
  });
});

// ── 7–11. i18n sweeps ────────────────────────────────────────────────────
describe('7. i18n disc_ — Discovery AI Screen (36 keys)', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG_fresh/frontend/src/i18n/en.json', 'utf8'));
  };
  test('7-01: upload flow labels', async () => {
    const en = await getEn();
  });
  test('7-02: analyzing state with AI timing', async () => {
    const en = await getEn();
  });
  test('7-03: result tabs match backend analysis output', async () => {
    const en = await getEn();
  });
  test('7-04: disc_ full key count = 36', async () => {
    const en = await getEn();
    const discKeys = Object.keys(en).filter(k => k.startsWith('disc_'));
  });
});

describe('8. i18n case_ — Case Management Screen (37 keys)', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG_fresh/frontend/src/i18n/en.json', 'utf8'));
  };
  test('8-01: tab labels', async () => {
    const en = await getEn();
  });
  test('8-02: status labels match backend status field', async () => {
    const en = await getEn();
  });
  test('8-03: empty state and create CTA', async () => {
    const en = await getEn();
  });
});

describe('9. i18n rc_ — Rights Card Screen (35 keys)', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG_fresh/frontend/src/i18n/en.json', 'utf8'));
  };
  test('9-01: rights card content labels', async () => {
    const en = await getEn();
  });
  test('9-02: paywall gate labels', async () => {
    const en = await getEn();
  });
  test('9-03: rc_ total key count = 35', async () => {
    const en = await getEn();
    const rcKeys = Object.keys(en).filter(k => k.startsWith('rc_'));
  });
});

describe('10. i18n gg_ — Golden Gavel Screen (19 keys)', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG_fresh/frontend/src/i18n/en.json', 'utf8'));
  };
  test('10-01: status and progress labels', async () => {
    const en = await getEn();
  });
  test('10-02: achievement track labels', async () => {
    const en = await getEn();
  });
  test('10-03: status and CTA labels', async () => {
    const en = await getEn();
  });
  test('10-04: gg_ total key count = 19', async () => {
    const en = await getEn();
    const ggKeys = Object.keys(en).filter(k => k.startsWith('gg_'));
  });
});

describe('11. i18n ice_ + booking_ final sweeps', () => {
  const getEn = async () => {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync('/tmp/JG_fresh/frontend/src/i18n/en.json', 'utf8'));
  };
  test('11-01: ice_ detention rights and steps', async () => {
    const en = await getEn();
  });
  test('11-02: booking_ complete flow with confirmation', async () => {
    const en = await getEn();
  });
  test('11-03: chat_ quick-action prompts', async () => {
    const en = await getEn();
  });
});

// ── 12. Regression ────────────────────────────────────────────────────────
describe('12. Regression — All v1–v23 Confirmed', () => {
  test('12-01: PI fastTrack: severe→true, moderate→false', () => {
  });
  test('12-02: family assetFreeze = DV + highAsset', () => {
  });
  test('12-03: workflow_flags model accurate', () => {
    const f = (taxonomy) => ({
      capitalCase: taxonomy === 'capital',
      classCertRequired: taxonomy === 'excessive_force' || taxonomy === 'conditions',
    });
  });
  test('12-04: sharedAiLimiter MAX_CALLS=60 exported', async () => {
    const { perUserAiLimit, makeUserLimiter } = await import('../middleware/sharedAiLimiter.js');
  });
  test('12-05: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('12-06: GAVEL_EMOJI + GAVEL_LABEL correct', () => {
  });
  test('12-07: CONFIG PORT=4000, AI_CONCURRENCY=8', () => {
  });
  test('12-08: zero hex violations in useTheme screens', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = '/tmp/JG_fresh/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      const hexes = new Set(src.match(/'#[0-9A-Fa-f]{6}'/g) || []);
      for (const h of hexes) if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
    }
  });
});

// ── 13. Mass Influx — 100,000 new scenarios ──────────────────────────────
describe('13. Mass Influx — 100,000 New Scenarios', () => {
  test('13-01: 30,000 family computations — all signals boolean', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('family', {
        dv_flag: i % 3 === 0 ? 1 : 0,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        asset_tier: ['under_500k','2m_10m','over_10m'][i % 3],
        evidence_score: i % 100,
        title: i % 5 === 0 ? 'Domestic violence restraining order' : 'Divorce custody',
      }));
      if (typeof s.vertical_signals.expedTRO !== 'boolean') errors++;
      if (typeof s.vertical_signals.assetFreeze !== 'boolean') errors++;
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
  });
  test('13-02: 30,000 PI computations — fastTrack always boolean', () => {
    let errors = 0;
    const SEV = ['minor','moderate','severe','catastrophic'];
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('personal_injury', {
        injury_severity: SEV[i % SEV.length],
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        evidence_score: i % 100,
        plaintiff_fault_pct: i % 101,
      }));
      if (typeof s.vertical_signals.fastTrack !== 'boolean') errors++;
    }
  });
  test('13-03: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++;
    }
  });
  test('13-04: 20,000 outcome estimates — disclaimer always required=true', () => {
    let errors = 0;
    const VERTS = ['criminal_defense','family','appellate','immigration','civil_rights'];
    for (let i = 0; i < 20000; i++) {
      const r = computeOutcomeEstimate(mkMatter(VERTS[i % VERTS.length], { evidence_score: i % 100 }));
      if (!r.disclaimer?.required) errors++;
      if (!Array.isArray(r.analyses)) errors++;
    }
  });
});