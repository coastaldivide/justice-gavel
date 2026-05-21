// JUSTICE GAVEL — BRUTAL TRIALS v175
// DB SCHEMA INTEGRITY + IMPORT CHAINS + REFERRAL SYSTEM REMOVAL

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

describe('DB. Schema Integrity', () => {
  test('DB-01: db/index.js syntax clean', async () => {
    let threw = false;
    try { await import('../db/index.js'); } catch(e) { threw=true; throw e; }
    expect(threw).toBe(false);
  });
  test('DB-02: ai_jobs has status+output+completed_at', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS ai_jobs\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('status');
    expect(m[1]).toContain('output');
    expect(m[1]).toContain('completed_at');
  });
  test('DB-03: motion_history has case_id+content+status+jurisdiction', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS motion_history\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    for(const col of ['case_id','content','status','jurisdiction'])
      expect(m[1]).toContain(col);
  });
  test('DB-04: firms has owner_id+vertical+pricing_tier', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS firms\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    for(const col of ['owner_id','vertical','pricing_tier']) expect(m[1]).toContain(col);
  });
  test('DB-05: firm_invites has invited_by+expires_at', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS firm_invites\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('invited_by');
    expect(m[1]).toContain('expires_at');
  });
  test('DB-06: docket_entries has notes', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS docket_entries\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('notes');
  });
  test('DB-07: feedback has rating+comment', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const m  = db.match(/CREATE TABLE IF NOT EXISTS feedback\s*\(([^;]+)\)/s);
    expect(m).toBeTruthy();
    expect(m[1]).toContain('rating');
    expect(m[1]).toContain('comment');
  });
  test('DB-08: zero schema mismatches', async () => {
    const fs=await import('fs'); const path=await import('path');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables={};
    for(const m of db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([^;]+)\)/gs)){
      const cols=[...m[2].matchAll(/^\s+(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)/gm)].map(c=>c[1]);
      tables[m[1]]=new Set(cols);
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
          if(u.length) bad.push(path.relative('/tmp/JG/backend/src/routes',fp)+': INSERT '+t+': '+u);
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(bad.length) console.log('Mismatches:',bad);
    expect(bad.length).toBe(0);
  });
  test('DB-09: firm_members INSERTs use firm_role not role', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/firms.js','utf8');
    for(const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+firm_members\s*\(([^)]+)\)/gsi)){
      const cols=m[1].split(',').map(c=>c.trim());
      expect(cols).not.toContain('role');
    }
  });
});

describe('IMPORT. Route Import Integrity', () => {
  test('IMPORT-01: admin.js has getDb', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/admin.js','utf8');
    expect(src).toContain('getDb');
    expect(src).toContain('db/index.js');
  });
  test('IMPORT-02: connections.js has calcStripeFee', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(src).toContain('calcStripeFee');
    expect(src).toContain('payments/stripe');
  });
  test('IMPORT-03: perUserAiLimit in sharedAiLimiter', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/middleware/sharedAiLimiter.js','utf8')).toContain('perUserAiLimit');
  });
});

describe('REF. Referral System Eliminated', () => {
  test('REF-01: routes/referrals.js deleted', async () => {
    const fs=await import('fs');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
  });
  test('REF-02: /api/referrals not in app.js', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain('/api/referrals');
  });
  test('REF-03: referrals table gone from DB', async () => {
    const fs=await import('fs');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(db).not.toContain('CREATE TABLE IF NOT EXISTS referrals');
  });
  test('REF-04: no referral credit discount in QuickConnect', async () => {
    const fs=await import('fs');
    const conn=fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(conn).not.toContain('referral_credit');
    expect(conn).toContain('QUICKCONNECT_PRICE_CENTS');
  });
  test('REF-05: RewardsScreen.tsx deleted', async () => {
    const fs=await import('fs');
    expect(fs.existsSync('/tmp/JG/frontend/src/screens/RewardsScreen.tsx')).toBe(false);
  });
  test('REF-06: Rewards not in AppNavigator', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8')).not.toContain('Rewards');
  });
  test('REF-07: Rewards tile gone from HomeScreen', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8')).not.toContain('More:Rewards');
  });
  test('REF-08: no FE screen calls /referrals/ API', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const hits=fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))
      .filter(f=>fs.readFileSync(path.join(scr,f),'utf8').includes('/referrals/'));
    if(hits.length) console.log('Referral API hits:',hits);
    expect(hits.length).toBe(0);
  });
  test('REF-09: no dead navigate to Rewards', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      for(const m of fs.readFileSync(path.join(scr,f),'utf8').matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log('Dead:'+f+'->'+m[1]);}
    }
    expect(dead).toBe(0);
  });
});

describe('GATE. Zero-Defect Gates', () => {
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
  test('GATE-02: 0 SQL injection + all screens reachable', async () => {
    const fs=await import('fs'); const path=await import('path');
    let inj=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        inj+=[...fs.readFileSync(fp,'utf8').matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(inj).toBe(0);
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens'; const all=new Set();
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]/g)) all.add(m[1]);
      for(const m of s.matchAll(/screen:\s*['"]([^'"]+)['"]/g)) all.add(m[1]);
      for(const m of s.matchAll(/['"]More:(\w+)['"]/g)) all.add(m[1]);
    }
    const roots=new Set(['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab','MoreHome']);
    const gone=[...reg].filter(r=>!all.has(r)&&!roots.has(r));
    console.log('Unreachable: '+gone.length);
    expect(gone.length).toBe(0);
  });
  test('GATE-03: 437/437 routes all tiers', async () => {
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
          for(const t of [5,10,15,20,25]) if(h>=t) counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log('Routes >=25: '+counts[25]+'/'+total);
    for(const t of [5,10,15,20,25]) expect(counts[t]).toBe(total);
  });
  test('GATE-04: security + AI + auth', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8')).toContain('AbortController');
    expect(fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8')).toContain('REFRESH_THRESHOLD_MS');
  });
});

describe('MASS. 2M Influx', () => {
  test('MASS-01: 2M escalation + 2M encrypt', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for(let i=0;i<2000000;i++){
      const s=computeAllSignals(mkM(V[i%10],{evidence_score:i%101,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v175_'+i))!==('v175_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
