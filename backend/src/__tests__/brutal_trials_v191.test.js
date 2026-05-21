// JUSTICE GAVEL — BRUTAL TRIALS v191
// DB SCHEMA INTEGRITY: Cross-referencing SELECT queries against actual
// column definitions. Confirmed fixes: admin.js scan_results query,
// analytics.js matter_taxonomy column name.
// All 33 HomeScreen tiles traced. Zero render path issues.

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

// ── DB SCHEMA INTEGRITY ───────────────────────────────────────────────────
describe('SCHEMA. DB Column Query Integrity', () => {
  test('SCHEMA-01: admin.js scan_results query uses real column names', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js','utf8');
    // Before fix: SELECT id, scan_type, status, summary, critical_count FROM scan_results
    // scan_type, status, summary, critical_count do NOT exist in scan_results table
    // Real columns: id, scan_id, overall, summary_json, findings_json, created_at
    expect(src).not.toMatch(/SELECT[^;`'"]+scan_type[^;`'"]+FROM[^;`'"]+scan_results/i);
    expect(src).not.toMatch(/SELECT[^;`'"]+critical_count[^;`'"]+FROM[^;`'"]+scan_results/i);
    // After fix: queries use real columns
    expect(src).toContain('scan_id');
    expect(src).toContain('summary_json');
  });
  test('SCHEMA-02: analytics.js queries matters.matter_taxonomy not matters.taxonomy', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8');
    // Before fix: SELECT m.taxonomy FROM matters — column is named matter_taxonomy
    // Silent NULL return caused wrong analytics data
    // After fix: SELECT m.matter_taxonomy
    const rawTaxonomy = /\bm\.taxonomy\b(?!\s+AS|_)/.test(src);
    expect(rawTaxonomy).toBe(false);
    expect(src).toContain('matter_taxonomy');
  });
  test('SCHEMA-03: scan_results table has correct columns in db/index.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    // Verify the actual schema matches what routes query
    expect(src).toContain('scan_results');
    expect(src).toContain('scan_id');
    expect(src).toContain('summary_json');
    expect(src).toContain('findings_json');
    expect(src).toContain('overall');
  });
  test('SCHEMA-04: matters table has vertical + evidence_score columns via migrations', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const migDir = '/tmp/JG/backend/src/migrations';
    const allSql = fs.readdirSync(migDir).filter(f=>f.endsWith('.sql'))
      .map(f=>fs.readFileSync(path.join(migDir,f),'utf8')).join('\n');
    // These columns are added via migrations (not in 001_init.sql base)
    expect(allSql).toMatch(/vertical.*matters|matters.*vertical/i);
    expect(allSql).toContain('evidence_score');
    expect(allSql).toContain('vulnerability_level');
    expect(allSql).toContain('time_pressure');
    expect(allSql).toContain('matter_taxonomy');
  });
  test('SCHEMA-05: all db.all/get queries use parameterized values (no SQL concat)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    let bad = 0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        bad+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\+\s*\w+/g)].length;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(bad).toBe(0);
  });
});

// ── UX RENDER CORRECTNESS ─────────────────────────────────────────────────
describe('UX. Render Path Correctness', () => {
  test('UX-01: 0 interactive elements without onPress', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      const noPressElems=[...src.matchAll(/<(?:TouchableOpacity|Pressable)\s+(?![^>]*onPress)[^>]*\/>/gs)]
        .filter(m=>!m[0].includes('disabled'));
      if(noPressElems.length) bad.push(f+': '+noPressElems.length);
    }
    if(bad.length) console.log('No-onPress:', bad.slice(0,3));
    expect(bad.length).toBe(0);
  });
  test('UX-02: 0 conditional renders using .length && (renders "0" bug)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      const matches=[...src.matchAll(/\{(\w+)\.length\s*&&\s*</g)].map(m=>m[1]);
      if(matches.length) bad.push(f+': '+matches.join(', '));
    }
    if(bad.length) console.log('length&& renders "0":', bad.slice(0,3));
    expect(bad.length).toBe(0);
  });
  test('UX-03: HomeScreen has all 33 tiles defined', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    const tiles = [...src.matchAll(/label:\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    expect(tiles.length).toBe(33);
    // Critical tiles that drive revenue and UX
    const critical = ['Just Arrested', 'Emergency', 'Find a', 'Ask a', 'My', 'Clear My'];
    for(const t of critical){
      expect(tiles.some(tile => tile.includes(t.split('\\')[0]))).toBe(true);
    }
  });
  test('UX-04: every screen that loads data shows loading indicator', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      if(!src.includes('api.')) continue;
      const hasLoading    = src.includes('setLoading') || src.includes('isLoading') || src.includes('loading');
      const hasIndicator  = src.includes('ActivityIndicator') || src.includes('spinner') ||
                            src.includes('Spinner') || src.includes('loading');
      if(hasLoading && !hasIndicator) bad.push(f);
    }
    if(bad.length) console.log('No loading indicator:', bad.slice(0,3));
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
    const roots=new Set(['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab','MoreHome']);
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
  test('GATE-04: security + startup + payment metadata + file upload safety', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
    const pkg=JSON.parse(fs.readFileSync('/tmp/JG/backend/package.json','utf8'));
    expect(pkg.scripts.prestart).toContain('migrate');
    for(const f of ['analyze.js','history.js'])
      expect(fs.readFileSync('/tmp/JG/backend/src/routes/discovery/'+f,'utf8')).toContain('fileSize');
    for(const f of ['bondsman.js','connections.js','pi_leads.js']){
      const src=fs.readFileSync('/tmp/JG/backend/src/routes/billing/'+f,'utf8');
      if(src.includes('paymentIntents.create'))expect(src).toContain('metadata');
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v191_'+i))!==('v191_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
