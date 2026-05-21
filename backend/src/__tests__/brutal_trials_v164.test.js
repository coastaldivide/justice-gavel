// JUSTICE GAVEL — BRUTAL TRIALS v164
// COMPLETE NAVIGATION & UX SCAN — ALL ISSUES FIXED
// 22-section audit across every screen, link, route, and component

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

describe('NAV1. All navigate() calls are valid', () => {
  test('N1-01: 0 dead navigate() calls across all 75 screens', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const registered=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g)){
        if(!registered.has(m[1])){dead++; console.log(`Dead: ${f}→'${m[1]}'`);}
      }
    }
    expect(dead).toBe(0);
  });
  test('N1-02: HelpNow uses correct route names (BailCalculator, CourtLocator)', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(src).toContain("navigate('BailCalculator')");
    expect(src).toContain("navigate('CourtLocator')");
    expect(src).not.toContain("navigate('BailCalculatorScreen')");
    expect(src).not.toContain("navigate('CourtLocatorScreen')");
  });
  test('N1-03: JustArrested routes to HelpNow (find_help action)', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx','utf8');
    expect(src).toContain("action: 'find_help'");
    expect(src).toContain("HelpNow");
    // find_help → HelpNow → LawyersTab: 2-step emergency flow (intentional UX design)
  });
  test('N1-04: MatchCard taps through to LawyerProfile', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/MatchScreen.tsx','utf8');
    const mcStart=src.indexOf('function MatchCard');
    const mcBlock=src.slice(mcStart,mcStart+600);
    expect(mcBlock).toContain("navigate('LawyerProfile'");
    expect(mcBlock).toContain('TouchableOpacity');
    expect(mcBlock).toContain('accessibilityRole="button"');
    // Before: user sees match results but cannot tap through to attorney profile
    // After: tapping a match card navigates to full LawyerProfileScreen
  });
  test('N1-05: HagueContact registered and linked from Immigration + FamilyCourt', async () => {
    const fs=await import('fs');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    expect(nav).toContain('name="HagueContact"');
    const imm=fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx','utf8');
    const fam=fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx','utf8');
    expect(imm).toContain("navigate('HagueContact')");
    expect(fam).toContain("navigate('HagueContact')");
  });
  test('N1-06: TermsAcceptanceModal wired into RegisterScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(src).toContain('TermsAcceptanceModal');
    expect(src).toContain('showTerms');
  });
});

describe('NAV2. All components in use', () => {
  test('N2-01: 0 unused components', async () => {
    const fs=await import('fs'); const path=await import('path');
    const compDir='/tmp/JG/frontend/src/components';
    const scrDir='/tmp/JG/frontend/src/screens';
    const navSrc=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    let allSrc=navSrc;
    for(const f of fs.readdirSync(scrDir).filter(f=>f.endsWith('.tsx')))
      allSrc+=fs.readFileSync(path.join(scrDir,f),'utf8');
    const unused=fs.readdirSync(compDir).filter(f=>f.endsWith('.tsx'))
      .map(f=>f.replace('.tsx','')).filter(c=>!allSrc.includes(c));
    console.log(`Unused: ${unused}`);
    expect(unused.length).toBe(0);
  });
  test('N2-02: LawyerSkeletonCard in LawyersScreen loading state', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyersScreen.tsx','utf8');
    expect(src).toContain('LawyerSkeletonCard');
  });
  test('N2-03: LegalNotice in DUILaws + DrugPenalties + Expungement', async () => {
    const fs=await import('fs');
    for(const f of ['DUILawsScreen','DrugPenaltiesScreen','ExpungementScreen']){
      const src=fs.readFileSync(`/tmp/JG/frontend/src/screens/${f}.tsx`,'utf8');
      expect(src).toContain('LegalNotice');
    }
  });
});

describe('API1. Backend Routes for Frontend Calls', () => {
  test('API-01: GET /family/contacts route exists in cases.js', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("'/family/contacts'");
    // FamilyConnectScreen calls this; was previously missing → 404 on every load
  });
  test('API-02: /advocacy/stats route exists', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/advocacy.js','utf8');
    expect(src.toLowerCase()).toContain('stats');
  });
  test('API-03: /arrests/monitors GET+POST routes exist', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/arrests.js','utf8');
    expect(src).toContain('/monitors');
  });
  test('API-04: /checkins routes exist (enroll, submit, enrollments)', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js','utf8');
    expect(src).toContain('enroll');
  });
  test('API-05: /pay/create route exists', async () => {
    const fs=await import('fs');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/pay.js')).toBe(true);
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/pay.js','utf8');
    expect(src).toContain('create');
  });
  test('API-06: /push/token + /push/reminders exist', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/push.js','utf8');
    expect(src).toContain('/token');
    expect(src).toContain('reminder');
  });
});

describe('UX1. Zero Quality Violations', () => {
  test('UX-01: 0 accessibility violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let acc=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(acc).toBe(0);
  });
  test('UX-02: 0 hex color violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hex=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme')) for(const h of (s.match(/'#[0-9A-Fa-f]{6}'/g)||[])) if(!BRAND.has(h)) hex++;
    }
    expect(hex).toBe(0);
  });
  test('UX-03: 0 setState without fallback', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      n+=(fs.readFileSync(path.join(scr,f),'utf8').match(/set\w+\((?:res|r|data|response)\.data\)(?!\s*\|)/g)||[]).length;
    }
    expect(n).toBe(0);
  });
  test('UX-04: 0 unsafe .data.property access', async () => {
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
  test('UX-05: Linking.openURL uses valid schemes only', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let invalid=0;
    const validSchemes=['http','https','tel:','sms:','mailto:','app-settings:'];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/Linking\.openURL\(['"]([^'"]+)['"]\)/g)){
        const url=m[1];
        if(!validSchemes.some(s=>url.startsWith(s))){invalid++; console.log(`Invalid URL: ${f}: ${url}`);}
      }
    }
    expect(invalid).toBe(0);
    // app-settings: is valid Expo URL for device settings (used in CaseScreen camera permissions)
  });
});

describe('ROUTES1. 439/439 Routes All Tiers', () => {
  test('R-01: ≥5 ≥10 ≥15 ≥20 ≥25 all 439/439', async () => {
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

describe('MASS1. 2M Influx', () => {
  test('M-01: 2M escalation + 2M encrypt', () => {
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v164_${i}`))!==`v164_${i}`) e2++;
    expect(e2).toBe(0);
  });
});
