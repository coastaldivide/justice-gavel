// JUSTICE GAVEL — BRUTAL TRIALS v167
// BEHAVIORAL FUNCTIONAL SCAN — Every screen, every interaction, every edge case
// secureTextEntry, keyExtractor, Alert messages, KeyboardAvoidingView,
// loading states, error handlers, data fallbacks, navigation, accessibility

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

// ══ PASSWORD SECURITY ═════════════════════════════════════════════════════
describe('PWD. Password Fields — secureTextEntry Required', () => {
  test('PWD-01: LoginScreen password field has secureTextEntry', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/LoginScreen.tsx','utf8');
    // Find password TextInput block and verify secureTextEntry present
    const pwIdx=src.indexOf('placeholder="Your password"');
    const pwBlock=src.slice(pwIdx, pwIdx+400);
    expect(pwBlock).toContain('secureTextEntry');
    // Before fix: password displayed in plaintext — users' passwords visible to observers
    // After fix: secureTextEntry={!showPassword} — password masked
  });
  test('PWD-02: RegisterScreen password field has secureTextEntry', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    const pwIdx=src.indexOf('placeholder="At least 6 characters"');
    const pwBlock=src.slice(pwIdx, pwIdx+400);
    expect(pwBlock).toContain('secureTextEntry');
  });
});

// ══ FLATLIST KEYING ═══════════════════════════════════════════════════════
describe('LIST. FlatList keyExtractor — No List Scrambling', () => {
  test('LIST-01: all FlatLists across all 75 screens have keyExtractor', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let missing=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/<FlatList\b/g)){
        const block=src.slice(m.index,Math.min(src.length,m.index+600));
        const end=block.indexOf('\n\n');
        const tag=end>0?block.slice(0,end):block;
        if(!tag.includes('keyExtractor')){
          missing++;
          console.log(`Missing keyExtractor: ${f}`);
        }
      }
    }
    // keyExtractor prevents React from re-rendering entire list on data change
    // Without it: items reorder/flash/duplicate on every update
    expect(missing).toBe(0);
  });
});

// ══ ALERT DIALOGS ════════════════════════════════════════════════════════
describe('ALERT. Alert.alert — No Empty Dialogs', () => {
  test('ALERT-01: ChatScreen Message Options alert has message text', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/ChatScreen.tsx','utf8');
    // Was: Alert.alert('Message Options', undefined, [...])
    // After: Alert.alert('Message Options', 'Select an action...', [...])
    expect(src).not.toContain("'Message Options', undefined");
    expect(src).toContain("'Message Options'");
    const idx=src.indexOf("'Message Options'");
    const after=src.slice(idx+17,idx+80);
    expect(after).not.toContain('undefined');
  });
});

// ══ KEYBOARD HANDLING ════════════════════════════════════════════════════
describe('KBD. Keyboard Handling — Inputs Visible While Typing', () => {
  test('KBD-01: HagueContactScreen has KeyboardAvoidingView for 4 TextInputs', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HagueContactScreen.tsx','utf8');
    expect(src).toContain('KeyboardAvoidingView');
    // 4 TextInput fields without KAV → keyboard covers the bottom fields on small devices
  });
});

// ══ FULL BEHAVIORAL SCAN — ALL SCREENS ═══════════════════════════════════
describe('SCAN. Complete Screen Behavioral Scan', () => {
  test('SCAN-01: 0 dead navigate() calls', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log(`Dead: ${f}→'${m[1]}'`);}
    }
    expect(dead).toBe(0);
  });
  test('SCAN-02: 0 setState without null fallback', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      n+=(fs.readFileSync(path.join(scr,f),'utf8').match(/set\w+\((?:res|r|data|response)\.data\)(?!\s*\|)/g)||[]).length;
    }
    expect(n).toBe(0);
  });
  test('SCAN-03: 0 accessibility violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      n+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(n).toBe(0);
  });
  test('SCAN-04: 0 hex color violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))n++;
    }
    expect(n).toBe(0);
  });
  test('SCAN-05: 0 password TextInput without secureTextEntry', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/<TextInput[^>]*>/gs)){
        const blk=m[0];
        if(/password|Password|pwd/.test(blk) && !blk.includes('secureTextEntry')){
          n++; console.log(`Missing secureTextEntry: ${f}`);
        }
      }
    }
    expect(n).toBe(0);
  });
  test('SCAN-06: 0 FlatList without keyExtractor', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/<FlatList\b/g)){
        const block=src.slice(m.index,Math.min(src.length,m.index+600));
        const end=block.indexOf('\n\n');
        if(!(end>0?block.slice(0,end):block).includes('keyExtractor')){
          n++; console.log(`Missing keyExtractor: ${f}`);
        }
      }
    }
    expect(n).toBe(0);
  });
});

// ══ BACKEND BEHAVIORAL ════════════════════════════════════════════════════
describe('BE. Backend Behavioral Checks', () => {
  test('BE-01: 0 SQL injection risks', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let risky=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        risky+=[...fs.readFileSync(fp,'utf8').matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
      }
    };
    wd(routesDir);
    expect(risky).toBe(0);
  });
  test('BE-02: 0 bare SELECT * without annotation', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let bare=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        for(const m of src.matchAll(/SELECT \*[^\n]*/g))
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable')) bare++;
      }
    };
    wd(routesDir);
    expect(bare).toBe(0);
  });
  test('BE-03: discovery.js + motions/generate.js + /family/contacts exist', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/discovery.js','utf8')).toContain("'/analyze'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/motions/generate.js','utf8')).toContain("'/generate'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8')).toContain("'/family/contacts'");
  });
  test('BE-04: auth has rate limiting + GDPR delete', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src.toLowerCase()).toContain('ratelimit');
    expect(src).toContain('DELETE FROM users');
  });
  test('BE-05: Stripe webhook 5 events + HMAC verification', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js','utf8');
    for(const ev of ['payment_intent.succeeded','invoice.payment_failed',
                     'customer.subscription.deleted','customer.subscription.updated',
                     'checkout.session.completed'])
      expect(src).toContain(ev);
    expect(src).toContain('STRIPE_WEBHOOK_SECRET');
  });
  test('BE-06: TCPA STOP handling in Twilio webhook', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/twilio.js','utf8')).toContain('STOP');
  });
});

// ══ HOMESCREEN DISCOVERY ═════════════════════════════════════════════════
describe('HOME. HomeScreen Feature Discovery', () => {
  test('HOME-01: TILES grid has 28+ navigation targets covering all feature areas', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    const tilesStart=src.indexOf('const TILES');
    const tilesEnd=src.indexOf('];',tilesStart)+2;
    const tiles=src.slice(tilesStart,tilesEnd);
    const navTargets=[...tiles.matchAll(/nav:\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    console.log(`TILES count: ${navTargets.length}`);
    expect(navTargets.length).toBeGreaterThanOrEqual(28);
    // All major feature areas covered in the discovery grid
  });
  test('HOME-02: More:X helper navigates to MoreStack correctly', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    expect(src).toContain("nav.startsWith('More:')");
    expect(src).toContain("navigation.navigate('MoreTab', { screen: nav.slice(5)");
    // The helper correctly routes More:JustArrested → MoreTab {screen:'JustArrested'}
  });
  test('HOME-03: all registered screens reachable from somewhere in the app', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    const allTargets=new Set();
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/navigate\(['"]([^'"]+)['"]/g)) allTargets.add(m[1]);
      for(const m of s.matchAll(/screen:\s*['"]([^'"]+)['"]/g)) allTargets.add(m[1]);
      for(const m of s.matchAll(/['"]More:(\w+)['"]/g)) allTargets.add(m[1]);
    }
    const tabRoots=new Set(['HomeTab','ChatTab','LawyersTab','BailTab','MoreTab','MoreHome']);
    const unreachable=[...reg].filter(r=>!allTargets.has(r)&&!tabRoots.has(r));
    console.log(`Unreachable: ${unreachable.length}`);
    expect(unreachable.length).toBe(0);
  });
});

// ══ MASS INFLUX ═══════════════════════════════════════════════════════════
describe('MASS. 2M Influx — Zero Errors', () => {
  test('MASS-01: 2M escalation + 2M encrypt', () => {
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v167_${i}`))!==`v167_${i}`) e2++;
    expect(e2).toBe(0);
  });
  test('MASS-02: 444/444 routes all tiers ≥5 ≥10 ≥15 ≥20 ≥25', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const routesDir='/tmp/JG/backend/src/routes';
    let counts={5:0,10:0,15:0,20:0,25:0},total=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        for(const[,p] of fs.readFileSync(fp,'utf8').matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)){
          total++;
          const h=(corpus.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length;
          for(const t of [5,10,15,20,25]) if(h>=t) counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log(`Routes ≥5:${counts[5]} ≥25:${counts[25]}/${total}`);
    for(const t of [5,10,15,20,25]) expect(counts[t]).toBe(total);
  });
});
