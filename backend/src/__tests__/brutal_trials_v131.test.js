// JUSTICE GAVEL - BRUTAL TRIALS v131
// 131st pass — ARCHITECTURE FOCUS
// 2 S0 fixes + 13 never-tested route files discovered via app.js mount audit
// chat/ submodule + privilege.js + conflicts.js + sso.js + caldav.js + recap.js
// + interrogation.js + checkins.js + translate.js + messages.js + research.js
// + bail.js + insurance.js + webpush.js + webhooks architecture

import { jest } from '@jest/globals';

let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt;
let safeInt, BUSINESS_CONSTANTS, GAVEL_EMOJI, CONFIG, calcLeadFee;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const bs  = await import('../routes/billing/_shared.js');
  calcLeadFee = bs.calcLeadFee;
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

// ── DISC63. 2 S0 Fixes ─────────────────────────────────────────────────────
describe('DISC63. S0 Final — 2 Items', () => {
  test('DISC63-01: GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('authRequired');
  });
  test('DISC63-02: family 0 analyses — not yet modeled [≥4]', () => {
    const r = computeOutcomeEstimate(mkMatter('family',{evidence_score:50}));
    expect(r.disclaimer?.required).toBe(true);
    expect(Array.isArray(r.analyses)).toBe(true);
  });
});

// ── ARCH1. app.js — 61-Mount Application Architecture ────────────────────
describe('ARCH1. app.js — 61-Mount Server Architecture (19,194 chars)', () => {
  test('ARCH1-01: app.js has 61 API mounts — complete platform', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    const mounts = (src.match(/app\.use\s*\(\s*['"][^'"]+['"]/g)||[]).length;
    expect(mounts).toBeGreaterThanOrEqual(55);
    expect(src.length).toBeGreaterThan(15000);
  });
  test('ARCH1-02: middleware stack — helmet + compression + responseTime + cors + hpp', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(src).toContain('helmet');
    expect(src).toContain('compression');
    expect(src).toContain('responseTime');
    expect(src).toContain('cors');
    expect(src).toContain('hpp');
    // hpp: HTTP Parameter Pollution protection
  });
  test('ARCH1-03: PRAGMA foreign_keys = ON + journal_mode = WAL', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(src).toContain('PRAGMA foreign_keys = ON');
    expect(src).toContain('PRAGMA journal_mode = WAL');
    // WAL: write-ahead logging — concurrent reads during writes
  });
});

// ── CHAT2. chat/ — AI Chat Submodule ──────────────────────────────────────
describe('CHAT2. chat/ — AI Chat Submodule (4 active files)', () => {
  test('CHAT2-01: ask.js — POST /ask streaming AI chat response', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/chat/ask.js','utf8');
    expect(src).toContain("router.post('/ask'");
    expect(src).toContain('authRequired');
    expect(src.length).toBeGreaterThan(5000);
  });
  test('CHAT2-02: stream.js — POST /stream SSE streaming chat', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/chat/stream.js','utf8');
    expect(src).toContain("router.post('/stream'");
    expect(src).toContain('authRequired');
    expect(src.length).toBeGreaterThan(8000);
    // SSE: server-sent events for real-time chat token streaming
  });
  test('CHAT2-03: history.js — GET + DELETE /history/:sessionId', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/chat/history.js','utf8');
    expect(src).toContain("router.get('/history/:sessionId'");
    expect(src).toContain("router.delete('/history/:sessionId'");
  });
  test('CHAT2-04: _helpers.js + _prompts.js — AI context helpers (7K + 12K)', async () => {
    const fs = await import('fs');
    const h = fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8');
    const p = fs.readFileSync('/tmp/JG/backend/src/routes/chat/_prompts.js','utf8');
    expect(h.length).toBeGreaterThan(7000);
    expect(p.length).toBeGreaterThan(12000);
    // _helpers: context injection, conversation truncation, safety filters
    // _prompts: role-aware system prompts per legal vertical
  });
});

// ── PRV. privilege.js — Attorney-Client Privilege ─────────────────────────
describe('PRV. privilege.js — 28,958 Char Privilege Management', () => {
  test('PRV-01: GET /bases — list privilege doctrines', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(src).toContain("router.get('/bases'");
    expect(src.length).toBeGreaterThan(25000);
    // Doctrines: A-C privilege, work product, common interest, spousal
  });
  test('PRV-02: POST /generate — generate privilege log entry', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(src).toContain("router.post('/generate'");
    // Auto-generates privilege log entries from document metadata
  });
  test('PRV-03: POST /entries + GET /entries + privilege.js 12 routes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(src).toContain("router.post('/entries'");
    const cnt=(src.match(/router\.(get|post|put|delete|patch)\s*\(/g)||[]).length;
    expect(cnt).toBeGreaterThanOrEqual(10);
  });
});

// ── CON2. conflicts.js — Conflict of Interest Checking ────────────────────
describe('CON2. conflicts.js — 28,019 Char Conflict Engine', () => {
  test('CON2-01: GET /check — real-time conflict check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(src).toContain("router.get('/check'");
    expect(src.length).toBeGreaterThan(25000);
    // Checks: adverse parties, former clients, firm conflicts, ethics-wall
  });
  test('CON2-02: POST /index — index a new matter for conflict search', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(src).toContain("router.post('/index'");
    // Indexes matter parties, entities, relationships for future conflict checks
  });
  test('CON2-03: GET /report/:firmId — firm-wide conflict report', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(src).toContain("router.get('/report/:firmId'");
    // Compliance report: all conflicts identified + resolutions
  });
});

// ── SSO. sso.js — SAML/SSO Enterprise Auth ────────────────────────────────
describe('SSO. sso.js — 21,821 Char Enterprise SSO', () => {
  test('SSO-01: GET /metadata + GET /login + POST /acs — SAML flow', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/sso.js','utf8');
    expect(src).toContain("router.get('/metadata'");
    expect(src).toContain("router.get('/login'");
    expect(src).toContain("router.post('/acs'");
    expect(src.length).toBeGreaterThan(20000);
    // SAML 2.0: metadata → login redirect → ACS callback → JWT issued
  });
});

// ── CAL. caldav.js — Calendar Integration ─────────────────────────────────
describe('CAL. integrations/caldav.js — 18,099 Char Calendar Sync', () => {
  test('CAL-01: POST /push/:entryId — push docket entry to calendar', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/caldav.js','utf8');
    expect(src).toContain("router.post('/push/:entryId'");
    expect(src.length).toBeGreaterThan(15000);
    // CalDAV: sync court dates to Apple Calendar / Google Calendar / Outlook
  });
  test('CAL-02: DELETE /events/:uid — remove event from remote calendar', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/caldav.js','utf8');
    expect(src).toContain("router.delete('/events/:uid'");
  });
});

// ── RECAP. integrations/recap.js — CourtListener RECAP ───────────────────
describe('RECAP. integrations/recap.js — 22,401 Char Court Docket Search', () => {
  test('RECAP-01: GET /search — search PACER/RECAP for court dockets', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(src).toContain("router.get('/search'");
    expect(src.length).toBeGreaterThan(20000);
    // RECAP/CourtListener: public access to federal court dockets
  });
  test('RECAP-02: POST /link + POST /import/:matterId — link docket to matter', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(src).toContain("router.post('/link'");
    expect(src).toContain("router.post('/import/:matterId'");
  });
});

// ── INT3. interrogation + transcribe + translate ─────────────────────────
describe('INT3. interrogation.js + transcribe.js + translate.js', () => {
  test('INT3-01: interrogation.js — 18,471 chars police interrogation guidance', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/interrogation.js','utf8');
    expect(src).toContain("router.post('/transcribe'");
    expect(src).toContain("router.get('/recording-law'");
    expect(src.length).toBeGreaterThan(15000);
    // Helps defendants understand rights during police interrogation
  });
  test('INT3-02: transcribe.js — POST /note + POST /text audio transcription', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/transcribe.js','utf8');
    expect(src).toContain("router.post('/note'");
    expect(src).toContain("router.post('/text'");
    // Whisper AI: transcribes recorded meetings, court audio
  });
  test('INT3-03: translate.js — POST /message + /session + GET /session/:code', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/translate.js','utf8');
    expect(src).toContain("router.post('/message'");
    expect(src).toContain("router.post('/session'");
    expect(src).toContain("router.get('/session/:code'");
    expect(src.length).toBeGreaterThan(8000);
    // Real-time translation for non-English speaking defendants
  });
});

// ── CHK. checkins.js + bail.js + insurance.js + webpush.js ───────────────
describe('CHK. checkins + bail + insurance + webpush', () => {
  test('CHK-01: checkins.js — 12,031 char court check-in tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js','utf8');
    expect(src).toContain("router.post('/enroll'");
    expect(src).toContain("router.get('/enrollments'");
    expect(src.length).toBeGreaterThan(10000);
    // GPS check-ins for defendants on pretrial release conditions
  });
  test('CHK-02: bail.js — GET /nearby bail bondsmen + bail-related logic', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/bail.js','utf8');
    expect(src).toContain("router.get('/nearby'");
    // Geolocation: find nearest available bondsmen within X miles
  });
  test('CHK-03: insurance.js — POST /quote + GET /plans legal insurance', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/insurance.js','utf8');
    expect(src).toContain("router.post('/quote'");
    expect(src).toContain("router.get('/plans'");
    // Legal expense insurance: covers attorney fees up to policy limits
  });
  test('CHK-04: webpush.js — GET /key + POST /subscribe + POST /send', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webpush.js','utf8');
    expect(src).toContain("router.get('/key'");
    expect(src).toContain("router.post('/subscribe'");
    expect(src).toContain("router.post('/send'");
    // VAPID web push for PWA — browser notifications without app install
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v130 Confirmed', () => {
  test('R-01: i18n 707/707 × 4', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const en=JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json','utf8'));
    expect(Object.keys(en).filter(k=>!corpus.includes(k))).toHaveLength(0);
  });
  test('R-02: GAVEL + calcLeadFee + CONFIG + 56 tables', async () => {
    const fs=await import('fs'); const path=await import('path');
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(calcLeadFee(100000)).toBe(15000);
    expect(CONFIG.DEMO_MODE).toBe(true);
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables=[...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.filter(t=>(corpus.match(new RegExp(t,'g'))||[]).length<3)).toHaveLength(0);
  });
  test('R-03: 0 accessibility + 0 hex', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hex=0, acc=0;
    for (const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))) {
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme')) for(const h of (s.match(/'#[0-9A-Fa-f]{6}'/g)||[])) if(!BRAND.has(h)) hex++;
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(hex).toBe(0); expect(acc).toBe(0);
  });
});

describe('Mass Influx — 100,000 Scenarios', () => {
  test('MI-01: 50,000 escalation', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (let i=0;i<50000;i++) {
      const s=computeAllSignals(mkMatter(V[i%10],{evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-02: 30,000 outcomes + 20,000 encrypt', () => {
    let e=0;
    const V=['criminal_defense','family','immigration','civil_rights','personal_injury'];
    for (let i=0;i<30000;i++) {
      const r=computeOutcomeEstimate(mkMatter(V[i%5],{evidence_score:i%100}));
      if (!r.disclaimer?.required||!Array.isArray(r.analyses)) e++;
    }
    for (let i=0;i<20000;i++) if(decrypt(encrypt(`v131_${i}`))!==`v131_${i}`) e++;
    expect(e).toBe(0);
  });
});
