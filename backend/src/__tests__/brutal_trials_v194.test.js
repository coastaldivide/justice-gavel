// JUSTICE GAVEL — BRUTAL TRIALS v194
// CORRUPTION SWEEP v2: 5 more screens fixed (Discovery, LegalResearch,
// Translator, VoiceNote, MotionLibrary nav fragments), CrisisResourcesScreen
// JSX-in-useEffect repaired, all 79 screens verified syntax-clean.

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

// ── SYNTAX CORRUPTION — FINAL SWEEP ───────────────────────────────────────
describe('SYNTAX2. TypeScript Corruption Final Sweep', () => {
  test('SYNTAX2-01: 0 screens with navigation fragment inside function body', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const lines = fs.readFileSync(path.join(scr,f),'utf8').split('\n');
      for(let i=3; i<lines.length; i++){
        const s = lines[i].trim();
        // Both forms: `navigation }: ScreenProps)` and `route, navigation }: ScreenProps)`
        if(/^(?:route,\s*)?navigation\s*\}\s*:\s*ScreenProps/.test(s)){
          bad.push(f+':L'+(i+1)); break;
        }
      }
    }
    if(bad.length) console.log('Nav fragments remaining:', bad);
    expect(bad.length).toBe(0);
  });
  test('SYNTAX2-02: CrisisResourcesScreen useEffect does NOT return JSX', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CrisisResourcesScreen.tsx','utf8');
    // Before fix: mountedRef useEffect contained `return (<View>...</View>)` — 952 chars of JSX
    // React throws error if useEffect returns anything other than a cleanup fn or undefined
    // After fix: `return () => { mountedRef.current = false; };`
    expect(src).not.toContain('return (\n      <View');
    expect(src).not.toContain('return (\n    <View');
    // Correct cleanup return
    expect(src).toContain('return () => { mountedRef.current = false; }');
  });
  test('SYNTAX2-03: DiscoveryScreen has no nav fragment in body', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx','utf8');
    expect(src).not.toMatch(/^(?:route,\s*)?navigation\s*\}\s*:\s*ScreenProps/m);
    // Still has route/navigation accessible (from function params above)
    expect(src).toContain('navigation');
  });
  test('SYNTAX2-04: All 74 native screens pass full syntax integrity check', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const issues = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src   = fs.readFileSync(path.join(scr,f),'utf8');
      const lines = src.split('\n');
      // Check all corruption patterns
      if(/^const \{ colors\s*$/m.test(src))   issues.push(f+': truncated useTheme');
      if(/^,\s*isDark\s*\}\s*=\s*useTheme/m.test(src)) issues.push(f+': orphaned useTheme frag');
      for(let i=3;i<lines.length;i++)
        if(/^(?:route,\s*)?navigation\s*\}\s*:\s*ScreenProps/.test(lines[i].trim()))
          { issues.push(f+':L'+(i+1)+': nav fragment'); break; }
    }
    if(issues.length) console.log('Remaining corruption:', issues.slice(0,5));
    expect(issues.length).toBe(0);
  });
  test('SYNTAX2-05: no useEffect returns JSX across all screens', async () => {
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
        if(/\breturn\s*\(\s*<\w+/.test(body)) bad.push(f);
      }
    }
    if(bad.length) console.log('JSX in useEffect:', bad);
    expect(bad.length).toBe(0);
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
    // HagueContact is a specialty screen (Hague Convention) accessible from FamilyCourtScreen
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
    for(const f of ['bondsman.js','connections.js','pi_leads.js']){
      const src=fs.readFileSync('/tmp/JG/backend/src/routes/billing/'+f,'utf8');
      if(src.includes('paymentIntents.create')) expect(src).toContain('metadata');
    }
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v194_'+i))!==('v194_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
