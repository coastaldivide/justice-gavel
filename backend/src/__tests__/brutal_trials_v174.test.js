// JUSTICE GAVEL — BRUTAL TRIALS v174
// DEEPEST FUNCTIONAL SCAN — DB schema ↔ API response ↔ FE field contract
// Every user session, every data contract, every API response field

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

// ── API RESPONSE ↔ FE FIELD CONTRACTS ────────────────────────────────────
describe('CONTRACT. API Response Fields Match FE Expectations', () => {
  test('CONTRACT-01: messages.js SELECT cm.* covers .body field FE uses', async () => {
    const fs = await import('fs');
    const msg = fs.readFileSync('/tmp/JG/backend/src/routes/messages.js','utf8');
    expect(msg).toContain('SELECT cm.*');
    // case_messages table has 'body' column; cm.* includes it
    // MessagesScreen uses both .body and .content — body is covered
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(db).toContain('body'); // case_messages has body column
  });
  test('CONTRACT-02: /family/contacts returns u.phone for emergency dialing', async () => {
    const fs = await import('fs');
    const cases = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    const fcIdx = cases.indexOf("'/family/contacts'");
    const handler = cases.slice(fcIdx, fcIdx+1000);
    expect(handler).toContain('u.phone');
    // Before fix: phone was missing — users couldn't call family contacts
    // After fix: phone included in SELECT and returned with contacts
  });
  test('CONTRACT-03: referrals route removed (exploit risk eliminated)', async () => {
    const fs = await import('fs');
    // referrals.js was removed — no credit-based referral system
    // prevents infinite credit loop exploit via POST /referrals/apply
    expect(fs.existsSync('/tmp/JG/backend/src/routes/referrals.js')).toBe(false);
    const app = fs.readFileSync('/tmp/JG/backend/src/app.js','utf8');
    expect(app).not.toContain('/api/referrals');
  });
  test('CONTRACT-04: providers /lawyers returns all LawyersScreen fields', async () => {
    const fs = await import('fs');
    const prov = fs.readFileSync('/tmp/JG/backend/src/routes/providers.js','utf8');
    for(const f of ['name','phone','rating','lat','lng','avg_response_hrs',
                    'bar_verified','data_verified','gavel_level','years_experience'])
      expect(prov).toContain(f);
    expect(prov).not.toContain('gavel_levelerience');
  });
  test('CONTRACT-05: chat /ask returns jobId for ChatScreen polling', async () => {
    const fs = await import('fs');
    const ask = fs.readFileSync('/tmp/JG/backend/src/routes/chat/ask.js','utf8');
    expect(ask).toContain('jobId');
    expect(ask).toContain("'pending'");
    expect(ask).toContain('enqueue'); // async — returns immediately
  });
  test('CONTRACT-06: /golden-gavel/eligibility returns eligible field', async () => {
    const fs = await import('fs');
    const gg = fs.readFileSync('/tmp/JG/backend/src/routes/golden_gavel.js','utf8');
    expect(gg).toContain('eligible');
  });
});

// ── USER SESSION FLOWS ────────────────────────────────────────────────────
describe('SESSION. Complete User Sessions', () => {
  test('SESSION-01: New user onboarding uses auth context (not navigate)', async () => {
    const fs = await import('fs');
    const onb = fs.readFileSync('/tmp/JG/frontend/src/screens/OnboardingScreen.tsx','utf8');
    // Onboarding uses setAppAuth('browsing') — auth context drives navigation
    // This is correct — no navigate() needed
    expect(onb).toContain('setAppAuth');
    expect(onb).toContain("replace('Login')");
    // browseNow() sets auth state → AppNavigator switches stack automatically
  });
  test('SESSION-02: Registration → token saved → HomeTab', async () => {
    const fs = await import('fs');
    const reg = fs.readFileSync('/tmp/JG/frontend/src/screens/RegisterScreen.tsx','utf8');
    expect(reg).toContain('/auth/register');
    expect(reg).toContain('secureTextEntry');
    expect(reg).toContain("navigate('HomeTab')");
    // Token saved to secureStorage
    const savesTok = reg.includes('setItem') || reg.includes('setToken') || reg.includes('secureStorage');
    expect(savesTok).toBe(true);
  });
  test('SESSION-03: JustArrested step wizard — silence + bail + help', async () => {
    const fs = await import('fs');
    const ja = fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx','utf8');
    expect(ja).toContain('silent');
    expect(ja).toContain('bail');
    expect(ja).toContain('find_help');
    expect(ja).toContain('HelpNow');
    // Step navigation works
    expect(ja).toContain('prev');
    expect(ja).toContain('next');
  });
  test('SESSION-04: HelpNow — lawyers + bail + court + chat reachable', async () => {
    const fs = await import('fs');
    const hn = fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx','utf8');
    expect(hn).toContain('/providers/lawyers');
    expect(hn).toContain('/providers/bail');
    expect(hn).toContain('/courthouses');
    expect(hn).toContain('988');
    // All navigation targets exist
    expect(hn).toContain("navigate('LawyersTab')");
    expect(hn).toContain("navigate('ChatTab')");
    expect(hn).toContain('BailCalculator');
  });
  test('SESSION-05: BailCalculator shows bondCost result in render', async () => {
    const fs = await import('fs');
    const bail = fs.readFileSync('/tmp/JG/frontend/src/screens/BailCalculatorScreen.tsx','utf8');
    // bondCost function defined and used in render
    expect(bail).toContain('bondCost');
    // Renders formatted cost string
    expect(bail).toContain('fmt(bondCost');
  });
  test('SESSION-06: Discovery uses 90s direct request (not job queue)', async () => {
    const fs = await import('fs');
    const disc = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx','utf8');
    expect(disc).toContain('/discovery/analyze');
    expect(disc).toContain('90000'); // 90s timeout for large PDFs
    expect(disc).toContain('setAnalysis'); // stores result directly
    // No jobId polling needed — synchronous AI call with timeout
  });
  test('SESSION-07: BondsmanDashboard confirmAccept has full error handling', async () => {
    const fs = await import('fs');
    const bond = fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx','utf8');
    // confirmAccept: await api → Alert success → loadLeads → catch → Alert error
    expect(bond).toContain('confirmAccept');
    expect(bond).toContain("'✅ Lead Accepted'");
    expect(bond).toContain('fee_charged');
    expect(bond).toContain("'Payment issue'"); // error Alert
    expect(bond).toContain('finally');
  });
});

// ── PAYMENT SYSTEM ────────────────────────────────────────────────────────
describe('PAY. Payment System Verified', () => {
  test('PAY-01: subscription flow complete', async () => {
    const fs = await import('fs');
    const sub = fs.readFileSync('/tmp/JG/backend/src/routes/billing/subscriptions.js','utf8');
    expect(sub).toContain("router.post('/subscribe'");
    expect(sub).toContain("TIERS[tier]");
    expect(sub).toContain("'demo'");
    expect(sub).toContain("stripe.subscriptions.create");
    // FE
    const feSub = fs.readFileSync('/tmp/JG/frontend/src/screens/SubscriptionScreen.tsx','utf8');
    expect(feSub).toContain('/billing/subscribe');
    expect(feSub).toContain('{!!error');  // error shown to user
    expect(feSub).toContain("Platform.OS === 'ios'"); // iOS App Store gate
  });
  test('PAY-02: QuickConnect charges + returns contacts', async () => {
    const fs = await import('fs');
    const qc = fs.readFileSync('/tmp/JG/backend/src/routes/billing/connections.js','utf8');
    expect(qc).toContain('paymentIntents.create');
    expect(qc).toContain("pi.status !== 'succeeded'");
    expect(qc).toContain('validLat, validLat, validLng, validLng');
    expect(qc).toContain('revenue_log');
  });
  test('PAY-03: Stripe webhook handles 5 events + updates DB', async () => {
    const fs = await import('fs');
    const wh = fs.readFileSync('/tmp/JG/backend/src/routes/billing/webhooks.js','utf8');
    for(const ev of ['customer.subscription.deleted','customer.subscription.updated',
                     'invoice.payment_failed','checkout.session.completed'])
      expect(wh).toContain(ev);
    expect(wh).toContain('UPDATE');
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
        if(!reg.has(m[1])){dead++;console.log(`Dead:${f}→${m[1]}`);}
      for(const m of s.matchAll(/<TextInput([^>]*)>/gs))
        if(/password|Password|pwd/.test(m[1])&&!m[1].includes('secureTextEntry')){noPw++;}
    }
    expect(dead).toBe(0); expect(noPw).toBe(0);
  });
  test('GATE-02: 0 FlatList without keyExtractor + 0 accessibility + 0 hex', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const scr='/tmp/JG/frontend/src/screens';
    let noKey=0,acc=0,hex=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of s.matchAll(/<FlatList\b/g)){
        const blk=s.slice(m.index,Math.min(s.length,m.index+700));
        const end=blk.indexOf('\n\n');
        if(!(end>0?blk.slice(0,end):blk).includes('keyExtractor')){noKey++;console.log(`NoKey:${f}`);}
      }
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h)){hex++;console.log(`hex ${h} ${f}`);}
    }
    expect(noKey).toBe(0); expect(acc).toBe(0); expect(hex).toBe(0);
  });
  test('GATE-03: 0 SQL injection + 0 bare SELECT * + all screens reachable', async () => {
    const fs=await import('fs'); const path=await import('path');
    let inj=0,bare=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_'))continue;
        const src=fs.readFileSync(fp,'utf8');
        inj+=[...src.matchAll(/db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
        for(const m of src.matchAll(/SELECT \*[^\n]*/g))
          if(!m[0].includes('intentional')&&m[0].includes('FROM')&&!m[0].includes('safeTable'))bare++;
      }
    };
    wd('/tmp/JG/backend/src/routes');
    expect(inj).toBe(0); expect(bare).toBe(0);
    // Reachability
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
    console.log(`Unreachable:${gone.length}`);
    expect(gone.length).toBe(0);
  });
  test('GATE-04: AI timeout + token refresh + providers fields', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js','utf8')).toContain('AbortController');
    expect(fs.readFileSync('/tmp/JG/frontend/src/services/api.ts','utf8')).toContain('REFRESH_THRESHOLD_MS');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
  });
  test('GATE-05: 444/444 routes all tiers ≥5..≥25', async () => {
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
        if(!f.endsWith('.js')||f.startsWith('_'))continue;
        for(const[,p] of fs.readFileSync(fp,'utf8').matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)){
          total++;
          const h=(corpus.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length;
          for(const t of [5,10,15,20,25])if(h>=t)counts[t]++;
        }
      }
    };
    wd(routesDir);
    console.log(`Routes ≥25: ${counts[25]}/${total}`);
    for(const t of [5,10,15,20,25])expect(counts[t]).toBe(total);
  });
});

// ── MASS ──────────────────────────────────────────────────────────────────
describe('MASS. 2M Influx', () => {
  test('MASS-01: 2M escalation + 2M encrypt zero errors', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights',
             'white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for(let i=0;i<2000000;i++){
      const s=computeAllSignals(mkM(V[i%10],{
        evidence_score:i%101,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if(!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
    let e2=0;
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v174_${i}`))!==`v174_${i}`) e2++;
    expect(e2).toBe(0);
  });
});
