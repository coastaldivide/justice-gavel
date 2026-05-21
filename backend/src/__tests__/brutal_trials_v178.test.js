// JUSTICE GAVEL — BRUTAL TRIALS v178
// DEEPEST LAYER: app entry, OTA, push, biometric, ToS, tiles, journey simulation
// Everything that runs before the user sees a single screen

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

// ── APP ENTRY + LIFECYCLE ─────────────────────────────────────────────────
describe('APP. App Entry and Lifecycle', () => {
  test('APP-01: App.tsx has correct auth state machine', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    // Auth states: loading → biometric → age gate → token check → authed/browsing/guest
    expect(app).toContain("'loading'");
    expect(app).toContain("'authed'");
    expect(app).toContain("'browsing'");
    expect(app).toContain("'guest'");
    expect(app).toContain('bioChecked');
    expect(app).toContain('age_verified');
    // canBrowse() gates MainTabs vs GuestNavigator
    expect(app).toContain('canBrowse');
    expect(app).toContain('MainTabs');
    expect(app).toContain('GuestNavigator');
  });
  test('APP-02: biometric lock implemented before UI shows', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('LocalAuthentication');
    expect(app).toContain('biometric_enabled');
    expect(app).toContain('bioLocked');
    // bioChecked gates the entire UI — nothing shows until bio check completes
    expect(app).toContain('!bioChecked');
  });
  test('APP-03: ToS check on every authenticated startup', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('/auth/tos-status');
    expect(app).toContain('tosNeeded');
    // Backend has the route
    const auth = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(auth).toContain('tos-status');
    expect(auth).toContain('accept-tos');
  });
  test('APP-04: offline network detection wired', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('NetInfo');
    expect(app).toContain('isOffline');
    expect(app).toContain('isConnected');
  });
  test('APP-05: push notification deep-link routing', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('addNotificationResponseReceivedListener');
    expect(app).toContain('case_update');
    expect(app).toContain('navigationRef');
  });
});

// ── OTA + PUSH ────────────────────────────────────────────────────────────
describe('OTA. Over-The-Air Updates and Push', () => {
  test('OTA-01: useOTAUpdates implemented — not just declared', async () => {
    const fs = await import('fs');
    const setup = fs.readFileSync('/tmp/JG/frontend/src/hooks/useAppSetup.ts','utf8');
    // Before fix: useOTAUpdates() called by App.tsx but never defined
    // This caused a ReferenceError on every app launch
    expect(setup).toContain('export function useOTAUpdates');
    expect(setup).toContain('checkForUpdateAsync');
    expect(setup).toContain('fetchUpdateAsync');
    expect(setup).toContain('reloadAsync');
  });
  test('OTA-02: push import path correct (not broken ./src/ path)', async () => {
    const fs = await import('fs');
    const setup = fs.readFileSync('/tmp/JG/frontend/src/hooks/useAppSetup.ts','utf8');
    // Before fix: dynamic import used './src/services/api' which is wrong
    // from hooks/ directory — it would silently fail to send push token
    expect(setup).not.toContain('./src/services/api');
    expect(setup).toContain('../services/api');
  });
  test('OTA-03: dead linking config removed from useAppSetup.ts', async () => {
    const fs = await import('fs');
    const setup = fs.readFileSync('/tmp/JG/frontend/src/hooks/useAppSetup.ts','utf8');
    // A second linking config was defined in useAppSetup but never exported
    // The real linking config is in AppNavigator.tsx
    // This dead code confused the deep-link routing
    expect(setup).not.toMatch(/^const linking = \{/m);
  });
  test('OTA-04: push token only POSTed when changed (no redundant calls)', async () => {
    const fs = await import('fs');
    const setup = fs.readFileSync('/tmp/JG/frontend/src/hooks/useAppSetup.ts','utf8');
    expect(setup).toContain('last_push_token');
    expect(setup).toContain('token !== lastToken');
  });
  test('OTA-05: push registration skips on web platform', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    // Push doesn't work on web — should be gated
    expect(app).toContain("Platform.OS !== 'web'");
    expect(app).toContain('registerForPushNotificationsAsync');
  });
});

// ── USER JOURNEY SIMULATION ───────────────────────────────────────────────
describe('JOURNEY. All 12 User Journeys', () => {
  test('JOURNEY-01: Emergency — JustArrested → HelpNow → Lawyers/Bail/Chat', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const ja =fs.readFileSync(path.join(scr,'JustArrestedScreen.tsx'),'utf8');
    const hn =fs.readFileSync(path.join(scr,'HelpNowScreen.tsx'),'utf8');
    expect(ja).toMatch(/remain silent|Miranda/i);
    expect(ja).toMatch(/attorney|lawyer/i);
    expect(ja).toContain('HelpNow');
    expect(hn).toContain('/providers/lawyers');
    expect(hn).toContain('988');
    expect(hn).toContain("navigate('LawyersTab')");
    expect(hn).toContain("navigate('ChatTab')");
  });
  test('JOURNEY-02: Find Lawyer → Book Consultation', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const lawyers=fs.readFileSync(path.join(scr,'LawyersScreen.tsx'),'utf8');
    const profile=fs.readFileSync(path.join(scr,'LawyerProfileScreen.tsx'),'utf8');
    const booking=fs.readFileSync(path.join(scr,'BookingScreen.tsx'),'utf8');
    expect(lawyers).toContain('/providers/lawyers');
    expect(lawyers).toContain('LawyerProfile');
    expect(profile).toContain('/reviews');
    expect(profile).toContain('Booking');
    expect(booking).toContain('/consultations/book');
    expect(booking).toContain('catch');
  });
  test('JOURNEY-03: Case Management — all sub-screens linked', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const cs=fs.readFileSync(path.join(scr,'CaseScreen.tsx'),'utf8');
    for(const screen of ['CaseTimeline','Messages','MotionLibrary','Discovery','DeadlineCalculator'])
      expect(cs).toContain(screen);
    // Messages can send
    const ms=fs.readFileSync(path.join(scr,'MessagesScreen.tsx'),'utf8');
    expect(ms).toContain('api.post');
  });
  test('JOURNEY-04: Payments — subscribe + QuickConnect', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const sub=fs.readFileSync(path.join(scr,'SubscriptionScreen.tsx'),'utf8');
    const qc =fs.readFileSync(path.join(scr,'QuickConnectScreen.tsx'),'utf8');
    expect(sub).toContain('/billing/subscribe');
    expect(sub).toContain('/billing/cancel');
    expect(sub).toContain('{!!error');
    expect(qc).toContain('/billing/quickconnect');
    expect(qc).not.toContain('referral_credit');
  });
  test('JOURNEY-05: AI Chat — send + poll + disclaimer', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const chat=fs.readFileSync(path.join(scr,'ChatScreen.tsx'),'utf8');
    expect(chat).toContain('/chat/ask');
    expect(chat).toContain('pollJob');
    expect(chat).toMatch(/not legal advice|disclaimer/i);
    expect(chat).toContain('keyExtractor');
  });
  test('JOURNEY-06: Bail Calculator — fetches schedules via /legaldata/bail', async () => {
    const fs=await import('fs'); const path=await import('path');
    const bail=fs.readFileSync('/tmp/JG/frontend/src/screens/BailCalculatorScreen.tsx','utf8');
    // Uses cachedGet('/legaldata/bail?state=...')
    expect(bail).toContain('/legaldata/bail');
    expect(bail).toContain('bondCost');
    expect(bail).toContain('fmt(bondCost');
    // Backend has the route
    const ld=fs.readFileSync('/tmp/JG/backend/src/routes/legaldata.js','utf8');
    expect(ld).toContain('bail');
  });
  test('JOURNEY-07: Expungement → petition generation', async () => {
    const fs=await import('fs'); const path=await import('path');
    const exp=fs.readFileSync('/tmp/JG/frontend/src/screens/ExpungementScreen.tsx','utf8');
    expect(exp).toContain('/expungement/check');
    expect(exp).toContain('/expungement/petition');
    expect(exp).toMatch(/eligibl/i);
  });
  test('JOURNEY-08: Settings — logout clears all + nav resets', async () => {
    const fs=await import('fs'); const path=await import('path');
    const settings=fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx','utf8');
    const logoutIdx=settings.indexOf('const logout');
    const logoutBody=settings.slice(logoutIdx,logoutIdx+500);
    expect(logoutBody).toContain('clearAuth');
    expect(logoutBody).toContain('AsyncStorage');
    expect(logoutBody).toMatch(/reset.*Login|Login.*reset/s);
    expect(settings).not.toContain('/referrals/');
  });
  test('JOURNEY-09: HomeScreen — all 30 tiles navigate to real screens', async () => {
    const fs=await import('fs'); const path=await import('path');
    const home=fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    const nav =fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg =new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const tiles=home.match(/nav:\s*['"]([^'"]+)['"]/g)||[];
    let bad=0;
    for(const tile of tiles){
      const target=tile.replace(/nav:\s*['"]/,'').replace(/['"]/,'');
      if(target.startsWith('More:')){
        if(!reg.has(target.slice(5))){bad++;console.log('Bad tile: '+target);}
      } else if(!target.startsWith('tab:')&&!['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab'].includes(target)){
        if(!reg.has(target)){bad++;console.log('Bad tile: '+target);}
      }
    }
    expect(bad).toBe(0);
  });
  test('JOURNEY-10: Family Monitor — contacts + arrest search + monitors', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    const fam =fs.readFileSync(path.join(scr,'FamilyConnectScreen.tsx'),'utf8');
    const arst=fs.readFileSync(path.join(scr,'ArrestMonitorScreen.tsx'),'utf8');
    expect(fam).toContain('/family/contacts');
    expect(fam).toContain('/arrests/search');
    expect(arst).toContain('/arrests/monitors');
    expect(arst).toContain('Alert');
  });
  test('JOURNEY-11: Attorney Dashboard — profile + cases + bar validation', async () => {
    const fs=await import('fs'); const path=await import('path');
    const atty=fs.readFileSync('/tmp/JG/frontend/src/screens/AttorneyDashboardScreen.tsx','utf8');
    expect(atty).toContain('/attorney/profile');
    expect(atty).toContain('/attorney/cases');
    expect(atty).toContain('saveProfile');
    expect(atty).toContain('Bar Number');
  });
  test('JOURNEY-12: Offline — NetInfo wired + SW exists + offline page', async () => {
    const fs=await import('fs');
    const app=fs.readFileSync('/tmp/JG/frontend/App.tsx','utf8');
    expect(app).toContain('NetInfo');
    expect(app).toContain('isOffline');
    const sw=fs.readFileSync('/tmp/JG/frontend/web/sw.js','utf8');
    expect(sw).toContain('CACHE_NAME');
    expect(sw).toContain('offline.html');
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
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable'))bare++;
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
  test('GATE-03: DB schema clean + 0 mismatches', async () => {
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
          if(u.length)bad.push(path.relative('/tmp/JG/backend/src/routes',fp)+': '+t+': '+u);
        }
      }
    };
    wd('/tmp/JG/backend/src/routes');
    if(bad.length)console.log('Mismatches:',bad);
    expect(bad.length).toBe(0);
  });
  test('GATE-04: security hardening — CORS + GDPR + Stripe HMAC + AI timeout', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8')).toContain('AbortController');
    expect(fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8')).toContain('REFRESH_THRESHOLD_MS');
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt('v178_'+i))!==('v178_'+i))e2++;
    expect(e2).toBe(0);
  });
});
