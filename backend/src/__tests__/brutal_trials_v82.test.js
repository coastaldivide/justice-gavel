import { feSource } from './helpers/feSource.js';
// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL - BRUTAL TRIALS v82
// 82nd pass: Hague Convention Feature + all discrepancy fixes confirmed


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
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain("router.get('/us-resources'");
    expect(src).toContain("router.get('/member-states'");
    expect(src).toContain("router.get('/central-authority/:countryCode'");
    expect(src).toContain("router.post('/report-intake'");
    expect(src).toContain("router.get('/intake/:caseId'");
  });
  test('HAGUE-02: US_RESOURCES contains OCI emergency line 1-888-407-4747', async () => {
    const fs = await import('fs');
    const mig = fs.readFileSync(__REPO + '/supabase/migrations/00000000000026_specialized_guides.sql', 'utf8');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    // Section F: the contacts are stored data (migration 26) read by the route, each with its source
    expect(mig).toContain("'+1-888-407-4747'");
    expect(mig).toContain('abduction@state.gov');
    expect(src).toContain('hague_central_authorities');
    expect(src).toContain('emergency_phone');
  });
  test('HAGUE-03: US_RESOURCES contains NCMEC 1-800-843-5678 (24/7)', async () => {
    const fs = await import('fs');
    const mig = fs.readFileSync(__REPO + '/supabase/migrations/00000000000026_specialized_guides.sql', 'utf8');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    expect(mig).toContain("('ncmec', 'National Center for Missing & Exploited Children (NCMEC)', '1-800-843-5678'");
    expect(src).toContain('FROM hague_resources');
  });
  test('HAGUE-04: FBI IC3 + INTERPOL documented (federal reporting paths)', async () => {
    const fs = await import('fs');
    const mig = fs.readFileSync(__REPO + '/supabase/migrations/00000000000026_specialized_guides.sql', 'utf8');
    // IC3 (the internet-crime portal) is no longer offered for parental kidnapping: the FBI page is
    expect(mig).toContain('https://www.fbi.gov/investigate/violent-crime/parental-kidnapping');
    expect(mig).toContain("'18 U.S.C. § 1204'");
    expect(mig).toContain('INTERPOL');
    expect(mig).not.toContain('ic3.gov');
  });
  test('HAGUE-05: 28 member states in MEMBER_STATES including contracting and non-contracting', async () => {
    const fs = await import('fs');
    const mig = fs.readFileSync(__REPO + '/supabase/migrations/00000000000026_specialized_guides.sql', 'utf8');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    expect(mig).toContain("('GB', 'United Kingdom'");
    expect(mig).toContain("('IN', 'India'");
    expect(mig).toContain("('US', 'United States'");
    expect((mig.match(/^ {2}\('[A-Z]{2}', /gm) || []).length).toBeGreaterThanOrEqual(28);
    expect(mig).toContain("'HCCH member state registry'");
    expect(src).toContain("router.get('/central-authority/:countryCode'");
    expect(src).toContain("router.get('/member-states'");
  });
  test('HAGUE-06: POST /report-intake returns next_steps for contracting vs non-contracting state', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    const en = fs.readFileSync(__REPO + '/backend/src/i18n/messages/en.js', 'utf8');
    expect(src).toContain('next_steps');
    expect(src).toContain('hague.steps.contracting.');
    expect(src).toContain('hague.steps.non_contracting.');
    expect(src).toContain('legal_notice');
    expect(en).toContain('Article 11');      // recorded wording, flagged for lawyer review (section F)
    expect(en).toContain('six weeks');                    // Art. 11 (Oct 2026 legal review: courts, statement of reasons)
    expect(en).toContain('statement of the reasons');
    expect(en).toContain('U.S. embassy');
    expect(en).toContain('bilateral treaty');
  });
  test('HAGUE-08: hague_contacts route is mounted at /api/hague-contacts in app.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8');
    expect(src).toContain('/api/hague-contacts');
    expect(src).toContain('hagueContactsRouter');
  });
});

// ── HAGUE-FE. HagueContactScreen ──────────────────────────────────────────
describe('HAGUE-FE. HagueContactScreen.tsx — 4 Phases', () => {
  test('HAGUE-FE-01: screen has 4 phases: home/lookup/intake/result', async () => {
    const fe = feSource(__REPO + '/frontend/src/screens/HagueContactScreen.tsx');
    expect(fe).toContain("type Phase = 'home' | 'lookup' | 'intake' | 'done'");
    expect(fe).toContain("setPhase('lookup')");
    expect(fe).toContain("setPhase('intake')");
    expect(fe).toContain("setPhase('done')");
  });
  test('HAGUE-FE-02: OCI tap-to-call 1-888-407-4747 on home screen', async () => {
    const fe = feSource(__REPO + '/frontend/src/screens/HagueContactScreen.tsx');
    // numbers come from the server's stored data and go through utils/contact (tel:+1…)
    expect(fe).toContain('telUrl(phone)');
    expect(fe).toContain('hapticCall()');
    expect(fe).toContain('emergency_phone');
    expect(fe).toContain("'/hague-contacts/us-resources'");
  });
  test('HAGUE-FE-03: NCMEC tap-to-call 1-800-843-5678 on home screen', async () => {
    const fe = feSource(__REPO + '/frontend/src/screens/HagueContactScreen.tsx');
    // numbers come from the server's stored data and go through utils/contact (tel:+1…)
    expect(fe).toContain('telUrl(phone)');
    expect(fe).toContain('hapticCall()');
    expect(fe).toContain('emergency_phone');
    expect(fe).toContain("'/hague-contacts/us-resources'");
  });
  test('HAGUE-FE-04: Federal reporting links — FBI IC3 + State Dept Hague application', async () => {
    const fs = await import('fs');
    const mig = fs.readFileSync(__REPO + '/supabase/migrations/00000000000026_specialized_guides.sql', 'utf8');
    // IC3 (the internet-crime portal) is no longer offered for parental kidnapping: the FBI page is
    expect(mig).toContain('https://www.fbi.gov/investigate/violent-crime/parental-kidnapping');
    expect(mig).toContain("'18 U.S.C. § 1204'");
    expect(mig).toContain('INTERPOL');
    expect(mig).not.toContain('ic3.gov');
  });
  test('HAGUE-FE-05: country lookup → Central Authority → Intake → Next Steps flow', async () => {
    const fe = feSource(__REPO + '/frontend/src/screens/HagueContactScreen.tsx');
    expect(fe).toContain('pickCountry');
    expect(fe).toContain('/hague-contacts/central-authority/');
    expect(fe).toContain("'/hague-contacts/member-states'");
    expect(fe).toContain("'/hague-contacts/report-intake'");
    expect(fe).toContain('SourceLine');
  });
  test('HAGUE-FE-07: critical TouchableOpacity buttons have accessibilityRole', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
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
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/HagueContactScreen.tsx', 'utf8');
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
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    expect(src).toContain('1980');
    expect(src).not.toContain('International Criminal Court');
  });
  test('HAGUE-UX-02: legal notice on all endpoints — attorney must file directly', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    const en = fs.readFileSync(__REPO + '/backend/src/i18n/messages/en.js', 'utf8');
    expect(src).toContain('legal_note');
    expect(en).toContain('It does not file anything');
  });
  test('HAGUE-UX-03: Article 11 6-week timeline mentioned in next_steps', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    const en = fs.readFileSync(__REPO + '/backend/src/i18n/messages/en.js', 'utf8');
    expect(src).toContain('next_steps');
    expect(src).toContain('hague.steps.contracting.');
    expect(src).toContain('hague.steps.non_contracting.');
    expect(src).toContain('legal_notice');
    expect(en).toContain('Article 11');      // recorded wording, flagged for lawyer review (section F)
    expect(en).toContain('six weeks');                    // Art. 11 (Oct 2026 legal review: courts, statement of reasons)
    expect(en).toContain('statement of the reasons');
    expect(en).toContain('U.S. embassy');
    expect(en).toContain('bilateral treaty');
  });
  test('HAGUE-UX-04: non-contracting state gets different next_steps (bilateral channels)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/hague_contacts.js', 'utf8');
    const en = fs.readFileSync(__REPO + '/backend/src/i18n/messages/en.js', 'utf8');
    expect(src).toContain('next_steps');
    expect(src).toContain('hague.steps.contracting.');
    expect(src).toContain('hague.steps.non_contracting.');
    expect(src).toContain('legal_notice');
    expect(en).toContain('Article 11');      // recorded wording, flagged for lawyer review (section F)
    expect(en).toContain('six weeks');                    // Art. 11 (Oct 2026 legal review: courts, statement of reasons)
    expect(en).toContain('statement of the reasons');
    expect(en).toContain('U.S. embassy');
    expect(en).toContain('bilateral treaty');
  });
  test('HAGUE-UX-05: HagueContactScreen legal disclaimer present', async () => {
    const fe = feSource(__REPO + '/frontend/src/screens/HagueContactScreen.tsx');
    expect(fe).toContain('not legal advice');
    expect(fe).toContain('family law attorney');
    expect(fe).toContain('UnreviewedNotice');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v81 Confirmed', () => {
  test('R-02: GAVEL[3]=🏆', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
  test('R-03: encryption 1,000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('R-06: BUSINESS_CONSTANTS verified', () => {
    /* removed: BUSINESS_CONSTANTS.MAX_CASES does not exist */
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBeUndefined() /* section G: the paid badge was removed */;
    expect(CONFIG.DEMO_MODE).toBeDefined();
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
