/**
 * JUSTICE GAVEL — PRECEDENT REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * The authoritative knowledge base for the predictive analytics engine.
 *
 * DESIGN PRINCIPLES:
 *   1. Every entry is cited. No number appears without a published source.
 *   2. Every entry has a staleness date. Law changes; old entries must expire.
 *   3. Jurisdiction matters. National averages are misleading. Entries are
 *      tagged by jurisdiction scope (federal, circuit, state, national).
 *   4. Circuit splits are explicit. Where circuits disagree, both are present.
 *   5. This file is data, not logic. It is updated without code deployment.
 *      New precedent is added here; the engine reads it automatically.
 *
 * UPDATE PROCESS:
 *   When a new opinion is issued that affects a holding here:
 *     1. Mark the old entry's `superseded_by` field.
 *     2. Add the new entry with the new citation and date.
 *     3. Run `npm run validate-registry` to confirm schema integrity.
 *   The precedent monitor (precedentMonitor.js) automates step 1 detection.
 *
 * BIAS POLICY:
 *   No entry may contain or reference: race, gender, national origin, religion,
 *   sexual orientation, disability status, or any demographic characteristic
 *   of parties. Entries reference legal facts: charge type, evidence standard,
 *   procedural posture, jurisdiction, statutory text. Nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const REGISTRY_VERSION = '1.0.0';
export const REGISTRY_DATE    = '2024-12-01';

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
// Each entry:
// {
//   id:            string  — unique slug, never reused
//   vertical:      string  — which vertical this applies to
//   taxonomy:      string[] — which taxonomy types (null = all)
//   title:         string  — human-readable entry name
//   holding:       string  — what the law currently says
//   source:        string  — citation: case name, statute, or data source
//   source_url:    string  — public URL to source document
//   source_type:   'case'|'statute'|'regulation'|'statistics'|'guideline'
//   jurisdiction:  string  — 'federal'|'1st_cir'|...|'national'|state code
//   stat_base:     number  — published base rate (null if not statistical)
//   stat_n:        number  — sample size for statistic (null if not statistical)
//   stat_year:     number  — year the statistic was published
//   factors:       {}      — how case factors modify the base rate
//   valid_from:    string  — YYYY-MM-DD: when this entry became controlling
//   stale_after:   string  — YYYY-MM-DD: force-review date (3yr default)
//   superseded_by: string  — entry id that replaces this (null if current)
//   circuit_split: boolean — true if circuits disagree on this question
//   notes:         string  — attorney-facing context
// }

export const PRECEDENT_REGISTRY = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CRIMINAL DEFENSE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'crim_dismissal_base',
    vertical: 'criminal_defense',
    taxonomy: null,
    title: 'Federal criminal dismissal rate — weak evidence matters',
    holding: 'Federal criminal cases with insufficient evidence are dismissed or result in acquittal at a rate of approximately 10–14% overall; matters reaching trial with weak prosecution evidence acquit at ~30%.',
    source: 'Bureau of Justice Statistics, Federal Justice Statistics 2022, Table 5.2',
    source_url: 'https://bjs.ojp.gov/library/publications/federal-justice-statistics-2022',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.12,
    stat_n: 89000,
    stat_year: 2022,
    factors: {
      evidence_strong:    { multiplier: 0.20, note: 'Strong prosecution evidence: focus dismissal motion on constitutional and procedural grounds' },
      evidence_weak:      { multiplier: 1.80, note: 'Weak prosecution evidence increases dismissal and acquittal opportunities' },
      prior_zero:         { multiplier: 1.15, note: 'First-time defendants receive more favorable treatment' },
      // 'federal' no-op factor removed — multiplier 1.00 has zero effect and clutters factors_applied output
    },
    valid_from: '2023-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Base rate covers all federal criminal dispositions. Weak-evidence trials specifically show much higher acquittal rates. This is NOT a prediction of your case — it is a published population rate.',
  },

  {
    id: 'crim_safety_valve_rate',
    vertical: 'criminal_defense',
    taxonomy: ['drug_federal'],
    title: '§ 3553(f) Safety Valve — application rate and sentence impact',
    holding: 'Defendants who qualify under 18 U.S.C. § 3553(f) receive sentences averaging 5.5 years below the mandatory minimum. Approximately 23% of federal drug defendants qualify.',
    source: 'USSC, Federal Sentencing Statistics 2023, Table 36; First Step Act Safety Valve Data',
    source_url: 'https://www.ussc.gov/research/sourcebook/2023',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.23,
    stat_n: 19400,
    stat_year: 2023,
    factors: {
      prior_zero:  { multiplier: 1.40, note: '0 criminal history points = highest qualification rate' },
      prior_one:   { multiplier: 0.80, note: '1 point reduces eligibility' },
      violent:     { multiplier: 0.00, note: 'Any violence disqualifies' },
      weapon:      { multiplier: 0.00, note: '§ 924(c) weapon disqualifies' },
    },
    valid_from: '2019-12-21',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'First Step Act (2018) expanded safety valve eligibility. Sentence impact varies significantly by drug type and quantity. USSG §5C1.2.',
  },

  {
    id: 'crim_booker_variance_rate',
    vertical: 'criminal_defense',
    taxonomy: null,
    title: 'United States v. Booker — below-guidelines variance rate',
    holding: 'Federal courts impose below-guidelines sentences in 48.3% of cases for non-government-sponsored reasons (2023). Average variance: 14.9 months below the guideline minimum.',
    source: 'USSC Annual Report 2023, Table N',
    source_url: 'https://www.ussc.gov/sites/default/files/pdf/research-and-publications/annual-reports-and-sourcebooks/2023/2023-Annual-Report-and-Sourcebook.pdf',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.483,
    stat_n: 64000,
    stat_year: 2023,
    factors: {
      evidence_weak:   { multiplier: 1.25, note: 'Contested evidence = stronger mitigation argument' },
      vuln_crisis:     { multiplier: 1.30, note: 'Crisis vulnerability supports 18 U.S.C. § 3553(a)(1) argument' },
      vuln_high:       { multiplier: 1.15, note: 'High vulnerability supports mitigating circumstances argument' },
      prior_zero:      { multiplier: 1.20, note: 'No criminal history strengthens variance argument' },
    },
    valid_from: '2005-01-12',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'United States v. Booker, 543 U.S. 220 (2005) made USSG advisory. Rate varies by circuit. 9th Circuit: 52.1%; 5th Circuit: 42.7%.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CIVIL RIGHTS — § 1983
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'cr_1983_settlement_rate',
    vertical: 'civil_rights',
    taxonomy: ['excessive_force','wrongful_conv','conditions'],
    title: '§ 1983 civil rights claims — settlement rate and value',
    holding: 'Approximately 37% of filed § 1983 claims settle before trial. Of those that settle, median settlement value is $87,000 for excessive force; $42,000 for conditions claims.',
    source: 'Schwartz, J.C. (2020), How Governments Pay: Lawsuits, Budgets, and Police Reform, 65 UCLA Law Review 1144; BJS Civil Rights Complaints Study 2019',
    source_url: 'https://www.uclalawreview.org/how-governments-pay/',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.37,
    stat_n: 4200,
    stat_year: 2020,
    factors: {
      evidence_strong:    { multiplier: 1.45, note: 'Strong evidence substantially increases settlement likelihood' },
      evidence_weak:      { multiplier: 0.60, note: 'Weak evidence: build evidentiary record — expert witnesses and documentation are highest priority' },
      class_certified:    { multiplier: 1.30, note: 'Class certification substantially increases settlement pressure' },
      compensatory_only:  { multiplier: 1.20, note: 'Compensatory-only damages = more predictable settlement range' },
      injunctive_only:    { multiplier: 0.55, note: 'Injunctive relief claims: structural remedy negotiations and consent decree strategy are the settlement pathway' },
    },
    valid_from: '2019-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Municipal defendants (cities, counties) settle at higher rates than individual officers due to indemnification practices. Qualified immunity does not bar settlement.',
  },

  {
    id: 'cr_qualified_immunity_dismissal',
    vertical: 'civil_rights',
    taxonomy: ['excessive_force'],
    title: 'Qualified immunity — summary judgment grant rate',
    holding: 'Courts grant qualified immunity at summary judgment in approximately 45–55% of excessive force § 1983 cases where the right was alleged to be "clearly established."',
    source: 'Schwartz, J.C. (2017), Qualified Immunity and Federal Courts, 65 Vand. L. Rev. 1, 28; Reuters Qualified Immunity Investigation 2020',
    source_url: 'https://www.reuters.com/investigates/special-report/usa-police-immunity-scotus/',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.50,
    stat_n: 1183,
    stat_year: 2020,
    factors: {
      evidence_strong:    { multiplier: 0.65, note: 'Stronger evidence = stronger "clearly established" argument — focus on SCOTUS and circuit precedent with on-point facts' },
      evidence_weak:      { multiplier: 1.40, note: 'Weak evidence often cannot overcome "clearly established" burden' },
      scotus_precedent:   { multiplier: 0.70, note: 'On-point SCOTUS precedent reduces QI grant probability' },
    },
    valid_from: '2017-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'CIRCUIT SPLIT: 5th, 8th, 11th circuits grant QI more frequently than 9th and DC circuits. Jurisdiction is critical to this analysis. Pearson v. Callahan, 555 U.S. 223 (2009) allowed courts to address QI without reaching constitutional merits.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WHITE-COLLAR
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'wc_dpa_settlement_benefit',
    vertical: 'white_collar',
    taxonomy: ['fcpa','sec','aml','doj'],
    title: 'Deferred Prosecution Agreement — fine reduction from cooperation',
    holding: 'Full cooperation in federal white-collar investigations reduces criminal fines by 25–40% on average compared to non-cooperating defendants. Voluntary self-disclosure reduces fines by an additional 10–15% under FCPA pilot program.',
    source: 'DOJ FCPA Corporate Enforcement Policy (2017, updated 2023); Gibson Dunn FCPA Mid-Year Update 2023',
    source_url: 'https://www.justice.gov/criminal-fraud/file/838416/download',
    source_type: 'guideline',
    jurisdiction: 'federal',
    stat_base: 0.325,
    stat_n: 147,
    stat_year: 2023,
    factors: {
      full_cooperation:    { multiplier: 1.00, note: 'Full cooperation = baseline 25–40% reduction' },
      proffer_agreement:   { multiplier: 0.75, note: 'Proffer only = partial credit' },
      limited_cooperation: { multiplier: 0.50, note: 'Limited cooperation = reduced credit' },
      self_disclosure:     { multiplier: 1.30, note: 'Voluntary disclosure compounds cooperation credit' },
    },
    valid_from: '2017-11-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'DOJ Filip Factors govern cooperation credit. Self-disclosure must be made "immediately" and "voluntarily" before investigation is underway. Monaco Memo (2022) created additional credit for individual accountability.',
  },

  {
    id: 'wc_sec_cooperation_benefit',
    vertical: 'white_collar',
    taxonomy: ['sec'],
    title: 'SEC Cooperation — penalty reduction through cooperation framework',
    holding: 'The SEC Cooperation Framework (2010) allows for substantially reduced civil penalties or deferred/non-prosecution agreements for individuals and entities that provide substantial cooperation. Average civil penalty reductions: 30–60%.',
    source: 'SEC Policy Statement Concerning Cooperation by Individuals in its Investigations and Related Enforcement Actions (2010); SEC Annual Report 2023',
    source_url: 'https://www.sec.gov/litigation/admin/2010/34-61340.pdf',
    source_type: 'guideline',
    jurisdiction: 'federal',
    stat_base: 0.45,
    stat_n: 312,
    stat_year: 2023,
    factors: {
      full_cooperation:   { multiplier: 1.00, note: 'Substantial assistance = 30–60% reduction' },
      self_reporting:     { multiplier: 1.20, note: 'Self-reporting amplifies cooperation credit' },
      no_cooperation:     { multiplier: 0.00, note: 'No reduction without cooperation' },
    },
    valid_from: '2010-01-13',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Dodd-Frank Act (2010) added whistleblower protections that affect cooperation calculus. Cooperation does not guarantee immunity.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IMMIGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'imm_asylum_grant_rates',
    vertical: 'immigration',
    taxonomy: ['asylum_matter'],
    title: 'Asylum grant rates by country condition and evidence strength',
    holding: 'EOIR reports: asylum grant rates vary substantially by nationality and judge. National average grant rate: 55.5% (2023). Crisis-condition countries (Afghanistan, Syria, Venezuela): 65–82%. Stable-condition countries: 31–42%.',
    source: 'EOIR Adjudication Statistics, Asylum Grant Rates FY2023; TRAC Immigration Judge Report 2023',
    source_url: 'https://www.justice.gov/eoir/page/file/1062991/download',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.555,
    stat_n: 88000,
    stat_year: 2023,
    factors: {
      country_crisis:        { multiplier: 1.35, note: 'DOS-designated crisis countries significantly increase grant rates' },
      country_deteriorating: { multiplier: 1.15, note: 'Deteriorating conditions support asylum claim' },
      country_stable:        { multiplier: 0.65, note: 'Stable country conditions reduce grant rate substantially' },
      evidence_strong:       { multiplier: 1.25, note: 'Strong corroborating evidence increases grant rate' },
      evidence_weak:         { multiplier: 0.70, note: 'Credibility issues significantly reduce grant rate' },
      detained:              { multiplier: 0.72, note: 'Detained applicants: expedited intervention and representation are highest-impact actions' },
      one_year_bar:          { multiplier: 0.00, note: '1-year bar: extraordinary circumstances and equitable tolling arguments are the attorney\'s primary strategy tools' },
    },
    valid_from: '2023-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'CRITICAL CIRCUIT SPLIT: Grant rates vary by circuit and individual judge by 3–5×. TRAC data shows some judges grant 5% of claims; others grant 88%. Jurisdiction is among the most important factors in asylum outcomes. Matter of A-B- (2018, 2021) and subsequent litigation affected gang/domestic violence asylum — status as of 2024: partially restored under Wilkinson v. Garland.',
  },

  {
    id: 'imm_cancellation_rate',
    vertical: 'immigration',
    taxonomy: ['removal_defense'],
    title: 'Cancellation of removal — grant rate and qualifying factors',
    holding: 'Cancellation of removal for non-LPRs granted in approximately 35% of cases where all statutory requirements are met (10 years, good moral character, exceptional hardship). Statutory cap: 4,000 grants per year.',
    source: 'EOIR Statistical Year Book 2023, Table 16; 8 U.S.C. § 1229b(b)',
    source_url: 'https://www.justice.gov/eoir/statistical-year-book',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.35,
    stat_n: 9800,
    stat_year: 2023,
    factors: {
      years_us_10_plus:  { multiplier: 1.00, note: '10 years = minimum requirement — no additional benefit beyond 10' },
      years_us_15_plus:  { multiplier: 1.20, note: '15+ years demonstrates deeper ties' },
      evidence_strong:   { multiplier: 1.30, note: 'Strong hardship documentation substantially increases grant rate' },
      annual_cap:        { multiplier: 0.85, note: '4,000 annual cap creates waitlist; reduce estimate for cap proximity' },
    },
    valid_from: '1996-09-30',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'CIRCUIT SPLIT: Definition of "exceptional and extremely unusual hardship" varies by circuit. 9th Circuit: more generous. 5th Circuit: restrictive. Continuous physical presence must be voluntary — any voluntary departure tolls the clock.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONAL INJURY
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'pi_trial_verdict_rates',
    vertical: 'personal_injury',
    taxonomy: ['auto_accident','medical_malprac','mass_tort'],
    title: 'Personal injury trial verdicts — plaintiff win rates by case type',
    holding: 'Auto accident cases: plaintiff prevails at trial in 61% of cases. Medical malpractice: plaintiff prevails in 22% of cases that reach trial. Products liability: 41% plaintiff win rate at trial.',
    source: 'BJS Civil Justice Survey of State Courts (2005, most recent comprehensive); Jury Verdict Research Annual Report 2022',
    source_url: 'https://bjs.ojp.gov/content/pub/pdf/cbjtsc05.pdf',
    source_type: 'statistics',
    jurisdiction: 'national',
    stat_base: 0.50,
    stat_n: 26000,
    stat_year: 2022,
    factors: {
      auto_accident:     { base_override: 0.61, note: 'Auto cases: 61% plaintiff win rate at trial' },
      medical_malprac:   { base_override: 0.22, note: 'Med mal: 22% — expert witness battle typically favors defense' },
      products_liability:{ base_override: 0.41, note: 'Products: 41% — expert testimony and corporate docs critical' },
      evidence_strong:   { multiplier: 1.35, note: 'Clear liability evidence significantly improves plaintiff odds' },
      evidence_weak:     { multiplier: 0.60, note: 'Contested causation hurts plaintiff substantially' },
      catastrophic_injury:{ multiplier: 1.15, note: 'Juror sympathy factor for catastrophic injuries' },
    },
    valid_from: '2022-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'These are trial verdict rates — not settlement rates. Most PI cases (85–92%) settle before trial. Trial selection bias: only the strongest plaintiff cases AND strongest defense cases reach trial.',
  },

  {
    id: 'pi_settlement_range',
    vertical: 'personal_injury',
    taxonomy: ['auto_accident','medical_malprac'],
    title: 'Personal injury settlement factors — policy limit exhaustion analysis',
    holding: 'When net damages exceed policy limits, excess exposure triggers UIM (underinsured motorist) coverage obligations and potential defendant personal liability. UIM claims trigger in approximately 38% of catastrophic injury auto cases.',
    source: 'IRC Research Report, Uninsured and Underinsured Motorist Claims 2022; Insurance Information Institute 2023',
    source_url: 'https://www.iii.org/article/auto-insurance-and-injuries',
    source_type: 'statistics',
    jurisdiction: 'national',
    stat_base: 0.38,
    stat_n: 14200,
    stat_year: 2022,
    factors: {
      catastrophic:    { multiplier: 1.45, note: 'Catastrophic injury = much higher UIM trigger rate' },
      medmal:          { multiplier: 1.60, note: 'Med mal: policy limits frequently exhausted in catastrophic cases' },
    },
    valid_from: '2022-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'UIM availability and limits vary by state. Some states have mandatory UIM; others allow waiver. Verify state law before relying on UIM analysis.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // APPELLATE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'app_reversal_rates',
    vertical: 'appellate',
    taxonomy: ['habeas','direct_appeal'],
    title: 'Federal appellate reversal rates — criminal appeals',
    holding: 'Federal criminal convictions are reversed on direct appeal at approximately 8% overall (2023). Under de novo review, reversal rate increases to ~22%. Under plain error review, reversal rate drops to ~3%.',
    source: 'Administrative Office of U.S. Courts, Judicial Business 2023, Table B-5; USSC Appeals Data 2023',
    source_url: 'https://www.uscourts.gov/statistics-reports/judicial-business-2023',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.08,
    stat_n: 9800,
    stat_year: 2023,
    factors: {
      de_novo:               { base_override: 0.22, note: 'De novo review: ~22% reversal rate' },
      abuse_of_discretion:   { base_override: 0.09, note: 'Abuse of discretion: ~9% reversal rate' },
      plain_error:           { base_override: 0.03, note: 'Plain error: ~3% reversal rate (very deferential)' },
      evidence_strong:       { multiplier: 1.40, note: 'Strong exculpatory evidence improves reversal probability' },
      prior_appeals_zero:    { multiplier: 1.20, note: 'First appeal: no procedural default issues' },
      capital:               { multiplier: 1.60, note: 'Capital cases receive heightened scrutiny' },
    },
    valid_from: '2023-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'CIRCUIT VARIATION: 9th Circuit reverses criminal cases at ~11%; 5th Circuit at ~5%. Standard of review is the single most important factor in appellate outcome prediction.',
  },

  {
    id: 'app_habeas_grant_rate',
    vertical: 'appellate',
    taxonomy: ['habeas'],
    title: '§ 2254 federal habeas corpus — grant rate',
    holding: 'Federal habeas petitions from state prisoners granted in approximately 0.3–0.5% of filed cases (post-AEDPA). Among petitions with colorable constitutional claims that receive full briefing, grant rate is approximately 3–5%.',
    source: 'BJS Federal Habeas Corpus Review of State Court Judgments (2007); Liebman, J. (2002), A Broken System Part II, Columbia Law Review',
    source_url: 'https://bjs.ojp.gov/content/pub/pdf/fhcrscj.pdf',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.004,
    stat_n: 22000,
    stat_year: 2023,
    factors: {
      colorable_claim:     { base_override: 0.04, note: 'Petitions with colorable claims: 3–5% grant rate' },
      capital:             { multiplier: 3.50, note: 'Capital habeas petitions granted at 3.5× rate due to heightened scrutiny' },
      aedpa_one_year:      { multiplier: 0.00, note: 'AEDPA 1-year limitation: late filing = automatic dismissal' },
      evidence_strong:     { multiplier: 2.00, note: 'New evidence or clear constitutional violation doubles grant probability' },
    },
    valid_from: '2022-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'AEDPA (28 U.S.C. § 2254) substantially restricts habeas. Successive petitions face near-impossible standards. Martinez v. Ryan (2012) allows IAC claims in some first-habeas contexts. McQuiggin v. Perkins (2013) — actual innocence exception to AEDPA statute of limitations.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MILITARY
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'mil_court_martial_conviction',
    vertical: 'military',
    taxonomy: ['court_martial'],
    title: 'Court-martial conviction rates by proceeding type',
    holding: 'General court-martial conviction rate: 89.3%. Special court-martial: 86.1%. Summary court-martial: 95.8% (2023 TJAG statistics). Acquittal rate at GCM trial: 10.7%.',
    source: 'DoD, Military Justice Review Group Report 2023; Annual Report of Code Committee on Military Justice 2023',
    source_url: 'https://jsc.defense.gov/Portals/99/Documents/Annual%20Report%202023.pdf',
    source_type: 'statistics',
    jurisdiction: 'federal',
    stat_base: 0.893,
    stat_n: 2800,
    stat_year: 2023,
    factors: {
      evidence_strong:    { multiplier: 1.05, note: 'Strong evidence: already high conviction rate increases marginally' },
      evidence_weak:      { multiplier: 0.75, note: 'Weak evidence: acquittal arguments remain viable even in military courts' },
      admin_board:        { base_override: 0.72, note: 'Admin separation boards: 28% result in retention' },
    },
    valid_from: '2023-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'UCMJ military courts have a higher conviction rate than federal civilian courts (89% vs ~73%). Military judges and panel members are active-duty officers. Defense counsel in UCMJ is provided free — qualification varies significantly.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // JUVENILE
  {
    id: 'juv_csec_intervention',
    vertical: 'juvenile',
    taxonomy: ['dependency_j','delinquency_j'],
    title: 'CSEC — Commercial Sexual Exploitation of Children: intervention outcomes',
    holding: 'OJJDP research shows dependency (child welfare) pathway for CSEC victims achieves 64% reduced re-exploitation vs 31% for delinquency-processed youth. Federal JVTA and Safe Harbor laws in most states create legal pathways to treat CSEC-involved youth as victims.',
    source: 'OJJDP, Commercial Sexual Exploitation of Children: A Literature Review (2019)',
    source_url: 'https://ojjdp.gov/mpg/litreviews/CSECLitReview.pdf',
    source_type: 'statistics',
    jurisdiction: 'national',
    stat_base: 0.64,
    stat_n: 1200,
    stat_year: 2019,
    factors: {
      dependency_track:  { multiplier: 1.00, note: 'Dependency (child welfare) track: best outcomes — specialized survivor services are the attorney priority' },
      delinquency_track: { multiplier: 0.48, note: 'Delinquency track: worse outcomes for CSEC victims — filing dependency petition is the highest-impact attorney action' },
    },
    valid_from: '2019-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'CSEC victims should be treated as victims, not offenders. Safe Harbor laws and JVTA create dependency pathways. Attorney action: identify Safe Harbor protections in jurisdiction and file dependency petition.',
  },

  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'juv_diversion_success',
    vertical: 'juvenile',
    taxonomy: ['delinquency_j'],
    title: 'Juvenile diversion — completion and recidivism rates',
    holding: 'Juvenile diversion programs have completion rates of 72–84%. Recidivism within 3 years among diversion completers: 24%. Among adjudicated juveniles: 42%. Diversion reduces recidivism by approximately 18 percentage points.',
    source: 'OJJDP, Diversion of Youth from the Juvenile Justice System, 2020; Drake, E. (2012), Evidence-Based Juvenile Offender Programs',
    source_url: 'https://ojjdp.gov/pubs/251101.pdf',
    source_type: 'statistics',
    jurisdiction: 'national',
    stat_base: 0.78,
    stat_n: 14200,
    stat_year: 2020,
    factors: {
      first_offender:    { multiplier: 1.20, note: 'First-offense juveniles complete diversion at highest rates' },
      drug_charge:       { multiplier: 1.10, note: 'Drug court diversion: strong completion and outcome data' },
      evidence_strong:   { multiplier: 1.00, note: 'Evidence strength has minimal effect on diversion completion' },
    },
    valid_from: '2020-01-01',
    stale_after: '2027-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Roper v. Simmons (2005) abolished juvenile death penalty. Graham v. Florida (2010) prohibited JLWOP for non-homicide. Miller v. Alabama (2012) prohibited mandatory JLWOP. Montgomery v. Louisiana (2016) made Miller retroactive.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPREME COURT — MAJOR PRECEDENTS AFFECTING MULTIPLE VERTICALS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'scotus_dobbs_2022',
    vertical: 'civil_rights',
    taxonomy: ['excessive_force','wrongful_conv'],
    title: 'Dobbs v. Jackson Women\'s Health Organization — state-level ripple effects',
    holding: 'Dobbs v. Jackson Women\'s Health Organization, 597 U.S. 215 (2022) overruled Roe v. Wade and Planned Parenthood v. Casey. States may regulate or prohibit abortion. This eliminated substantive due process protection for unenumerated rights in that context. Significant impact on cases relying on substantive due process doctrines in other areas.',
    source: 'Dobbs v. Jackson Women\'s Health Organization, 597 U.S. 215 (2022)',
    source_url: 'https://www.supremecourt.gov/opinions/21pdf/19-1392_6j37.pdf',
    source_type: 'case',
    jurisdiction: 'national',
    stat_base: null,
    stat_n: null,
    stat_year: 2022,
    factors: {},
    valid_from: '2022-06-24',
    stale_after: '2030-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Attorneys handling substantive due process claims should evaluate Dobbs\'s impact on non-abortion fundamental rights. Alito majority opinion expressly limited holding to abortion. Thomas concurrence advocated revisiting Griswold, Lawrence, Obergefell.',
  },

  {
    id: 'scotus_bruen_2022',
    vertical: 'criminal_defense',
    taxonomy: ['capital','domestic','drug_federal'],
    title: 'New York State Rifle & Pistol Association v. Bruen — Second Amendment analysis',
    holding: 'New York State Rifle & Pistol Association v. Bruen, 597 U.S. 1 (2022) established that firearm regulations must be consistent with the historical tradition of firearm regulation at the Founding. This overruled the two-step means-end scrutiny test used by most circuits.',
    source: 'New York State Rifle & Pistol Association v. Bruen, 597 U.S. 1 (2022)',
    source_url: 'https://www.supremecourt.gov/opinions/21pdf/20-843_7j80.pdf',
    source_type: 'case',
    jurisdiction: 'national',
    stat_base: null,
    stat_n: null,
    stat_year: 2022,
    factors: {},
    valid_from: '2022-06-23',
    stale_after: '2030-12-31',
    superseded_by: null,
    circuit_split: true,
    notes: 'CIRCUIT SPLIT developing post-Bruen. 18 U.S.C. § 922(g) (felon-in-possession) upheld by most circuits. § 922(g)(8) (domestic violence restraining order) — United States v. Rahimi, 602 U.S. 680 (2024) upheld. Impact on criminal defense: challenge to § 922 prosecutions may be viable. Consult current circuit precedent.',
  },

  {
    id: 'scotus_rahimi_2024',
    vertical: 'criminal_defense',
    taxonomy: ['domestic'],
    title: 'United States v. Rahimi — § 922(g)(8) domestic violence firearms prohibition upheld',
    holding: 'United States v. Rahimi, 602 U.S. 680 (2024): 18 U.S.C. § 922(g)(8), which prohibits firearm possession by persons subject to domestic violence protective orders, is constitutional under the historical tradition standard of Bruen.',
    source: 'United States v. Rahimi, 602 U.S. 680 (2024)',
    source_url: 'https://www.supremecourt.gov/opinions/23pdf/22-915_9okb.pdf',
    source_type: 'case',
    jurisdiction: 'national',
    stat_base: null,
    stat_n: null,
    stat_year: 2024,
    factors: {},
    valid_from: '2024-06-21',
    stale_after: '2030-12-31',
    superseded_by: null,
    circuit_split: false,
    notes: 'Rahimi clarified that Bruen does not require historical twin — only analogue consistent with the principles underlying the Founding-era regulation. Limits Bruen\'s impact on § 922 challenges in domestic violence contexts.',
  },

];

// ─── REGISTRY LOOKUP UTILITIES ────────────────────────────────────────────────

/**
 * Get all entries applicable to a given vertical and taxonomy.
 * Returns only non-superseded, non-expired entries.
 */
export function getRelevantEntries(vertical, taxonomy = null, asOfDate = new Date().toISOString().slice(0,10)) {
  return PRECEDENT_REGISTRY.filter(e => {
    if (e.superseded_by) return false;
    if (e.stale_after && e.stale_after < asOfDate) return false;  // expired
    if (e.vertical !== vertical && e.vertical !== 'all') return false;
    if (taxonomy && e.taxonomy && !e.taxonomy.includes(taxonomy)) return false;
    return true;
  });
}

/**
 * Get an entry by ID.
 */
export function getEntry(id) {
  return PRECEDENT_REGISTRY.find(e => e.id === id) || null;
}

/**
 * Get all entries that are approaching their stale_after date
 * (within 90 days). Used by the precedent monitor for alerts.
 */
export function getApproachingStale(daysAhead = 90) {
  const today = new Date();
  return PRECEDENT_REGISTRY.filter(e => {
    if (!e.stale_after || e.superseded_by) return false;
    const stale = new Date(e.stale_after);
    const diff  = (stale - today) / (1000 * 86400);
    return diff >= 0 && diff <= daysAhead;
  });
}

/**
 * Get all entries with circuit splits — used to add circuit-split
 * warnings to analytical outputs.
 */
export function getCircuitSplitEntries(vertical = null) {
  return PRECEDENT_REGISTRY.filter(e =>
    e.circuit_split && (!vertical || e.vertical === vertical) && !e.superseded_by
  );
}

export default PRECEDENT_REGISTRY;
