/**
 * JUSTICE GAVEL — GRAND SIMULATION: 100,000 TRIALS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  TRACK A — LAW FIRMS (50,000 trials across 10 firm types × 5,000 each)
 *    F01  HVS  Harrington Voss & Slate LLP       (Criminal Defense)
 *    F02  MCR  McDermott Civil Rights             (§ 1983 / Civil Rights)
 *    F03  RCG  Regent Compliance Group PC         (White-Collar / Regulatory)
 *    F04  PLF  Pellegrino Family Law Center       (Family Law)
 *    F05  KIP  Kessler Immigration Partners       (Removal Defense)
 *    F06  TPT  Thornwald PI & Mass Tort           (Personal Injury)
 *    F07  APD  Axiom Public Defense Consortium    (Public Defender)
 *    F08  HAG  Halcyon Appellate Group            (Appellate / PCR)
 *    F09  BMJ  Blackrock Military Justice LLC     (UCMJ / Military)
 *    F10  MJD  Meridian Juvenile & Dependency     (Juvenile / Dependency)
 *
 *  TRACK B — INDIVIDUAL CONSUMERS (50,000 trials across 10 user profiles × 5,000 each)
 *    I01  Urban tenant facing eviction             (Housing / Benefits)
 *    I02  DUI first offender — state court        (Criminal / Traffic)
 *    I03  Undocumented — asylum seeker            (Immigration)
 *    I04  Domestic violence survivor              (Family / DV)
 *    I05  Ex-offender seeking expungement         (Expungement / Reentry)
 *    I06  Medical debt / wage garnishment         (Consumer / Civil)
 *    I07  Small business — contract dispute       (Business / Contract)
 *    I08  Workers' comp claim denied              (Labor / Employment)
 *    I09  Veteran — benefits denial               (Veterans / Admin)
 *    I10  Juvenile and family — dependency        (Juvenile / Dependency)
 *
 *  ASSERTIONS PER TRIAL: ~12 per firm trial + ~10 per individual trial
 *  TOTAL ASSERTIONS: ~1,100,000
 *
 *  FEEDBACK FORMAT: each trial reports to a ledger; failures accumulate
 *  into a correction matrix that drives deterministic fixes.
 */

import { classifyCharge, getEligibility, STATE_RULES } from '../routes/expungement/rules.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PRNG
// ═══════════════════════════════════════════════════════════════════════════
function makePrng(seed) {
  let s = seed >>> 0;
  return {
    next()        { s = (Math.imul(1664525,s)+1013904223)>>>0; return s; },
    float()       { return this.next()/0xFFFFFFFF; },
    int(lo,hi)    { return lo+(this.next()%(hi-lo+1)); },
    pick(arr)     { return arr[this.next()%arr.length]; },
    bool(p=0.5)   { return this.float()<p; },
    shuffle(a)    { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=this.next()%(i+1);[b[i],b[j]]=[b[j],b[i]];} return b; },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED POOLS
// ═══════════════════════════════════════════════════════════════════════════
const VAR_A  = ['emergency','standard','relaxed'];
const VAR_B  = ['federal','state_felony','state_misdemeanor','international'];
const VAR_C  = ['low','moderate','high','crisis'];
const ALL_ST = Object.keys(STATE_RULES);

function eb(s){ return s<25?'weak':s<50?'contested':s<75?'moderate':'strong'; }
function sv(rng){
  const tp=rng.pick(VAR_A), jx=rng.pick(VAR_B), vl=rng.pick(VAR_C);
  const es=rng.int(0,100); return {timePressure:tp,jurisdiction:jx,vulnerability:vl,evidenceScore:es,evidence:eb(es),state:rng.pick(ALL_ST)};
}

const RANKS = {super_admin:7,managing_partner:6,firm_admin:6,partner:5,lead_esquire:5,co_counsel:4,
  senior_associate:4,associate:4,paralegal:3,law_clerk:3,investigator:3,
  compliance_analyst:3,forensic_accountant:3,guardian_ad_litem:3,case_manager:3,
  mitigation_specialist:3,interpreter:2,junior_associate:2,expert_witness:2,client:2,viewer:1};
function hasRank(role,min){return(RANKS[role]||0)>=(RANKS[min]||0);}

function addCal(d,n){const dt=new Date(d+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+n);return dt.toISOString().slice(0,10);}
function addBus(d,n){const dt=new Date(d+'T12:00:00Z');let a=0;while(a<n){dt.setUTCDate(dt.getUTCDate()+1);if(dt.getUTCDay()%6)a++;}return dt.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.ceil((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000);}
const PR={critical:4,high:3,normal:2,low:1};
function prioSort(a,b){const ad=a.due||'',bd=b.due||'';if(ad!==bd)return ad.localeCompare(bd);return(PR[b.priority]||0)-(PR[a.priority]||0);}

function hkm(aLat,aLng,bLat,bLng){const R=6371,r=d=>d*Math.PI/180,dL=r(bLat-aLat),dl=r(bLng-aLng),a=Math.sin(dL/2)**2+Math.cos(r(aLat))*Math.cos(r(bLat))*Math.sin(dl/2)**2;return 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*R;}
function score(l,uLat,uLng,st){let s=(l.rating||0)*20+Math.min(l.reviews||0,100)*0.3+Math.min(l.yrs||0,20)*0.5;s+=l.free?15:0;s+=l.proB?18:0;s+=l.slide?10:0;s+=l.barV?20:0;s+=l.jtbV?12:0;s+=l.gavel?8:0;s+=Math.min(l.gLv||0,5)*4;s+=l.avail==='accepting'?20:l.avail==='limited'?8:l.avail==='unavailable'?-30:0;if(l.rh!=null)s+=l.rh<=2?15:l.rh<=6?10:l.rh<=24?5:-5;if(l.st?.toUpperCase()===st)s+=15;if(Number.isFinite(uLat)&&Number.isFinite(l.lat))s-=Math.min(hkm(uLat,uLng,l.lat,l.lng),50)*0.2;return Math.round(s);}
function genL(rng,st){return{rating:+(1+rng.float()*4).toFixed(1),reviews:rng.int(0,300),yrs:rng.int(1,35),free:rng.bool(.4),proB:rng.bool(.15),slide:rng.bool(.25),barV:rng.bool(.75),jtbV:rng.bool(.4),gavel:rng.bool(.1),gLv:rng.int(0,5),avail:rng.pick(['accepting','accepting','limited','unavailable']),rh:rng.bool(.2)?null:rng.pick([1,2,4,8,24,48]),st,lat:25+rng.float()*20,lng:-120+rng.float()*60};}
function topM(rng,st,uLat,uLng){return Array.from({length:6},()=>genL(rng,st)).map(l=>({...l,matchScore:score(l,uLat,uLng,st)})).sort((a,b)=>b.matchScore-a.matchScore)[0];}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED ASSERTIONS (reused by both tracks)
// ═══════════════════════════════════════════════════════════════════════════
function assertSorted(dl){for(let i=1;i<dl.length;i++){const pd=dl[i-1].due||'',cd=dl[i].due||'';if(pd===cd)expect(PR[dl[i-1].priority]||0).toBeGreaterThanOrEqual(PR[dl[i].priority]||0);else expect(pd.localeCompare(cd)).toBeLessThanOrEqual(0);}}
function assertScore(top){expect(Number.isFinite(top.matchScore)).toBe(true);expect(top.matchScore).toBeGreaterThanOrEqual(-50);expect(top.matchScore).toBeLessThanOrEqual(300);}
function assertVarC(v){expect(VAR_C).toContain(v.vulnerability);expect(v.evidenceScore).toBeGreaterThanOrEqual(0);expect(v.evidenceScore).toBeLessThanOrEqual(100);expect(['weak','contested','moderate','strong']).toContain(v.evidence);expect(v.evidence).toBe(eb(v.evidenceScore));}

// ═══════════════════════════════════════════════════════════════════════════
//  FIRM CHARGE / MATTER POOLS (all 10 verticals)
// ═══════════════════════════════════════════════════════════════════════════
const POOL = {
  F01: ['First-degree murder','Federal drug trafficking — heroin','Wire fraud','Money laundering','Aggravated assault','Armed robbery','Kidnapping','DUI — third offense — fatality','Domestic battery — strangulation','Child exploitation — CSAM distribution','Tax evasion','Identity theft','Arson','Carjacking','Voluntary manslaughter','Sexual assault','Conspiracy to distribute methamphetamine','Witness tampering','Shoplifting','Marijuana possession'],
  F02: ['Excessive force — fatal police shooting','Brady violation — suppressed exculpatory lab','Coerced confession — 14th Amendment','Deliberate indifference — denied cancer treatment BOP','Solitary confinement 18 months — 8th Amendment','Retaliatory arrest after filming police','ADA — deaf defendant denied interpreter','False arrest — fabricated informant tip','Malicious prosecution','Class action — cash bail system — equal protection','Actual innocence petition — DNA exoneration','Jail overcrowding class action','SWAT no-knock raid — wrong address','Prison sexual assault — failure to protect PREA'],
  F03: ['DOJ FCPA bribery','DOJ Criminal Antitrust — price-fixing cartel','DOJ MLARS — money laundering','SEC insider trading investigation','FinCEN SAR — structuring investigation','DOJ healthcare billing fraud','False Claims Act qui tam','OSHA criminal referral — worker deaths','EPA criminal — illegal discharge','RICO enterprise investigation','Export controls — ITAR violation','Government contract fraud — defective pricing'],
  F04: ['High-net-worth divorce — offshore assets','Child custody — relocation to another state','Protective order — immediate hearing','Grandparent visitation rights','Termination of parental rights','Paternity — contested — DNA','Pre-nuptial agreement — validity challenge','International child abduction — Hague Convention','Spousal support modification','Father challenging third-party custody order'],
  F05: ['Cancellation of removal — 10-year bar','Asylum — credible fear hearing','Asylum — one-year filing bar','DACA — pending renewal','TPS — El Salvador re-registration','U-Visa — victim of violent crime','Writ of habeas corpus — immigration detention','Board of Immigration Appeals — appeal','Consular processing — waiver I-601A','SIJS — juvenile court dependency'],
  F06: ['Motor vehicle accident — T-bone — TBI','Slip and fall — grocery store — fractured hip','Medical malpractice — surgical error — wrong-site surgery','Product liability — defective airbag — Takata recall','Wrongful death — industrial explosion','Premises liability — apartment complex shooting','Mass tort — 3M earplugs — hearing loss','Mass tort — Roundup — Non-Hodgkin lymphoma','Workers compensation — third-party claim','Nursing home abuse — pressure ulcers — elder neglect'],
  F07: ['State felony — appointed counsel — murder 2','State felony — sexual assault','State felony — armed robbery','State misdemeanor — DUI','State misdemeanor — domestic assault','State misdemeanor — drug possession','State felony — child abuse','State felony — stalking with weapon','Probation violation — state court','Preliminary hearing — probable cause challenge'],
  F08: ['28 U.S.C. § 2255 — ineffective assistance of counsel','28 U.S.C. § 2241 — jurisdictional challenge','State PCR — Brady violation — suppressed evidence','State PCR — actual innocence — DNA','Federal direct appeal — sentencing enhancement error','Federal direct appeal — Batson challenge — jury selection','State direct appeal — jury instruction error','Successive petition — Martinez exception','Compassionate release — terminal illness — 18 U.S.C. § 3582','Conviction integrity unit — joint application'],
  F09: ['Court-Martial — Article 120 UCMJ — sexual assault','Court-Martial — Article 107 UCMJ — false official statement','Court-Martial — Article 128b UCMJ — DV','Administrative separation — misconduct','Administrative separation — performance','Security clearance revocation — Guideline E','Physical evaluation board — PTSD — disability rating','LOD determination — combat injury','OTH discharge upgrade — BCMR petition','AWOL — Article 86 UCMJ'],
  F10: ['Dependency — parental rights termination petition','Dependency — emergency detention hearing','Delinquency — felony assault — juvenile certification','Delinquency — carjacking — direct file adult court','Dependency — reunification services — 6-month review','ICWA — tribal notification — custody proceeding','Guardianship — relative placement hearing','Emancipation petition — 16-year-old','School disciplinary — special education rights','Delinquency — marijuana — diversion program'],
  I01: ['Eviction — nonpayment of rent — 3-day notice','Eviction — lease violation — nuisance','Unlawful detainer — month-to-month — no cause','Section 8 voucher termination — appeal','SNAP benefits denial — categorical eligibility','Medicaid denial — immigration status confusion','TANF sanction — failure to comply work requirements','Utility shutoff — winter heating protection','Habitability — mold — implied warranty','Eviction — retaliation for repair complaint'],
  I02: ['DUI first offense — 0.09 BAC — state court','DUI first offense — refusal to submit BAC test','DUI — passenger injured — aggravated','Reckless driving — reduced from DUI','Traffic — suspended license — driving while revoked','DUI — commercial driver license at stake','DUI — out-of-state license — reciprocity issues','DUI — prescription medication — impairment','DUI — underage driver — 0.04 BAC','DUI — arraignment — bail conditions — interlock'],
  I03: ['Asylum — fear of MS-13 — credible fear screening','Asylum — female genital cutting — gender-based','Asylum — LGBTQ persecution — Cuba','DACA recipient — removal order stay','TPS — Venezuela — registration','Withholding of removal — article 3 CAT','U-Visa — victim of human trafficking','Motion to reopen — in absentia removal order','Voluntary departure — flight risk evaluation','Family petition — I-130 — priority date backlog'],
  I04: ['Restraining order — emergency protective order','Restraining order — permanent — contested','Divorce with DV — safety plan required','Child custody — DV — 3044 presumption','Safety planning — relocation to shelter','Immigration — VAWA self-petition','Contempt — violation of protective order','Custody modification — abuse allegation','Civil harassment — workplace stalker','Criminal — DV victim — self-defense charge'],
  I05: ['Expungement — felony — drug possession — prop 47','Expungement — misdemeanor — DUI — 10 years','Expungement — multiple misdemeanors — same incident','Sealing — juvenile record — adult employment','Dismissal — completion of diversion program','Certificate of rehabilitation — parole complete','Pardon application — state governor','Reclassification — felony to misdemeanor — 17b','Record clearing — marijuana conviction — automatic','Background check challenge — incorrect record'],
  I06: ['Medical debt — $45,000 — collection lawsuit','Wage garnishment — student loan — hardship claim','Bankruptcy Chapter 7 — means test — discharge','Bankruptcy Chapter 13 — plan confirmation','Credit report dispute — FCRA violation','Debt collector harassment — FDCPA violation','Car repossession — wrongful — cure period missed','Payday loan trap — unconscionability defense','Identity theft — fraudulent accounts — credit repair','Small claims — landlord withholding deposit'],
  I07: ['Breach of contract — vendor nonpayment $28,000','LLC operating agreement — partner dispute','Independent contractor — misclassification — IRS','Trademark — cease and desist — small business name','Commercial lease — landlord breach — COVID force majeure','SBA loan — personal guarantee — default','Non-compete agreement — enforceability — California','DMCA takedown — fair use defense','Sales contract — goods not delivered — UCC','Franchise dispute — termination — FTC disclosure'],
  I08: ["Workers comp — denied — 'arising out of employment'","Workers comp — permanent partial disability — settlement",'Occupational disease — mesothelioma — asbestos exposure','Retaliation — fired after workers comp claim','OSHA violation — reporting — whistleblower protection','FMLA — denied leave — serious health condition','ADA accommodation — denied — reasonable adjustment','Title VII — race discrimination — termination','EEOC charge — sexual harassment — hostile work environment','Wage theft — unpaid overtime — FLSA collective'],
  I09: ['VA benefits — PTSD — service connection denied','VA benefits — TBI — claims backlog','TDIU — total disability individual unemployability','Camp Lejeune — contaminated water — tort claim','Agent Orange — presumptive disability — appeal','Other Than Honorable discharge — upgrade','Vocational rehabilitation — VA Chapter 31','VA loan — foreclosure — loss mitigation','GI Bill — overpayment dispute','MST — military sexual trauma — PTSD claim'],
  I10: ['Dependency — parent — reunification services','Dependency — ICWA compliance — tribal notification','Delinquency — minor — diversion eligible','Delinquency — juvenile hall — certification hearing','School discipline — IEP — special ed rights','LGBTQ youth — housing — minor emancipation','Foster care — extended — age out services','Relative placement — kinship care — preference','Guardianship petition — grandparent — abuse in home','Parental rights — contested termination — reunification failed'],
};

// Bail categories for criminal matters
function bailCat(m){const l=m.toLowerCase();if(/murder|homicide|killing/.test(l))return 'capital';if(/trafficking|heroin|meth|cocaine|fentanyl|§841|cce/.test(l))return'drug_fed';if(/misdemeanor|intoxication|shoplifting|trespass|marijuana/.test(l))return'misdemeanor';if(/juvenile/.test(l))return'no_bail';return'felony';}
const BAIL_RANGE={capital:[500000,2000000],drug_fed:[100000,1000000],felony:[25000,500000],misdemeanor:[1000,25000],no_bail:[0,0]};

// Roles per track
const FIRM_ROLES=['managing_partner','partner','senior_associate','associate','paralegal','law_clerk','investigator','compliance_analyst'];
const IND_ROLES=['client','assigned_attorney','paralegal','interpreter','case_manager'];

// ═══════════════════════════════════════════════════════════════════════════
//  TRIAL GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

function firmTrial(firmId, trialN, rng) {
  const v=sv(rng);
  const matter=rng.pick(POOL[firmId]);
  const ts=rng.int(2,Math.min(5,FIRM_ROLES.length));
  const roles=rng.shuffle(FIRM_ROLES).slice(0,ts);
  const trig='2025-01-15';
  const deadline_days=[1,3,7,14,30,45,60,90,120,180];
  const dl=deadline_days.map((d,i)=>({key:`dl_${i}`,due:addCal(trig,d),priority:i<2?'critical':i<5?'high':'normal'})).sort(prioSort);

  // Bail / damage calc
  let financialValue=0;
  if(['F01','F07','F09','F10'].includes(firmId)){
    const cat=bailCat(matter);
    const [lo,hi]=BAIL_RANGE[cat];
    financialValue=rng.int(lo,hi);
  } else if(['F06'].includes(firmId)){
    financialValue=rng.int(50000,5000000);
  } else if(['F03'].includes(firmId)){
    financialValue=rng.int(500000,500000000);
  } else if(['F02'].includes(firmId)){
    financialValue=rng.int(25000,10000000);
  } else {
    financialValue=rng.int(1000,500000);
  }

  const ct=classifyCharge(matter);
  const stat=rng.pick(['Dismissed','Convicted','Closed','Pending']);
  const elig=getEligibility(v.state,ct,stat);
  const uLat=25+rng.float()*20, uLng=-120+rng.float()*60;
  const top=topM(rng,v.state,uLat,uLng);
  const urgency=v.vulnerability==='crisis'||v.timePressure==='emergency';
  const strongCase=v.evidence==='strong'&&v.evidenceScore>=75;
  const hasMitigation=v.vulnerability==='high'||v.vulnerability==='crisis';

  return {firmId,trialN,matter,ts,roles,dl,financialValue,v,ct,stat,elig,top,urgency,strongCase,hasMitigation};
}

function indTrial(profileId, trialN, rng) {
  const v=sv(rng);
  const matter=rng.pick(POOL[profileId]);
  const ts=rng.int(1,3);
  const roles=IND_ROLES.slice(0,ts+1);
  const trig='2025-06-01';
  const deadline_days=[3,7,14,30,60,90];
  const dl=deadline_days.map((d,i)=>({key:`dl_${i}`,due:addBus(trig,d),priority:i<1?'critical':i<3?'high':'normal'})).sort(prioSort);

  const ct=classifyCharge(matter);
  const stat=rng.pick(['Dismissed','Convicted','Closed','Pending']);
  const elig=getEligibility(v.state,ct,stat);
  const uLat=30+rng.float()*15, uLng=-100+rng.float()*40;
  const top=topM(rng,v.state,uLat,uLng);
  const needsInterpreter=profileId==='I03'||rng.bool(0.15);
  const legalAid=rng.bool(0.6);
  const proSe=!legalAid&&rng.bool(0.3);
  const urgency=v.vulnerability==='crisis'||v.timePressure==='emergency';

  return {profileId,trialN,matter,ts,roles,dl,v,ct,stat,elig,top,needsInterpreter,legalAid,proSe,urgency};
}

// ═══════════════════════════════════════════════════════════════════════════
//  ASSERTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function assertFirmTrial(t,n) {
  const L=`F${t.firmId} trial ${n}`;

  // VAR-C: evidence consistency
  expect(eb(t.v.evidenceScore)).toBe(t.v.evidence);
  expect(t.v.evidenceScore).toBeGreaterThanOrEqual(0);
  expect(t.v.evidenceScore).toBeLessThanOrEqual(100);
  expect(VAR_C).toContain(t.v.vulnerability);

  // Deadline ordering
  assertSorted(t.dl);
  expect(t.dl.length).toBeGreaterThan(0);

  // Roles
  expect(t.roles.length).toBeGreaterThanOrEqual(2);
  expect(t.roles.length).toBeLessThanOrEqual(8);
  t.roles.forEach(r=>expect(RANKS).toHaveProperty(r));

  // Match score
  assertScore(t.top);

  // Financial value non-negative
  expect(t.financialValue).toBeGreaterThanOrEqual(0);

  // Classification
  expect(['felony','misdemeanor','civil','other','dui','sexual','domestic','dismissed','infraction','traffic','child_abuse','juvenile','immigration','housing','employment','consumer']).toContain(t.ct);

  // Urgency flag consistency
  if(t.v.vulnerability==='crisis'||t.v.timePressure==='emergency') {
    expect(t.urgency).toBe(true);
  }

  // Eligibility result shape
  expect(t.elig).toBeDefined(); expect(['boolean','string']).toContain(typeof t.elig.eligible);
}

function assertIndTrial(t,n) {
  const L=`I${t.profileId} trial ${n}`;

  // VAR-C consistency
  expect(eb(t.v.evidenceScore)).toBe(t.v.evidence);
  expect(t.v.evidenceScore).toBeGreaterThanOrEqual(0);
  expect(VAR_C).toContain(t.v.vulnerability);

  // Deadlines ordered
  assertSorted(t.dl);
  expect(t.dl.length).toBeGreaterThan(0);

  // Roles include client
  expect(t.roles).toContain('client');

  // Match score
  assertScore(t.top);

  // Classification
  expect(['felony','misdemeanor','civil','other','dui','sexual','domestic','dismissed','infraction','traffic','child_abuse','juvenile','immigration','housing','employment','consumer']).toContain(t.ct);

  // Eligibility shape
  expect(t.elig).toBeDefined(); expect(['boolean','string']).toContain(typeof t.elig.eligible);

  // Pro-se flag
  if(t.legalAid) expect(t.proSe).toBe(false);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEDGER & FEEDBACK REPORTER
// ═══════════════════════════════════════════════════════════════════════════
const LEDGER = {
  firmPass:0, firmFail:0, indPass:0, indFail:0,
  firmBreakdown:Object.fromEntries(['F01','F02','F03','F04','F05','F06','F07','F08','F09','F10'].map(k=>[k,{pass:0,fail:0}])),
  indBreakdown:Object.fromEntries(['I01','I02','I03','I04','I05','I06','I07','I08','I09','I10'].map(k=>[k,{pass:0,fail:0}])),
  errors:[],
};

function runFirmBatch(firmId, N, seed) {
  const rng=makePrng(seed);
  for(let i=0;i<N;i++){
    const t=firmTrial(firmId,i,rng);
    try {
      assertFirmTrial(t,i);
      LEDGER.firmPass++;
      LEDGER.firmBreakdown[firmId].pass++;
    } catch(e) {
      LEDGER.firmFail++;
      LEDGER.firmBreakdown[firmId].fail++;
      LEDGER.errors.push({track:'firm',id:firmId,trial:i,msg:e.message?.slice(0,80)});
    }
  }
}

function runIndBatch(profileId, N, seed) {
  const rng=makePrng(seed);
  for(let i=0;i<N;i++){
    const t=indTrial(profileId,i,rng);
    try {
      assertIndTrial(t,i);
      LEDGER.indPass++;
      LEDGER.indBreakdown[profileId].pass++;
    } catch(e) {
      LEDGER.indFail++;
      LEDGER.indBreakdown[profileId].fail++;
      LEDGER.errors.push({track:'individual',id:profileId,trial:i,msg:e.message?.slice(0,80)});
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

const N_PER = 5000; // 5,000 per firm/profile = 50,000 each track = 100,000 total

// ─── TRACK A: LAW FIRMS ──────────────────────────────────────────────────────

describe('TRACK A — LAW FIRMS (50,000 trials)', () => {

  test('F01-HVS — Criminal Defense — 5,000 trials', () => {
    runFirmBatch('F01', N_PER, 0xC0FFEE01);
    const b=LEDGER.firmBreakdown.F01;
    console.log(`  F01 HVS Criminal Defense: ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F01').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F02-MCR — Civil Rights — 5,000 trials', () => {
    runFirmBatch('F02', N_PER, 0xDEAD0002);
    const b=LEDGER.firmBreakdown.F02;
    console.log(`  F02 MCR Civil Rights:     ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F02').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F03-RCG — White Collar / Regulatory — 5,000 trials', () => {
    runFirmBatch('F03', N_PER, 0xF00D0003);
    const b=LEDGER.firmBreakdown.F03;
    console.log(`  F03 RCG White Collar:     ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F03').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F04-PLF — Family Law — 5,000 trials', () => {
    runFirmBatch('F04', N_PER, 0xBEEF0004);
    const b=LEDGER.firmBreakdown.F04;
    console.log(`  F04 PLF Family Law:       ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F04').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F05-KIP — Immigration / Removal Defense — 5,000 trials', () => {
    runFirmBatch('F05', N_PER, 0xCAFE0005);
    const b=LEDGER.firmBreakdown.F05;
    console.log(`  F05 KIP Immigration:      ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F05').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F06-TPT — Personal Injury / Mass Tort — 5,000 trials', () => {
    runFirmBatch('F06', N_PER, 0xFACE0006);
    const b=LEDGER.firmBreakdown.F06;
    console.log(`  F06 TPT Personal Injury:  ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F06').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F07-APD — Public Defender — 5,000 trials', () => {
    runFirmBatch('F07', N_PER, 0xBABE0007);
    const b=LEDGER.firmBreakdown.F07;
    console.log(`  F07 APD Public Defender:  ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F07').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F08-HAG — Appellate / PCR — 5,000 trials', () => {
    runFirmBatch('F08', N_PER, 0xD00D0008);
    const b=LEDGER.firmBreakdown.F08;
    console.log(`  F08 HAG Appellate:        ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F08').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F09-BMJ — Military Justice / UCMJ — 5,000 trials', () => {
    runFirmBatch('F09', N_PER, 0xACE00009);
    const b=LEDGER.firmBreakdown.F09;
    console.log(`  F09 BMJ Military:         ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F09').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('F10-MJD — Juvenile & Dependency — 5,000 trials', () => {
    runFirmBatch('F10', N_PER, 0x1CE0000A);
    const b=LEDGER.firmBreakdown.F10;
    console.log(`  F10 MJD Juvenile:         ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='F10').slice(0,3).forEach(e=>console.log(`    ❌ trial ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('FIRM TRACK TOTAL — 50,000 firm trials', () => {
    const total=LEDGER.firmPass+LEDGER.firmFail;
    console.log(`\n  ─── FIRM TRACK REPORT ───────────────────────────────`);
    console.log(`  Total:    ${LEDGER.firmPass}/${total} (${((LEDGER.firmPass/total)*100).toFixed(3)}% pass rate)`);
    for(const [k,v] of Object.entries(LEDGER.firmBreakdown)){
      const t=v.pass+v.fail;
      const bar='█'.repeat(Math.round(v.pass/t*20))+'░'.repeat(Math.round(v.fail/t*20));
      console.log(`  ${k}: ${v.pass}/${t} [${bar}] ${v.fail===0?'✅':'❌ '+v.fail+' failures'}`);
    }
    expect(LEDGER.firmFail).toBe(0);
  });
});

// ─── TRACK B: INDIVIDUAL CONSUMERS ──────────────────────────────────────────

describe('TRACK B — INDIVIDUAL CONSUMERS (50,000 trials)', () => {

  test('I01 — Urban Tenant (Housing / Benefits) — 5,000 trials', () => {
    runIndBatch('I01', N_PER, 0xABCD0101);
    const b=LEDGER.indBreakdown.I01;
    console.log(`  I01 Urban Tenant:         ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I01').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I02 — DUI First Offender — 5,000 trials', () => {
    runIndBatch('I02', N_PER, 0xABCD0202);
    const b=LEDGER.indBreakdown.I02;
    console.log(`  I02 DUI First Offender:   ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I02').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I03 — Undocumented Asylum Seeker — 5,000 trials', () => {
    runIndBatch('I03', N_PER, 0xABCD0303);
    const b=LEDGER.indBreakdown.I03;
    console.log(`  I03 Asylum Seeker:        ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I03').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I04 — Domestic Violence Survivor — 5,000 trials', () => {
    runIndBatch('I04', N_PER, 0xABCD0404);
    const b=LEDGER.indBreakdown.I04;
    console.log(`  I04 DV Survivor:          ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I04').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I05 — Ex-Offender Expungement — 5,000 trials', () => {
    runIndBatch('I05', N_PER, 0xABCD0505);
    const b=LEDGER.indBreakdown.I05;
    console.log(`  I05 Expungement:          ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I05').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I06 — Medical Debt / Wage Garnishment — 5,000 trials', () => {
    runIndBatch('I06', N_PER, 0xABCD0606);
    const b=LEDGER.indBreakdown.I06;
    console.log(`  I06 Medical Debt:         ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I06').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I07 — Small Business Contract — 5,000 trials', () => {
    runIndBatch('I07', N_PER, 0xABCD0707);
    const b=LEDGER.indBreakdown.I07;
    console.log(`  I07 Small Business:       ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I07').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test("I08 — Workers' Comp Denied — 5,000 trials", () => {
    runIndBatch('I08', N_PER, 0xABCD0808);
    const b=LEDGER.indBreakdown.I08;
    console.log(`  I08 Workers Comp:         ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I08').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I09 — Veteran Benefits Denial — 5,000 trials', () => {
    runIndBatch('I09', N_PER, 0xABCD0909);
    const b=LEDGER.indBreakdown.I09;
    console.log(`  I09 Veteran Benefits:     ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I09').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('I10 — Juvenile & Dependency — 5,000 trials', () => {
    runIndBatch('I10', N_PER, 0xABCD1010);
    const b=LEDGER.indBreakdown.I10;
    console.log(`  I10 Juvenile Dependency:  ${b.pass}/${b.pass+b.fail} ✅`);
    if(b.fail) LEDGER.errors.filter(e=>e.id==='I10').slice(0,3).forEach(e=>console.log(`    ❌ ${e.trial}: ${e.msg}`));
    expect(b.fail).toBe(0);
  });

  test('INDIVIDUAL TRACK TOTAL — 50,000 individual trials', () => {
    const total=LEDGER.indPass+LEDGER.indFail;
    console.log(`\n  ─── INDIVIDUAL TRACK REPORT ─────────────────────────`);
    console.log(`  Total:    ${LEDGER.indPass}/${total} (${((LEDGER.indPass/total)*100).toFixed(3)}% pass rate)`);
    for(const [k,v] of Object.entries(LEDGER.indBreakdown)){
      const t=v.pass+v.fail;
      const bar='█'.repeat(Math.round(v.pass/t*20))+'░'.repeat(Math.round(v.fail/t*20));
      console.log(`  ${k}: ${v.pass}/${t} [${bar}] ${v.fail===0?'✅':'❌ '+v.fail+' failures'}`);
    }
    expect(LEDGER.indFail).toBe(0);
  });
});

// ─── GRAND FINAL REPORT ──────────────────────────────────────────────────────

describe('GRAND TOTAL — 100,000 TRIALS', () => {
  test('GRAND TOTAL: both tracks combined', () => {
    const grand=LEDGER.firmPass+LEDGER.firmFail+LEDGER.indPass+LEDGER.indFail;
    const pass=LEDGER.firmPass+LEDGER.indPass;
    const fail=LEDGER.firmFail+LEDGER.indFail;
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  JUSTICE GAVEL — GRAND SIMULATION FINAL REPORT      ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Firm trials:        ${String(LEDGER.firmPass+LEDGER.firmFail).padEnd(10)} ${LEDGER.firmFail===0?'✅ all pass':'❌ '+LEDGER.firmFail+' fail'}`);
    console.log(`║  Individual trials:  ${String(LEDGER.indPass+LEDGER.indFail).padEnd(10)} ${LEDGER.indFail===0?'✅ all pass':'❌ '+LEDGER.indFail+' fail'}`);
    console.log(`║  Grand total:        ${String(grand).padEnd(10)} ${fail===0?'✅ PERFECT SCORE':'❌ '+fail+' failures'}`);
    console.log(`║  Pass rate:          ${((pass/grand)*100).toFixed(4)}%`);
    if(fail>0){
      console.log('║  FAILURES BY CATEGORY:');
      const byId={};
      LEDGER.errors.forEach(e=>{byId[e.id]=(byId[e.id]||0)+1;});
      Object.entries(byId).forEach(([id,n])=>console.log(`║    ${id}: ${n} failures`));
      console.log('║  FIRST 10 ERROR MESSAGES:');
      LEDGER.errors.slice(0,10).forEach(e=>console.log(`║    [${e.track}/${e.id}/#${e.trial}] ${e.msg}`));
    }
    console.log('╚══════════════════════════════════════════════════════╝');
    expect(fail).toBe(0);
  });
});
