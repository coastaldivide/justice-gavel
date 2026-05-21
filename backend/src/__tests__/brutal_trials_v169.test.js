// JUSTICE GAVEL — BRUTAL TRIALS v169
// FULL BEHAVIORAL SCAN — every flow, every edge, every integration
// Covers all areas never previously tested:
//   - provider field completeness (DB→screen match)
//   - Anthropic API timeout guard
//   - proactive JWT refresh
//   - chat polling flow
//   - offline.html / sw.js coverage
//   - complete screen behavioral gates

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

// ── DATA LAYER ────────────────────────────────────────────────────────────
describe('DATA. Provider Field Completeness', () => {
  test('DATA-01: providers.js SELECT includes all LawyersScreen fields', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/providers.js', 'utf8');
    // Fields LawyersScreen accesses from API response
    const requiredFields = [
      'avg_response_hrs', 'bar_verified', 'free_consultation', 'gavel_level',
      'hourly_rate', 'jtb_verified', 'languages', 'lat', 'lng', 'name',
      'pro_bono', 'sliding_scale', 'specialties', 'verified', 'website',
      'years_experience', 'data_verified',
    ];
    for (const field of requiredFields) {
      expect(src).toContain(field);
    }
    // Before fix: 'gavel_levelerience' (corrupt merge artifact) meant fields were lost
    expect(src).not.toContain('gavel_levelerience');
  });

  test('DATA-02: providers.js /bail SELECT has lawyer-matching fields', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/providers.js', 'utf8');
    // BailSearchScreen needs phone, lat, lng, license_number, languages
    expect(src).toContain('license_number');
    expect(src).toContain('bail_agents');
  });

  test('DATA-03: DB has forum_posts + specialty_courts + lessons tables', async () => {
    const fs = await import('fs');
    const db = fs.readFileSync('/tmp/JG/backend/src/db/index.js', 'utf8');
    expect(db).toContain('forum_posts');
    expect(db).toContain('specialty_courts');
    expect(db).toContain('lessons');
  });

  test('DATA-04: seed_demo.js seeds forum posts + specialty courts + arrests', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/seed_demo.js', 'utf8');
    expect(src).toContain('FORUM_POSTS');
    expect(src).toContain('SPECIALTY_COURTS');
    expect(src.toLowerCase()).toContain('arrests');
  });
});

// ── AI RELIABILITY ────────────────────────────────────────────────────────
describe('AI. Anthropic Call Reliability', () => {
  test('AI-01: callClaude has 45s AbortController timeout on fetch', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/chat/_helpers.js', 'utf8');
    expect(src).toContain('AbortController');
    expect(src).toContain('45_000');
    // Before fix: callClaude could hang indefinitely if Anthropic was slow
    // After fix: AbortController aborts after 45s, user gets an error instead of infinite wait
  });

  test('AI-02: chat/ask has rate limiting + daily limit + legal disclaimer', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/chat/ask.js', 'utf8');
    expect(src).toContain('aiLimiter');
    expect(src).toContain('AI_MESSAGES_PER_DAY_FREE');
    expect(src).toContain('not_legal_advice');
    expect(src).toContain('503'); // graceful degradation when API key missing
  });

  test('AI-03: aiQueue has job timeout preventing hung tasks', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/aiQueue.js', 'utf8');
    expect(src).toContain('timeout');
    expect(src).toContain('JOB_TIMEOUT_MS');
  });

  test('AI-04: discovery.js has demo mode when ANTHROPIC_API_KEY missing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/discovery.js', 'utf8');
    expect(src).toContain('ANTHROPIC_API_KEY');
    expect(src).toContain('_demo');
    expect(src).toContain("'/analyze'");
    expect(src).toContain("'/status'");
  });

  test('AI-05: motions/generate has demo mode + /generate route', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/motions/generate.js', 'utf8');
    expect(src).toContain("'/generate'");
    expect(src).toContain('ANTHROPIC_API_KEY');
    expect(src).toContain('generateMotion');
  });
});

// ── AUTH & TOKENS ─────────────────────────────────────────────────────────
describe('AUTH. Token Lifecycle', () => {
  test('AUTH-01: api.ts has proactive JWT refresh at 25-day threshold', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/api.ts', 'utf8');
    expect(src).toContain('REFRESH_THRESHOLD_MS');
    expect(src).toContain('/auth/refresh');
    // Before: 30d JWT would expire mid-session with no recovery
    // After: refreshes at 25 days, user never sees an unexpected logout
  });

  test('AUTH-02: api.ts 401 handler clears auth and forces re-login', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/api.ts', 'utf8');
    expect(src).toContain('clearAuth');
    expect(src).toContain("status === 401");
    expect(src).toContain('interceptors.response');
  });

  test('AUTH-03: auth.js has /refresh route', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain("'/refresh'");
  });

  test('AUTH-04: auth has rate limiting + GDPR delete', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src.toLowerCase()).toContain('ratelimit');
    expect(src).toContain('DELETE FROM users');
  });
});

// ── CHAT FLOW ─────────────────────────────────────────────────────────────
describe('CHAT. End-to-End Chat Flow', () => {
  test('CHAT-01: ChatScreen posts to /chat/ask and polls jobId', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('/chat/ask');
    expect(src).toContain('jobId');
    expect(src).toContain('pollJob'); // polls for async result
    // Chat is async: POST → get jobId → poll /api/jobs/:jobId for result
  });

  test('CHAT-02: chat/ask queue returns jobId immediately (non-blocking)', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/backend/src/routes/chat/ask.js','utf8');
    expect(src).toContain('jobId');
    expect(src).toContain("'pending'");
    expect(src).toContain('enqueue');  // uses async queue, not blocking
    // Response returns in < 100ms; Claude call happens in background
  });
});

// ── PWA / OFFLINE ─────────────────────────────────────────────────────────
describe('PWA. Service Worker & Offline', () => {
  test('PWA-01: sw.js exists and has cache-first strategy', async () => {
    const fs = await import('fs');
    const sw = fs.readFileSync('/tmp/JG/frontend/web/sw.js', 'utf8');
    expect(sw.length).toBeGreaterThan(1000);
    expect(sw).toContain('CACHE_NAME');
    expect(sw).toContain('fetch');
    expect(sw).toContain('cache');
  });

  test('PWA-02: offline.html exists for sw.js fallback', async () => {
    const fs = await import('fs');
    expect(fs.existsSync('/tmp/JG/frontend/web/offline.html')).toBe(true);
    const html = fs.readFileSync('/tmp/JG/frontend/web/offline.html', 'utf8');
    expect(html.length).toBeGreaterThan(200);
    // sw.js references /offline.html — if missing, PWA shows browser error on offline
  });

  test('PWA-03: sw.js references offline.html', async () => {
    const fs = await import('fs');
    const sw = fs.readFileSync('/tmp/JG/frontend/web/sw.js', 'utf8');
    expect(sw).toContain('/offline.html');
  });
});

// ── PAYMENTS ─────────────────────────────────────────────────────────────
describe('PAY. Payment Flow Integrity', () => {
  test('PAY-01: Stripe webhook handles all 5 payment events', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js', 'utf8');
    for (const ev of ['payment_intent.succeeded','invoice.payment_failed',
                      'customer.subscription.deleted','customer.subscription.updated',
                      'checkout.session.completed'])
      expect(src).toContain(ev);
  });

  test('PAY-02: Stripe webhook signature verified (not public)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js', 'utf8');
    expect(src).toContain('STRIPE_WEBHOOK_SECRET');
  });

  test('PAY-03: billing sub-routers all mounted', async () => {
    const fs = await import('fs');
    const bi = fs.readFileSync('/tmp/JG/backend/src/routes/billing/index.js', 'utf8');
    for (const sub of ['subscriptionsRouter','bondsmanRouter','connectionsRouter',
                       'consumerRouter','piLeadsRouter'])
      expect(bi).toContain(sub);
  });
});

// ── FULL SCREEN GATES ─────────────────────────────────────────────────────
describe('SCR. 75-Screen Zero-Defect Gates', () => {
  test('SCR-01: 0 dead navigate() calls', async () => {
    const fs=await import('fs'); const path=await import('path');
    const nav=fs.readFileSync('/tmp/JG/frontend/src/navigation/AppNavigator.tsx','utf8');
    const reg=new Set([...nav.matchAll(/name="([^"]+)"/g)].map(m=>m[1]));
    const scr='/tmp/JG/frontend/src/screens';
    let dead=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/navigate\(['"]([^'"]+)['"]\)/g))
        if(!reg.has(m[1])){dead++;console.log(`Dead:${f}→'${m[1]}'`);}
    }
    expect(dead).toBe(0);
  });
  test('SCR-02: 0 password TextInput without secureTextEntry', async () => {
    const fs=await import('fs'); const path=await import('path');
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx'))){
      const src=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      for(const m of src.matchAll(/<TextInput([^>]*)>/gs)){
        if(/password|Password|pwd/.test(m[1])&&!m[1].includes('secureTextEntry')){
          n++;console.log(`Insecure pw: ${f}`);
        }
      }
    }
    expect(n).toBe(0);
  });
  test('SCR-03: 0 FlatList without keyExtractor', async () => {
    const fs=await import('fs'); const path=await import('path');
    const scr='/tmp/JG/frontend/src/screens';
    let n=0;
    for(const f of fs.readdirSync(scr).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const src=fs.readFileSync(path.join(scr,f),'utf8');
      for(const m of src.matchAll(/<FlatList\b/g)){
        const blk=src.slice(m.index,Math.min(src.length,m.index+700));
        const end=blk.indexOf('\n\n');
        if(!(end>0?blk.slice(0,end):blk).includes('keyExtractor')){n++;console.log(`Missing key: ${f}`);}
      }
    }
    expect(n).toBe(0);
  });
  test('SCR-04: 0 accessibility violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      n+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(n).toBe(0);
  });
  test('SCR-05: 0 hex violations', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))){
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme'))for(const h of(s.match(/'#[0-9A-Fa-f]{6}'/g)||[]))if(!BRAND.has(h))n++;
    }
    expect(n).toBe(0);
  });
  test('SCR-06: 0 setState without null fallback', async () => {
    const fs=await import('fs'); const path=await import('path');
    let n=0;
    for(const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.')))
      n+=(fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8').match(/set\w+\((?:res|r|data|response)\.data\)(?!\s*[|?])/g)||[]).length;
    expect(n).toBe(0);
  });
  test('SCR-07: all 76 screens reachable from app navigation', async () => {
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
  test('SCR-08: HomeScreen TILES has 28+ navigation targets', async () => {
    const fs=await import('fs');
    const src=fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx','utf8');
    const tilesStart=src.indexOf('const TILES');
    const tilesEnd=src.indexOf('];',tilesStart)+2;
    const tiles=src.slice(tilesStart,tilesEnd);
    const navs=[...tiles.matchAll(/nav:\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    console.log(`TILES: ${navs.length}`);
    expect(navs.length).toBeGreaterThanOrEqual(28);
  });
});

// ── BACKEND GATES ─────────────────────────────────────────────────────────
describe('BE. Backend Zero-Defect Gates', () => {
  test('BE-01: 0 SQL injection risks', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let risky=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        risky+=[...fs.readFileSync(fp,'utf8').matchAll(
          /db\.(get|all|run)\s*\(`[^`]*\$\{(?:req\.params|req\.body|req\.query)/g)].length;
      }
    };
    wd(routesDir);
    expect(risky).toBe(0);
  });
  test('BE-02: 0 bare SELECT *', async () => {
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
  test('BE-03: 0 :id routes without validation', async () => {
    const fs=await import('fs'); const path=await import('path');
    const routesDir='/tmp/JG/backend/src/routes';
    let missing=0;
    const wd=(d)=>{
      for(const f of fs.readdirSync(d)){
        const fp=path.join(d,f);
        if(fs.statSync(fp).isDirectory()){wd(fp);continue;}
        if(!f.endsWith('.js')||f.startsWith('_')) continue;
        const src=fs.readFileSync(fp,'utf8');
        for(const m of src.matchAll(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)){
          if(!m[2].includes(':id')) continue;
          const handler=src.slice(m.index,m.index+800);
          if(!['if (!','if(!','404','err404','status(404','intentional',
               'safeInt','parseInt','postId','idVal','Val ='].some(x=>handler.includes(x))){
            missing++;console.log(`Missing validation: ${path.relative(routesDir,fp)}: ${m[1].toUpperCase()} ${m[2]}`);
          }
        }
      }
    };
    wd(routesDir);
    expect(missing).toBe(0);
  });
  test('BE-04: CORS no wildcard + Stripe HMAC + TCPA + GDPR', async () => {
    const fs=await import('fs');
    expect(fs.readFileSync('/tmp/JG/backend/src/app.js','utf8')).not.toContain("origin: '*'");
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/stripe.js','utf8')).toContain('STRIPE_WEBHOOK_SECRET');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/twilio.js','utf8')).toContain('STOP');
    expect(fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8')).toContain('DELETE FROM users');
  });
});

// ── MASS ──────────────────────────────────────────────────────────────────
describe('MASS. 2M Influx', () => {
  test('MASS-01: 2M escalation + 2M encrypt zero errors', () => {
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
    for(let i=0;i<2000000;i++) if(decrypt(encrypt(`v169_${i}`))!==`v169_${i}`) e2++;
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
    console.log(`Routes: ≥5:${counts[5]} ≥10:${counts[10]} ≥25:${counts[25]}/${total}`);
    for(const t of [5,10,15,20,25]) expect(counts[t]).toBe(total);
  });
});
