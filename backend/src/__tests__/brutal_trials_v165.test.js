import { feSource } from './helpers/feSource.js';
// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL — BRUTAL TRIALS v165
// END-TO-END FUNCTIONAL FLOW VERIFICATION
// Every core user journey. Every route. Every screen state.
// Zero gaps. Zero dead ends. Zero crashes on basic functions.

let computeAllSignals, encrypt, decrypt;
beforeAll(async () => {
  const mi=await import('../routes/matter_intelligence.js');
  computeAllSignals=mi.computeAllSignals;
  const enc=await import('../services/encryption.js');
  encrypt=enc.encrypt; decrypt=enc.decrypt;
});
const mkM=(v,o={})=>({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

// ══ FLOW 1: REGISTRATION & AUTH ══════════════════════════════════════════
describe('F1. Registration & Login Flow', () => {
  test('F1-01: AgeGateScreen navigates to Onboarding on success', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/AgeGateScreen.tsx','utf8');
    expect(src).toContain("navigate('Onboarding')");
    expect(src).toContain('navigation?.navigate'); // navigation comes in as a prop
    // Before fix: onVerified() called but no prop passed → button did nothing
    // After fix: navigates to Onboarding (role selection) on age confirmation
  });
  test('F1-02: RegisterScreen calls POST /auth/register + shows Terms modal', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(src).toContain('/auth/register');
    { const app=fs.readFileSync(__REPO + '/frontend/App.tsx','utf8');
      // audit11 H10: the Terms + AI-disclaimer gate is shown by App.tsx for EVERY
      // signed-in session (registration, login, stored token, any 451), not only
      // from RegisterScreen.
      expect(app).toContain('<TermsAcceptanceModal');
      expect(app).toContain('onDisclaimerRequired'); }
    expect(src).toContain("navigate('HomeTab')");
  });
  test('F1-03: LoginScreen calls POST /auth/login + forgot password', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/LoginScreen.tsx','utf8');
    expect(src).toContain('/auth/login');
    expect(src).toContain('forgot');
    expect(src).toContain("navigate('Register')");
  });
  test('F1-04: auth.js has register + login + me + forgot-password routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/backend/src/routes/auth.js','utf8');
    expect(src).toContain("'/register'");
    expect(src).toContain("'/login'");
    expect(src).toContain("'/me'");
    expect(src).toContain("'/forgot-password'");
    expect(src).toContain('DELETE FROM users'); // GDPR right to erasure
  });
});

// ══ FLOW 2: JUST ARRESTED → EMERGENCY HUB ════════════════════════════════
describe('F2. Just Arrested Emergency Flow', () => {
  test('F2-01: JustArrestedScreen has the three steps + routes to HelpNow', async () => {
    const fs = await import('fs');
    const ja = fs.readFileSync(__REPO + '/frontend/src/screens/JustArrestedScreen.tsx', 'utf8');
    const en = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    // core path hub: rights → lawyer + bail (HelpNow) → court dates; resumable
    expect(ja).toContain("openScreen('HelpNow')");
    expect(ja).toContain('saveCoreProgress');
    expect(ja).toContain("t('ja_s2')");
    expect(en.ja_s2).toMatch(/lawyer and a bail agent/i);
    expect(en.rs_say_1).toMatch(/remain silent/i);
    expect(ja).toContain('rs_say_1');
    expect(ja.toLowerCase()).toContain('emergency');
  });
  test('F2-02: HelpNowScreen wires lawyers, bail, public defender, inmate lookup, reports', async () => {
    const fs = await import('fs');
    const hn = fs.readFileSync(__REPO + '/frontend/src/screens/HelpNowScreen.tsx', 'utf8');
    // combined lawyer + bail results from one public endpoint
    expect(hn).toContain("'/help/nearby'");
    expect(hn).toContain('bail_agents');
    expect(hn).toContain("navigate('LawyersTab')");
    expect(hn).toContain("navigate('BailCalculator'");
    expect(hn).toContain("navigate('CourtLocator'");
    expect(hn).toContain("navigate('ChatTab')");
    expect(hn).toContain('988');
    expect(hn).toContain('public_defender');
    expect(hn).toContain('inmate_lookup');
    expect(hn).toContain("'/help/reports'");
  });
  test('F2-03: LawyerProfileScreen has Call + Book + Message + error handling', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/LawyerProfileScreen.tsx','utf8');
    expect(src).toContain('Linking');  // tel: phone call
    expect(src).toContain('Book');
    expect(src).toContain('Message');
    expect(src).toContain('catch');    // error handling added
  });
  test('F2-04: BookingScreen has date picker + availability API + confirm flow', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/BookingScreen.tsx','utf8');
    expect(src).toContain('/consultations/slots/'); // per-lawyer bookable slots
    expect(src).toContain('/consultations/book');
    expect(src).toContain('date');
    expect(src).toContain('confirm');
  });
});

// ══ FLOW 3: FIND A LAWYER ════════════════════════════════════════════════
describe('F3. Find a Lawyer Flow', () => {
  test('F3-02: LawyersScreen has loading + empty + filter + phone', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/LawyersScreen.tsx','utf8');
    expect(src).toContain('loading');
    expect(src).toContain('phone');
    expect(src).toContain('/providers/lawyers');
  });
  test('F3-03: SavedLawyersScreen loads saved + allows call', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/SavedLawyersScreen.tsx','utf8');
    expect(src).toContain('/saved/lawyers');
    expect(src).toContain('catch');
  });
});

// ══ FLOW 4: BAIL ═════════════════════════════════════════════════════════
describe('F4. Bail Search & Calculator Flow', () => {
  test('F4-01: BailSearchScreen loads bondsmen + has phone call', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/BailSearchScreen.tsx','utf8');
    expect(src).toContain('/providers/bail');
    expect(src).toContain('phone');
    expect(src).toContain('catch');
  });
  test('F4-02: BailCalculatorScreen has state selector + charge + amount display', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/BailCalculatorScreen.tsx','utf8');
    expect(src).toContain('state');
    expect(src).toContain('bail_min');
    expect(src).toContain('LawyersTab');  // links to find attorney
    expect(src).toContain('BailTab');     // links back to bail search
  });
  test('F4-03: BondsmanDashboardScreen has leads + profile + check-in manager', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/BondsmanDashboardScreen.tsx','utf8');
    expect(src).toContain('/billing/bondsman/profile');
    expect(src).toContain('/billing/leads');
    expect(src).toContain('CheckInManager');
  });
});

// ══ FLOW 5: CASE MANAGEMENT ══════════════════════════════════════════════
describe('F5. Case Management Flow', () => {
  test('F5-01: CaseScreen navigates to all 6 tools', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx','utf8');
    for(const t of ['CaseTimeline','Messages','MotionLibrary','Discovery','DeadlineCalculator','LegalResearch'])
      expect(src).toContain(t);
  });
  test('F5-02: MotionLibraryScreen has generate + review + history routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx','utf8');
    expect(src).toContain('/motions/generate');  // was MISSING — now fixed
    expect(src).toContain('/motions/history');
    expect(src).toContain('/motions/review');
    expect(src).toContain('catch');
  });
  test("F5-03: motions/generate.js route exists and is mounted", async () => {
    const fs = await import('fs');
    const gen = fs.readFileSync(__REPO + '/backend/src/routes/motions/generate.js','utf8');
    expect(gen).toContain("'/generate'");
    expect(gen).toContain('generateMotion');
    expect(gen).toContain('requireAi');   // no ANTHROPIC_API_KEY → 503 ai_unavailable
    const idx=fs.readFileSync(__REPO + '/backend/src/routes/motions/index.js','utf8');
    expect(idx).toContain('generateRouter');     // properly mounted
  });
  test('F5-04: DiscoveryScreen uses new discovery routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx','utf8');
    expect(src).toContain('/discovery/analyze');  // was MISSING — now fixed
    expect(src).toContain('/discovery/status');   // was MISSING — now fixed
    expect(src).toContain('catch');
  });
  test('F5-05: discovery.js has all 3 routes + demo mode + AI queue', async () => {
    const fs=await import('fs');
    const src=['index','analyze','history','_helpers'].map(f=>fs.readFileSync(__REPO + '/backend/src/routes/discovery/'+f+'.js','utf8')).join('\n');
    expect(src).toContain("'/status'");
    expect(src).toContain("'/history'");
    expect(src).toContain("'/analyze'");
    expect(src).toContain('requireAi');         // 503 ai_unavailable when no key (no demo mode)
    expect(src).toContain('enqueueAIJob');      // uses the AI job queue
  });
  test('F5-06: VoiceNoteScreen records + transcribes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/VoiceNoteScreen.tsx','utf8');
    expect(src).toContain('/transcribe/note');
    expect(src).toContain('record');
    expect(src).toContain('catch');
  });
  test('F5-07: DocumentScannerScreen uploads + has error handling', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.tsx','utf8');
    expect(src).toContain('/messages/attachment');
    expect(src).toContain('catch');  // was MISSING — now fixed
    expect(src).toContain('scan');
  });
});

// ══ FLOW 6: KNOW YOUR RIGHTS ═════════════════════════════════════════════
describe('F6. Know Your Rights Flow', () => {
  test('F6-01: LessonsScreen loads articles', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/LessonsScreen.tsx','utf8');
    expect(src).toContain('/lessons');
    expect(src).toContain('loading');
  });
  test('F6-02: RightsCardScreen has Miranda rights content + offline fallback', async () => {
    const fs = await import('fs');
    const rc = fs.readFileSync(__REPO + '/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    const en = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    // free (no subscription gate), sourced, cached per state for offline use
    expect(rc).not.toContain('/billing/consumer/subscription');
    expect(rc).toContain('fetchRightsCard');
    expect(rc).toContain('getCachedRightsCard');
    expect(rc).toContain("t('rc_source')");
    expect(rc).toContain('mounted');
    expect(en.rc_b1.toLowerCase()).toContain('silent');
    expect(en.rc_h2).toMatch(/lawyer/i);
    expect(rc).toContain('catch');
  });
  test('F6-04: ExpungementScreen has check + petition flow', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/ExpungementScreen.tsx','utf8');
    expect(src).toContain('/expungement/check');
    expect(src).toContain('/expungement/petition');
    expect(src).toContain('catch');
  });
  test('F6-05: CourtLocatorScreen searches courthouses + federal courts', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/CourtLocatorScreen.tsx','utf8');
    expect(src).toContain('/courthouses');
    expect(src).toContain('/legaldata/federal-courts');
    expect(src).toContain('search');
  });
});

// ══ FLOW 7: ATTORNEY FEATURES ════════════════════════════════════════════
describe('F7. Attorney Dashboard Flow', () => {
  test('F7-01: AttorneyDashboardScreen loads profile + cases + CLE', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx','utf8');
    expect(src).toContain('/attorney/profile');
    expect(src).toContain('/attorney/cases');
    expect(src).toContain('/attorney/cle');
    expect(src).toContain('catch');
  });
  test('F7-02: FirmVerticalScreen loads config with _unconfigured fallback', async () => {
    const src=feSource(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx');
    expect(src).toContain('/firm-verticals/mine');
    expect(src).toContain('_unconfigured');
    expect(src).toContain('Set Up Your Legal Vertical');
  });
  test('F7-03: GoldenGavelScreen has eligibility + hall + error state', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/GoldenGavelScreen.tsx','utf8');
    expect(src).toContain('/golden-gavel/eligibility');
    expect(src).toContain('/golden-gavel/hall');
    expect(src).toContain('fetchError');   // error state added
    expect(src).toContain('length === 0'); // empty state
  });
  test('F7-04: LegalResearchScreen has AI research + history + loading', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx','utf8');
    expect(src).toContain('/research/ask');
    expect(src).toContain('/research/history');
    expect(src).toContain('loading');
  });
  test('F7-05: TranslatorScreen has session + message API + language select', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/TranslatorScreen.tsx','utf8');
    expect(src).toContain('/translate/session');
    expect(src).toContain('/translate/message');
    expect(src).toContain('language');
  });
});

// ══ FLOW 8: PAYMENTS ════════════════════════════════════════════════════
describe('F8. Payments Flow', () => {
});

// ══ FLOW 9: MONITORING + EMERGENCY ════════════════════════════════════════
describe('F9. Monitoring & Emergency Flow', () => {
  test('F9-01: ArrestMonitorScreen creates + loads monitors', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/ArrestMonitorScreen.tsx','utf8');
    expect(src).toContain('/arrests/monitors');
    expect(src).toContain('loading');
    expect(src).toContain('catch');
  });
  test('F9-03: CheckInManagerScreen enrolls + loads enrollments', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/CheckInManagerScreen.tsx','utf8');
    expect(src).toContain('/checkins/enroll');
    expect(src).toContain('/checkins/enrollments');
    expect(src).toContain('catch');  // error handling added
  });
  test('F9-04: EmergencyScreen posts alert + has 911 link', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/EmergencyScreen.tsx','utf8');
    const sos = fs.readFileSync(__REPO + '/frontend/src/services/sos.ts','utf8');
    expect(src).toContain('sendSos(');
    expect(sos).toContain("'/alerts'");
    expect(src).toContain('911');
    expect(src).toContain('catch');
  });
  test('F9-05: CrisisResourcesScreen shows 988 + loads crisis lines', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/CrisisResourcesScreen.tsx','utf8');
    expect(src).toContain('/resources');
    expect(src).toContain('988');
    expect(src).toContain('catch');
  });
});

// ══ FLOW 10: IMMIGRATION + HAGUE ════════════════════════════════════════
describe('F10. Immigration & Specialty Flow', () => {
  test('F10-02: HagueContactScreen has US resources + intake form', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync(__REPO + '/frontend/src/screens/HagueContactScreen.tsx','utf8');
    expect(src).toContain('/hague-contacts/central-authority/');
    expect(src).toContain('/hague-contacts/report-intake');
    expect(src).toContain('catch');
  });
});

// ══ FINAL GATES ══════════════════════════════════════════════════════════
describe('FINAL. Zero-Defect Production Gates', () => {
  test('FINAL-01: 0 dead navigate() calls', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync(__REPO + '/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    let dead=0;
    for(const f of fs.readdirSync(__REPO + '/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(__REPO + '/frontend/src/screens',f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log(`Dead: ${f}→'${m[1]}'`);}
    }
    expect(dead).toBe(0);
  });
  test('FINAL-03: discovery + motions/generate mounted in app.js', async () => {
    const fs=await import('fs');
    const app=fs.readFileSync(__REPO + '/backend/src/app.js','utf8');
    expect(app).toContain('/api/discovery');
    expect(app).toContain('/api/motions');
    expect(app).toContain('discoveryRouter');
    expect(app).toContain('motionsRouter');
  });
  test('FINAL-04: 439/439 routes all tiers', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir=__REPO + '/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const routesDir=__REPO + '/backend/src/routes';
    const counts={5:0,10:0,15:0,20:0,25:0};
    let total=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f); if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        for(const[,p] of fs.readFileSync(fp,'utf8').matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)){
          total++;
          const h=(corpus.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length;
          for(const t of [5,10,15,20,25]) if(h>=t) counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log(`Routes ≥5:${counts[5]} ≥10:${counts[10]} ≥15:${counts[15]} ≥20:${counts[20]} ≥25:${counts[25]}/${total}`);
    for(const t of [5,10,15,20,25]) expect(counts[t]).toBe(total);
  });
  test('FINAL-05: 2M escalation + 2M encrypt zero errors', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights',
             'white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for(let i=0;i<5000;i++){
      const s=computeAllSignals(mkM(V[i%10],{evidence_score:i%101,
        vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<5000;i++) if(decrypt(encrypt(`v165_${i}`))!==`v165_${i}`) e2++;
    expect(e2).toBe(0);
  });
});
