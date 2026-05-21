// JUSTICE GAVEL — BRUTAL TRIALS v176
// useEffect correctness, rate limiter coverage, full behavioral gates.
// Every function flow end to end.

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

// ── USEEFFECT CORRECTNESS ─────────────────────────────────────────────────
describe('EFFECT. useEffect Has Deps — No Infinite Loops', () => {
  test('EFFECT-01: all API-calling useEffects have deps arrays (full body scan)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const scr = '/tmp/JG/frontend/src/screens';
    const bad = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      // Scan every useEffect
      for(const m of src.matchAll(/useEffect\s*\(\s*\(\s*\)\s*=>/g)){
        // Trace full effect body (handle nested braces)
        const rest = src.slice(m.index + m[0].length);
        const brace = rest.indexOf('{');
        if(brace < 0 || brace > 20) continue;
        let depth=0, j=brace;
        while(j<rest.length){
          if(rest[j]==='{') depth++;
          else if(rest[j]==='}'){depth--; if(depth===0) break;}
          j++;
        }
        const body  = rest.slice(brace,j+1);
        const after = rest.slice(j+1,j+30);
        const hasApi = /api\.(get|post|put)|AsyncStorage/.test(body);
        const hasDeps = /\[/.test(after.slice(0,20));
        if(hasApi && !hasDeps) bad.push(f+': api useEffect no deps');
      }
    }
    if(bad.length) console.log('No-deps effects:', bad);
    expect(bad.length).toBe(0);
  });
  test('EFFECT-02: no setInterval without clearInterval', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const scr = '/tmp/JG/frontend/src/screens';
    const bad = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      if((src.match(/setInterval\s*\(/g)||[]).length > 0 && !src.includes('clearInterval'))
        bad.push(f);
    }
    expect(bad.length).toBe(0);
  });
  test('EFFECT-03: screens with 5+ API calls use safe async pattern', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const scr = '/tmp/JG/frontend/src/screens';
    let n = 0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      const apiCount = (src.match(/api\.(get|post|put)/g)||[]).length;
      const hasSafe = src.includes('mountedRef') || src.includes('isMounted') ||
        src.includes('finally') || src.includes('.catch(');
      if(apiCount >= 5 && !hasSafe){ n++; console.log('Missing safe pattern: '+f); }
    }
    expect(n).toBe(0);
  });
});

// ── RATE LIMITER COVERAGE ─────────────────────────────────────────────────
describe('RATE. Every Write Route Has Rate Limiting', () => {
  test('RATE-01: all high-risk routes have limiters', async () => {
    const fs = await import('fs');
    const checks = [
      ['routes/auth.js',                  'login/register'],
      ['routes/chat/ask.js',              'AI chat'],
      ['routes/billing/subscriptions.js', 'billing'],
      ['routes/billing/connections.js',   'payments'],
      ['routes/motions/generate.js',      'motions'],
      ['routes/alerts.js',                'emergency alerts'],
      ['routes/messages.js',             'messages'],
    ];
    for(const [rel, desc] of checks){
      const src = fs.readFileSync('/tmp/JG/backend/src/'+rel,'utf8');
      const hasLimit = src.includes('Limiter') || src.includes('rateLimit');
      if(!hasLimit) console.log('Missing limiter: '+rel);
      expect(hasLimit).toBe(true);
    }
  });
  test('RATE-02: secondary routes now have makeUserLimiter', async () => {
    const fs = await import('fs');
    const routes = [
      'routes/forum.js',
      'routes/firm_acquisition.js',
      'routes/firm_verticals.js',
      'routes/hague_contacts.js',
      'routes/attorney/profile.js',
    ];
    for(const rel of routes){
      const src = fs.readFileSync('/tmp/JG/backend/src/'+rel,'utf8');
      expect(src).toContain('makeUserLimiter');
    }
  });
});

// ── REFERRAL SYSTEM GONE ──────────────────────────────────────────────────
describe('REF. Referral System Completely Removed', () => {
  test('REF-01: routes/referrals.js deleted', async () => {
    const fs = await import('fs');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
  });
  test('REF-02: no /referrals/ calls in any FE screen', async () => {
    const fs = await import('fs'); const path = await import('path');
    const scr = '/tmp/JG/frontend/src/screens';
    const hits = fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))
      .filter(f=>fs.readFileSync(path.join(scr,f),'utf8').includes('/referrals/'));
    expect(hits.length).toBe(0);
  });
  test('REF-03: QuickConnect charges full price (no discount path)', async () => {
    const fs = await import('fs');
    const conn = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(conn).not.toContain('referral_credit');
    expect(conn).toContain('QUICKCONNECT_PRICE_CENTS');
  });
  test('REF-04: RewardsScreen.tsx deleted + no dead navigate to Rewards', async () => {
    const fs = await import('fs'); const path = await import('path');
    expect(fs.existsSync('/tmp/JG/frontend/src/screens/RewardsScreen.tsx')).toBe(false);
    const nav = fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    expect(nav).not.toContain('Rewards');
    const reg = new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr = '/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')))
      for(const m of fs.readFileSync(path.join(scr,f),'utf8').matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log('Dead:'+f+'->'+m[1]);}
    expect(dead).toBe(0);
  });
});

// ── SCHEMA + IMPORTS ──────────────────────────────────────────────────────
describe('SCHEMA. DB Tables Verified', () => {
  test('SCHEMA-01: db/index.js parses without syntax errors', async () => {
    let ok = true;
    try { await import('../db/index.js'); } catch(e) { ok=false; throw e; }
    expect(ok).toBe(true);
  });
  test('SCHEMA-02: zero INSERT column mismatches', async () => {
    const fs = await import('fs'); const path = await import('path');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables = {};
    for(const m of db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([^;]+)\)/gs)){
      const cols=[...m[2].matchAll(/^\s+(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)/gm)].map(c=>c[1]);
      tables[m[1]] = new Set(cols);
    }
    const bad=[];
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        for(const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)/gsi)){
          const t=m[1]; if(!tables[t])continue;
          const u=m[2].split(',').map(c=>c.trim()).filter(c=>c&&!c.startsWith('?')&&!tables[t].has(c)&&!/^\d/.test(c));
          if(u.length) bad.push(path.relative('/tmp/JG/backend/src/routes',fp)+': '+t+': '+u);
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(bad.length) console.log('Mismatches:', bad);
    expect(bad.length).toBe(0);
  });
  test('SCHEMA-03: admin.js and connections.js have correct imports', async () => {
    const fs = await import('fs');
    const admin = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js','utf8');
    const conn  = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(admin).toContain('getDb');
    expect(conn).toContain('calcStripeFee');
  });
});

// ── ZERO-DEFECT GATES ─────────────────────────────────────────────────────
describe('GATE. Zero-Defect Production Gates', () => {
  test('GATE-01: 0 dead navigates + 0 password without secureTextEntry', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0,noPw=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log('Dead:'+f+'->'+m[1]);}
      for(const m of s.matchAll(/<TextInput([^>]*)>/gs))
        if(/password|Password|pwd/.test(m[1])&&!m[1].includes('secureTextEntry')) noPw++;
    }
    expect(dead).toBe(0); expect(noPw).toBe(0);
  });
  test('GATE-02: 0 SQL injection + 0 bare SELECT * + all screens reachable', async () => {
    const fs=await import('fs'); const path=await import('path');
    let inj=0,bare=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        inj+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
        for(const m of src.matchAll(/SELECT \*[^\n]*/g))
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable')) bare++;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(inj).toBe(0); expect(bare).toBe(0);
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
    const gone=[...reg].filter(r=>!all.has(r)&&!roots.has(r));
    console.log('Unreachable: '+gone.length);
    expect(gone.length).toBe(0);
  });
  test('GATE-03: 0 FlatList no keyExtractor + 0 accessibility + 0 hex', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const scr='/tmp/JG/frontend/src/screens';
    let noKey=0,acc=0,hex=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/<FlatList\b/g)){
        const blk=s.slice(m.index,Math.min(s.length,m.index+700));
        const end=blk.indexOf('\n\n');
        if(!(end>0?blk.slice(0,end):blk).includes('keyExtractor'))noKey++;
      }
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h)){hex++;console.log('hex:'+h+' in '+f);}
    }
    console.log('noKey:'+noKey+' acc:'+acc+' hex:'+hex);
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-04: security + AI + token + providers', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8')).toContain('AbortController');
    expect(fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8')).toContain('REFRESH_THRESHOLD_MS');
    const prov=fs.readFileSync('/tmp/JG/backend/src/routes/providers.js','utf8');
    expect(prov).toContain('avg_response_hrs');
    expect(prov).not.toContain('gavel_levelerience');
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

describe('MASS. 2M Influx', () => {
  test('MASS-01: 2M escalation + 2M encrypt zero errors', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for(let i=0;i<2000000;i++){
      const s=computeAllSignals(mkM(V[i%10],{evidence_score:i%101,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v176_'+i))!==('v176_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
