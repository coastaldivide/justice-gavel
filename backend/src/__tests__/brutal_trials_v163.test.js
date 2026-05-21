// JUSTICE GAVEL — BRUTAL TRIALS v163
// NAVIGATION DEAD-END SCAN — ALL ISSUES FIXED
// Issue 1: HelpNow wrong navigate names → fixed (BailCalculator, CourtLocator)
// Issue 2: HagueContactScreen unreachable → added to MoreStack + linked from 2 screens
// Issue 3: TermsAcceptanceModal wired into RegisterScreen
// Issue 4: 5 orphaned components all wired (ScreenHeader, LawyerSkeletonCard,
//           MotionTypeBadge, CaseStatusBadge, LegalNotice)
// Issue 5: Stack screens use auto-back from RN Navigator — confirmed not a bug

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

describe('NAV. Navigation — Zero Dead Ends', () => {
  test('NAV-01: HelpNow uses correct route names (BailCalculator not BailCalculatorScreen)', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(src).not.toContain("navigate('BailCalculatorScreen')");
    expect(src).not.toContain("navigate('CourtLocatorScreen')");
    expect(src).toContain("navigate('BailCalculator')");
    expect(src).toContain("navigate('CourtLocator')");
    // Before: users tapped "Bail Calculator" and got no screen transition
    // After: tapping navigates correctly to the BailCalculator route
  });

  test('NAV-02: HagueContactScreen registered in AppNavigator', async () => {
    const fs=await import('fs');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const names=[...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]);
    expect(names).toContain('HagueContact');
    expect(nav).toContain('HagueContactScreen');
    // Was a 21,803-char fully-built screen with NO way to reach it
    // Now registered as 'HagueContact' in MoreStack
  });

  test('NAV-03: HagueContact linked from ImmigrationConsequencesScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx','utf8');
    expect(src).toContain("navigate('HagueContact')");
  });

  test('NAV-04: HagueContact linked from FamilyCourtScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx','utf8');
    expect(src).toContain("navigate('HagueContact')");
    // Family law attorneys now reach Hague Convention resources from FamilyCourt screen
  });

  test('NAV-05: TermsAcceptanceModal wired into RegisterScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(src).toContain('TermsAcceptanceModal');
    expect(src).toContain('showTerms');
    // Modal was built (12,227 chars) but never shown — now shown during registration
  });

  test('NAV-06: 0 dead navigate() calls across all 75 screens', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const registered=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g)){
        if(!registered.has(m[1])) { dead++; console.log(`Dead: ${f} → '${m[1]}'`); }
      }
    }
    expect(dead).toBe(0);
  });

  test('NAV-07: 76 screens registered (75 files + HagueContact = 76)', async () => {
    const fs=await import('fs');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const names=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    console.log(`Registered screens: ${names.size}`);
    expect(names.size).toBe(76);
    // 75 screen files + TermsAcceptanceModal is a modal (not a screen, correct to not register)
    // HagueContact was file #76 added to navigator
  });
});

describe('COMP. All Components Wired', () => {
  test('COMP-01: ScreenHeader imported in 6+ screens', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let count=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      if(fs.readFileSync(path.join(scr,f),'utf8').includes('ScreenHeader')) count++;
    }
    expect(count).toBeGreaterThanOrEqual(6);
    // ScreenHeader: reusable header component now used across leaf screens
  });
  test('COMP-02: LawyerSkeletonCard in LawyersScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LawyersScreen.tsx','utf8');
    expect(src).toContain('LawyerSkeletonCard');
    // Shows animated shimmer while attorney list loads — better UX than spinner
  });
  test('COMP-03: MotionTypeBadge in MotionLibraryScreen', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/MotionLibraryScreen.tsx','utf8');
    expect(src).toContain('MotionTypeBadge');
    // Colored chip labels on motion types (Suppression, MTD, Habeas etc.)
  });
  test('COMP-04: CaseStatusBadge in CaseScreen + CaseTimelineScreen', async () => {
    const fs=await import('fs');
    const cs=fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx','utf8');
    const ct=fs.readFileSync('/tmp/JG/frontend/src/screens/CaseTimelineScreen.tsx','utf8');
    expect(cs).toContain('CaseStatusBadge');
    expect(ct).toContain('CaseStatusBadge');
  });
  test('COMP-05: LegalNotice in DUILaws + DrugPenalties + Expungement', async () => {
    const fs=await import('fs');
    const dui=fs.readFileSync('/tmp/JG/frontend/src/screens/DUILawsScreen.tsx','utf8');
    const drug=fs.readFileSync('/tmp/JG/frontend/src/screens/DrugPenaltiesScreen.tsx','utf8');
    const exp=fs.readFileSync('/tmp/JG/frontend/src/screens/ExpungementScreen.tsx','utf8');
    expect(dui).toContain('LegalNotice');
    expect(drug).toContain('LegalNotice');
    expect(exp).toContain('LegalNotice');
    // LegalNotice: "This is general information, not legal advice" — UPL protection
  });
  test('COMP-06: 0 unused components after fixes', async () => {
    const fs=await import('fs'); const path=await import('path');
    const compDir='/tmp/JG/frontend/src/components';
    const scrDir='/tmp/JG/frontend/src/screens';
    const navSrc=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    let allSrc=navSrc;
    for(const f of fs.readdirSync(scrDir).filter(f=>f.endsWith('.tsx')))
      allSrc+=fs.readFileSync(path.join(scrDir,f),'utf8');
    const unused=fs.readdirSync(compDir).filter(f=>f.endsWith('.tsx'))
      .map(f=>f.replace('.tsx',''))
      .filter(c=>!allSrc.includes(c));
    console.log(`Unused components: ${unused.length}`);
    expect(unused.length).toBe(0);
  });
});

describe('UX. UI/UX Quality Gates', () => {
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
  test('UX-04: 0 unsafe data access', async () => {
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
});

describe('MASS. 2M Influx', () => {
  test('M-01: 2M escalation + 2M encrypt zero errors', () => {
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v163_${i}`))!==`v163_${i}`) e2++;
    expect(e2).toBe(0);
  });
});
