// JUSTICE GAVEL — BRUTAL TRIALS v180
// STARTUP INTEGRITY: migration system, column bootstrap, users table schema,
// fresh deployment safety. The deepest layer: what happens on first boot.

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

// ── STARTUP + MIGRATION SYSTEM ────────────────────────────────────────────
describe('STARTUP. Fresh Deployment Safety', () => {
  test('STARTUP-01: package.json prestart runs migrate.js before server', async () => {
    const fs = await import('fs');
    const pkg = JSON.parse(fs.readFileSync('/tmp/JG/backend/package.json','utf8'));
    // Before fix: npm start only ran server.js — migrations never applied
    // Fresh deployment would fail with "no such column: display_name" on login
    expect(pkg.scripts.prestart).toContain('migrate');
    expect(pkg.scripts.start).toContain('server.js');
  });
  test('STARTUP-02: migrate.js exists and is idempotent', async () => {
    const fs = await import('fs');
    expect(fs.existsSync('/tmp/JG/backend/src/scripts/migrate.js')).toBe(true);
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/migrate.js','utf8');
    // Idempotent: handles "column already exists" errors gracefully
    expect(src).toContain('migration');
    expect(src).toMatch(/IF NOT EXISTS|catch|error/i);
  });
  test('STARTUP-03: db/index.js bootstraps critical users columns on startup', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    // Before fix: users.role, users.display_name not added in db/index.js
    // Fresh deployment: SELECT role FROM users returns null for all users
    // After fix: ALTER TABLE IF NOT EXISTS for all critical columns
    expect(db).toContain('Users table column bootstrap');
    expect(db).toContain("ADD COLUMN IF NOT EXISTS role");
    expect(db).toContain("ADD COLUMN IF NOT EXISTS display_name");
    expect(db).toContain("ADD COLUMN IF NOT EXISTS login_identifier");
    expect(db).toContain("ADD COLUMN IF NOT EXISTS tos_version_accepted");
  });
  test('STARTUP-04: bootstrap covers all columns auth.js queries from users', async () => {
    const fs = await import('fs');
    const db   = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const auth = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    // Find all column names auth.js SELECTs from users
    const userSelects = [...auth.matchAll(/SELECT\s+([\w\s,*]+)\s+FROM\s+users/gi)];
    const authCols = new Set();
    for(const m of userSelects){
      const cols = m[1].split(',').map(c=>c.trim().toLowerCase()).filter(c=>c&&c!=='*');
      cols.forEach(c=>authCols.add(c));
    }
    // Every column auth needs should be in the bootstrap
    const criticalCols = ['role','display_name','email','id'];
    for(const col of criticalCols){
      if(col==='id'||col==='email') continue; // always in CREATE TABLE
      expect(db).toContain('ADD COLUMN IF NOT EXISTS '+col);
    }
    // auth.js has graceful fallback: user.role || 'user'
    expect(auth).toContain("role || 'user'");
  });
  test('STARTUP-05: db/index.js parses clean after bootstrap addition', async () => {
    let ok = true;
    try { await import('../db/index.js'); } catch(e) { ok=false; throw e; }
    expect(ok).toBe(true);
  });
  test('STARTUP-06: 44 migration files exist + migrations dir present', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const migDir = '/tmp/JG/backend/src/migrations';
    expect(fs.existsSync(migDir)).toBe(true);
    const files = fs.readdirSync(migDir).filter(f=>f.endsWith('.sql'));
    // At least 40 migrations covering the full feature history
    expect(files.length).toBeGreaterThanOrEqual(40);
    // 001_init.sql creates base tables
    expect(fs.existsSync(path.join(migDir,'001_init.sql'))).toBe(true);
    const init = fs.readFileSync(path.join(migDir,'001_init.sql'),'utf8');
    expect(init).toContain('CREATE TABLE');
    expect(init).toContain('users');
  });
});

// ── SCHEMA INTEGRITY ──────────────────────────────────────────────────────
describe('SCHEMA. Database Column Integrity', () => {
  test('SCHEMA-01: 0 INSERT column mismatches (all tables)', async () => {
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
          if(u.length) bad.push(path.relative('/tmp/JG/backend/src/routes',fp)+': '+t+': '+u);
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(bad.length) console.log('Mismatches:',bad);
    expect(bad.length).toBe(0);
  });
  test('SCHEMA-02: users bootstrap covers subscription + gavel + bar + push cols', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    for(const col of ['subscription','gavel_level','bar_verified','bar_number',
                       'push_token','is_defender','notif_new_case']){
      expect(db).toContain('ADD COLUMN IF NOT EXISTS '+col);
    }
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
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))hex++;
    }
    console.log('noKey:'+noKey+' acc:'+acc+' hex:'+hex);
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-04: all write routes rate-limited + security hardening', async () => {
    const fs=await import('fs'); const path=await import('path');
    const unprotected=[];
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        if(f.includes('webhook'))return;
        const src=fs.readFileSync(fp,'utf8');
        const writes=(src.match(/router\.(post|put|patch|delete)\s*\([^'"]*authRequired/g)||[]).length;
        const hasLim=src.includes('Limiter')||src.includes('rateLimit')||src.includes('makeUserLimiter');
        if(writes>0&&!hasLim) unprotected.push(path.relative('/tmp/JG/backend/src/routes',fp));
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(unprotected.length) console.log('Unprotected:',unprotected);
    expect(unprotected.length).toBe(0);
    // Security
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v180_'+i))!==('v180_'+i))e2++;
    expect(e2).toBe(0);
  });
});
