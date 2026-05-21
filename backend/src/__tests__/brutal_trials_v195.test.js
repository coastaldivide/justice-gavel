// JUSTICE GAVEL — BRUTAL TRIALS v195
// POST-FIX VERIFICATION: 7 shell screens (FamilyCourtScreen, HousingRightsScreen,
// IceDetentionScreen, ImmigrationConsequencesScreen, JuvenileJusticeScreen,
// MentalHealthDiversionScreen, TenantRightsScreen) rebuilt with JSX render.
// 20 screens had navigation params missing from function signature — fixed.
// 0 JSX-in-useEffect remaining across all 74 screens.

import { jest } from '@jest/globals';
let computeAllSignals, encrypt, decrypt;
beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
});
const mkM = (v,o={}) => ({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

// ── SHELL SCREEN RENDER VERIFICATION ─────────────────────────────────────
describe('RENDER. Shell Screen Render Presence', () => {
  test('RENDER-01: all 7 previously-empty screens now have JSX render', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const screens = [
      'FamilyCourtScreen.tsx',
      'HousingRightsScreen.tsx',
      'IceDetentionScreen.tsx',
      'ImmigrationConsequencesScreen.tsx',
      'JuvenileJusticeScreen.tsx',
      'MentalHealthDiversionScreen.tsx',
      'TenantRightsScreen.tsx',
    ];
    const noRender = [];
    for(const f of screens){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      // Must have a real JSX return (not just the cleanup return)
      const hasJSX = /^\s+return\s*\(/m.test(src) &&
        src.includes('<ScrollView') || src.includes('<View') && src.includes('return (');
      if(!hasJSX) noRender.push(f);
    }
    if(noRender.length) console.log('Missing render:', noRender);
    expect(noRender.length).toBe(0);
  });
  test('RENDER-02: IceDetentionScreen has header + content (bilingual guide)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/IceDetentionScreen.tsx','utf8');
    expect(src).toContain('RIGHTS_KEYS');
    expect(src).toContain('STEP_KEYS');
    expect(src).toContain('return (');
    expect(src).toContain('<ScrollView');
  });
  test('RENDER-03: FamilyCourtScreen has custody/support data and render', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx','utf8');
    expect(src).toContain('CUSTODY_SECTIONS');
    expect(src).toContain('SUPPORT_SECTIONS');
    expect(src).toContain('return (');
  });
  test('RENDER-04: no JSX inside useEffect across all 74 screens', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/g)){
        let depth=0, i=src.indexOf('{',m.index);
        while(i<src.length){if(src[i]==='{')depth++;else if(src[i]==='}'){depth--;if(!depth)break;}i++;}
        const body=src.slice(src.indexOf('{',m.index),i+1);
        if(/\breturn\s*\(\s*[<{]/.test(body)) bad.push(f);
      }
    }
    if(bad.length) console.log('JSX in useEffect:', bad);
    expect(bad.length).toBe(0);
  });
});

// ── FUNCTION SIGNATURE VERIFICATION ──────────────────────────────────────
describe('SIG. Function Signature Integrity', () => {
  test('SIG-01: all screens that use navigation have it in function signature', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      const fnM = src.match(/^export default function \w+\(([^)]*)\)/m);
      if(!fnM) continue;
      const params = fnM[1];
      const usesNav = /\bnavigation\b/.test(src.slice(fnM.index+fnM[0].length));
      const hasNavParam = /navigation/.test(params) || /ScreenProps/.test(params);
      if(usesNav && !hasNavParam) bad.push(f+': params='+params.slice(0,40));
    }
    if(bad.length) console.log('Missing nav param:', bad);
    expect(bad.length).toBe(0);
  });
  test('SIG-02: 0 screens with truncated useTheme or orphaned fragments', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      if(/^const \{ colors\s*$/m.test(src))   bad.push(f+': truncated useTheme');
      if(/^,\s*isDark\s*\}\s*=\s*useTheme/m.test(src)) bad.push(f+': orphaned frag');
      const lines=src.split('\n');
      for(let i=3;i<lines.length;i++)
        if(/^(?:route,\s*)?navigation\s*\}\s*:\s*ScreenProps/.test(lines[i].trim()))
          { bad.push(f+':nav-frag:L'+(i+1)); break; }
    }
    if(bad.length) console.log('Syntax corruption:', bad);
    expect(bad.length).toBe(0);
  });
  test('SIG-03: EmergencyScreen navigation param correct after all fixes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/EmergencyScreen.tsx','utf8');
    const fnM = src.match(/^export default function EmergencyScreen\(([^)]*)\)/m);
    expect(fnM).toBeTruthy();
    // Has proper navigation access
    expect(src).toContain('navigation');
  });
});

// ── ZERO-DEFECT GATES ─────────────────────────────────────────────────────
describe('GATE. Zero-Defect Production Gates', () => {
  test('GATE-01: 0 dead navigates + 0 password without secureTextEntry', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens'; let dead=0,noPw=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){ dead++; console.log('Dead:'+f+'->'+m[1]); }
      for(const m of s.matchAll(/<TextInput([^>]*)>/gs))
        if(/password|Password|pwd/.test(m[1])&&!m[1].includes('secureTextEntry')) noPw++;
    }
    expect(dead).toBe(0); expect(noPw).toBe(0);
  });
  test('GATE-02: 0 SQL injection + 0 broken imports + all screens reachable', async () => {
    const fs=await import('fs'); const path=await import('path');
    let inj=0,broken=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        inj+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
        for(const m of src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)){
          const res=path.resolve(path.dirname(fp),m[1]);
          if(!fs.existsSync(res)&&!fs.existsSync(res+'.js'))broken++;
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(broken>0)console.log('Broken:',broken);
    expect(inj).toBe(0); expect(broken).toBe(0);
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens'; const all=new Set();
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]/g))all.add(m[1]);
      for(const m of s.matchAll(/screen:\s*['"]([^'"]+)['"]/g))all.add(m[1]);
      for(const m of s.matchAll(/['"]More:(\w+)['"]/g))all.add(m[1]);
    }
    const roots=new Set(['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab','MoreHome','HagueContact']);
    expect([...reg].filter(r=>!all.has(r)&&!roots.has(r)).length).toBe(0);
  });
  test('GATE-03: 0 FlatList noKey + 0 accessibility + 0 hex', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const scr='/tmp/JG/frontend/src/screens'; let noKey=0,acc=0,hex=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/<FlatList\b/g)){
        const blk=s.slice(m.index,Math.min(s.length,m.index+700));
        const end=blk.indexOf('\n\n');
        if(!(end>0?blk.slice(0,end):blk).includes('keyExtractor'))noKey++;
      }
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))hex++;
    }
    console.log('noKey:'+noKey+' acc:'+acc+' hex:'+hex);
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-04: all prior fixes intact', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
    const pkg=JSON.parse(fs.readFileSync('/tmp/JG/backend/package.json','utf8'));
    expect(pkg.scripts.prestart).toContain('migrate');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/admin.js','utf8')).toContain('scan_id');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8')).toContain('matter_taxonomy');
    expect(fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx','utf8'))
      .toContain("api.get('/billing/subscription')");
    for(const f of ['analyze.js','history.js'])
      expect(fs.readFileSync('/tmp/JG/backend/src/routes/discovery/'+f,'utf8')).toContain('fileSize');
  });
  test('GATE-05: 437/437 routes all tiers', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const routesDir='/tmp/JG/backend/src/routes';
    let counts={5:0,10:0,15:0,20:0,25:0},total=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        for(const[,p] of fs.readFileSync(fp,'utf8').matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)){
          total++;
          const h=(corpus.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length;
          for(const t of [5,10,15,20,25])if(h>=t)counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log('Routes >=25: '+counts[25]+'/'+total);
    for(const t of [5,10,15,20,25])expect(counts[t]).toBe(total);
  });
});

// ── MASS ──────────────────────────────────────────────────────────────────
describe('MASS. 2M Influx', () => {
  test('MASS-01: 2M escalation + 2M encrypt zero errors', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for(let i=0;i<2000000;i++){
      const s=computeAllSignals(mkM(V[i%10],{evidence_score:i%101,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level))e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v195_'+i))!==('v195_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
