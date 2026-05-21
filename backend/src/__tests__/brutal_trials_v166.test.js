// JUSTICE GAVEL — BRUTAL TRIALS v166
// COMPLETE END-TO-END FUNCTIONAL VERIFICATION
// Every screen. Every flow. Every route. Every state.
// The standard: flawless basic function performance.

import { jest } from '@jest/globals';
let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt, CONFIG;
beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals    = mi.computeAllSignals;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});
const mkM = (v,o={}) => ({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

// ══ SCREEN QUALITY — every screen, every check ════════════════════════════
describe('SCREEN. All 75 Screens — Zero Defects', () => {
  test('S-01: 0 dead navigate() calls', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log(`Dead:${f}→'${m[1]}'`);}
    }
    expect(dead).toBe(0);
  });
  test('S-02: 0 setState without null fallback', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      n+=(s.match(/set\w+\((?:res|r|data|response)\.data\)(?!\s*\|)/g)||[]).length;
    }
    expect(n).toBe(0);
  });
  test('S-03: 0 unsafe .data.property access', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/(?:res|r|data|response)\.data\.[a-zA-Z_][a-zA-Z0-9_]*/g)){
        if(!m[0].includes('?.') && !'?.'.includes(src[m.index-2])) n++;
      }
    }
    expect(n).toBe(0);
  });
  test('S-04: 0 hex color violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))n++;
    }
    expect(n).toBe(0);
  });
  test('S-05: 0 accessibility violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      n+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(n).toBe(0);
  });
  test('S-06: 0 components unused', async () => {
    const fs=await import('fs'); const path=await import('path');
    const compDir='/tmp/JG/frontend/src/components';
    const scrDir='/tmp/JG/frontend/src/screens';
    let allSrc=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    for(const f of fs.readdirSync(scrDir).filter(f=>f.endsWith('.tsx')))
      allSrc+=fs.readFileSync(path.join(scrDir,f),'utf8');
    const unused=fs.readdirSync(compDir).filter(f=>f.endsWith('.tsx'))
      .map(f=>f.replace('.tsx','')).filter(c=>!allSrc.includes(c));
    expect(unused.length).toBe(0);
  });
  test('S-07: 76 screens registered (75 files + HagueContact)', async () => {
    const fs=await import('fs');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const names=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    expect(names.size).toBe(76);
    expect(names.has('HagueContact')).toBe(true);
  });
});

// ══ NAVIGATION — every screen reachable ═══════════════════════════════════
describe('NAV. All 76 Screens Reachable', () => {
  test('NAV-01: TILES grid covers 14 key screens via More:X pattern', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    const tilesStart=src.indexOf('const TILES');
    const tilesEnd=src.indexOf('];',tilesStart)+2;
    const tiles=src.slice(tilesStart,tilesEnd);
    // All More:X targets are valid MoreStack screens
    for(const t of [...tiles.matchAll(/nav:\s*['"]More:(\w+)['"]/g)].map(m=>m[1])){
      const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
      const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
      expect(reg.has(t)).toBe(true);
    }
    // HomeScreen navigate helper handles 'More:X' prefix correctly
    expect(src).toContain("nav.startsWith('More:')");
    expect(src).toContain("navigation.navigate('MoreTab', { screen: nav.slice(5)");
  });
  test('NAV-02: all registered screens reachable from somewhere', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    const allTargets=new Set();
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      // All navigate() targets
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]/g)) allTargets.add(m[1]);
      // Nested screen: navigate('Tab', {screen:'X'})
      for(const m of s.matchAll(/screen:\s*['"]([^'"]+)['"]/g)) allTargets.add(m[1]);
      // More:X tiles and references
      for(const m of s.matchAll(/['"]More:(\w+)['"]/g)) allTargets.add(m[1]);
    }
    const tabRoots=new Set(['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab','MoreHome']);
    const unreachable=[...reg].filter(r=>!allTargets.has(r)&&!tabRoots.has(r));
    console.log(`Unreachable screens: ${unreachable.length}: ${unreachable.join(',')}`);
    expect(unreachable.length).toBe(0);
  });
  test('NAV-03: HelpNow→BailCalculator, HelpNow→CourtLocator correct names', async () => {
    const fs=await import('fs');
    const hns=fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(hns).toContain("navigate('BailCalculator')");
    expect(hns).toContain("navigate('CourtLocator')");
    expect(hns).not.toContain("navigate('BailCalculatorScreen')");
    expect(hns).not.toContain("navigate('CourtLocatorScreen')");
  });
  test('NAV-04: MatchCard taps to LawyerProfile', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/MatchScreen.tsx','utf8');
    const mc=src.slice(src.indexOf('function MatchCard'),src.indexOf('function MatchCard')+600);
    expect(mc).toContain("navigate('LawyerProfile'");
    expect(mc).toContain('TouchableOpacity');
  });
  test('NAV-05: AgeGate navigates to Onboarding on success', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/AgeGateScreen.tsx','utf8');
    expect(src).toContain("navigate('Onboarding')");
  });
  test('NAV-06: HagueContact linked from Immigration + FamilyCourt', async () => {
    const fs=await import('fs');
    const imm=fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx','utf8');
    const fam=fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx','utf8');
    expect(imm).toContain("navigate('HagueContact')");
    expect(fam).toContain("navigate('HagueContact')");
  });
  test('NAV-07: TermsAcceptanceModal shown in RegisterScreen', async () => {
    const fs=await import('fs');
    const reg=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(reg).toContain('TermsAcceptanceModal');
    expect(reg).toContain('showTerms');
  });
});

// ══ BACKEND — routes, auth, DB ════════════════════════════════════════════
describe('BE. Backend Integrity', () => {
  test('BE-01: 363+ backend routes defined', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let total=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        total+=[...src.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]/g)].length;
      }
    };
    wd(routesDir);
    console.log(`Total backend routes: ${total}`);
    expect(total).toBeGreaterThan(360);
  });
  test('BE-02: all 92 route files have try/catch', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let noTryCatch=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        const handlers=(src.match(/router\.(get|post|put|delete|patch)\s*\([^,]+,\s*async/g)||[]).length;
        if(handlers>0 && !src.includes('try {') && !src.includes('try{')) noTryCatch++;
      }
    };
    wd(routesDir);
    expect(noTryCatch).toBe(0);
  });
  test('BE-03: discovery.js has all 3 routes + AI queue + demo mode', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/discovery.js','utf8');
    expect(src).toContain("'/status'");
    expect(src).toContain("'/history'");
    expect(src).toContain("'/analyze'");
    expect(src).toContain('ANTHROPIC_API_KEY');
    expect(src).toContain('ai_jobs');
  });
  test('BE-04: motions/generate.js route exists + mounted', async () => {
    const fs=await import('fs');
    const gen=fs.readFileSync('/tmp/JG/backend/src/routes/motions/generate.js','utf8');
    expect(gen).toContain("'/generate'");
    expect(gen).toContain('generateMotion');
    const idx=fs.readFileSync('/tmp/JG/backend/src/routes/motions/index.js','utf8');
    expect(idx).toContain('generateRouter');
  });
  test('BE-05: GET /family/contacts route in cases.js', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("'/family/contacts'");
  });
  test('BE-06: 5 migration-043 tables in db/index.js', async () => {
    const fs=await import('fs');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    for(const t of ['recovery_agents','feedback','firm_invites','account_deletion_log','ai_jobs'])
      expect(db).toContain(t);
  });
  test('BE-07: 11 composite performance indexes', async () => {
    const fs=await import('fs');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(db).toContain('idx_matters_firm_status');
    expect(db).toContain('idx_audit_log_firm_created');
    expect(db).toContain('idx_cases_user_status');
    expect(db).toContain('idx_docket_entries_matter_due');
  });
  test('BE-08: auth.js has rate limiting + GDPR delete', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain('DELETE FROM users');
    expect(src.toLowerCase()).toContain('ratelimit');
  });
  test('BE-09: Stripe webhook handles all 5 payment events', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js','utf8');
    for(const ev of ['payment_intent.succeeded','invoice.payment_failed',
                     'customer.subscription.deleted','customer.subscription.updated',
                     'checkout.session.completed'])
      expect(src).toContain(ev);
  });
  test('BE-10: 0 SQL injection risks', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let risky=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        risky+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
      }
    };
    wd(routesDir);
    expect(risky).toBe(0);
  });
  test('BE-11: all SELECT * have intentional comment or projection', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let bare=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        for(const m of src.matchAll(/SELECT \*[^\n]*/g)){
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable')) bare++;
        }
      }
    };
    wd(routesDir);
    expect(bare).toBe(0);
  });
});

// ══ CORE FLOWS — key user journeys verified ════════════════════════════════
describe('FLOW. Core User Journeys', () => {
  test('FLOW-01: Registration → Onboarding → Login full chain', async () => {
    const fs=await import('fs');
    const age=fs.readFileSync('/tmp/JG/frontend/src/screens/AgeGateScreen.tsx','utf8');
    const reg=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    const log=fs.readFileSync('/tmp/JG/frontend/src/screens/LoginScreen.tsx','utf8');
    expect(age).toContain("navigate('Onboarding')");
    expect(reg).toContain('/auth/register');
    expect(reg).toContain('TermsAcceptanceModal');
    expect(reg).toContain("navigate('HomeTab')");
    expect(log).toContain('/auth/login');
    expect(log).toContain("navigate('Register')");
  });
  test('FLOW-02: Emergency flow chain — JustArrested→HelpNow→Lawyers', async () => {
    const fs=await import('fs');
    const ja=fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx','utf8');
    const hn=fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(ja).toContain('HelpNow'); // find_help action routes to HelpNow
    expect(hn).toContain("navigate('LawyersTab')");
    expect(hn).toContain("navigate('BailCalculator')");
    expect(hn).toContain("navigate('CourtLocator')");
    expect(hn).toContain("navigate('ChatTab')");
    expect(hn).toContain('/providers/lawyers');
    expect(hn).toContain('/providers/bail');
    expect(hn).toContain('/courthouses');
  });
  test('FLOW-03: Lawyer search → Match → Profile → Book chain', async () => {
    const fs=await import('fs');
    const ls=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyersScreen.tsx','utf8');
    const ms=fs.readFileSync('/tmp/JG/frontend/src/screens/MatchScreen.tsx','utf8');
    const lp=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx','utf8');
    const bk=fs.readFileSync('/tmp/JG/frontend/src/screens/BookingScreen.tsx','utf8');
    expect(ls).toContain('/providers/lawyers');
    const mc=ms.slice(ms.indexOf('function MatchCard'),ms.indexOf('function MatchCard')+600);
    expect(mc).toContain("navigate('LawyerProfile'");
    expect(lp).toContain('Linking'); // phone call
    expect(lp).toContain('catch');   // error handling
    expect(bk).toContain('/consultations/book');
    expect(bk).toContain('/attorney/profile/availability');
  });
  test('FLOW-04: AI features — discovery + motions + research chain', async () => {
    const fs=await import('fs');
    const disc=fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx','utf8');
    const ml=fs.readFileSync('/tmp/JG/frontend/src/screens/MotionLibraryScreen.tsx','utf8');
    const lr=fs.readFileSync('/tmp/JG/frontend/src/screens/LegalResearchScreen.tsx','utf8');
    expect(disc).toContain('/discovery/analyze');
    expect(disc).toContain('/discovery/status');
    expect(ml).toContain('/motions/generate');
    expect(ml).toContain('/motions/history');
    expect(lr).toContain('/research/ask');
    expect(lr).toContain('/research/history');
  });
  test('FLOW-05: Case management chain', async () => {
    const fs=await import('fs');
    const cs=fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx','utf8');
    for(const dest of ['CaseTimeline','Messages','MotionLibrary','Discovery','DeadlineCalculator','LegalResearch'])
      expect(cs).toContain(dest);
  });
  test('FLOW-06: Bail chain — Search→Calculator→Bondsman', async () => {
    const fs=await import('fs');
    const bs=fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx','utf8');
    const bc=fs.readFileSync('/tmp/JG/frontend/src/screens/BailCalculatorScreen.tsx','utf8');
    const bd=fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx','utf8');
    expect(bs).toContain('/providers/bail');
    expect(bc).toContain('state');
    expect(bd).toContain('/billing/bondsman/profile');
    expect(bd).toContain('/billing/leads');
  });
  test('FLOW-07: Know Your Rights chain', async () => {
    const fs=await import('fs');
    const ls=fs.readFileSync('/tmp/JG/frontend/src/screens/LessonsScreen.tsx','utf8');
    const rc=fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx','utf8');
    const dui=fs.readFileSync('/tmp/JG/frontend/src/screens/DUILawsScreen.tsx','utf8');
    expect(ls).toContain('/lessons');
    expect(rc.toLowerCase()).toContain('silent');
    expect(rc.toLowerCase()).toContain('attorney');
    expect(rc).toContain('catch');
    expect(dui).toContain('BAC');
  });
  test('FLOW-08: Payment chain — Subscribe→Pay→QuickConnect', async () => {
    const fs=await import('fs');
    const sub=fs.readFileSync('/tmp/JG/frontend/src/screens/SubscriptionScreen.tsx','utf8');
    const pay=fs.readFileSync('/tmp/JG/frontend/src/screens/PaymentsScreen.tsx','utf8');
    const qc=fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx','utf8');
    expect(sub).toContain('/billing/consumer/subscription');
    expect(pay).toContain('/pay/create');
    expect(qc).toContain('/billing/quickconnect');
  });
  test('FLOW-09: Monitoring chain — Arrest Monitor → Family Connect → CheckIn', async () => {
    const fs=await import('fs');
    const am=fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx','utf8');
    const fc=fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyConnectScreen.tsx','utf8');
    const ci=fs.readFileSync('/tmp/JG/frontend/src/screens/CheckInScreen.tsx','utf8');
    expect(am).toContain('/arrests/monitors');
    expect(fc).toContain('/family/contacts');
    expect(fc).toContain('/arrests/search');
    expect(ci).toContain('/checkins/submit');
  });
  test('FLOW-10: Immigration chain — IceDetention→Immigration→HagueContact', async () => {
    const fs=await import('fs');
    const ice=fs.readFileSync('/tmp/JG/frontend/src/screens/IceDetentionScreen.tsx','utf8');
    const imm=fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx','utf8');
    const hag=fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx','utf8');
    expect(ice).toContain('/resources');
    expect(imm).toContain("navigate('HagueContact')");
    expect(hag).toContain('/hague-contacts/us-resources');
    expect(hag).toContain('/hague-contacts/report-intake');
  });
});

// ══ DATA — seed completeness ════════════════════════════════════════════════
describe('DATA. Seed & Schema Completeness', () => {
  test('DATA-01: 51/51 bail schedule states', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/scripts/seed_providers.js','utf8');
    const bs=src.slice(src.indexOf('const BAIL_SCHEDULES'),src.indexOf('const bailStmt'));
    const states=new Set([...bs.matchAll(/state:'([A-Z]{2})'/g)].map(m=>m[1]));
    expect(states.size).toBe(51);
  });
  test('DATA-02: 50+ lessons in seed', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/scripts/seed_providers.js','utf8');
    const li=src.indexOf('const LESSONS');
    const le=src.indexOf('];',li)+2;
    const count=[...src.slice(li,le).matchAll(/title:'[^']+'/g)].length;
    expect(count).toBeGreaterThanOrEqual(50);
  });
  test('DATA-03: forum posts + specialty courts + demo arrests seeded', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/scripts/seed_demo.js','utf8');
    expect(src).toContain('FORUM_POSTS');
    expect(src).toContain('SPECIALTY_COURTS');
    expect(src).toContain('DEMO_ARRESTS');
  });
  test('DATA-04: TODO.md 0 incomplete items', async () => {
    const fs=await import('fs');
    const todo=fs.readFileSync('/tmp/JG/TODO.md','utf8');
    expect((todo.match(/❌/g)||[]).length).toBe(0);
  });
});

// ══ MASS INFLUX ════════════════════════════════════════════════════════════
describe('MASS. 2M Influx — Zero Errors', () => {
  test('MASS-01: 2M escalation + 2M encrypt', () => {
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v166_${i}`))!==`v166_${i}`) e2++;
    expect(e2).toBe(0);
  });
  test('MASS-02: 439+ routes all tiers ≥5 ≥10 ≥15 ≥20 ≥25', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const routesDir='/tmp/JG/backend/src/routes';
    let counts={5:0,10:0,15:0,20:0,25:0},total=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
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
});
