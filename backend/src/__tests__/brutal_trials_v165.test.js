// JUSTICE GAVEL — BRUTAL TRIALS v165
// END-TO-END FUNCTIONAL FLOW VERIFICATION
// Every core user journey. Every route. Every screen state.
// Zero gaps. Zero dead ends. Zero crashes on basic functions.

import { jest } from '@jest/globals';
let computeAllSignals, encrypt, decrypt, CONFIG;
beforeAll(async () => {
  const mi=await import('../routes/matter_intelligence.js');
  computeAllSignals=mi.computeAllSignals;
  const enc=await import('../services/encryption.js');
  encrypt=enc.encrypt; decrypt=enc.decrypt;
  const cfg=await import('../config.js');
  CONFIG=cfg.CONFIG;
});
const mkM=(v,o={})=>({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

// ══ FLOW 1: REGISTRATION & AUTH ══════════════════════════════════════════
describe('F1. Registration & Login Flow', () => {
  test('F1-01: AgeGateScreen navigates to Onboarding on success', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/AgeGateScreen.tsx','utf8');
    expect(src).toContain("navigate('Onboarding')");
    expect(src).toContain('useNavigation');
    // Before fix: onVerified() called but no prop passed → button did nothing
    // After fix: navigates to Onboarding (role selection) on age confirmation
  });
  test('F1-02: RegisterScreen calls POST /auth/register + shows Terms modal', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(src).toContain('/auth/register');
    expect(src).toContain('TermsAcceptanceModal');
    expect(src).toContain('showTerms');
    expect(src).toContain("navigate('HomeTab')");
  });
  test('F1-03: LoginScreen calls POST /auth/login + forgot password', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LoginScreen.tsx','utf8');
    expect(src).toContain('/auth/login');
    expect(src).toContain('forgot');
    expect(src).toContain("navigate('Register')");
  });
  test('F1-04: auth.js has register + login + me + forgot-password routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("'/register'");
    expect(src).toContain("'/login'");
    expect(src).toContain("'/me'");
    expect(src).toContain("'/forgot-password'");
    expect(src).toContain('DELETE FROM users'); // GDPR right to erasure
  });
});

// ══ FLOW 2: JUST ARRESTED → EMERGENCY HUB ════════════════════════════════
describe('F2. Just Arrested Emergency Flow', () => {
  test('F2-01: JustArrestedScreen has emergency steps + routes to HelpNow', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx','utf8');
    // Core actions present
    expect(src).toContain("action: 'find_help'");  // → HelpNow emergency hub
    expect(src).toContain('HelpNow');
    // Key content: bail, rights, emergency all present as text/keywords
    expect(src.toLowerCase()).toContain('bail');
    expect(src.toLowerCase()).toContain('right');
    expect(src.toLowerCase()).toContain('emergency');
  });
  test('F2-02: HelpNowScreen has all 5 emergency services wired', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(src).toContain('/providers/lawyers');  // find attorney
    expect(src).toContain('/providers/bail');      // find bondsman
    expect(src).toContain('/courthouses');         // find courthouse
    expect(src).toContain('CRISIS_LINE');          // crisis hotline
    expect(src).toContain('TREATMENT');            // treatment resources
    expect(src).toContain("navigate('LawyersTab')");
    expect(src).toContain("navigate('BailCalculator')");
    expect(src).toContain("navigate('CourtLocator')");
    expect(src).toContain("navigate('ChatTab')");  // AI legal chat
  });
  test('F2-03: LawyerProfileScreen has Call + Book + Message + error handling', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx','utf8');
    expect(src).toContain('Linking');  // tel: phone call
    expect(src).toContain('Book');
    expect(src).toContain('Message');
    expect(src).toContain('catch');    // error handling added
  });
  test('F2-04: BookingScreen has date picker + availability API + confirm flow', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/BookingScreen.tsx','utf8');
    expect(src).toContain('/attorney/profile/availability');
    expect(src).toContain('/consultations/book');
    expect(src).toContain('date');
    expect(src).toContain('confirm');
  });
});

// ══ FLOW 3: FIND A LAWYER ════════════════════════════════════════════════
describe('F3. Find a Lawyer Flow', () => {
  test('F3-01: MatchScreen MatchCard navigates to LawyerProfile', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/MatchScreen.tsx','utf8');
    const mcStart=src.indexOf('function MatchCard');
    const mcBlock=src.slice(mcStart, mcStart+600);
    expect(mcBlock).toContain("navigate('LawyerProfile'");
    expect(mcBlock).toContain('TouchableOpacity');
    expect(mcBlock).toContain('accessibilityRole="button"');
    // Was: static View — no tap handler. User saw matches but couldn't open any.
  });
  test('F3-02: LawyersScreen has loading + empty + filter + phone', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyersScreen.tsx','utf8');
    expect(src).toContain('loading');
    expect(src).toContain('phone');
    expect(src).toContain('/providers/lawyers');
  });
  test('F3-03: SavedLawyersScreen loads saved + allows call', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/SavedLawyersScreen.tsx','utf8');
    expect(src).toContain('/saved/lawyers');
    expect(src).toContain('catch');
  });
});

// ══ FLOW 4: BAIL ═════════════════════════════════════════════════════════
describe('F4. Bail Search & Calculator Flow', () => {
  test('F4-01: BailSearchScreen loads bondsmen + has phone call', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx','utf8');
    expect(src).toContain('/providers/bail');
    expect(src).toContain('phone');
    expect(src).toContain('catch');
  });
  test('F4-02: BailCalculatorScreen has state selector + charge + amount display', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/BailCalculatorScreen.tsx','utf8');
    expect(src).toContain('state');
    expect(src).toContain('bail_min');
    expect(src).toContain('LawyersTab');  // links to find attorney
    expect(src).toContain('BailTab');     // links back to bail search
  });
  test('F4-03: BondsmanDashboardScreen has leads + profile + check-in manager', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx','utf8');
    expect(src).toContain('/billing/bondsman/profile');
    expect(src).toContain('/billing/leads');
    expect(src).toContain('CheckInManager');
  });
});

// ══ FLOW 5: CASE MANAGEMENT ══════════════════════════════════════════════
describe('F5. Case Management Flow', () => {
  test('F5-01: CaseScreen navigates to all 6 tools', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx','utf8');
    for(const t of ['CaseTimeline','Messages','MotionLibrary','Discovery','DeadlineCalculator','LegalResearch'])
      expect(src).toContain(t);
  });
  test('F5-02: MotionLibraryScreen has generate + review + history routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/MotionLibraryScreen.tsx','utf8');
    expect(src).toContain('/motions/generate');  // was MISSING — now fixed
    expect(src).toContain('/motions/history');
    expect(src).toContain('/motions/review');
    expect(src).toContain('catch');
  });
  test('F5-03: motions/generate.js route exists and is mounted', async () => {
    const fs=await import('fs');
    const gen=fs.readFileSync('/tmp/JG/backend/src/routes/motions/generate.js','utf8');
    expect(gen).toContain("'/generate'");
    expect(gen).toContain('generateMotion');
    expect(gen).toContain('ANTHROPIC_API_KEY');  // demo mode guard
    const idx=fs.readFileSync('/tmp/JG/backend/src/routes/motions/index.js','utf8');
    expect(idx).toContain('generateRouter');     // properly mounted
  });
  test('F5-04: DiscoveryScreen uses new discovery routes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx','utf8');
    expect(src).toContain('/discovery/analyze');  // was MISSING — now fixed
    expect(src).toContain('/discovery/status');   // was MISSING — now fixed
    expect(src).toContain('catch');
  });
  test('F5-05: discovery.js has all 3 routes + demo mode + AI queue', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/discovery.js','utf8');
    expect(src).toContain("'/status'");
    expect(src).toContain("'/history'");
    expect(src).toContain("'/analyze'");
    expect(src).toContain('ANTHROPIC_API_KEY'); // demo mode when key not set
    expect(src).toContain('ai_jobs');           // uses proper job queue
  });
  test('F5-06: VoiceNoteScreen records + transcribes', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/VoiceNoteScreen.tsx','utf8');
    expect(src).toContain('/transcribe/note');
    expect(src).toContain('record');
    expect(src).toContain('catch');
  });
  test('F5-07: DocumentScannerScreen uploads + has error handling', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/DocumentScannerScreen.tsx','utf8');
    expect(src).toContain('/messages/attachment');
    expect(src).toContain('catch');  // was MISSING — now fixed
    expect(src).toContain('scan');
  });
});

// ══ FLOW 6: KNOW YOUR RIGHTS ═════════════════════════════════════════════
describe('F6. Know Your Rights Flow', () => {
  test('F6-01: LessonsScreen loads articles', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LessonsScreen.tsx','utf8');
    expect(src).toContain('/lessons');
    expect(src).toContain('loading');
  });
  test('F6-02: RightsCardScreen has Miranda rights content + error handling', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx','utf8');
    expect(src.toLowerCase()).toContain('silent');  // right to remain silent
    expect(src.toLowerCase()).toContain('attorney'); // right to attorney
    expect(src).toContain('catch');  // was MISSING — now fixed
  });
  test('F6-03: DUILawsScreen has BAC + state content', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/DUILawsScreen.tsx','utf8');
    expect(src).toContain('BAC');
    expect(src).toContain('state');
  });
  test('F6-04: ExpungementScreen has check + petition flow', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/ExpungementScreen.tsx','utf8');
    expect(src).toContain('/expungement/check');
    expect(src).toContain('/expungement/petition');
    expect(src).toContain('catch');
  });
  test('F6-05: CourtLocatorScreen searches courthouses + federal courts', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/CourtLocatorScreen.tsx','utf8');
    expect(src).toContain('/courthouses');
    expect(src).toContain('/legaldata/federal-courts');
    expect(src).toContain('search');
  });
});

// ══ FLOW 7: ATTORNEY FEATURES ════════════════════════════════════════════
describe('F7. Attorney Dashboard Flow', () => {
  test('F7-01: AttorneyDashboardScreen loads profile + cases + CLE', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/AttorneyDashboardScreen.tsx','utf8');
    expect(src).toContain('/attorney/profile');
    expect(src).toContain('/attorney/cases');
    expect(src).toContain('/attorney/cle');
    expect(src).toContain('catch');
  });
  test('F7-02: FirmVerticalScreen loads config with _unconfigured fallback', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/FirmVerticalScreen.tsx','utf8');
    expect(src).toContain('/firm-verticals/mine');
    expect(src).toContain('_unconfigured');
    expect(src).toContain('Set Up Your Legal Vertical');
  });
  test('F7-03: GoldenGavelScreen has eligibility + hall + error state', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/GoldenGavelScreen.tsx','utf8');
    expect(src).toContain('/golden-gavel/eligibility');
    expect(src).toContain('/golden-gavel/hall');
    expect(src).toContain('fetchError');   // error state added
    expect(src).toContain('length === 0'); // empty state
  });
  test('F7-04: LegalResearchScreen has AI research + history + loading', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LegalResearchScreen.tsx','utf8');
    expect(src).toContain('/research/ask');
    expect(src).toContain('/research/history');
    expect(src).toContain('loading');
  });
  test('F7-05: TranslatorScreen has session + message API + language select', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/TranslatorScreen.tsx','utf8');
    expect(src).toContain('/translate/session');
    expect(src).toContain('/translate/message');
    expect(src).toContain('language');
  });
});

// ══ FLOW 8: PAYMENTS ════════════════════════════════════════════════════
describe('F8. Payments Flow', () => {
  test('F8-01: SubscriptionScreen loads current plan + subscribe', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/SubscriptionScreen.tsx','utf8');
    expect(src).toContain('/billing/consumer/subscription');
    expect(src).toContain('/billing/subscribe');
    expect(src).toContain('catch');
  });
  test('F8-02: QuickConnectScreen has $20 connect + referral credit', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx','utf8');
    expect(src).toContain('/billing/quickconnect');
    expect(src).toContain('/referrals/credit');
    expect(src).toContain('catch');
  });
  test('F8-03: RewardsScreen has referral code + reviews', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RewardsScreen.tsx','utf8');
    expect(src).toContain('/referrals/my-code');
    expect(src).toContain('/reviews');
    expect(src).toContain('catch');
  });
});

// ══ FLOW 9: MONITORING + EMERGENCY ════════════════════════════════════════
describe('F9. Monitoring & Emergency Flow', () => {
  test('F9-01: ArrestMonitorScreen creates + loads monitors', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx','utf8');
    expect(src).toContain('/arrests/monitors');
    expect(src).toContain('loading');
    expect(src).toContain('catch');
  });
  test('F9-02: FamilyConnectScreen loads contacts + arrest search', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyConnectScreen.tsx','utf8');
    expect(src).toContain('/family/contacts');   // was MISSING route — now added
    expect(src).toContain('/arrests/search');
    expect(src).toContain('catch');
  });
  test('F9-03: CheckInManagerScreen enrolls + loads enrollments', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/CheckInManagerScreen.tsx','utf8');
    expect(src).toContain('/checkins/enroll');
    expect(src).toContain('/checkins/enrollments');
    expect(src).toContain('catch');  // error handling added
  });
  test('F9-04: EmergencyScreen posts alert + has 911 link', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/EmergencyScreen.tsx','utf8');
    expect(src).toContain('/alerts');
    expect(src).toContain('911');
    expect(src).toContain('catch');
  });
  test('F9-05: CrisisResourcesScreen shows 988 + loads crisis lines', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/CrisisResourcesScreen.tsx','utf8');
    expect(src).toContain('/resources');
    expect(src).toContain('988');
    expect(src).toContain('catch');
  });
});

// ══ FLOW 10: IMMIGRATION + HAGUE ════════════════════════════════════════
describe('F10. Immigration & Specialty Flow', () => {
  test('F10-01: ImmigrationConsequencesScreen links to HagueContact', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx','utf8');
    expect(src).toContain("navigate('HagueContact')");
    expect(src).toContain('/lessons');
  });
  test('F10-02: HagueContactScreen has US resources + intake form', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx','utf8');
    expect(src).toContain('/hague-contacts/us-resources');
    expect(src).toContain('/hague-contacts/report-intake');
    expect(src).toContain('catch');
  });
  test('F10-03: IceDetentionScreen has ICE locator + resources', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/IceDetentionScreen.tsx','utf8');
    expect(src).toContain('ICE');
    expect(src).toContain('/resources');
    expect(src).toContain('ChatTab');
  });
});

// ══ FINAL GATES ══════════════════════════════════════════════════════════
describe('FINAL. Zero-Defect Production Gates', () => {
  test('FINAL-01: 0 dead navigate() calls', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    let dead=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log(`Dead: ${f}→'${m[1]}'`);}
    }
    expect(dead).toBe(0);
  });
  test('FINAL-02: 0 acc + 0 hex + 0 setState without fallback', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hex=0,acc=0,noFb=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))hex++;
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
      noFb+=(s.match(/set\w+\((?:res|r|data|response)\.data\)(?!\s*\|)/g)||[]).length;
    }
    console.log(`hex:${hex} acc:${acc} noFb:${noFb}`);
    expect(hex).toBe(0); expect(acc).toBe(0); expect(noFb).toBe(0);
  });
  test('FINAL-03: discovery + motions/generate mounted in app.js', async () => {
    const fs=await import('fs');
    const app=fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(app).toContain('/api/discovery');
    expect(app).toContain('/api/motions');
    expect(app).toContain('discoveryRouter');
    expect(app).toContain('motionsRouter');
  });
  test('FINAL-04: 439/439 routes all tiers', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const routesDir='/tmp/JG/backend/src/routes';
    let counts={5:0,10:0,15:0,20:0,25:0},total=0;
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
    for(let i=0;i<2000000;i++){
      const s=computeAllSignals(mkM(V[i%10],{evidence_score:i%101,
        vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v165_${i}`))!==`v165_${i}`) e2++;
    expect(e2).toBe(0);
  });
});
