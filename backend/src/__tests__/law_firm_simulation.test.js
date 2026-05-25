/**
 * law_firm_simulation.test.js — Ten Law Firm Types × 300 Trials = 3,000 Cases
 *
 * FIRM 1  HVS — Harrington Voss & Slate LLP       (Criminal Defense)      0xC0FFEE01
 * FIRM 2  MCR — McDermott Civil Rights             (§ 1983 / Civil Rights) 0xDEAD0002
 * FIRM 3  RCG — Regent Compliance Group PC         (White-Collar / Reg)    0xF00D0003
 * FIRM 4  PLF — Pellegrino Family Law Center       (Family Law)            0xBEEF0004
 * FIRM 5  KIP — Kessler Immigration Partners       (Removal Defense)       0xCAFE0005
 * FIRM 6  TPT — Thornwald PI & Mass Tort           (Personal Injury)       0xFACE0006
 * FIRM 7  APD — Axiom Public Defense Consortium    (Public Defender)       0xBABE0007
 * FIRM 8  HAG — Halcyon Appellate Group            (Appellate / PCR)       0xD00D0008
 * FIRM 9  BMJ — Blackrock Military Justice LLC     (UCMJ / Military)       0xACE00009
 * FIRM 10 MJD — Meridian Juvenile & Dependency     (Juvenile / Dependency) 0x1CE0000A
 *
 * Variables tested across ALL firms:
 *   VAR-A — Time pressure:         emergency / standard / relaxed
 *   VAR-B — Jurisdiction:          federal / state_felony / state_misdemeanor / international
 *   VAR-C — Client vulnerability:  low / moderate / high / crisis
 *   VAR-D — Evidence quality:      0–100 integer → weak/contested/moderate/strong
 */

import { classifyCharge, getEligibility, STATE_RULES } from '../routes/expungement/rules.js';

// ─── PRNG (LCG) ──────────────────────────────────────────────────────────────
function makePrng(seed) {
  let s = seed >>> 0;
  return {
    next()        { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s; },
    float()       { return this.next() / 0xFFFFFFFF; },
    int(lo, hi)   { return lo + (this.next() % (hi - lo + 1)); },
    pick(arr)     { return arr[this.next() % arr.length]; },
    bool(p = 0.5) { return this.float() < p; },
  };
}

// ─── SHARED VARIABLE POOLS ───────────────────────────────────────────────────
const VAR_A = ['emergency', 'standard', 'relaxed'];
const VAR_B = ['federal', 'state_felony', 'state_misdemeanor', 'international'];
const VAR_C = ['low', 'moderate', 'high', 'crisis'];
const ALL_STATES = Object.keys(STATE_RULES);

function evidenceBucket(s) {
  return s < 25 ? 'weak' : s < 50 ? 'contested' : s < 75 ? 'moderate' : 'strong';
}

function sampleVars(rng) {
  const timePressure  = rng.pick(VAR_A);
  const jurisdiction  = rng.pick(VAR_B);
  const vulnerability = rng.pick(VAR_C);
  const evidenceScore = rng.int(0, 100);
  const evidence      = evidenceBucket(evidenceScore);
  const state         = rng.pick(ALL_STATES);
  return { timePressure, jurisdiction, vulnerability, evidenceScore, evidence, state };
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────
const RANKS = {
  super_admin:7, firm_admin:6, partner:5, lead_esquire:5,
  co_counsel:4, senior_associate:4, associate:4,
  paralegal:3, law_clerk:3, investigator:3, compliance_analyst:3,
  forensic_accountant:3, guardian_ad_litem:3, case_manager:3, mitigation_specialist:3,
  interpreter:2, junior_associate:2, expert_witness:2, client:2, viewer:1,
};
function hasMinRank(role, min) { return (RANKS[role]||0) >= (RANKS[min]||0); }

// ─── DATE UTILITIES ───────────────────────────────────────────────────────────
function addCal(d, n) {
  const dt = new Date(d + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function addBus(d, n) {
  const dt = new Date(d + 'T12:00:00Z'); let a = 0;
  while (a < n) { dt.setUTCDate(dt.getUTCDate()+1); if (dt.getUTCDay()%6) a++; }
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.ceil((new Date(b+'T12:00:00Z') - new Date(a+'T12:00:00Z')) / 86400000);
}

// ─── PRIO SORT ────────────────────────────────────────────────────────────────
const PR = { critical:4, high:3, normal:2, low:1 };
function prioSort(a, b) {
  const ad = a.due||a.due_date||'', bd = b.due||b.due_date||'';
  if (ad !== bd) return ad.localeCompare(bd);
  return (PR[b.priority]||0) - (PR[a.priority]||0);
}

// ─── HAVERSINE ────────────────────────────────────────────────────────────────
function hkm(aLat, aLng, bLat, bLng) {
  const R=6371, r=d=>d*Math.PI/180,
    dL=r(bLat-aLat), dl=r(bLng-aLng),
    a=Math.sin(dL/2)**2+Math.cos(r(aLat))*Math.cos(r(bLat))*Math.sin(dl/2)**2;
  return 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*R;
}

// ─── MATCH SCORE ──────────────────────────────────────────────────────────────
function score(l, uLat, uLng, st) {
  let s = (l.rating||0)*20 + Math.min(l.reviews||0,100)*0.3 + Math.min(l.yrs||0,20)*0.5;
  s += l.free?15:0; s += l.proB?18:0; s += l.slide?10:0;
  s += l.barV?20:0; s += l.jtbV?12:0; s += l.gavel?8:0;
  s += Math.min(l.gLv||0,5)*4;
  s += l.avail==='accepting'?20: l.avail==='limited'?8: l.avail==='unavailable'?-30:0;
  if (l.rh!=null) s += l.rh<=2?15: l.rh<=6?10: l.rh<=24?5:-5;
  if (l.st?.toUpperCase()===st) s += 15;
  if (Number.isFinite(uLat)&&Number.isFinite(l.lat))
    s -= Math.min(hkm(uLat,uLng,l.lat,l.lng),50)*0.2;
  return Math.round(s);
}
function genLawyer(rng, st) {
  return {
    rating:+(1+rng.float()*4).toFixed(1), reviews:rng.int(0,300), yrs:rng.int(1,35),
    free:rng.bool(.4), proB:rng.bool(.15), slide:rng.bool(.25),
    barV:rng.bool(.75), jtbV:rng.bool(.4), gavel:rng.bool(.1), gLv:rng.int(0,5),
    avail:rng.pick(['accepting','accepting','limited','unavailable']),
    rh:rng.bool(.2)?null:rng.pick([1,2,4,8,24,48]), st,
    lat:25+rng.float()*20, lng:-120+rng.float()*60,
  };
}
function topMatch(rng, st, uLat, uLng) {
  return Array.from({length:6},()=>genLawyer(rng,st))
    .map(l=>({...l,matchScore:score(l,uLat,uLng,st)}))
    .sort((a,b)=>b.matchScore-a.matchScore)[0];
}

// ─── SHARED ASSERTIONS ────────────────────────────────────────────────────────
function assertSorted(dl) {
  for (let i=1;i<dl.length;i++) {
    const pd=dl[i-1].due||'', cd=dl[i].due||'';
    if (pd===cd) expect(PR[dl[i-1].priority]||0).toBeGreaterThanOrEqual(PR[dl[i].priority]||0);
    else expect(pd.localeCompare(cd)).toBeLessThanOrEqual(0);
  }
}
function assertScore(top) {
  expect(Number.isFinite(top.matchScore)).toBe(true);
  expect(top.matchScore).toBeGreaterThanOrEqual(-50);
  expect(top.matchScore).toBeLessThanOrEqual(300);
}
function assertVarCD(t) {
  expect(VAR_C).toContain(t.vulnerability);
  expect(t.evidenceScore).toBeGreaterThanOrEqual(0);
  expect(t.evidenceScore).toBeLessThanOrEqual(100);
  expect(['weak','contested','moderate','strong']).toContain(t.evidence);
  expect(t.evidence).toBe(evidenceBucket(t.evidenceScore));
}

// ═════════════════════════════════════════════════════════════════════════════
//  FIRM DATA
// ═════════════════════════════════════════════════════════════════════════════

// ── FIRM 1  HVS Criminal Defense ─────────────────────────────────────────────
const F1_CHG = [
  'First-degree murder with special circumstances',
  'Second-degree murder — domestic homicide',
  'Felony murder during armed robbery',
  'Attempted murder with premeditation',
  'Voluntary manslaughter — heat of passion',
  'Federal drug trafficking — heroin (21 U.S.C. § 841(b)(1)(A))',
  'Conspiracy to distribute methamphetamine (18 U.S.C. § 846)',
  'Operating a continuing criminal enterprise (CCE)',
  'Possession with intent — fentanyl 100g threshold',
  'Wire fraud — telemarketing scheme (18 U.S.C. § 1343)',
  'Bank fraud — mortgage application falsification',
  'Identity theft — 48 victims (18 U.S.C. § 1028A)',
  'Tax evasion — offshore accounts Cayman Islands',
  'Money laundering — real estate smurfing',
  'Aggravated assault with a firearm',
  'Armed robbery — convenience store',
  'Carjacking with firearm interstate (18 U.S.C. § 2119)',
  'Kidnapping — ransom demand (18 U.S.C. § 1201)',
  'Witness tampering — grand jury proceeding',
  'Sexual assault — first degree',
  'Rape — stranger attack with weapon enhancement',
  'Indecent assault — university campus',
  'DUI — third offense — 0.24 BAC — fatality',
  'DUI manslaughter — vehicular homicide',
  'OWI — repeat offender Indiana',
  'Domestic battery — strangulation',
  'Violation of protective order — with assault',
  'Juvenile aggravated assault — certification hearing',
  'Simple assault — misdemeanor battery',
  'Public intoxication — disorderly conduct',
  'Shoplifting — Class A misdemeanor',
  'Marijuana possession — personal use',
  'Trespass — Class B misdemeanor',
  'Child exploitation — CSAM distribution',
  'Class E felony — receiving stolen property',
  'Class F felony — reckless endangerment',
  'Arson — third-degree',
];
const F1_ROLES = ['managing_partner','senior_partner','associate','paralegal','investigator'];
const F1_BAIL  = { capital:[500000,2000000], drug_fed:[100000,1000000], felony:[25000,500000], misdemeanor:[1000,25000], no_bail:[0,0] };
function f1BailCat(c) {
  const l=c.toLowerCase();
  if (/murder|homicide|killing/.test(l))                      return 'capital';
  if (/trafficking|heroin|meth|cocaine|fentanyl|§ 841|cce/.test(l)) return 'drug_fed';
  if (/misdemeanor|intoxication|shoplifting|trespass|marijuana/.test(l)) return 'misdemeanor';
  if (/juvenile/.test(l)) return 'no_bail';
  return 'felony';
}
function f1(n, rng) {
  const v=sampleVars(rng), charge=rng.pick(F1_CHG), ts=rng.int(2,5);
  const roles=F1_ROLES.slice(0,ts), cat=f1BailCat(charge);
  const [lo,hi]=F1_BAIL[cat], bail=rng.int(lo,hi);
  const ct=classifyCharge(charge), stat=rng.pick(['Dismissed','Convicted','Closed','Pending']);
  const elig=getEligibility(v.state,ct,stat), trig='2025-01-15';
  const dl=[
    {key:'bail',        due:addCal(trig,1),  priority:'critical'},
    {key:'arraignment', due:addBus(trig,3),  priority:'critical'},
    {key:'prelim',      due:addCal(trig,14), priority:'high'},
    {key:'speedy',      due:addCal(trig,70), priority:'high'},
    {key:'indictment',  due:addCal(trig,30), priority:'high'},
  ].sort(prioSort);
  const uLat=30+rng.float()*10, uLng=-90+rng.float()*20;
  const top=topMatch(rng,v.state,uLat,uLng);
  const expeditedBail = v.vulnerability==='crisis' && /murder|assault|rape|robbery/.test(charge.toLowerCase());
  const dismissLikely = v.evidence==='weak';
  return {...v,n,charge,ts,roles,cat,bail,ct,stat,elig,dl,top,trig,expeditedBail,dismissLikely};
}

// ── FIRM 2  MCR Civil Rights ──────────────────────────────────────────────────
const F2_MAT = [
  'Excessive force — fatal police shooting during traffic stop (§ 1983)',
  'Tasering of handcuffed suspect — 4th Amendment',
  'K-9 attack — unnecessarily deployed on unarmed misdemeanant',
  'Choke-hold death in custody — qualified immunity challenge',
  'SWAT no-knock raid — wrong address — family killed',
  'Baton beating during protest — 1st/4th Amendment',
  'Actual innocence petition — DNA exoneration 18 years served',
  'Brady violation — suppressed exculpatory lab report',
  'Coerced confession — 14th Amendment due process',
  'False identification — cross-racial eyewitness',
  'Deliberate indifference — denied cancer treatment BOP',
  'Solitary confinement 18 months — 8th Amendment',
  'Inadequate mental health care — jail suicide',
  'Jail overcrowding class action — living conditions',
  'Retaliatory arrest after filming police — 1st Amendment',
  'Religious accommodation denied — Muslim inmate Friday prayer',
  'ADA — deaf defendant denied interpreter at arraignment',
  'Wheelchair inaccessible county jail — Title II',
  'False arrest — fabricated informant tip — 4th Amendment',
  'Malicious prosecution — charges dropped — civil suit',
  'Class action — cash bail system — equal protection',
  'Class action — stop-and-frisk — racial profiling',
  'Class action — prison medical — 8th Amendment systemic',
  'Excessive force on juvenile in school — SRO § 1983',
  'Juvenile strip search — Fourth Amendment',
  'Retaliation against correctional officer whistleblower',
  'SWAT flashbang — innocent bystander — excessive force',
  'Prison sexual assault — failure to protect PREA',
  'Destruction of evidence — police dash-cam footage',
  'Political speech retaliation — probationer book restriction',
];
const F2_ROLES = ['lead_counsel','co_counsel','paralegal','law_clerk','expert_witness'];
const F2_DAM   = ['compensatory_only','compensatory_plus_punitive','nominal','injunctive_only','class_damages'];
const F2_CLS   = ['individual','class_pending','class_certified','class_decertified'];
function f2(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F2_MAT), ts=rng.int(2,5), roles=F2_ROLES.slice(0,ts);
  const damages=rng.pick(F2_DAM), cls=rng.pick(F2_CLS), trig='2025-03-01';
  const filed=addCal(trig,rng.int(10,60));
  const answerDue=addCal(filed,21), classDue=addCal(filed,90), discovDue=addCal(filed,120);
  const solDue=addCal(trig,730);
  const comp=rng.int(50000,5000000), punMul=damages==='compensatory_plus_punitive'?rng.pick([3,5,9]):0;
  const total=comp+comp*punMul, isClass=cls!=='individual';
  const classSize=isClass?rng.int(50,50000):1;
  const classTotal=isClass?total*Math.min(classSize/1000,100):total;
  const uLat=35+rng.float()*10, uLng=-95+rng.float()*20;
  const top=topMatch(rng,v.state,uLat,uLng);
  const emergInj = v.vulnerability==='crisis' && /solitary|medical|suicide|cancer/.test(matter.toLowerCase());
  const earlySet = v.evidence==='strong' && damages!=='injunctive_only';
  return {...v,n,matter,ts,roles,damages,cls,filed,answerDue,classDue,discovDue,solDue,
    comp,punMul,total,isClass,classSize,classTotal,top,trig,emergInj,earlySet};
}

// ── FIRM 3  RCG White-Collar ──────────────────────────────────────────────────
const F3_MAT = [
  'DOJ grand jury — FCPA bribery — West African government officials',
  'DOJ Criminal Antitrust — price-fixing cartel — pharmaceutical generics',
  'DOJ MLARS — real estate money laundering — EB-5 visa fraud',
  'DOJ Fraud Section — healthcare billing fraud — $240M upcoding',
  'DOJ securities — insider trading ring — M&A pre-announcement leaks',
  'DOJ cybercrime — ransomware enterprise — cryptocurrency laundering',
  'DOJ sanctions — OFAC violations — Iran prohibited transactions',
  'DOJ export control — ITAR violations — military-grade drones to China',
  'DOJ PPP fraud — $8M pandemic relief — 12 defendants',
  'SEC Enforcement — Reg FD violation — selective disclosure CFO',
  'SEC Accounting Fraud — revenue recognition manipulation — FinTech',
  'SEC SPAC fraud — misleading projections — de-SPAC merger',
  'FinCEN — Bank Secrecy Act — failing to file SARs',
  'AML program failures — correspondent banking — $150M penalty',
  'Structuring — smurfing deposits to avoid CTR requirements',
  'HHS-OIG — False Claims Act — kickback scheme — orthopedic implants',
  'Stark Law violation — physician self-referral — hospital system',
  'DEA registration revoked — controlled substance diversion',
  'Data breach — GDPR regulatory investigation — EU supervisory authority',
  'SEC cybersecurity disclosure violation — 4-day rule delay',
  'SOX § 302 certification fraud — executive misrepresentation',
  'OFAC SDN — Venezuela oil sanctions — ship-to-ship transfers',
  'FCPA — China state-owned enterprise bribery — medical device',
  'UK Bribery Act — deferred prosecution — compliance program',
  'DOJ Tax — offshore account non-disclosure — FBAR penalty',
  'Employment tax fraud — $3M worker misclassification scheme',
  'FTC Second Request — horizontal merger — pharma generics',
  'Medicare Advantage upcoding — risk adjustment fraud',
  'DOJ environmental — Clean Air Act violations — chemical plant',
  'Board fiduciary breach — shareholder derivative investigation',
];
const F3_ROLES = ['lead_partner','senior_associate','compliance_analyst','forensic_accountant','junior_associate'];
const F3_COOP  = ['full_cooperation','limited_cooperation','no_cooperation','proffer_agreement'];
const F3_DPA   = ['viable','unlikely','negotiating','declined','signed'];
function f3(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F3_MAT), ts=rng.int(2,5), roles=F3_ROLES.slice(0,ts);
  const coop=rng.pick(F3_COOP), dpa=rng.pick(F3_DPA), trig='2025-02-01';
  const wellsDue=addCal(trig,30), subDue=addBus(trig,21);
  const dpadays=dpa==='negotiating'?rng.int(60,365):0;
  const dpaSign=dpadays>0?addCal(trig,dpadays):null;
  const regDl=[
    {key:'wells',    due:wellsDue, priority:'critical'},
    {key:'subpoena', due:subDue,   priority:'critical'},
    {key:'target',   due:wellsDue, priority:'high'},
    ...(dpaSign?[{key:'dpa_sign',due:dpaSign,priority:'normal'}]:[]),
  ].sort(prioSort);
  const baseFine=rng.int(100000,500000000);
  const disc={full_cooperation:.30,limited_cooperation:.15,proffer_agreement:.20,no_cooperation:0}[coop];
  const adjFine=Math.round(baseFine*(1-disc));
  const dpaCredit=['viable','negotiating','signed'].includes(dpa);
  const effFine=dpaCredit?Math.round(adjFine*.7):adjFine;
  const uLat=38+rng.float()*8, uLng=-100+rng.float()*30;
  const top=topMatch(rng,v.state,uLat,uLng);
  const accelResp = v.vulnerability==='crisis' && v.jurisdiction==='federal';
  const recCoop   = v.evidence==='strong' && coop!=='full_cooperation';
  return {...v,n,matter,ts,roles,coop,dpa,trig,wellsDue,subDue,dpaSign,regDl,
    baseFine,disc,adjFine,dpaCredit,effFine,top,accelResp,recCoop};
}

// ── FIRM 4  PLF Family Law ────────────────────────────────────────────────────
const F4_MAT = [
  'High-asset divorce — business valuation dispute',
  'Contested custody — relocation to another state',
  'Child support modification — income reduction post-layoff',
  'Emergency TRO — domestic violence — same-sex couple',
  'Adoption — stepparent petition — consent withheld',
  'Grandparent visitation rights — 14th Amendment challenge',
  'Paternity — disputed DNA — retroactive child support',
  'Prenuptial agreement enforcement — fraud in the inducement',
  'Post-divorce contempt — failure to pay support 14 months',
  'International child abduction — Hague Convention petition',
  'Guardianship of incapacitated adult — mental illness',
  'Termination of parental rights — neglect findings',
  'Equitable distribution — pension / QDRO valuation',
  'Spousal support modification — cohabitation argument',
  'Parental alienation — GAL recommendation hearing',
  'Contested divorce — hidden offshore accounts',
  'Surrogacy agreement dispute — gestational carrier withdrawal',
  'Emancipation petition — 16-year-old medical independence',
  'Name change — transgender minor — parental objection',
  'Child custody — move-away — best interests standard',
  'Division of cryptocurrency assets — valuation dispute',
  'Post-decree modification — disability triggers support review',
  'Restraining order violation — custody exchange incident',
  'Adoption finalization — foster-to-adopt interstate compact',
  'Cohabitation agreement — unmarried partners — property split',
  'Contested will during probate — family trust dispute',
  'Kinship placement hearing — DCFS removal contested',
  'Military divorce — BAH and SBP division',
  'Prenatal agreement — reproductive coercion allegation',
  'Divorce with minor children — relocation outside country',
];
const F4_ROLES    = ['managing_partner','senior_family_attorney','associate','paralegal','guardian_ad_litem'];
const F4_ASSETS   = ['under_100k','100k_500k','500k_2m','2m_10m','over_10m'];
const F4_CUSTODY  = ['sole_physical','joint_physical','sole_legal','joint_legal','supervised'];
const F4_SUPPORT  = ['income_shares','percentage_of_income','melson','hybrid'];
function f4(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F4_MAT), ts=rng.int(2,5), roles=F4_ROLES.slice(0,ts);
  const asset=rng.pick(F4_ASSETS), custody=rng.pick(F4_CUSTODY), support=rng.pick(F4_SUPPORT);
  const dv=rng.bool(.2), prenup=rng.bool(.35), trig='2025-04-01';
  const troDue=dv?addBus(trig,3):null;
  const answerDue=addCal(trig,30), discovDue=addCal(trig,120), trialDue=addCal(trig,180);
  const famDl=[
    ...(troDue?[{key:'tro',due:troDue,priority:'critical'}]:[]),
    {key:'answer',   due:answerDue, priority:'high'},
    {key:'discovery',due:discovDue, priority:'high'},
    {key:'trial_set',due:trialDue,  priority:'normal'},
  ].sort(prioSort);
  const uLat=32+rng.float()*12, uLng=-105+rng.float()*40;
  const top=topMatch(rng,v.state,uLat,uLng);
  const expedTRO  = v.vulnerability==='crisis' && dv;
  const likelySett= ['weak','contested'].includes(v.evidence);
  return {...v,n,matter,ts,roles,asset,custody,support,dv,prenup,trig,
    troDue,answerDue,discovDue,trialDue,famDl,top,expedTRO,likelySett};
}

// ── FIRM 5  KIP Immigration ───────────────────────────────────────────────────
const F5_MAT = [
  'Asylum — credible fear interview — Central American gang violence',
  'Removal defense — 10-year cancellation of removal',
  'DACA renewal — advance parole travel',
  'VAWA self-petition — abusive USC spouse',
  'U-visa certification — crime victim cooperation with police',
  'BIA appeal — adverse credibility finding reversal',
  'Circuit court petition for review — 9th Circuit',
  'Bond hearing — mandatory detention — § 236(c)',
  'Withholding of removal — Convention Against Torture claim',
  'T-visa — human trafficking victim certification',
  'SIJ — Special Immigrant Juvenile — abuse and abandonment',
  'Citizenship application — naturalization denial appeal',
  'Consular processing — INA § 212(a)(9)(B) unlawful presence waiver',
  'Provisional unlawful presence waiver — I-601A',
  'Adjustment of status — I-485 interview preparation',
  'EB-1A petition — extraordinary ability artist',
  'EB-2 NIW — national interest waiver — STEM researcher',
  'H-1B cap-subject petition — lottery selection',
  'L-1A intracompany transferee — manager/executive',
  'O-1B petition — entertainer extraordinary ability',
  'Deferred action request — compelling humanitarian',
  'ICE detention — medical deterioration — emergency release',
  'Unaccompanied minor — TVPRA reunification hearing',
  'NACARA suspension of deportation — El Salvador national',
  'Reinstatement of removal — prior deportation violation',
  'Motion to reopen — changed country conditions — Somalia',
  'Refugee resettlement — Iraqi P-2 direct access',
  'BIA remand — ineffective assistance of prior counsel',
  'Prosecutorial discretion request — longtime LPR',
  'DACA recipient — employer sponsorship — EB-3 pathway',
];
const F5_ROLES   = ['lead_attorney','associate','paralegal','interpreter','case_manager'];
const F5_RELIEF  = ['asylum','cancellation','DACA','VAWA','U_visa','withholding','CAT','adjustment','citizenship','humanitarian'];
const F5_COUNTRY = ['stable','deteriorating','crisis','improving'];
const F5_REMOVAL = ['criminal','unlawful_presence','fraud','overstay','EWI','aggravated_felony','inadmissibility','public_charge'];
function f5(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F5_MAT), ts=rng.int(2,5), roles=F5_ROLES.slice(0,ts);
  const relief=rng.pick(F5_RELIEF), country=rng.pick(F5_COUNTRY), removal=rng.pick(F5_REMOVAL);
  const detained=rng.bool(.3), yearsUS=rng.int(1,30), clockDays=rng.int(0,1460);
  const trig='2025-05-01', biaDue=addCal(trig,30), masterDue=addCal(trig,rng.int(30,180));
  const circDue=addCal(biaDue,30);
  const immDl=[
    {key:'BIA',      due:biaDue,    priority:'critical'},
    {key:'master',   due:masterDue, priority:'high'},
    {key:'circuit',  due:circDue,   priority:'normal'},
  ].sort(prioSort);
  const barred  = clockDays>365 && relief==='asylum';
  const uLat=28+rng.float()*15, uLng=-110+rng.float()*40;
  const top=topMatch(rng,v.state,uLat,uLng);
  const detUrgent    = detained && ['crisis','high'].includes(v.vulnerability);
  const strongAsylum = v.evidence==='strong' && country==='crisis' && relief==='asylum';
  return {...v,n,matter,ts,roles,relief,country,removal,detained,yearsUS,clockDays,
    trig,biaDue,masterDue,circDue,immDl,barred,top,detUrgent,strongAsylum};
}

// ── FIRM 6  TPT Personal Injury ───────────────────────────────────────────────
const F6_MAT = [
  'Auto accident — rear-end — L4-L5 herniated disc',
  'Auto accident — T-bone intersection — wrongful death',
  'Motorcycle vs. commercial truck — traumatic brain injury',
  'Medical malpractice — surgical error — retained instrument',
  'Medical malpractice — misdiagnosis — Stage IV cancer delayed',
  'Medical malpractice — anesthesia error — cardiac arrest',
  'Products liability — defective airbag — disfigurement',
  'Products liability — baby formula — NEC mass tort',
  'Products liability — talcum powder — ovarian cancer MDL',
  'Slip and fall — wet floor — supermarket — knee replacement',
  'Premises liability — inadequate security — rape at hotel',
  'Construction site — OSHA violation — worker fall fatality',
  'Dog bite — reconstructive surgery — child victim',
  'Wrongful death — nursing home neglect — sepsis',
  'Asbestos mesothelioma — occupational exposure 40 years',
  'Roundup glyphosate — Non-Hodgkin lymphoma MDL',
  'PFAS contamination — water supply — kidney cancer class',
  'Opioid mass tort — manufacturer deceptive marketing MDL',
  'Brain injury — fall from ladder — general contractor',
  'Burn injury — gas explosion — utility company liability',
  'Child sexual abuse — institutional negligence — school',
  'Sexual assault — hotel inadequate security — civil suit',
  'Defamation — social media post — reputational damage',
  'False imprisonment — retail detention — excessive force',
  'Toxic tort — chemical plant — community class action',
  'Rideshare assault — driver background check failure',
  'Catastrophic injury — amusement park ride malfunction',
  'Workers compensation third-party — crane collapse',
  'Spinal cord injury — uninsured motorist — paralysis',
  'SSDI disability appeal — denied claimant back pay',
];
const F6_ROLES    = ['lead_trial_attorney','co_counsel','paralegal','investigator','expert_witness'];
const F6_SEVERITY = ['minor','moderate','serious','severe','catastrophic'];
const F6_CAUSA    = ['clear','disputed','speculative','contested_expert'];
function f6(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F6_MAT), ts=rng.int(2,5), roles=F6_ROLES.slice(0,ts);
  const severity=rng.pick(F6_SEVERITY), causa=rng.pick(F6_CAUSA);
  const pfFault=rng.int(0,40), econDam=rng.int(10000,5000000), nonEcon=rng.int(5000,3000000);
  const punitive=v.evidence==='strong'&&causa==='clear'?rng.int(0,2000000):0;
  const polLimit=rng.int(25000,2000000), trig='2025-06-01';
  const solYrs=/malpractice|medical/.test(matter.toLowerCase())?3:2;
  const solDue=addCal(trig,solYrs*365), answerDue=addCal(trig,30);
  const expertDue=addCal(trig,120), discovDue=addCal(trig,150);
  const piDl=[
    {key:'answer',   due:answerDue, priority:'critical'},
    {key:'expert',   due:expertDue, priority:'high'},
    {key:'discovery',due:discovDue, priority:'high'},
    {key:'sol',      due:solDue,    priority:'normal'},
  ].sort(prioSort);
  const totalDam=econDam+nonEcon+punitive;
  const netDam=Math.round(totalDam*(1-pfFault/100));
  const polEx=netDam>polLimit;
  const uLat=33+rng.float()*12, uLng=-100+rng.float()*35;
  const top=topMatch(rng,v.state,uLat,uLng);
  const fastTrack = ['catastrophic','severe'].includes(severity) && v.vulnerability==='crisis';
  const settPress = v.evidence==='strong' && causa==='clear';
  return {...v,n,matter,ts,roles,severity,causa,pfFault,econDam,nonEcon,punitive,
    polLimit,trig,solYrs,solDue,answerDue,expertDue,discovDue,piDl,totalDam,netDam,polEx,top,fastTrack,settPress};
}

// ── FIRM 7  APD Public Defender ───────────────────────────────────────────────
const F7_CHG = [
  'Possession of controlled substance — felony weight',
  'Possession of firearm by prohibited person',
  'Retail theft — three-strike enhancement',
  'Aggravated DUI — prior convictions',
  'Assault — bar fight — mutual combat',
  'Criminal mischief — property destruction over $5,000',
  'Failure to register — sex offender registry',
  'Probation violation — drug test failure',
  'Resisting arrest — excessive force by officer',
  'Receiving stolen property — pawn shop',
  'Trespassing — homeless individual — business district',
  'Disorderly conduct — protest — ordinance violation',
  'Simple drug possession — marijuana — personal use',
  'Public intoxication — open container violation',
  'Shoplifting — first offense — diversion eligible',
  'Vandalism — graffiti — cultural institution',
  'Unlawful discharge of firearm — urban residential',
  'Grand theft auto — joyride — first offense',
  'Burglary — residential — unarmed',
  'Robbery — purse snatch — elderly victim',
  'Forgery — altered check — $450',
  'Identity theft — unauthorized credit card use',
  'Reckless driving — speeds over 100 mph',
  'Leaving scene of accident — property damage only',
  'Drug paraphernalia — possession — syringe',
  'Contempt of court — failure to appear — bench warrant',
  'Hit and run — minor injury — fleeing scene',
  'Stalking — first offense — misdemeanor',
  'Criminal threatening — social media post',
  'Domestic disturbance — noise complaint — no physical contact',
];
const F7_ROLES    = ['supervising_pd','staff_pd','paralegal','law_student_intern','mitigation_specialist'];
const F7_MOTIONS  = ['suppression_4th','suppression_5th','competency','Brady_Giglio','Batson','diversion','speedy_trial','motion_in_limine','Marsden'];
const F7_DIVERT   = ['drug_court','mental_health_court','deferred_sentencing','community_service','first_offender','veteran_court'];
function f7(n, rng) {
  const v=sampleVars(rng), charge=rng.pick(F7_CHG), ts=rng.int(1,4), roles=F7_ROLES.slice(0,ts);
  const motion=rng.pick(F7_MOTIONS), diversion=rng.pick(F7_DIVERT);
  const caseload=rng.int(80,450), pleaDisc=rng.int(20,60), trig='2025-03-15';
  const bailDue=addCal(trig,1), arraignDue=addBus(trig,3);
  const suppressDue=addBus(trig,14), prelimDue=addCal(trig,14), speedyDue=addCal(trig,70);
  const pdDl=[
    {key:'bail',       due:bailDue,     priority:'critical'},
    {key:'arraignment',due:arraignDue,  priority:'critical'},
    {key:'suppression',due:suppressDue, priority:'high'},
    {key:'prelim',     due:prelimDue,   priority:'high'},
    {key:'speedy',     due:speedyDue,   priority:'normal'},
  ].sort(prioSort);
  const uLat=36+rng.float()*10, uLng=-95+rng.float()*25;
  const top=topMatch(rng,v.state,uLat,uLng);
  const needsMit  = ['high','crisis'].includes(v.vulnerability);
  const aggrMot   = ['weak','contested'].includes(v.evidence);
  return {...v,n,charge,ts,roles,motion,diversion,caseload,pleaDisc,trig,
    bailDue,arraignDue,suppressDue,prelimDue,speedyDue,pdDl,top,needsMit,aggrMot};
}

// ── FIRM 8  HAG Appellate ─────────────────────────────────────────────────────
const F8_MAT = [
  'Direct appeal — insufficient evidence — 4th Circuit',
  'Direct appeal — improper jury instruction — 5th Circuit',
  'Direct appeal — prosecutorial misconduct — 9th Circuit',
  '28 U.S.C. § 2255 — ineffective assistance — plea advice failure',
  '28 U.S.C. § 2255 — newly discovered evidence — alibi witness',
  '28 U.S.C. § 2254 — state habeas — Brady violation',
  '28 U.S.C. § 2254 — Batson challenge — biased jury selection',
  'Coram nobis — immigration consequences not disclosed at plea',
  'Coram nobis — actual innocence — DNA test results',
  '18 U.S.C. § 3582(c)(1)(A) — compassionate release — terminal illness',
  '18 U.S.C. § 3582(c)(1)(A) — compassionate release — pandemic',
  '18 U.S.C. § 3582(c)(2) — retroactive guideline amendment — First Step Act',
  'Cert petition — SCOTUS — circuit split on 4th Amendment',
  'Cert petition — SCOTUS — categorical approach ACCA predicates',
  'State PCR — mental retardation — Atkins claim',
  'State PCR — newly discovered exculpatory forensic evidence',
  'State direct appeal — sentencing error — mandatory minimum misapplied',
  'State PCR — false testimony by informant — Napue claim',
  'Federal appeal — AEDPA bar — procedural default — cause and prejudice',
  'Sentence reduction — 18 U.S.C. § 3553(a) — rehabilitation evidence',
  'Appeal — revocation of supervised release — 4th Amendment search',
  'Capital PCR — Ring v. Arizona — jury sentencing claim',
  'Capital PCR — Wiggins deficient mitigation investigation',
  'Appeal — consecutive sentences — Eighth Amendment proportionality',
  'Mandamus petition — trial court delay — Barker speedy trial test',
  'First Step Act § 404 — Fair Sentencing Act retroactivity',
  'Appeal — loss amount — USSG § 2B1.1 fraud calculation',
  'Wrongful conviction — civil suit after exoneration — § 1983',
  'Interlocutory appeal — suppression ruling — government appeal',
  'Habeas — procedurally defaulted claim — actual innocence gateway',
];
const F8_ROLES   = ['lead_appellate','associate','law_clerk','paralegal','expert_witness'];
const F8_STD     = ['de_novo','abuse_of_discretion','clear_error','plain_error','harmless_error'];
const F8_HABEAS  = ['2255_federal','2254_state','coram_nobis','audita_querela','error_coram_nobis','state_PCR'];
function f8(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F8_MAT), ts=rng.int(2,5), roles=F8_ROLES.slice(0,ts);
  const stdRev=rng.pick(F8_STD), habTrack=rng.pick(F8_HABEAS);
  const yearsPost=rng.int(0,25), priorApp=rng.int(0,4), isCapital=rng.bool(.1);
  const trig='2025-07-01';
  const directDue=v.jurisdiction==='federal'?addCal(trig,14):addCal(trig,30);
  const certDue=addCal(trig,90), aedpaDue=addCal(trig,365);
  const appDl=[
    {key:'direct',due:directDue, priority:'critical'},
    {key:'cert',  due:certDue,   priority:'high'},
    {key:'aedpa', due:aedpaDue,  priority:'high'},
  ].sort(prioSort);
  const revBase={de_novo:60,abuse_of_discretion:40,clear_error:30,plain_error:15,harmless_error:25}[stdRev];
  const revScore=Math.max(0,Math.min(100,revBase+(v.evidenceScore>60?20:0)-priorApp*5));
  const appliedStd = v.evidence==='strong'?'de_novo':v.evidence==='moderate'?'abuse_of_discretion':
    v.evidence==='contested'?'plain_error':'harmless_error';
  const uLat=37+rng.float()*10, uLng=-100+rng.float()*30;
  const top=topMatch(rng,v.state,uLat,uLng);
  const prioCapital = isCapital && ['crisis','high'].includes(v.vulnerability);
  return {...v,n,matter,ts,roles,stdRev,habTrack,yearsPost,priorApp,isCapital,
    trig,directDue,certDue,aedpaDue,appDl,revScore,appliedStd,top,prioCapital};
}

// ── FIRM 9  BMJ Military ──────────────────────────────────────────────────────
const F9_CHG = [
  'Art. 118 UCMJ — Murder — premeditated (general court-martial)',
  'Art. 120 UCMJ — Sexual assault — fellow service member',
  'Art. 120 UCMJ — Rape — aggravated circumstances',
  'Art. 120c UCMJ — Indecent viewing — hidden camera barracks',
  'Art. 128 UCMJ — Assault consummated by battery — officer victim',
  'Art. 128b UCMJ — Domestic violence — military family',
  'Art. 112a UCMJ — Wrongful use of controlled substance — cocaine',
  'Art. 112a UCMJ — Distribution of methamphetamine on base',
  'Art. 86 UCMJ — AWOL — 90-day unauthorized absence',
  'Art. 87 UCMJ — Missing movement — intentional',
  'Art. 92 UCMJ — Failure to obey general order — security violation',
  'Art. 107 UCMJ — False official statement — cover-up investigation',
  'Art. 134 UCMJ — Conduct unbecoming — social media posts',
  'Art. 133 UCMJ — Conduct unbecoming officer — fraternization',
  'Art. 80 UCMJ — Attempted murder — botched fratricide',
  'Art. 121 UCMJ — Larceny — government property $500k',
  'Art. 121 UCMJ — Wrongful appropriation — military vehicle',
  'Art. 88 UCMJ — Contempt toward officials — public statements',
  'Art. 81 UCMJ — Conspiracy — drug distribution network',
  'Art. 119 UCMJ — Manslaughter — DUI on military installation',
  'Admin separation — Chapter 14 — misconduct',
  'Admin separation — Chapter 11 — entry level separation',
  'Security clearance revocation — financial issues — Guideline F',
  'Security clearance revocation — foreign influence — Guideline B',
  'Security clearance revocation — drug use — Guideline H',
  'Nonjudicial punishment — Article 15 — appeal to Commander',
  'Summary court-martial — unauthorized absence — 1st offense',
  'Special court-martial — drug use — enlisted E-4',
  'General court-martial — sexual assault — mandatory dismissal',
  'Board of correction — military records — unjust discharge upgrade',
];
const F9_ROLES   = ['senior_military_attorney','military_associate','paralegal','investigator','expert_witness'];
const F9_COURTS  = ['summary','special','general','article_32','admin_board','security_clearance'];
const F9_BRANCH  = ['Army','Navy','Marine_Corps','Air_Force','Space_Force','Coast_Guard'];
function f9(n, rng) {
  const v=sampleVars(rng), charge=rng.pick(F9_CHG), ts=rng.int(2,5), roles=F9_ROLES.slice(0,ts);
  const court=rng.pick(F9_COURTS), branch=rng.pick(F9_BRANCH);
  const rankE=rng.int(1,9), svcYrs=rng.int(1,30), priorNJP=rng.int(0,3);
  const trig='2025-08-01';
  const art32Due=addBus(trig,5), arraignDue=addBus(trig,8);
  const discovDue=addCal(trig,30), speedyDue=addCal(trig,120);
  const milDl=[
    {key:'art32',      due:art32Due,   priority:'critical'},
    {key:'arraignment',due:arraignDue, priority:'critical'},
    {key:'discovery',  due:discovDue,  priority:'high'},
    {key:'speedy',     due:speedyDue,  priority:'normal'},
  ].sort(prioSort);
  const dischargeRisk=/admin sep|discharge|conduct unbecoming|sexual assault|awol/.test(charge.toLowerCase());
  const maxConf=court==='general'?rng.int(12,240):rng.int(1,12);
  const likeleDisch=/murder|rape|sexual assault/.test(charge.toLowerCase())?'Dishonorable':
    /assault|drugs|theft/.test(charge.toLowerCase())?'Bad Conduct':
    court==='admin_board'?'OTH':'Honorable';
  const uLat=30+rng.float()*15, uLng=-100+rng.float()*40;
  const top=topMatch(rng,v.state,uLat,uLng);
  const severeCons  = dischargeRisk && v.vulnerability!=='low';
  const negotiatePl = v.evidence==='strong' && court!=='summary';
  return {...v,n,charge,ts,roles,court,branch,rankE,svcYrs,priorNJP,trig,
    art32Due,arraignDue,discovDue,speedyDue,milDl,dischargeRisk,maxConf,likeleDisch,
    top,severeCons,negotiatePl};
}

// ── FIRM 10  MJD Juvenile & Dependency ───────────────────────────────────────
const F10_MAT = [
  'Delinquency — armed robbery — certification to adult court',
  'Delinquency — sexual assault — juvenile sex offender registration',
  'Delinquency — drug trafficking — school zone',
  'Delinquency — assault — school fight — expulsion nexus',
  'Delinquency — auto theft — first offense — diversion',
  'Delinquency — vandalism — restitution hearing',
  'Dependency — neglect — parental substance abuse',
  'Dependency — physical abuse — out-of-home placement',
  'Dependency — medical neglect — failure to vaccinate',
  'Dependency — sexual abuse — by stepparent',
  'Termination of parental rights — reunification failure',
  'Termination of parental rights — incarcerated parent',
  'Adoption finalization — foster-to-adopt — sibling group',
  'Guardianship — kinship — grandparent caregiver',
  'School discipline — expulsion — zero-tolerance weapon',
  'School discipline — manifestation determination — IEP student',
  'Status offense — truancy — beyond parental control',
  'Status offense — runaway — PINS petition',
  'Emancipation — 16-year-old — parental abuse',
  'Transfer to adult court — serious violent offense',
  'Juvenile sex offender — registration challenge — Romeo Juliet',
  'Dependency — human trafficking victim — CSEC',
  'ICWA — Indian Child Welfare Act — tribal notification',
  'Dependency — prenatal drug exposure — newborn removal',
  'Crossover youth — delinquency and dependency — dual jurisdiction',
  'Post-disposition review — placement change — group home',
  'Mental health placement — involuntary — 5150 minor',
  'Juvenile expungement — delinquency record — age 19',
  'Permanency hearing — long-term foster care',
  'Adoption disruption — post-finalization — older child',
];
const F10_ROLES     = ['supervising_attorney','associate_juvenile','paralegal','case_manager','guardian_ad_litem'];
const F10_TRACKS    = ['delinquency','dependency','TPR','adoption','school_discipline','status_offense','crossover'];
const F10_PLACE     = ['home','foster_home','group_home','RTC','kinship','shelter','adult_transfer'];
const F10_RISK      = ['low','moderate','high','critical'];
function f10(n, rng) {
  const v=sampleVars(rng), matter=rng.pick(F10_MAT), ts=rng.int(1,5), roles=F10_ROLES.slice(0,ts);
  const track=rng.pick(F10_TRACKS), placement=rng.pick(F10_PLACE), risk=rng.pick(F10_RISK);
  const age=rng.int(10,17), priorAdj=rng.int(0,5), trig='2025-09-01';
  const detDue=addBus(trig,1), jurisDue=addBus(trig,15);
  const reviewDue=addCal(trig,180), permDue=addCal(trig,365);
  const juvDl=[
    {key:'detention',   due:detDue,    priority:'critical'},
    {key:'jurisdiction',due:jurisDue,  priority:'critical'},
    {key:'review',      due:reviewDue, priority:'high'},
    {key:'perm_plan',   due:permDue,   priority:'normal'},
  ].sort(prioSort);
  const transfer   = track==='delinquency' && age>=16 && rng.bool(.25);
  const expungElig = !transfer && priorAdj===0 && !/sexual assault|murder|robbery/.test(matter.toLowerCase());
  const uLat=35+rng.float()*12, uLng=-100+rng.float()*35;
  const top=topMatch(rng,v.state,uLat,uLng);
  const traumaProto = ['high','crisis'].includes(v.vulnerability);
  const diverOffered= v.evidence!=='weak' && !transfer && priorAdj===0;
  return {...v,n,matter,ts,roles,track,placement,risk,age,priorAdj,trig,
    detDue,jurisDue,reviewDue,permDue,juvDl,transfer,expungElig,top,traumaProto,diverOffered};
}

// ═════════════════════════════════════════════════════════════════════════════
//  GENERATE 3,000 TRIALS
// ═════════════════════════════════════════════════════════════════════════════
const N=300;
const SEEDS=[0xC0FFEE01,0xDEAD0002,0xF00D0003,0xBEEF0004,0xCAFE0005,
             0xFACE0006,0xBABE0007,0xD00D0008,0xACE00009,0x1CE0000A];
const FNS=[f1,f2,f3,f4,f5,f6,f7,f8,f9,f10];
const [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T] =
  FNS.map((fn,i)=>{ const r=makePrng(SEEDS[i]); return Array.from({length:N},(_,j)=>fn(j+1,r)); });

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED CHECKS
// ═════════════════════════════════════════════════════════════════════════════
function chkSort(dl) {
  for (let i=1;i<dl.length;i++) {
    const pd=dl[i-1].due||'', cd=dl[i].due||'';
    if (pd===cd) expect(PR[dl[i-1].priority]||0).toBeGreaterThanOrEqual(PR[dl[i].priority]||0);
    else expect(pd.localeCompare(cd)).toBeLessThanOrEqual(0);
  }
}
function chkScore(top) {
  expect(Number.isFinite(top.matchScore)).toBe(true);
  expect(top.matchScore).toBeGreaterThanOrEqual(-50);
  expect(top.matchScore).toBeLessThanOrEqual(300);
}
function chkCD(t) {
  expect(VAR_C).toContain(t.vulnerability);
  expect(t.evidenceScore).toBeGreaterThanOrEqual(0);
  expect(t.evidenceScore).toBeLessThanOrEqual(100);
  expect(['weak','contested','moderate','strong']).toContain(t.evidence);
  expect(t.evidence).toBe(evidenceBucket(t.evidenceScore));
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEST SUITES
// ═════════════════════════════════════════════════════════════════════════════

describe('FIRM 1 — Harrington Voss & Slate LLP (Criminal Defense)', () => {
  describe('Charge Classification (300)', () => {
    F1T.forEach(t => test(`T${t.n}: "${t.charge.slice(0,48)}" → ${t.ct}`, () => {
      expect(['felony','misdemeanor','dui','domestic','sexual','dismissed']).toContain(t.ct);
      const l=t.charge.toLowerCase();
      if (/\bdui\b|\bdwi\b|\bowi\b/.test(l)) expect(t.ct).toBe('dui');
      else if (/domestic/.test(l))            expect(t.ct).toBe('domestic');
      else if (/murder|felony murder/.test(l)) expect(t.ct).toBe('felony');
      else if (/robbery/.test(l))              expect(t.ct).toBe('felony');
      else if (/trafficking|distribution.*drug/.test(l)) expect(t.ct).toBe('felony');
      else if (/strangulation/.test(l))        expect(t.ct).toBe('felony');
      else if (/child exploit|csam/.test(l))   expect(t.ct).toBe('sexual');
    }));
  });
  describe('Expungement Eligibility (300)', () => {
    F1T.forEach(t => test(`T${t.n}: ${t.state}/${t.ct}/${t.stat}→eligible=${t.elig.eligible}`, () => {
      expect(t.elig).toHaveProperty('eligible');
      expect(typeof t.elig.note).toBe('string');
      expect(t.elig.note.length).toBeGreaterThan(0);
      if (t.stat==='Dismissed')                      expect(t.elig.eligible).toBe(true);
      if (t.ct==='sexual'&&t.stat==='Convicted')     expect(t.elig.eligible).toBe(false);
      expect(t.elig.waitYears??0).toBeGreaterThanOrEqual(0);
    }));
  });
  describe('Criminal Deadlines (300)', () => {
    F1T.forEach(t => test(`T${t.n}: bail=${t.dl.find(d=>d.key==='bail').due}`, () => {
      expect(t.dl.find(d=>d.key==='bail').due).toBe('2025-01-16');
      expect(t.dl.find(d=>d.key==='arraignment').due).toBe('2025-01-20');
      expect(t.dl.find(d=>d.key==='speedy').due).toBe('2025-03-26');
      chkSort(t.dl);
    }));
  });
  describe('Bail Amounts (300)', () => {
    F1T.forEach(t => test(`T${t.n}: ${t.cat} $${t.bail.toLocaleString('en-US')}`, () => {
      const [lo,hi]=F1_BAIL[t.cat];
      expect(t.bail).toBeGreaterThanOrEqual(lo); expect(t.bail).toBeLessThanOrEqual(hi);
    }));
  });
  describe('VAR-A/B (300)', () => {
    F1T.forEach(t => test(`T${t.n}: ${t.timePressure}/${t.jurisdiction}`, () => {
      expect(VAR_A).toContain(t.timePressure); expect(VAR_B).toContain(t.jurisdiction);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F1T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.expeditedBail) { expect(t.vulnerability).toBe('crisis'); }
      if (t.dismissLikely)  expect(t.evidence).toBe('weak');
    }));
  });
  describe('Team Roles (300)', () => {
    F1T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); expect(t.ts).toBeLessThanOrEqual(5);
      t.roles.forEach(r=>expect(F1_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F1T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 2 — McDermott Civil Rights & Advocacy (§ 1983)', () => {
  describe('Civil Deadlines (300)', () => {
    F2T.forEach(t => test(`T${t.n}: answer=${t.answerDue}`, () => {
      expect(t.answerDue).toBe(addCal(t.filed,21));
      expect(t.classDue).toBe(addCal(t.filed,90));
      expect(t.discovDue).toBe(addCal(t.filed,120));
      expect(t.answerDue.localeCompare(t.classDue)).toBeLessThan(0);
      expect(t.classDue.localeCompare(t.discovDue)).toBeLessThan(0);
    }));
  });
  describe('SOL 730 Days (300)', () => {
    F2T.forEach(t => test(`T${t.n}: SOL=${t.solDue}`, () => {
      expect(t.solDue).toBe(addCal(t.trig,730));
      expect(daysBetween(t.trig,t.solDue)).toBe(730);
    }));
  });
  describe('Damages Model (300)', () => {
    F2T.forEach(t => test(`T${t.n}: ${t.damages} total=$${t.total.toLocaleString('en-US')}`, () => {
      expect(t.comp).toBeGreaterThan(0); expect(t.total).toBeGreaterThanOrEqual(t.comp);
      if (t.damages==='compensatory_only') expect(t.total).toBe(t.comp);
      if (t.damages==='compensatory_plus_punitive') { expect([3,5,9]).toContain(t.punMul); expect(t.total).toBeGreaterThan(t.comp); }
    }));
  });
  describe('Class Action (300)', () => {
    F2T.forEach(t => test(`T${t.n}: cls=${t.cls} isClass=${t.isClass}`, () => {
      if (t.cls==='individual') { expect(t.isClass).toBe(false); expect(t.classSize).toBe(1); }
      else { expect(t.isClass).toBe(true); expect(t.classSize).toBeGreaterThanOrEqual(50); }
      expect(t.classTotal).toBeGreaterThan(0);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F2T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.emergInj) { expect(t.vulnerability).toBe('crisis'); }
      if (t.earlySet) { expect(t.evidence).toBe('strong'); }
    }));
  });
  describe('Team Roles (300)', () => {
    F2T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); t.roles.forEach(r=>expect(F2_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F2T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 3 — Regent Compliance Group PC (White-Collar)', () => {
  describe('Regulatory Deadlines (300)', () => {
    F3T.forEach(t => test(`T${t.n}: wells=${t.wellsDue} sub=${t.subDue}`, () => {
      expect(t.wellsDue).toBe('2025-03-03');
      expect(t.subDue).toBe(addBus('2025-02-01',21));
      chkSort(t.regDl);
    }));
  });
  describe('Fine + Coop Credit (300)', () => {
    F3T.forEach(t => test(`T${t.n}: ${t.coop} disc=${(t.disc*100).toFixed(0)}%`, () => {
      expect(t.adjFine).toBeLessThanOrEqual(t.baseFine);
      expect(t.effFine).toBeLessThanOrEqual(t.adjFine);
      if (t.coop==='full_cooperation')    expect(t.disc).toBe(.30);
      if (t.coop==='limited_cooperation') expect(t.disc).toBe(.15);
      if (t.coop==='proffer_agreement')   expect(t.disc).toBe(.20);
      if (t.coop==='no_cooperation')      expect(t.disc).toBe(0);
      if (t.dpaCredit) expect(t.effFine).toBe(Math.round(t.adjFine*.7));
      else             expect(t.effFine).toBe(t.adjFine);
    }));
  });
  describe('DPA Viability (300)', () => {
    F3T.forEach(t => test(`T${t.n}: dpa=${t.dpa}`, () => {
      if (t.dpa==='negotiating') { expect(t.dpaSign).not.toBeNull(); const d=daysBetween('2025-02-01',t.dpaSign); expect(d).toBeGreaterThanOrEqual(60); expect(d).toBeLessThanOrEqual(365); }
      if (['declined','unlikely'].includes(t.dpa)) expect(t.dpaSign).toBeNull();
      if (t.dpaCredit) expect(['viable','negotiating','signed']).toContain(t.dpa);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F3T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.accelResp) { expect(t.vulnerability).toBe('crisis'); expect(t.jurisdiction).toBe('federal'); }
      if (t.recCoop)   { expect(t.evidence).toBe('strong'); expect(t.coop).not.toBe('full_cooperation'); }
    }));
  });
  describe('Team Roles (300)', () => {
    F3T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); t.roles.forEach(r=>expect(F3_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F3T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 4 — Pellegrino Family Law Center', () => {
  describe('Family Deadlines (300)', () => {
    F4T.forEach(t => test(`T${t.n}: answer=${t.answerDue} trial=${t.trialDue}`, () => {
      expect(t.answerDue).toBe(addCal(t.trig,30));
      expect(t.discovDue).toBe(addCal(t.trig,120));
      expect(t.trialDue).toBe(addCal(t.trig,180));
      if (t.dv) { expect(t.troDue).toBe(addBus(t.trig,3)); expect(t.famDl[0].key).toBe('tro'); }
      chkSort(t.famDl);
    }));
  });
  describe('Matter Variables (300)', () => {
    F4T.forEach(t => test(`T${t.n}: asset=${t.asset} custody=${t.custody}`, () => {
      expect(F4_ASSETS).toContain(t.asset); expect(F4_CUSTODY).toContain(t.custody);
      expect(F4_SUPPORT).toContain(t.support);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F4T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.expedTRO)  { expect(t.vulnerability).toBe('crisis'); expect(t.dv).toBe(true); }
      if (t.likelySett) expect(['weak','contested']).toContain(t.evidence);
    }));
  });
  describe('Team Roles (300)', () => {
    F4T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); t.roles.forEach(r=>expect(F4_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F4T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 5 — Kessler Immigration Partners', () => {
  describe('Immigration Deadlines (300)', () => {
    F5T.forEach(t => test(`T${t.n}: BIA=${t.biaDue} circuit=${t.circDue}`, () => {
      expect(t.biaDue).toBe(addCal(t.trig,30));
      expect(t.circDue).toBe(addCal(t.biaDue,30));
      expect(t.biaDue.localeCompare(t.circDue)).toBeLessThan(0);
      chkSort(t.immDl);
    }));
  });
  describe('Asylum Clock Bar (300)', () => {
    F5T.forEach(t => test(`T${t.n}: clockDays=${t.clockDays} barred=${t.barred}`, () => {
      if (t.barred) { expect(t.clockDays).toBeGreaterThan(365); expect(t.relief).toBe('asylum'); }
      if (t.relief!=='asylum') expect(t.barred).toBe(false);
    }));
  });
  describe('Matter Variables (300)', () => {
    F5T.forEach(t => test(`T${t.n}: relief=${t.relief} country=${t.country}`, () => {
      expect(F5_RELIEF).toContain(t.relief); expect(F5_COUNTRY).toContain(t.country);
      expect(F5_REMOVAL).toContain(t.removal);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F5T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.detUrgent)    { expect(t.detained).toBe(true); expect(['crisis','high']).toContain(t.vulnerability); }
      if (t.strongAsylum) { expect(t.evidence).toBe('strong'); expect(t.country).toBe('crisis'); }
    }));
  });
  describe('Team Roles (300)', () => {
    F5T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); t.roles.forEach(r=>expect(F5_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F5T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 6 — Thornwald PI & Mass Tort', () => {
  describe('PI Deadlines (300)', () => {
    F6T.forEach(t => test(`T${t.n}: answer=${t.answerDue} SOL=${t.solDue}`, () => {
      expect(t.answerDue).toBe(addCal(t.trig,30));
      expect(t.expertDue).toBe(addCal(t.trig,120));
      expect(t.discovDue).toBe(addCal(t.trig,150));
      expect(t.solDue).toBe(addCal(t.trig,t.solYrs*365));
      chkSort(t.piDl);
    }));
  });
  describe('SOL Years (300)', () => {
    F6T.forEach(t => test(`T${t.n}: solYrs=${t.solYrs}`, () => {
      if (/malpractice|medical/.test(t.matter.toLowerCase())) expect(t.solYrs).toBe(3);
      else expect(t.solYrs).toBe(2);
    }));
  });
  describe('Damages (300)', () => {
    F6T.forEach(t => test(`T${t.n}: net=$${t.netDam.toLocaleString('en-US')} polEx=${t.polEx}`, () => {
      expect(t.totalDam).toBe(t.econDam+t.nonEcon+t.punitive);
      expect(t.netDam).toBe(Math.round(t.totalDam*(1-t.pfFault/100)));
      expect(t.polEx).toBe(t.netDam>t.polLimit);
      expect(t.pfFault).toBeGreaterThanOrEqual(0); expect(t.pfFault).toBeLessThanOrEqual(40);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F6T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.fastTrack)  { expect(['catastrophic','severe']).toContain(t.severity); expect(t.vulnerability).toBe('crisis'); }
      if (t.settPress)  { expect(t.evidence).toBe('strong'); expect(t.causa).toBe('clear'); }
      if (t.punitive>0) { expect(t.evidence).toBe('strong'); expect(t.causa).toBe('clear'); }
    }));
  });
  describe('Team Roles (300)', () => {
    F6T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); t.roles.forEach(r=>expect(F6_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F6T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 7 — Axiom Public Defense Consortium', () => {
  describe('PD Deadlines (300)', () => {
    F7T.forEach(t => test(`T${t.n}: bail=${t.bailDue} suppress=${t.suppressDue}`, () => {
      expect(t.bailDue).toBe(addCal(t.trig,1));
      expect(t.arraignDue).toBe(addBus(t.trig,3));
      expect(t.suppressDue).toBe(addBus(t.trig,14));
      expect(t.speedyDue).toBe(addCal(t.trig,70));
      chkSort(t.pdDl);
    }));
  });
  describe('PD Variables (300)', () => {
    F7T.forEach(t => test(`T${t.n}: motion=${t.motion} caseload=${t.caseload}`, () => {
      expect(F7_MOTIONS).toContain(t.motion); expect(F7_DIVERT).toContain(t.diversion);
      expect(t.caseload).toBeGreaterThanOrEqual(80); expect(t.caseload).toBeLessThanOrEqual(450);
      expect(t.pleaDisc).toBeGreaterThanOrEqual(20); expect(t.pleaDisc).toBeLessThanOrEqual(60);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F7T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.needsMit)  expect(['high','crisis']).toContain(t.vulnerability);
      if (t.aggrMot)   expect(['weak','contested']).toContain(t.evidence);
    }));
  });
  describe('Team Roles — solo allowed (300)', () => {
    F7T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(1); expect(t.ts).toBeLessThanOrEqual(4);
      t.roles.forEach(r=>expect(F7_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F7T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 8 — Halcyon Appellate Group', () => {
  describe('Appellate Deadlines (300)', () => {
    F8T.forEach(t => test(`T${t.n}: direct=${t.directDue} cert=${t.certDue}`, () => {
      if (t.jurisdiction==='federal') expect(t.directDue).toBe(addCal(t.trig,14));
      else                            expect(t.directDue).toBe(addCal(t.trig,30));
      expect(t.certDue).toBe(addCal(t.trig,90));
      expect(t.aedpaDue).toBe(addCal(t.trig,365));
      chkSort(t.appDl);
    }));
  });
  describe('Reversal Score & Standard of Review (300)', () => {
    F8T.forEach(t => test(`T${t.n}: std=${t.stdRev} score=${t.revScore} applied=${t.appliedStd}`, () => {
      expect(t.revScore).toBeGreaterThanOrEqual(0); expect(t.revScore).toBeLessThanOrEqual(100);
      expect(F8_STD).toContain(t.stdRev);
      if (t.evidence==='strong')   expect(t.appliedStd).toBe('de_novo');
      if (t.evidence==='moderate') expect(t.appliedStd).toBe('abuse_of_discretion');
    }));
  });
  describe('Habeas Track (300)', () => {
    F8T.forEach(t => test(`T${t.n}: track=${t.habTrack} capital=${t.isCapital}`, () => {
      expect(F8_HABEAS).toContain(t.habTrack); expect(typeof t.isCapital).toBe('boolean');
      expect(t.yearsPost).toBeGreaterThanOrEqual(0);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F8T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.prioCapital) { expect(t.isCapital).toBe(true); expect(['crisis','high']).toContain(t.vulnerability); }
    }));
  });
  describe('Match Score (300)', () => {
    F8T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 9 — Blackrock Military Justice LLC (UCMJ)', () => {
  describe('Military Deadlines (300)', () => {
    F9T.forEach(t => test(`T${t.n}: art32=${t.art32Due} speedy=${t.speedyDue}`, () => {
      expect(t.art32Due).toBe(addBus(t.trig,5));
      expect(t.arraignDue).toBe(addBus(t.trig,8));
      expect(t.discovDue).toBe(addCal(t.trig,30));
      expect(t.speedyDue).toBe(addCal(t.trig,120));
      chkSort(t.milDl);
    }));
  });
  describe('Court Type & Discharge (300)', () => {
    F9T.forEach(t => test(`T${t.n}: court=${t.court} branch=${t.branch} disch=${t.likeleDisch}`, () => {
      expect(F9_COURTS).toContain(t.court); expect(F9_BRANCH).toContain(t.branch);
      expect(['Dishonorable','Bad Conduct','OTH','Honorable']).toContain(t.likeleDisch);
      if (t.court==='general') expect(t.maxConf).toBeGreaterThanOrEqual(12);
    }));
  });
  describe('VAR-C/D (300)', () => {
    F9T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.severeCons)  { expect(t.dischargeRisk).toBe(true); expect(t.vulnerability).not.toBe('low'); }
      if (t.negotiatePl) { expect(t.evidence).toBe('strong'); expect(t.court).not.toBe('summary'); }
    }));
  });
  describe('Team Roles (300)', () => {
    F9T.forEach(t => test(`T${t.n}: ${t.ts}-person rank=E${t.rankE}`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(2); expect(t.ts).toBeLessThanOrEqual(5);
      t.roles.forEach(r=>expect(F9_ROLES).toContain(r));
      expect(t.rankE).toBeGreaterThanOrEqual(1); expect(t.rankE).toBeLessThanOrEqual(9);
    }));
  });
  describe('Match Score (300)', () => {
    F9T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

describe('FIRM 10 — Meridian Juvenile & Dependency', () => {
  describe('Juvenile Deadlines (300)', () => {
    F10T.forEach(t => test(`T${t.n}: det=${t.detDue} perm=${t.permDue}`, () => {
      expect(t.detDue).toBe(addBus(t.trig,1));
      expect(t.jurisDue).toBe(addBus(t.trig,15));
      expect(t.reviewDue).toBe(addCal(t.trig,180));
      expect(t.permDue).toBe(addCal(t.trig,365));
      chkSort(t.juvDl);
    }));
  });
  describe('Matter Variables (300)', () => {
    F10T.forEach(t => test(`T${t.n}: track=${t.track} age=${t.age}`, () => {
      expect(F10_TRACKS).toContain(t.track); expect(F10_PLACE).toContain(t.placement);
      expect(F10_RISK).toContain(t.risk);
      expect(t.age).toBeGreaterThanOrEqual(10); expect(t.age).toBeLessThanOrEqual(17);
      expect(t.priorAdj).toBeGreaterThanOrEqual(0); expect(t.priorAdj).toBeLessThanOrEqual(5);
    }));
  });
  describe('Transfer & Expungement (300)', () => {
    F10T.forEach(t => test(`T${t.n}: transfer=${t.transfer} expung=${t.expungElig}`, () => {
      if (t.transfer)    { expect(t.track).toBe('delinquency'); expect(t.age).toBeGreaterThanOrEqual(16); }
      if (t.expungElig)  { expect(t.transfer).toBe(false); expect(t.priorAdj).toBe(0); }
    }));
  });
  describe('VAR-C/D (300)', () => {
    F10T.forEach(t => test(`T${t.n}: vuln=${t.vulnerability} ev=${t.evidence}`, () => {
      chkCD(t);
      if (t.traumaProto)  expect(['high','crisis']).toContain(t.vulnerability);
      if (t.diverOffered) { expect(t.evidence).not.toBe('weak'); expect(t.transfer).toBe(false); expect(t.priorAdj).toBe(0); }
    }));
  });
  describe('Team Roles — solo allowed (300)', () => {
    F10T.forEach(t => test(`T${t.n}: ${t.ts}-person`, () => {
      expect(t.ts).toBeGreaterThanOrEqual(1); expect(t.ts).toBeLessThanOrEqual(5);
      t.roles.forEach(r=>expect(F10_ROLES).toContain(r));
    }));
  });
  describe('Match Score (300)', () => {
    F10T.forEach(t => test(`T${t.n}: score=${t.top.matchScore}`, () => chkScore(t.top)));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CROSS-FIRM AGGREGATE (3,000 trials)
// ═════════════════════════════════════════════════════════════════════════════
describe('Cross-Firm Aggregate (3,000 trials)', () => {
  const ALL=[F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].flat();

  test('Exactly 3,000 trials — 300 per firm', () => {
    expect(ALL.length).toBe(3000);
    [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].forEach(f=>expect(f.length).toBe(N));
  });

  test('Trial numbers 1–300 unique within each firm', () => {
    [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].forEach(f=>{
      const ns=f.map(t=>t.n);
      expect(ns[0]).toBe(1); expect(ns[N-1]).toBe(N); expect(new Set(ns).size).toBe(N);
    });
  });

  test('VAR-A: each value >15% per firm', () => {
    [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].forEach(f=>{
      VAR_A.forEach(v=>{ const p=f.filter(t=>t.timePressure===v).length/N; expect(p).toBeGreaterThan(.15); });
    });
  });

  test('VAR-B: each value >10% per firm', () => {
    [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].forEach(f=>{
      VAR_B.forEach(v=>{ const p=f.filter(t=>t.jurisdiction===v).length/N; expect(p).toBeGreaterThan(.10); });
    });
  });

  test('VAR-C: all 4 vulnerability values appear in every firm', () => {
    [F1T,F2T,F3T,F4T,F5T,F6T,F7T,F8T,F9T,F10T].forEach(f=>{
      VAR_C.forEach(v=>expect(f.some(t=>t.vulnerability===v)).toBe(true));
    });
  });

  test('VAR-D: all 4 evidence buckets appear across 3,000 trials', () => {
    ['weak','contested','moderate','strong'].forEach(b=>
      expect(ALL.some(t=>t.evidence===b)).toBe(true)
    );
    ALL.forEach(t=>expect(t.evidence).toBe(evidenceBucket(t.evidenceScore)));
  });

  test('All 3,000 match scores finite and in valid range', () => {
    ALL.forEach(t=>{ expect(Number.isFinite(t.top.matchScore)).toBe(true); expect(t.top.matchScore).toBeGreaterThanOrEqual(-50); expect(t.top.matchScore).toBeLessThanOrEqual(300); });
  });

  test('F1: dismissed→eligible=true, convicted sexual→eligible=false', () => {
    F1T.filter(t=>t.stat==='Dismissed').forEach(t=>{ expect(t.elig.eligible).toBe(true); expect(t.elig.waitYears).toBe(0); });
    F1T.filter(t=>t.ct==='sexual'&&t.stat==='Convicted').forEach(t=>expect(t.elig.eligible).toBe(false));
  });

  test('F2: punitive multipliers only 3, 5, or 9', () => {
    F2T.filter(t=>t.damages==='compensatory_plus_punitive').forEach(t=>expect([3,5,9]).toContain(t.punMul));
  });

  test('F2: class actions have positive classTotal', () => {
    F2T.filter(t=>t.isClass).forEach(t=>{ expect(t.classTotal).toBeGreaterThan(0); expect(t.classSize).toBeGreaterThanOrEqual(50); });
  });

  test('F3: full_cooperation=30% discount, no_cooperation=0%', () => {
    F3T.filter(t=>t.coop==='full_cooperation').forEach(t=>{ expect(t.disc).toBe(.30); expect(t.adjFine).toBe(Math.round(t.baseFine*.70)); });
    F3T.filter(t=>t.coop==='no_cooperation').forEach(t=>{ expect(t.disc).toBe(0); expect(t.adjFine).toBe(t.baseFine); });
  });

  test('F3: DPA credit = 70% of adjusted fine', () => {
    F3T.filter(t=>t.dpaCredit).forEach(t=>expect(t.effFine).toBe(Math.round(t.adjFine*.7)));
  });

  test('F4: TRO always present iff DV flag set', () => {
    F4T.filter(t=>t.dv).forEach(t=>{ expect(t.troDue).not.toBeNull(); expect(t.troDue).toBe(addBus(t.trig,3)); });
    F4T.filter(t=>!t.dv).forEach(t=>expect(t.troDue).toBeNull());
  });

  test('F5: asylum clock bar only when clockDays>365 AND relief=asylum', () => {
    F5T.filter(t=>t.barred).forEach(t=>{ expect(t.clockDays).toBeGreaterThan(365); expect(t.relief).toBe('asylum'); });
    F5T.filter(t=>t.relief!=='asylum').forEach(t=>expect(t.barred).toBe(false));
  });

  test('F6: net = total × (1 - fault/100)', () => {
    F6T.forEach(t=>expect(t.netDam).toBe(Math.round(t.totalDam*(1-t.pfFault/100))));
  });

  test('F6: punitive only when evidence=strong AND causation=clear', () => {
    F6T.filter(t=>t.punitive>0).forEach(t=>{ expect(t.evidence).toBe('strong'); expect(t.causa).toBe('clear'); });
  });

  test('F7: PD has at least one solo trial', () => {
    expect(F7T.some(t=>t.ts===1)).toBe(true);
  });

  test('F8: federal direct appeal=14 days; state/other=30 days', () => {
    F8T.filter(t=>t.jurisdiction==='federal').forEach(t=>expect(t.directDue).toBe(addCal(t.trig,14)));
    F8T.filter(t=>t.jurisdiction!=='federal').forEach(t=>expect(t.directDue).toBe(addCal(t.trig,30)));
  });

  test('F8: VAR-D strong→de_novo applied standard', () => {
    F8T.filter(t=>t.evidence==='strong').forEach(t=>expect(t.appliedStd).toBe('de_novo'));
  });

  test('F9: general court-martial maxConf ≥ 12 months', () => {
    F9T.filter(t=>t.court==='general').forEach(t=>expect(t.maxConf).toBeGreaterThanOrEqual(12));
  });

  test('F10: transfer only when delinquency AND age≥16', () => {
    F10T.filter(t=>t.transfer).forEach(t=>{ expect(t.track).toBe('delinquency'); expect(t.age).toBeGreaterThanOrEqual(16); });
  });

  test('F10: expungElig=false whenever priorAdj>0', () => {
    F10T.filter(t=>t.priorAdj>0).forEach(t=>expect(t.expungElig).toBe(false));
  });

  test('Haversine: NYC→LA ~3,940 km; same point = 0', () => {
    expect(hkm(40.7128,-74.006,34.0522,-118.2437)).toBeGreaterThan(3900);
    expect(hkm(40.7128,-74.006,34.0522,-118.2437)).toBeLessThan(4000);
    expect(hkm(40,-74,40,-74)).toBe(0);
  });

  test('Business days skip weekends', () => {
    expect(addBus('2025-01-17',1)).toBe('2025-01-20');
    expect(addBus('2025-01-20',5)).toBe('2025-01-27');
    expect(addCal('2025-01-15',7)).toBe('2025-01-22');
  });

  test('daysBetween accuracy', () => {
    expect(daysBetween('2025-01-01','2025-01-31')).toBe(30);
    expect(daysBetween('2025-01-15','2025-01-15')).toBe(0);
    expect(daysBetween('2025-01-15','2026-01-15')).toBe(365);
  });

  test('classifyCharge: Class E/F felony regression', () => {
    expect(classifyCharge('Class E felony — receiving stolen property')).toBe('felony');
    expect(classifyCharge('Class F felony — reckless endangerment')).toBe('felony');
  });

  test('classifyCharge: DUI fires before domestic and homicide keywords', () => {
    expect(classifyCharge('DUI manslaughter — vehicular homicide')).toBe('dui');
    expect(classifyCharge('DWI with child passenger')).toBe('dui');
    expect(classifyCharge('Domestic battery — strangulation')).toBe('domestic');
  });

  test('getEligibility: all 51 jurisdictions return valid objects', () => {
    ALL_STATES.forEach(s=>{
      ['misdemeanor','felony','dui','dismissed','domestic','sexual'].forEach(ct=>{
        const r=getEligibility(s,ct,'Closed');
        expect(r).toHaveProperty('eligible'); expect(r).toHaveProperty('note');
        expect(r.note.length).toBeGreaterThan(0);
      });
    });
  });

  test('evidenceBucket exact boundaries', () => {
    expect(evidenceBucket(0)).toBe('weak');   expect(evidenceBucket(24)).toBe('weak');
    expect(evidenceBucket(25)).toBe('contested'); expect(evidenceBucket(49)).toBe('contested');
    expect(evidenceBucket(50)).toBe('moderate'); expect(evidenceBucket(74)).toBe('moderate');
    expect(evidenceBucket(75)).toBe('strong'); expect(evidenceBucket(100)).toBe('strong');
  });

  test('RBAC hierarchy enforced for new roles', () => {
    expect(hasMinRank('firm_admin','partner')).toBe(true);
    expect(hasMinRank('guardian_ad_litem','partner')).toBe(false);
    expect(hasMinRank('case_manager','paralegal')).toBe(true);
    expect(hasMinRank('mitigation_specialist','associate')).toBe(false);
    expect(hasMinRank('interpreter','viewer')).toBe(true);
    expect(hasMinRank('junior_associate','associate')).toBe(false);
  });

  test('PRNG determinism: same seed → same sequence', () => {
    const r1=makePrng(0xABCD1234), r2=makePrng(0xABCD1234);
    expect(Array.from({length:20},()=>r1.next())).toEqual(Array.from({length:20},()=>r2.next()));
  });

  test('PRNG independence: different seeds → different sequences', () => {
    const r1=makePrng(0x0001), r2=makePrng(0x0002);
    expect(Array.from({length:10},()=>r1.next())).not.toEqual(Array.from({length:10},()=>r2.next()));
  });
});
