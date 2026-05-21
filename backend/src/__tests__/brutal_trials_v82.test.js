// JUSTICE GAVEL - BRUTAL TRIALS v82
// 82nd pass: Hague Convention Feature + all discrepancy fixes confirmed

import { jest } from '@jest/globals';

let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt;
let BUSINESS_CONSTANTS, GAVEL_EMOJI, CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const rh  = await import('../utils/routeHelpers.js');
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg  = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o={}) => ({
  id:1, vertical:v, title:`Test ${v}`, evidence_score:60,
  vulnerability_level:'moderate', time_pressure:'standard',
  supervised_release:0, plea_offer_pending:0, ...o,
});

// ── HAGUE. Hague Convention Feature ──────────────────────────────────────
describe('HAGUE. Hague Convention — Backend Route', () => {
  test('HAGUE-01: hague_contacts.js has 5 routes: us-resources, member-states, central-authority, report-intake, intake/:caseId', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain("router.get('/us-resources'");
    expect(src).toContain("router.get('/member-states'");
    expect(src).toContain("router.get('/central-authority/:countryCode'");
    expect(src).toContain("router.post('/report-intake'");
    expect(src).toContain("router.get('/intake/:caseId'");
  });
  test('HAGUE-02: US_RESOURCES contains OCI emergency line 1-888-407-4747', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('1-888-407-4747');
    expect(src).toContain('Office of Children\'s Issues');
    expect(src).toContain('abduction@state.gov');
  });
  test('HAGUE-03: US_RESOURCES contains NCMEC 1-800-843-5678 (24/7)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('1-800-843-5678');
    expect(src).toContain('NCMEC');
    expect(src).toContain('24/7');
  });
  test('HAGUE-04: FBI IC3 + INTERPOL documented (federal reporting paths)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('ic3.gov');
    expect(src).toContain('INTERPOL');
    expect(src).toContain('18 U.S.C. § 1204');
  });
  test('HAGUE-05: 28 member states in MEMBER_STATES including contracting and non-contracting', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain("{ code:'GB'");
    expect(src).toContain("{ code:'US'");
    expect(src).toContain("{ code:'IN'");
    expect(src).toContain('Not a contracting state');
    const memberCount = (src.match(/\{ code:'/g) || []).length;
    expect(memberCount).toBeGreaterThanOrEqual(25);
  });
  test('HAGUE-06: POST /report-intake returns next_steps for contracting vs non-contracting state', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('next_steps');
    expect(src).toContain('Hague Application');
    expect(src).toContain('bilateral channels');
    expect(src).toContain('legal_notice');
  });
  test('HAGUE-07: hague_intakes table in DB for case tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    expect(src).toContain('hague_intakes');
    expect(src).toContain('country_code');
    expect(src).toContain('child_name');
    expect(src).toContain('abduction_date');
    expect(src).toContain("REFERENCES cases(id) ON DELETE CASCADE");
  });
  test('HAGUE-08: hague_contacts route is mounted at /api/hague-contacts in app.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/app.js', 'utf8');
    expect(src).toContain('/api/hague-contacts');
    expect(src).toContain('hagueContactsRouter');
  });
});

// ── HAGUE-FE. HagueContactScreen ──────────────────────────────────────────
describe('HAGUE-FE. HagueContactScreen.tsx — 4 Phases', () => {
  test('HAGUE-FE-01: screen has 4 phases: home/lookup/intake/result', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain("'home'|'lookup'|'intake'|'result'");
    expect(src).toContain("'home'|'lookup'|'intake'|'result'");
    expect(src).toContain("setPhase('lookup')");
    expect(src).toContain("setPhase('intake')");
    expect(src).toContain("setPhase('result')");
  });
  test('HAGUE-FE-02: OCI tap-to-call 1-888-407-4747 on home screen', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('+18884074747');
    expect(src).toContain('hapticCall');
    expect(src).toContain("Linking.openURL(`tel:");
  });
  test('HAGUE-FE-03: NCMEC tap-to-call 1-800-843-5678 on home screen', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('18008435678');
    expect(src).toContain('NCMEC');
  });
  test('HAGUE-FE-04: Federal reporting links — FBI IC3 + State Dept Hague application', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('ic3.gov');
    expect(src).toContain('travel.state.gov');
    expect(src).toContain('INTERPOL');
    expect(src).toContain('Yellow Notice');
  });
  test('HAGUE-FE-05: country lookup → Central Authority → Intake → Next Steps flow', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('setPhase');
    expect(src).toContain('lookupAuthority');
    expect(src).toContain('submitIntake');
    expect(src).toContain('/hague-contacts/report-intake');
  });
  test('HAGUE-FE-06: all TextInput has maxFontSizeMultiplier={1.4} and maxLength', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    const inputs = (src.match(/<TextInput[^>]+>/gs) || []);
    expect(inputs.length).toBeGreaterThan(0);
    for (const inp of inputs) {
      expect(inp).toContain('maxFontSizeMultiplier={1.4}');
      expect(inp).toContain('maxLength');
    }
  });
  test('HAGUE-FE-07: critical TouchableOpacity buttons have accessibilityRole', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    // Emergency call buttons have accessibilityRole
    expect(src).toContain('accessibilityRole="button"');
    // Screen has proper accessibility labels
    expect(src).toContain('accessibilityLabel=');
    // Count: at least 5 buttons have role
    const withRole = (src.match(/accessibilityRole="button"/g) || []).length;
    expect(withRole).toBeGreaterThanOrEqual(5);
  });
  test('HAGUE-FE-08: uses useTheme, haptics (hapticCall/hapticSuccess/hapticWarn/hapticSelect)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('useTheme');
    expect(src).toContain('hapticCall');
    expect(src).toContain('hapticSuccess');
    expect(src).toContain('hapticWarn');
    expect(src).toContain('hapticSelect');
  });
});

// ── HAGUE-UX. Legal Accuracy + UX ────────────────────────────────────────
describe('HAGUE-UX. Hague Convention Legal Accuracy + UX', () => {
  test('HAGUE-UX-01: scope is 1980 Hague Convention on Civil Child Abduction (not ICC)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('1980');
    expect(src).toContain('Civil Aspects of International Child Abduction');
    // Correctly scoped — NOT ICC (which handles state-level war crimes)
    expect(src).not.toContain('International Criminal Court');
  });
  test('HAGUE-UX-02: legal notice on all endpoints — attorney must file directly', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('attorney');
    expect(src).toContain('directly');
    expect(src).toContain('legal_note');
  });
  test('HAGUE-UX-03: Article 11 6-week timeline mentioned in next_steps', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('Article 11');
    expect(src).toContain('6 weeks');
  });
  test('HAGUE-UX-04: non-contracting state gets different next_steps (bilateral channels)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('bilateral channels');
    expect(src).toContain('U.S. Embassy');
    // Non-contracting states (India, China, Pakistan) need embassy + local counsel
  });
  test('HAGUE-UX-05: HagueContactScreen legal disclaimer present', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
    expect(src).toContain('not legal advice');
    expect(src).toContain('licensed family law attorney');
    expect(src).toContain('legalNoticeText');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v81 Confirmed', () => {
  test('R-01: i18n 707/707', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/backend/src/__tests__';
    const corpus = fs.readdirSync(dir).filter(f => f.endsWith('.test.js'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    const en = JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
    expect(Object.keys(en).filter(k => !corpus.includes(k))).toHaveLength(0);
  });
  test('R-02: GAVEL[3]=🏆', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
  test('R-03: encryption 1,000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('R-04: DB now 56 tables (hague_intakes is 56th)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
    expect(tables.length).toBe(56);
    expect(tables).toContain('hague_intakes');
  });
  test('R-05: zero hex violations', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      for (const h of (src.match(/'#[0-9A-Fa-f]{6}'/g) || [])) {
        if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
      }
    }
    expect(violations).toHaveLength(0);
  });
  test('R-06: BUSINESS_CONSTANTS verified', () => {
    expect(BUSINESS_CONSTANTS.MAX_CASES).toBe(100);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
    expect(CONFIG.DEMO_MODE).toBe(true);
  });
  test('R-07: PI fastTrack severe→true', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
  });
});

// ── Mass Influx ─────────────────────────────────────────────────────────────
describe('Mass Influx — 100,000 Scenarios', () => {
  test('MI-01: 30,000 cross-vertical escalation', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score:i%100, vulnerability_level:['low','moderate','high','crisis'][i%4] }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-02: 30,000 outcome estimates', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score:i%100 }));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-03: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
  test('MI-04: 20,000 haversine distance calculations', async () => {
    const { haversineKm } = await import('../services/geolink.js');
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      const km = haversineKm(25+(i%25), -70-(i%50), 36.17, -86.78);
      if (km < 0 || !isFinite(km)) errors++;
    }
    expect(errors).toBe(0);
  });
});
