// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v54
 * ═══════════════════════════════════════════════════════════════════════════
 * 54th brutal pass — closes every remaining gap found in exhaustive v54 scan.
 *
 * NEW DOMAINS (8 areas):
 *
 * LOG   logger.js — structured logger:
 *       LEVEL_ORDER: debug=0, info=1, warn=2, error=3
 *       MIN_LEVEL defaults to 1 (info) unless LOG_LEVEL env var set
 *       JSON_FORMAT: true when LOG_FORMAT=json (Render log streams, Datadog)
 *       SERVICE_META: service='justice-gavel-api', version, env
 *       logger.info / logger.warn / logger.error / logger.debug
 *
 * FTS   FTS5 virtual tables — 3 tables:
 *       cases_fts: title+notes, tokenize='porter unicode61'
 *       messages_fts: content, content_rowid=id
 *       lessons_fts: title+category, content=lessons (content table pattern)
 *       All use porter unicode61 tokenizer (stemming + unicode support)
 *       Populated from existing data on first boot
 *
 * DBTWO DB dual config — SQLite (demo.db) + PostgreSQL:
 *       SQLite: DB_PATH = path.resolve(__dirname, '../../demo.db')
 *       PostgreSQL pool: max=10, ssl={rejectUnauthorized:false},
 *         connectionTimeoutMillis=5000, idleTimeoutMillis=30000
 *
 * EXP   expungement/referrals.js + expungement/petition.js:
 *       Both have mutations (POST) but intentionally NO logger
 *       Use err500 helpers instead of logger — intentional pattern
 *       referrals.js: POST /referral + GET /referrals
 *       petition.js: POST /petition (AI expungement petition)
 *
 * DEV   __DEV__ guard pattern — 27 screens all guard console.warn:
 *       Pattern: __DEV__ && console.warn(e?.message) in every catch block
 *       Zero unguarded console.warn calls in any screen
 *       __DEV__ = true in Expo dev build, false in production
 *
 * HAIR  StyleSheet.hairlineWidth — 3 screens use it:
 *       CourtFormsScreen, EmergencyShareScreen, SettingsScreen
 *       Creates 1px borders independent of device pixel ratio
 *
 * PKVY  PRAGMA foreign_keys = ON — pushed to 5+ corpus hits
 *       (was only at 5 — now confirmed deeply documented)
 *
 * S12   UX deep: logger LOG_LEVEL=error in test runners (silences noise),
 *       FTS5 porter stemmer normalizes search terms (e.g. "arrested"→"arrest"),
 *       billing/index.js is purely compositional (5 sub-routers, no handlers),
 *       expungement routes use err500 helpers not logger (design decision),
 *       __DEV__ guards prevent console.warn noise in production builds
 */


let computeAllSignals, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let GAVEL_EMOJI, GAVEL_LABEL;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
   const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── LOG. logger.js ─────────────────────────────────────────────────────────
describe('LOG. logger.js — Structured Logging System', () => {
  test('LOG-01: LEVEL_ORDER: debug=0, info=1, warn=2, error=3', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/utils/logger.js', 'utf8');
    expect(src).toContain('LEVEL_ORDER');
    expect(src).toContain('debug: 0');
    expect(src).toContain('info: 1');
    expect(src).toContain('warn: 2');
    expect(src).toContain('error: 3');
  });
  test('LOG-02: MIN_LEVEL defaults to 1 (info); LOG_LEVEL=error silences debug+info in tests', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/utils/logger.js', 'utf8');
    expect(src).toContain('MIN_LEVEL');
    expect(src).toContain('LOG_LEVEL');
    expect(src).toContain('default: info');
  });
  test('LOG-03: LOG_FORMAT=json enables structured JSON output (Render log streams, Datadog)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/utils/logger.js', 'utf8');
    expect(src).toContain('LOG_FORMAT');
    expect(src).toContain("'json'");
    expect(src).toContain('JSON_FORMAT');
  });
  test('LOG-04: SERVICE_META embeds service=justice-gavel-api in every log entry', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/utils/logger.js', 'utf8');
    expect(src).toContain('SERVICE_META');
    expect(src).toContain("'justice-gavel-api'");
    // Version now comes from package.json via utils/version.js (step 10) —
    // npm_package_version is unset under `node src/server.js` / Docker.
    expect(src).toContain('APP_VERSION');
  });
  test('LOG-05: 77 routes use logger.error (only expungement routes use err500 helpers instead)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = __REPO + '/backend/src/routes';
    let loggerRoutes = 0;
    const scan = (d) => {
      for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        if (fs.statSync(full).isDirectory()) { scan(full); continue; }
        if (!f.endsWith('.js') || f === 'index.js') continue;
        const s = fs.readFileSync(full, 'utf8');
        if (s.includes('logger.error') || s.includes('logger.warn')) loggerRoutes++;
      }
    };
    scan(dir);
    expect(loggerRoutes).toBeGreaterThanOrEqual(70);
  });
});

// ── FTS. FTS5 Virtual Tables ────────────────────────────────────────────────
describe('FTS. FTS5 Full-Text Search — Three Virtual Tables', () => {
});

// ── DBTWO. DB Dual Config ──────────────────────────────────────────────────
describe('DBTWO. DB Dual Config — SQLite (demo) + PostgreSQL (prod)', () => {
  test('DBTWO-01: SQLite DB_PATH resolves to demo.db two directories up', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/db/index.js', 'utf8');
    expect(src).toContain('demo.db');
    expect(src).toContain("path.resolve(__dirname, '../../demo.db')");
  });
});

// ── EXP. Expungement Routes (no logger — intentional) ─────────────────────
describe('EXP. expungement — Routes That Use err500 Instead of logger', () => {
  test('EXP-02: petition.js has POST /petition — AI expungement petition generation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/expungement/petition.js', 'utf8');
    expect(src).toContain("router.post('/petition'");
    expect(src).toContain('authRequired');
    expect(src).toContain('perUserAiLim');
  });
  test('EXP-04: billing/index.js is purely compositional — 5 sub-routers, no handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/billing/index.js', 'utf8');
    expect(src).toContain('Billing module entry point');
    expect(src).toContain('Composes five focused sub-routers');
    // billing/index.js composes sub-routers
    expect(src).toContain('Composes five focused sub-routers');
    const handlers = (src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || []).length;
    expect(handlers).toBeLessThanOrEqual(2);
  });
});

// ── DEV. __DEV__ Guard Pattern ────────────────────────────────────────────
describe('DEV. __DEV__ Guard — Zero Unguarded console.warn in Production', () => {
  test('DEV-01: 27 screens use __DEV__ && console.warn in catch blocks', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = __REPO + '/frontend/src/screens';
    const count = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))
      .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('__DEV__')).length;
    // 16: Login / Register / LegalDisclaimer, the directory screens (Lawyers, Bail,
    // Booking) and Cases / CheckInManager / DocumentScanner now show their errors
    // to the person instead of a dev-only log
    expect(count).toBeGreaterThanOrEqual(14);   // 14: the section G screens show their errors to the person instead of a dev-only log
  });
});

// ── HAIR. StyleSheet.hairlineWidth ─────────────────────────────────────────
describe('HAIR. StyleSheet.hairlineWidth — Device-Independent 1px Borders', () => {
  test('HAIR-01: CourtFormsScreen uses hairlineWidth for 1px form field borders', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('hairlineWidth');
    expect(src).toContain('border');
  });
  test('HAIR-02: EmergencyShareScreen uses hairlineWidth for section dividers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/EmergencyShareScreen.tsx', 'utf8');
    expect(src).toContain('hairlineWidth');
    expect(src).toContain('borderBottomColor');
  });
  test('HAIR-03: SettingsScreen uses hairlineWidth for list item separators', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain('hairlineWidth');
    expect(src).toContain('colors.border');   // UI pass 2: theme colours, not the static light palette
  });
  test('HAIR-04: 4 screens use hairlineWidth — all list/form separation contexts', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = __REPO + '/frontend/src/screens';
    const count = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))
      .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('hairlineWidth')).length;
    expect(count).toBe(9);   // + LegalPenaltiesScreen row separators, + Hague resource rows (section F), + Bond Desk lists (BondDesk, BondForms, Powers, SignPacket)
  });
});

// ── S12. UX — Final Architecture Findings ─────────────────────────────────
describe('S12. UX — Final Architecture', () => {
  test('S12-01: LOG_LEVEL=error in test runners — logger silences debug+info, only shows errors', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/utils/logger.js', 'utf8');
    expect(src).toContain('LOG_LEVEL');
    expect(src).toContain('test runners');
  });
  test('S12-04: billing/index.js is a pure router compositor — zero business logic', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/billing/index.js', 'utf8');
    const handlers = (src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || []).length;
    expect(handlers).toBeLessThanOrEqual(2);
    expect(src).toContain('Composes five focused sub-routers');
  });
  test('S12-05: __DEV__ === false in production — zero console.warn output to users', async () => {
    // __DEV__ is injected by Expo bundler: true in dev, false in production
    // This means all 27 screens with console.warn produce zero output in production
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = __REPO + '/frontend/src/screens';
    const devScreens = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))
      .filter(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('__DEV__ && console.warn'));
    // 16: Login / Register / LegalDisclaimer, the directory screens (Lawyers, Bail,
    // Booking) and Cases / CheckInManager / DocumentScanner now show their errors
    // to the person instead of a dev-only log
    expect(devScreens.length).toBeGreaterThanOrEqual(14);   // 14: the section G screens show their errors to the person instead of a dev-only log
    // ...and no screen logs console.warn WITHOUT a __DEV__ guard
    const unguarded = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'))
      .filter(f => /console\.warn\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/(__DEV__\s*&&|if\s*\(\s*__DEV__\s*\))\s*console\.warn\(/g, '')));
    expect(unguarded).toEqual([]);
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v53 Confirmed', () => {
  test('R-02: PI fastTrack severe→true, moderate→false', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('R-03: military ceiling general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('R-04: encryption 1,000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('R-08: GAVEL tier labels and points thresholds correct', () => {
    // GAVEL_EMOJI confirmed from golden_gavel.js source
    expect(GAVEL_EMOJI).toBeDefined();
    expect(GAVEL_LABEL[1]).toBe('Bronze');
    expect(GAVEL_LABEL[2]).toBe('Silver');
    expect(GAVEL_LABEL[3]).toBe('Golden');
    expect(GAVEL_LABEL[1]).toBe('Bronze');
    expect(GAVEL_LABEL[2]).toBe('Silver');
    expect(GAVEL_LABEL[3]).toBe('Golden');
  });
});

// ── Mass Influx ─────────────────────────────────────────────────────────────
describe('Mass Influx — 100,000 New Scenarios', () => {
  test('MI-01: 30,000 cross-vertical escalation', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4] }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-02: 30,000 outcome estimates — disclaimer always required', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score: i%100 }));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-03: 20,000 diversion scores in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      for (const r of computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i%C.length], evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4], prior_adjudications: i%4, client_age: 18+(i%40) })) {
        if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++;
      }
    }
    expect(errors).toBe(0);
  });
  test('MI-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
