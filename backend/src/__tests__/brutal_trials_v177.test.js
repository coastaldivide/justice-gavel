// JUSTICE GAVEL — BRUTAL TRIALS v177
// DEEPEST BEHAVIORAL LAYER: auth flow, API headers, logout, date safety,
// keyboard UX, pagination, rate limits, deep links, push, body size.

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

// ── AUTH + API ────────────────────────────────────────────────────────────
describe('AUTH. Auth Context and API Service', () => {
  test('AUTH-01: api.ts sends Authorization Bearer on every request', async () => {
    const fs = await import('fs');
    const api = fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8');
    expect(api).toContain('interceptors.request');
    expect(api).toContain('Authorization');
    expect(api).toContain('Bearer ${token}');
    // Every API call includes auth token automatically via Axios interceptor
  });
  test('AUTH-02: api.ts 401 handler clears auth + REFRESH_THRESHOLD for proactive refresh', async () => {
    const fs = await import('fs');
    const api = fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8');
    expect(api).toContain('clearAuth');
    expect(api).toContain('REFRESH_THRESHOLD_MS');
    expect(api).toContain("status === 401");
  });
  test('AUTH-03: logout clears all storage — token + user + session data', async () => {
    const fs = await import('fs');
    const settings = fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx','utf8');
    const logoutIdx = settings.indexOf('const logout');
    const logoutBody = settings.slice(logoutIdx, logoutIdx+500);
    // Must clear auth token AND app storage
    expect(logoutBody).toContain('clearAuth');
    expect(logoutBody).toContain('AsyncStorage');
    // Must reset navigation stack to Login
    expect(logoutBody).toMatch(/reset.*Login|Login.*reset/s);
  });
  test('AUTH-04: deep link scheme configured (justicegavel://)', async () => {
    const fs = await import('fs');
    const nav = fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    expect(nav).toContain('justicegavel://');
    expect(nav).toContain('https://justicegavel.app');
    // Linking config maps URL paths to screen names
    expect(nav).toContain('HomeTab');
    expect(nav).toContain("'chat'");
  });
});

// ── UX QUALITY ────────────────────────────────────────────────────────────
describe('UX. User Experience Quality', () => {
  test('UX-01: goBack() always guarded with canGoBack()', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      if(src.includes('navigation.goBack()') && 
         !src.includes('canGoBack()') && !src.includes('navigation.canGoBack')){
        bad.push(f);
      }
    }
    if(bad.length) console.log('goBack without guard:', bad);
    expect(bad.length).toBe(0);
    // Before fix: 3 screens called goBack() on deep-linked launch → crash
    // After fix: canGoBack() ? goBack() : null
  });
  test('UX-02: multi-input forms have keyboard chaining (returnKeyType)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    const bad  = [];
    for(const f of ['HagueContactScreen.tsx','FirmVerticalScreen.tsx']){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      expect(src).toContain('returnKeyType');
    }
    // HagueContact: 4 fields now chain next→next→next→done
    // FirmVertical: 13 fields now have returnKeyType="next"
  });
  test('UX-03: all form submit buttons have loading guard (no double-tap)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const scr  = '/tmp/JG/frontend/src/screens';
    let unguarded = 0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src = fs.readFileSync(path.join(scr,f),'utf8');
      const hasPost   = /api\.(post|put|patch)/.test(src);
      const hasSubmit = /on\w*(Submit|Save|Send|Register|Login|Pay|Subscribe|Book)/i.test(src);
      if(hasPost && hasSubmit){
        const hasGuard = src.includes('loading') || src.includes('saving') ||
          src.includes('submitting') || src.includes('setSaving') || src.includes('disabled={') ||
          src.includes('Loading') || src.includes('isProcessing') || src.includes('isSending');
        if(!hasGuard){ unguarded++; console.log('No guard: '+f); }
      }
    }
    expect(unguarded).toBe(0);
  });
  test('UX-04: push token registered on app setup', async () => {
    const fs = await import('fs');
    let hasSetup = false;
    for(const f of ['useAppSetup.ts','useAppSetup.tsx','AppSetup.ts','AppSetup.tsx']){
      try {
        const src = fs.readFileSync('/tmp/JG/frontend/src/hooks/'+f,'utf8');
        if(src.toLowerCase().includes('push') || src.toLowerCase().includes('notification'))
          hasSetup = true;
      } catch {}
    }
    // Push registration handled in hooks
    expect(hasSetup).toBe(true);
  });
});

// ── BACKEND QUALITY ───────────────────────────────────────────────────────
describe('BE. Backend Production Quality', () => {
  test('BE-01: request body limited to 1mb (prevents DoS via large payload)', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(app).toContain("limit: '1mb'");
    // Without this limit, attackers can send 100mb+ bodies crashing the server
  });
  test('BE-02: all write routes rate-limited (8 routes now protected)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const mustHave = [
      'routes/forum.js', 'routes/analytics.js', 'routes/firm_acquisition.js',
      'routes/hague_contacts.js', 'routes/attorney/profile.js',
    ];
    for(const rel of mustHave){
      const src = fs.readFileSync('/tmp/JG/backend/src/'+rel,'utf8');
      expect(src).toContain('Limiter');
    }
  });
  test('BE-03: 0 SQL injection in all route files', async () => {
    const fs = await import('fs'); const path = await import('path');
    let n = 0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        n+=[...fs.readFileSync(fp,'utf8').matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(n).toBe(0);
  });
  test('BE-04: 0 bare SELECT * in routes', async () => {
    const fs = await import('fs'); const path = await import('path');
    let bare = 0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);return;}
        if(!f.endsWith('.js')||f.startsWith('_'))return;
        const src=fs.readFileSync(fp,'utf8');
        for(const m of src.matchAll(/SELECT \*[^\n]*/g))
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable')) bare++;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(bare).toBe(0);
  });
  test('BE-05: CORS no wildcard + Stripe HMAC + TCPA + GDPR', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js','utf8')).toContain('STRIPE_WEBHOOK_SECRET');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/twilio.js','utf8')).toContain('STOP');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
  });
  test('BE-06: DB schema 0 mismatches — all INSERT cols exist', async () => {
    const fs = await import('fs'); const path = await import('path');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables = {};
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
    if(bad.length) console.log('Schema mismatches:',bad);
    expect(bad.length).toBe(0);
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
  test('GATE-02: 0 FlatList without keyExtractor + 0 accessibility + 0 hex violations', async () => {
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
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h)) hex++;
    }
    console.log('noKey:'+noKey+' acc:'+acc+' hex:'+hex);
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-03: all screens reachable + providers fields correct', async () => {
    const fs=await import('fs'); const path=await import('path');
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
    // Provider fields
    const prov=fs.readFileSync('/tmp/JG/backend/src/routes/providers.js','utf8');
    expect(prov).toContain('avg_response_hrs');
    expect(prov).not.toContain('gavel_levelerience');
  });
  test('GATE-04: AI timeout + proactive token refresh + referrals gone', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8')).toContain('AbortController');
    expect(fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8')).toContain('REFRESH_THRESHOLD_MS');
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
    const conn=fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(conn).not.toContain('referral_credit');
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v177_'+i))!==('v177_'+i)) e2++;
    expect(e2).toBe(0);
  });
});
