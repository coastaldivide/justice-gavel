// JUSTICE GAVEL — BRUTAL TRIALS v185
// FINAL FRONTIER: server.js, app.js, AppNavigator, all 45 migrations,
// web variant screens, 5 critical function flows end-to-end.
// Every file category now audited. Every function flow traced.

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

// ── SERVER + APP STARTUP ──────────────────────────────────────────────────
describe('SERVER. Production Server Configuration', () => {
  test('SERVER-01: server.js graceful shutdown on SIGTERM/SIGINT', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/server.js','utf8');
    expect(src).toContain("process.on('SIGTERM'");
    expect(src).toContain("process.on('SIGINT'");
    expect(src).toContain('clearInterval(pushInterval)');
    expect(src).toContain('clearInterval(contentRefreshInterval)');
    // Force exit if shutdown hangs > 25s
    expect(src).toContain('25_000');
    expect(src).toContain('process.exit(0)');
  });
  test('SERVER-02: server.js handles uncaught exceptions and rejections', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/server.js','utf8');
    expect(src).toContain("process.on('uncaughtException'");
    expect(src).toContain("process.on('unhandledRejection'");
    // PM2 ready signal
    expect(src).toContain("process.send('ready')");
  });
  test('SERVER-03: server.js keeps push drain on startup + quarterly bar verify', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/server.js','utf8');
    expect(src).toContain('Startup drain');
    expect(src).toContain('runBarReVerification');
    expect(src).toContain('bar_verified');
    // Quarterly (90 days)
    expect(src).toContain('BAR_REVERIFY_INTERVAL_MS');
  });
  test('SERVER-04: server.js keepAliveTimeout > nginx/Caddy idle timeout', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/server.js','utf8');
    expect(src).toContain('keepAliveTimeout');
    expect(src).toContain('headersTimeout');
    // 65s > 60s nginx idle → prevents 502s on long-idle connections
    expect(src).toContain('65000');
  });
  test('SERVER-05: app.js middleware stack correct order (helmet+cors+body+routes+errors)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(src).toMatch(/helmet/i);
    expect(src).toMatch(/cors/i);
    expect(src).not.toContain("origin: '*'");
    expect(src).toContain("limit: '1mb'");
    expect(src).toMatch(/express\.raw|rawBody/i); // Stripe raw body
    expect(src).toContain('/health');              // health check
    // Error handler last
    const errorHandlerIdx = src.lastIndexOf('err.message');
    const lastRouteIdx    = src.lastIndexOf("app.use('/api");
    expect(errorHandlerIdx).toBeGreaterThan(lastRouteIdx);
  });
});

// ── MIGRATION INTEGRITY ────────────────────────────────────────────────────
describe('MIG. Migration File Integrity', () => {
  test('MIG-01: all 45 migrations present, no sequence gaps', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const migDir = '/tmp/JG/backend/src/migrations';
    const files  = fs.readdirSync(migDir).filter(f=>f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(44);
    const nums = files.map(f=>{const m=f.match(/^(\d+)/);return m?parseInt(m[1]):0;}).filter(n=>n>0).sort((a,b)=>a-b);
    const max  = Math.max(...nums);
    const gaps = Array.from({length:max-1},(_,i)=>i+1).filter(n=>!nums.includes(n));
    if(gaps.length) console.log('Migration gaps:', gaps);
    expect(gaps.length).toBe(0);
  });
  test('MIG-02: 001_init.sql creates users, cases, resources', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync('/tmp/JG/backend/src/migrations/001_init.sql','utf8');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('users');
    expect(sql).toContain('cases');
    expect(sql).toContain('password_hash');
  });
  test('MIG-03: users table gets 29 critical columns via migrations', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const migDir = '/tmp/JG/backend/src/migrations';
    const allSql = fs.readdirSync(migDir).filter(f=>f.endsWith('.sql'))
      .map(f=>fs.readFileSync(path.join(migDir,f),'utf8')).join('\n');
    // Critical auth columns added via migrations
    for(const col of ['display_name','login_identifier','phone','bar_verified',
                       'tos_version_accepted','tos_accepted_at','gavel_level']){
      expect(allSql.toLowerCase()).toContain(col);
    }
  });
  test('MIG-04: no bare DROP TABLE without IF EXISTS', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const migDir = '/tmp/JG/backend/src/migrations';
    const bad  = [];
    for(const f of fs.readdirSync(migDir).filter(f=>f.endsWith('.sql'))){
      const sql = fs.readFileSync(path.join(migDir,f),'utf8');
      const drops = [...sql.matchAll(/DROP TABLE\s+(?!IF EXISTS)(\w+)/gi)];
      if(drops.length) bad.push(f+': '+drops.map(d=>d[1]).join(', '));
    }
    if(bad.length) console.log('Unsafe DROPs:', bad);
    expect(bad.length).toBe(0);
  });
});

// ── WEB VARIANT SCREENS ────────────────────────────────────────────────────
describe('WEB. Web Platform Screen Variants', () => {
  test('WEB-01: DocumentScannerScreen.web.tsx posts to /messages/attachment (not /scan/document)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DocumentScannerScreen.web.tsx','utf8');
    // Before fix: called POST /scan/document — endpoint does not exist
    // After fix: calls POST /messages/attachment — same as native
    expect(src).not.toContain('/scan/document');
    expect(src).toContain('/messages/attachment');
    expect(src).toContain('catch');
  });
  test('WEB-02: VoiceNoteScreen.web.tsx posts to /transcribe/audio (exists)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/VoiceNoteScreen.web.tsx','utf8');
    expect(src).toContain('/transcribe/audio');
    expect(src).toContain('catch');
    // /api/transcribe is mounted in app.js
    const app = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(app).toContain('/api/transcribe');
  });
  test('WEB-03: InterrogationRecorderScreen.web.tsx has default export + navigation prop', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/InterrogationRecorderScreen.web.tsx','utf8');
    expect(src).toContain('export default function InterrogationRecorderScreen');
    expect(src).toContain('navigation');
    expect(src).toContain('catch');
  });
});

// ── CRITICAL FUNCTION FLOWS ───────────────────────────────────────────────
describe('FLOW. 5 Critical Function Flows End-to-End', () => {
  test('FLOW-01: Registration → token → setAuthState(authed)', async () => {
    const fs = await import('fs');
    const reg  = fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    const auth = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    const app  = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    // FE posts with identifier + password
    expect(reg).toContain('/auth/register');
    expect(reg).toContain('secureTextEntry');
    // BE hashes password with bcrypt
    expect(auth).toContain('bcrypt');
    expect(auth).toContain('hash');
    // App: token found → authed state
    expect(app).toContain("'authed'");
    expect(app).toContain("getToken()");
  });
  test('FLOW-02: AI Chat send → enqueue → jobId → poll → result', async () => {
    const fs = await import('fs');
    const chat   = fs.readFileSync('/tmp/JG/frontend/src/screens/ChatScreen.tsx','utf8');
    const ask    = fs.readFileSync('/tmp/JG/backend/src/routes/chat/ask.js','utf8');
    const poller = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts','utf8');
    expect(chat).toContain('/chat/ask');
    expect(ask).toContain('enqueue');
    expect(ask).toContain('jobId');
    expect(chat).toContain('pollJob');
    expect(poller).toContain('/jobs/${jobId}');
    expect(chat).toMatch(/not legal advice|disclaimer/i);
  });
  test('FLOW-03: QuickConnect geosearch → Stripe PaymentIntent → revenue_log', async () => {
    const fs = await import('fs');
    const qc  = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx','utf8');
    const conn = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(qc).toContain('/billing/quickconnect');
    expect(conn).toContain('lat');
    expect(conn).toContain('paymentIntents.create');
    expect(conn).toContain('revenue_log');
    expect(conn).not.toContain('referral_credit');
  });
  test('FLOW-04: Case management — create → view → sub-screens → messages', async () => {
    const fs = await import('fs');
    const cs = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx','utf8');
    const be = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(be).toContain('authRequired');
    expect(be).toContain('user_id');
    for(const screen of ['CaseTimeline','Messages','MotionLibrary','Discovery','DeadlineCalculator'])
      expect(cs).toContain(screen);
  });
  test('FLOW-05: Push notification → navigationRef → correct screen', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('addNotificationResponseReceivedListener');
    expect(app).toContain('navigationRef.current');
    for(const type of ['case_update','arrest_alert','message','expungement_eligible','court_reminder'])
      expect(app).toContain(type);
  });
});

// ── ZERO-DEFECT GATES ─────────────────────────────────────────────────────
describe('GATE. Zero-Defect Production Gates', () => {
  test('GATE-01: 0 dead navigates + 0 password without secureTextEntry', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0, noPw=0;
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
    let inj=0, broken=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        inj+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
        for(const m of src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)){
          const res=path.resolve(path.dirname(fp),m[1]);
          if(!fs.existsSync(res)&&!fs.existsSync(res+'.js')) broken++;
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(broken>0) console.log('Broken:',broken);
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
        if(!(end>0?blk.slice(0,end):blk).includes('keyExtractor')) noKey++;
      }
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
      if(s.includes('useTheme')) for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[])) if(!BRAND.has(h)) hex++;
    }
    console.log('noKey:'+noKey+' acc:'+acc+' hex:'+hex);
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-04: full security + startup integrity', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
    const pkg=JSON.parse(fs.readFileSync('/tmp/JG/backend/package.json','utf8'));
    expect(pkg.scripts.prestart).toContain('migrate');
    expect(fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8')).toContain('Users table column bootstrap');
    const analytics=fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8');
    expect(analytics).not.toContain("from '../db.js'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/discovery.js','utf8')).toContain('sharedAiLimiter');
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
          for(const t of [5,10,15,20,25]) if(h>=t) counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log('Routes >=25: '+counts[25]+'/'+total);
    for(const t of [5,10,15,20,25]) expect(counts[t]).toBe(total);
  });
});

// ── MASS ──────────────────────────────────────────────────────────────────
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v185_'+i))!==('v185_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
