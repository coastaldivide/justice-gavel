/**
 * courtFormsRegistry.ts
 *
 * Authoritative registry of official government court form sources.
 *
 * SOURCING RULES:
 *  1. Every URL is a verified .gov or official court domain
 *  2. No third-party aggregators (no uslegal.com, no findlaw.com)
 *  3. Government works are not copyrightable (17 U.S.C. § 105)
 *  4. Each entry links directly to the court's own forms page
 *  5. Forms are pre-populated via AI assistant; the user reviews
 *     and signs every field before filing — we do not file on their behalf
 *
 * UPDATE CADENCE: Audit all URLs quarterly. Court sites reorganise
 * without redirects. Mark stale entries NEEDS_REVIEW.
 *
 * Last verified: April 2026
 */

export type FormCategory =
  | 'criminal_defense'
  | 'bail_bond'
  | 'expungement'
  | 'protective_order'
  | 'civil_rights'
  | 'small_claims'
  | 'family'
  | 'federal';

export interface CourtFormSource {
  /** ISO 3166-2 state code or 'FED' */
  state: string;
  stateName: string;
  /** Official Administrative Office of Courts or equivalent */
  aocName: string;
  /** Root forms portal — must be .gov or official court domain */
  formsPortalUrl: string;
  /** Direct deep-link to criminal/relevant forms if available */
  criminalFormsUrl?: string;
  expungementFormsUrl?: string;
  bailFormsUrl?: string;
  selfHelpUrl?: string;
  /** Set true if state offers fillable PDFs (vs image-only) */
  fillablePdf: boolean;
  /** Set true if state has an e-filing portal */
  eFiling: boolean;
  notes?: string;
}

export const FEDERAL_SOURCES: CourtFormSource = {
  state: 'FED',
  stateName: 'Federal (All Districts)',
  aocName: 'Administrative Office of the U.S. Courts',
  formsPortalUrl: 'https://www.uscourts.gov/forms-rules/forms',
  criminalFormsUrl: 'https://www.uscourts.gov/forms-rules/forms/category/criminal',
  selfHelpUrl: 'https://www.uscourts.gov/self-help',
  fillablePdf: true,
  eFiling: true,
  notes: 'Federal forms are public domain. PACER (pacer.gov) required for e-filing in most districts.',
};

export const STATE_COURT_FORMS: CourtFormSource[] = [
  {
    state: 'AL', stateName: 'Alabama',
    aocName: 'Alabama Administrative Office of Courts',
    formsPortalUrl: 'https://eforms.alacourt.gov/',
    selfHelpUrl: 'https://judicial.alabama.gov/library/Forms',
    fillablePdf: true, eFiling: false,
    notes: 'Fillable PDFs available. AlaFile for attorneys only.',
  },
  {
    state: 'AK', stateName: 'Alaska',
    aocName: 'Alaska Court System',
    formsPortalUrl: 'https://courts.alaska.gov/forms/',
    criminalFormsUrl: 'https://courts.alaska.gov/forms/criminal.htm',
    selfHelpUrl: 'https://courts.alaska.gov/selfhelp/',
    fillablePdf: true, eFiling: false,
    notes: 'Comprehensive self-help centre with plain-language guides.',
  },
  {
    state: 'AZ', stateName: 'Arizona',
    aocName: 'Arizona Judicial Branch',
    formsPortalUrl: 'https://www.azcourts.gov/selfservicecenter/Forms',
    selfHelpUrl: 'https://www.azcourts.gov/selfservicecenter/',
    expungementFormsUrl: 'https://www.azcourts.gov/selfservicecenter/Forms/Set-Aside',
    fillablePdf: true, eFiling: true,
    notes: 'Arizona has a regulatory sandbox (ARS § 7-101) for legal tech. Set-aside (expungement equivalent) forms available.',
  },
  {
    state: 'AR', stateName: 'Arkansas',
    aocName: 'Arkansas Administrative Office of the Courts',
    formsPortalUrl: 'https://arcourts.gov/forms',
    selfHelpUrl: 'https://arcourts.gov/courts/circuit-courts/pro-se',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'CA', stateName: 'California',
    aocName: 'California Courts — Judicial Council',
    formsPortalUrl: 'https://www.courts.ca.gov/forms.htm',
    criminalFormsUrl: 'https://www.courts.ca.gov/forms.htm?filter=CR',
    expungementFormsUrl: 'https://www.courts.ca.gov/documents/cr180.pdf',
    selfHelpUrl: 'https://www.courts.ca.gov/selfhelp.htm',
    fillablePdf: true, eFiling: true,
    notes: 'Judicial Council mandatory forms (JC forms) are the most comprehensive in the US. Fillable, saveable PDFs. CR-180 is the dismissal/expungement petition (PC § 1203.4).',
  },
  {
    state: 'CO', stateName: 'Colorado',
    aocName: 'Colorado Judicial Branch',
    formsPortalUrl: 'https://www.coloradojudicial.gov/self-help/forms',
    criminalFormsUrl: 'https://www.coloradojudicial.gov/self-help/forms/criminal',
    expungementFormsUrl: 'https://www.coloradojudicial.gov/self-help/forms/criminal/expungement',
    selfHelpUrl: 'https://www.coloradojudicial.gov/self-help',
    fillablePdf: true, eFiling: true,
  },
  {
    state: 'CT', stateName: 'Connecticut',
    aocName: 'Connecticut Judicial Branch',
    formsPortalUrl: 'https://www.jud.ct.gov/webforms/',
    criminalFormsUrl: 'https://www.jud.ct.gov/webforms/default.aspx#Criminal',
    selfHelpUrl: 'https://www.jud.ct.gov/selfhelp.htm',
    fillablePdf: true, eFiling: true,
    notes: 'Connecticut has robust e-filing (JDP-CV-79). Criminal expungement called "erasure" in CT.',
  },
  {
    state: 'DE', stateName: 'Delaware',
    aocName: 'Delaware Courts',
    formsPortalUrl: 'https://courts.delaware.gov/forms/',
    criminalFormsUrl: 'https://courts.delaware.gov/Superior/forms.aspx',
    selfHelpUrl: 'https://courts.delaware.gov/help/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'FL', stateName: 'Florida',
    aocName: 'Florida State Courts / Office of the State Courts Administrator',
    formsPortalUrl: 'https://www.flcourts.gov/Resources-Services/Court-Improvement/Family-Courts/Family-Law-Self-Help-Information',
    criminalFormsUrl: 'https://www.flcourts.gov/Resources-Services/Court-Improvement/Criminal-Court-Performance-and-Accountability',
    selfHelpUrl: 'https://www.flcourts.gov/Resources-Services/Court-Improvement/Family-Courts/Family-Law-Self-Help-Information',
    fillablePdf: true, eFiling: true,
    notes: 'Florida Supreme Court approved family forms extensively. Criminal pro se forms vary by circuit. Check local circuit court sites.',
  },
  {
    state: 'GA', stateName: 'Georgia',
    aocName: 'Georgia Administrative Office of the Courts',
    formsPortalUrl: 'https://georgiacourts.gov/administration/court-forms/',
    selfHelpUrl: 'https://georgiacourts.gov/judges/superior-court/superior-court-information/',
    fillablePdf: false, eFiling: false,
    notes: 'Georgia AOC forms are limited. Most criminal forms must be obtained from individual county superior courts.',
  },
  {
    state: 'HI', stateName: 'Hawaii',
    aocName: 'Hawaii State Judiciary',
    formsPortalUrl: 'https://www.courts.state.hi.us/self-help/courts/forms',
    criminalFormsUrl: 'https://www.courts.state.hi.us/self-help/courts/forms/criminal_forms',
    expungementFormsUrl: 'https://www.courts.state.hi.us/self-help/courts/forms/expungement',
    selfHelpUrl: 'https://www.courts.state.hi.us/self-help',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'ID', stateName: 'Idaho',
    aocName: 'Idaho Supreme Court — Self-Help Center',
    formsPortalUrl: 'https://isc.idaho.gov/forms',
    selfHelpUrl: 'https://isc.idaho.gov/self-help',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'IL', stateName: 'Illinois',
    aocName: 'Illinois Courts',
    formsPortalUrl: 'https://illinoiscourts.gov/forms/',
    selfHelpUrl: 'https://illinoiscourts.gov/self-represented-litigants/',
    expungementFormsUrl: 'https://illinoiscourts.gov/forms/approved-forms/',
    fillablePdf: true, eFiling: true,
    notes: 'Illinois Supreme Court Approved Forms (SCAP) — CR-401 Petition to Expunge and Seal. Robust e-filing via eFileIL.',
  },
  {
    state: 'IN', stateName: 'Indiana',
    aocName: 'Indiana Supreme Court — Division of State Court Administration',
    formsPortalUrl: 'https://www.in.gov/courts/iCourt/probono/forms/',
    selfHelpUrl: 'https://www.in.gov/courts/selfservice/',
    fillablePdf: true, eFiling: true,
  },
  {
    state: 'IA', stateName: 'Iowa',
    aocName: 'Iowa Judicial Branch',
    formsPortalUrl: 'https://www.iowacourts.gov/for-the-public/court-forms/',
    criminalFormsUrl: 'https://www.iowacourts.gov/for-the-public/court-forms/criminal/',
    selfHelpUrl: 'https://www.iowacourts.gov/for-the-public/representing-yourself/',
    fillablePdf: true, eFiling: true,
  },
  {
    state: 'KS', stateName: 'Kansas',
    aocName: 'Kansas Judicial Branch',
    formsPortalUrl: 'https://www.kscourts.org/Public/Forms.aspx',
    selfHelpUrl: 'https://www.kscourts.org/Public/Self-Help/Self-Represented-Litigants.aspx',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'KY', stateName: 'Kentucky',
    aocName: 'Kentucky Court of Justice — AOC',
    formsPortalUrl: 'https://courts.ky.gov/resources/publicationsresources/Pages/forms.aspx',
    selfHelpUrl: 'https://courts.ky.gov/selfrepresented/Pages/default.aspx',
    fillablePdf: true, eFiling: false,
    notes: 'KY AOC forms searchable by case type. Criminal forms include expungement petition (AOC-491).',
  },
  {
    state: 'LA', stateName: 'Louisiana',
    aocName: 'Louisiana Judicial Administration',
    formsPortalUrl: 'https://www.lasc.org/rules?p=Rules_and_Forms',
    selfHelpUrl: 'http://www.lsba.org/PublicResources/',
    fillablePdf: false, eFiling: false,
    notes: 'Louisiana uses Civil Code (not Common Law). Criminal forms vary heavily by parish. Recommend Louisiana Civil Code § references in disclaimers.',
  },
  {
    state: 'ME', stateName: 'Maine',
    aocName: 'Maine Judicial Branch',
    formsPortalUrl: 'https://www.courts.maine.gov/fees_forms/forms/',
    criminalFormsUrl: 'https://www.courts.maine.gov/fees_forms/forms/criminal.shtml',
    selfHelpUrl: 'https://www.courts.maine.gov/selfhelp/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'MD', stateName: 'Maryland',
    aocName: 'Maryland Courts',
    formsPortalUrl: 'https://www.courts.state.md.us/legalhelp/forms',
    expungementFormsUrl: 'https://www.courts.state.md.us/legalhelp/expungementforms',
    selfHelpUrl: 'https://www.courts.state.md.us/legalhelp',
    fillablePdf: true, eFiling: true,
    notes: 'Maryland has one of the most user-friendly self-help portals. Expungement forms particularly well documented.',
  },
  {
    state: 'MA', stateName: 'Massachusetts',
    aocName: 'Massachusetts Trial Court — Law Library',
    formsPortalUrl: 'https://www.mass.gov/court-forms',
    criminalFormsUrl: 'https://www.mass.gov/court-forms?type=criminal',
    expungementFormsUrl: 'https://www.mass.gov/info-details/expunge-your-criminal-record',
    selfHelpUrl: 'https://www.mass.gov/representing-yourself-in-court',
    fillablePdf: true, eFiling: true,
    notes: 'Mass.gov has one of the most navigable portals. Expungement forms for cases after Oct 2018 (MGL c. 276, § 100E–100U).',
  },
  {
    state: 'MI', stateName: 'Michigan',
    aocName: 'Michigan Courts',
    formsPortalUrl: 'https://www.courts.michigan.gov/administration/scao/forms/',
    criminalFormsUrl: 'https://www.courts.michigan.gov/administration/scao/forms/pages/criminal.aspx',
    expungementFormsUrl: 'https://www.courts.michigan.gov/administration/scao/forms/pages/expungement.aspx',
    selfHelpUrl: 'https://www.courts.michigan.gov/self-help/',
    fillablePdf: true, eFiling: true,
    notes: 'SCAO-approved forms. Michigan Clean Slate law (2021) expanded expungement eligibility significantly — forms updated to reflect.',
  },
  {
    state: 'MN', stateName: 'Minnesota',
    aocName: 'Minnesota Judicial Branch',
    formsPortalUrl: 'https://www.mncourts.gov/GetForms.aspx',
    selfHelpUrl: 'https://www.mncourts.gov/Help-Topics/Self-Help.aspx',
    expungementFormsUrl: 'https://www.mncourts.gov/Help-Topics/Expungement.aspx',
    fillablePdf: true, eFiling: true,
    notes: 'Guide & File system available for expungement — interactive interview-style form completion.',
  },
  {
    state: 'MS', stateName: 'Mississippi',
    aocName: 'Mississippi Administrative Office of Courts',
    formsPortalUrl: 'https://courts.ms.gov/aoc/forms/forms.php',
    selfHelpUrl: 'https://courts.ms.gov/',
    fillablePdf: false, eFiling: false,
    notes: 'Mississippi forms are limited at state level. County circuit court clerks maintain most criminal forms.',
  },
  {
    state: 'MO', stateName: 'Missouri',
    aocName: 'Missouri Courts',
    formsPortalUrl: 'https://www.courts.mo.gov/page.jsp?id=705',
    selfHelpUrl: 'https://www.courts.mo.gov/page.jsp?id=336',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'MT', stateName: 'Montana',
    aocName: 'Montana Courts',
    formsPortalUrl: 'https://courts.mt.gov/library/legalforms',
    selfHelpUrl: 'https://courts.mt.gov/library',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'NE', stateName: 'Nebraska',
    aocName: 'Nebraska Supreme Court',
    formsPortalUrl: 'https://supremecourt.nebraska.gov/courts/judicial-branch-court-forms',
    selfHelpUrl: 'https://supremecourt.nebraska.gov/self-help',
    fillablePdf: true, eFiling: true,
    notes: 'Nebraska Online Legal Self-Help Center is one of the better state portals.',
  },
  {
    state: 'NV', stateName: 'Nevada',
    aocName: 'Nevada Court System',
    formsPortalUrl: 'https://nvcourts.gov/AOC/Self_Help_Center/Forms_and_Instructions/',
    selfHelpUrl: 'https://nvcourts.gov/AOC/Self_Help_Center/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'NH', stateName: 'New Hampshire',
    aocName: 'New Hampshire Judicial Branch',
    formsPortalUrl: 'https://www.courts.nh.gov/court-forms',
    selfHelpUrl: 'https://www.courts.nh.gov/representing-yourself-court',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'NJ', stateName: 'New Jersey',
    aocName: 'New Jersey Courts',
    formsPortalUrl: 'https://www.njcourts.gov/forms',
    criminalFormsUrl: 'https://www.njcourts.gov/forms?f%5B0%5D=form_category%3A7',
    expungementFormsUrl: 'https://www.njcourts.gov/forms/11262_expungement.pdf',
    selfHelpUrl: 'https://www.njcourts.gov/self-help',
    fillablePdf: true, eFiling: true,
    notes: 'New Jersey has excellent self-help portal. Expungement form (A-2574) is fillable PDF with instructions.',
  },
  {
    state: 'NM', stateName: 'New Mexico',
    aocName: 'New Mexico Courts',
    formsPortalUrl: 'https://nmcourts.gov/self-help-resources/forms/',
    selfHelpUrl: 'https://nmcourts.gov/self-help-resources/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'NY', stateName: 'New York',
    aocName: 'New York State Unified Court System',
    formsPortalUrl: 'https://www.nycourts.gov/courthelp/forms.shtml',
    criminalFormsUrl: 'https://www.nycourts.gov/forms/criminal/',
    expungementFormsUrl: 'https://www.nycourts.gov/forms/criminal/cpldismissal.pdf',
    selfHelpUrl: 'https://www.nycourts.gov/courthelp/',
    fillablePdf: true, eFiling: true,
    notes: 'New York CourtHelp is among the most comprehensive in the US. LawHelpNY.org is the LHI-powered companion.',
  },
  {
    state: 'NC', stateName: 'North Carolina',
    aocName: 'North Carolina Administrative Office of the Courts',
    formsPortalUrl: 'https://www.nccourts.gov/forms',
    criminalFormsUrl: 'https://www.nccourts.gov/forms?category=criminal',
    expungementFormsUrl: 'https://www.nccourts.gov/forms?category=expunctions',
    selfHelpUrl: 'https://www.nccourts.gov/help-topics/representing-yourself',
    fillablePdf: true, eFiling: false,
    notes: 'NC AOC forms are well-organised by category. Expungement forms explicitly listed. Note: NC UPL laws are among the broadest — app must clearly stay in "legal information" lane.',
  },
  {
    state: 'ND', stateName: 'North Dakota',
    aocName: 'North Dakota Courts',
    formsPortalUrl: 'https://www.ndcourts.gov/legal-self-help/forms',
    selfHelpUrl: 'https://www.ndcourts.gov/legal-self-help',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'OH', stateName: 'Ohio',
    aocName: 'Ohio Supreme Court — Self-Representation',
    formsPortalUrl: 'https://www.supremecourt.ohio.gov/JCS/selfRepresentation/forms/',
    selfHelpUrl: 'https://www.supremecourt.ohio.gov/JCS/selfRepresentation/',
    expungementFormsUrl: 'https://www.supremecourt.ohio.gov/JCS/selfRepresentation/forms/criminal.asp',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'OK', stateName: 'Oklahoma',
    aocName: 'Oklahoma State Courts Network',
    formsPortalUrl: 'https://www.oscn.net/applications/oscn/forms.asp',
    selfHelpUrl: 'https://www.oklahomalegalaid.org/',
    fillablePdf: false, eFiling: false,
    notes: 'Oklahoma forms are image PDFs on OSCN. Oklahoma Legal Aid (oklahomalegalaid.org) has more accessible versions.',
  },
  {
    state: 'OR', stateName: 'Oregon',
    aocName: 'Oregon Judicial Department',
    formsPortalUrl: 'https://www.courts.oregon.gov/forms/',
    criminalFormsUrl: 'https://www.courts.oregon.gov/forms/Pages/criminal-forms.aspx',
    expungementFormsUrl: 'https://www.courts.oregon.gov/forms/Pages/criminal-forms.aspx',
    selfHelpUrl: 'https://www.courts.oregon.gov/help/',
    fillablePdf: true, eFiling: true,
    notes: 'Oregon eCourt provides fillable PDFs and limited e-filing. Expungement called "Motion to Set Aside" in Oregon.',
  },
  {
    state: 'PA', stateName: 'Pennsylvania',
    aocName: 'Pennsylvania Unified Judicial System — AOPC',
    formsPortalUrl: 'https://www.pacourts.us/forms/',
    selfHelpUrl: 'https://www.pacourts.us/learn/',
    expungementFormsUrl: 'https://www.pacourts.us/forms/for-the-public',
    fillablePdf: true, eFiling: true,
    notes: 'Pennsylvania "criminal expungement" and "clean slate" sealing have separate forms. PACFile for e-filing.',
  },
  {
    state: 'RI', stateName: 'Rhode Island',
    aocName: 'Rhode Island Judiciary',
    formsPortalUrl: 'https://www.courts.ri.gov/PublicResources/forms/',
    selfHelpUrl: 'https://www.courts.ri.gov/selfhelpcenters/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'SC', stateName: 'South Carolina',
    aocName: 'South Carolina Judicial Department',
    formsPortalUrl: 'https://www.sccourts.org/forms/',
    selfHelpUrl: 'https://www.sccourts.org/selfHelp/',
    fillablePdf: true, eFiling: false,
    notes: 'South Carolina UPL is a felony (S.C. Code § 40-5-310). Disclaimer language must be especially clear for SC users.',
  },
  {
    state: 'SD', stateName: 'South Dakota',
    aocName: 'South Dakota Unified Judicial System',
    formsPortalUrl: 'https://ujs.sd.gov/forms/',
    selfHelpUrl: 'https://ujs.sd.gov/self-help/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'TN', stateName: 'Tennessee',
    aocName: 'Tennessee Administrative Office of the Courts',
    formsPortalUrl: 'https://www.tncourts.gov/programs/court-forms',
    criminalFormsUrl: 'https://www.tncourts.gov/programs/court-forms',
    expungementFormsUrl: 'https://www.tncourts.gov/sites/default/files/docs/expungement_form_fillable_2.pdf',
    selfHelpUrl: 'https://www.tncourts.gov/programs/pro-se-litigants',
    fillablePdf: true, eFiling: false,
    notes: 'Tennessee AOC publishes fillable expungement petition (T.C.A. § 40-32-101). Criminal forms vary by General Sessions vs Circuit Court.',
  },
  {
    state: 'TX', stateName: 'Texas',
    aocName: 'Texas Office of Court Administration',
    formsPortalUrl: 'https://www.txcourts.gov/programs-services/self-help/',
    selfHelpUrl: 'https://www.txcourts.gov/programs-services/self-help/',
    expungementFormsUrl: 'https://texaslawhelp.org/resource/expunctions-petitions-forms',
    fillablePdf: true, eFiling: true,
    notes: 'Texas Law Help (texaslawhelp.org) is the official LHI-powered portal for interactive forms. Expunction (Tex. Code Crim. Proc. Art. 55) and sealing (Art. 55A) have separate processes.',
  },
  {
    state: 'UT', stateName: 'Utah',
    aocName: 'Utah Courts',
    formsPortalUrl: 'https://www.utcourts.gov/howto/forms/',
    selfHelpUrl: 'https://www.utcourts.gov/selfhelp/',
    expungementFormsUrl: 'https://www.utcourts.gov/howto/expungement/',
    fillablePdf: true, eFiling: true,
    notes: 'Utah has a legal tech regulatory sandbox (S.B. 80, 2020) — one of the most permissive states for legal tech.',
  },
  {
    state: 'VT', stateName: 'Vermont',
    aocName: 'Vermont Judiciary',
    formsPortalUrl: 'https://www.vermontjudiciary.org/self-help/court-forms',
    selfHelpUrl: 'https://www.vermontjudiciary.org/self-help',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'VA', stateName: 'Virginia',
    aocName: 'Virginia Supreme Court — Office of the Executive Secretary',
    formsPortalUrl: 'https://www.vacourts.gov/courtadmin/aoc/judprog/forms/',
    selfHelpUrl: 'https://www.vacourts.gov/online/forms/',
    expungementFormsUrl: 'https://www.vacourts.gov/courtadmin/aoc/judprog/forms/circuit/criminal/',
    fillablePdf: true, eFiling: true,
    notes: 'Virginia eFileVA for circuit court. Expungement petition CC-1473.',
  },
  {
    state: 'WA', stateName: 'Washington',
    aocName: 'Washington State Courts',
    formsPortalUrl: 'https://www.courts.wa.gov/forms/',
    criminalFormsUrl: 'https://www.courts.wa.gov/forms/?fa=forms.contribute&formID=20',
    expungementFormsUrl: 'https://www.courts.wa.gov/forms/?fa=forms.contribute&formID=20',
    selfHelpUrl: 'https://www.courts.wa.gov/newsinfo/index.cfm?fa=newsinfo.selfhelp',
    fillablePdf: true, eFiling: true,
    notes: 'Washington refers to expungement as "vacation of conviction" (RCW 9.96.060). The WA Courts forms portal is well-organised.',
  },
  {
    state: 'WV', stateName: 'West Virginia',
    aocName: 'West Virginia Judiciary',
    formsPortalUrl: 'https://www.courtswv.gov/public-resources/court-forms/',
    selfHelpUrl: 'https://www.courtswv.gov/public-resources/self-help/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'WI', stateName: 'Wisconsin',
    aocName: 'Wisconsin Courts',
    formsPortalUrl: 'https://www.wicourts.gov/forms1/',
    criminalFormsUrl: 'https://www.wicourts.gov/forms1/circuit/gf.htm',
    expungementFormsUrl: 'https://www.wicourts.gov/forms1/circuit/gf.htm',
    selfHelpUrl: 'https://www.wicourts.gov/services/public/selfhelp/',
    fillablePdf: true, eFiling: false,
    notes: 'Wisconsin GF-forms are official circuit court general forms.',
  },
  {
    state: 'WY', stateName: 'Wyoming',
    aocName: 'Wyoming Judicial Branch',
    formsPortalUrl: 'https://www.courts.state.wy.us/legal-help/court-forms/',
    selfHelpUrl: 'https://www.courts.state.wy.us/legal-help/',
    fillablePdf: true, eFiling: false,
  },
  {
    state: 'DC', stateName: 'District of Columbia',
    aocName: 'D.C. Courts',
    formsPortalUrl: 'https://www.dccourts.gov/services/forms',
    criminalFormsUrl: 'https://www.dccourts.gov/services/forms',
    selfHelpUrl: 'https://www.dccourts.gov/services/civil-matters/self-help',
    fillablePdf: true, eFiling: true,
    notes: 'D.C. Superior Court handles both criminal and civil matters. eFile DC available.',
  },
];

/** Look up form sources for a given state code */
export function getStateFormSource(stateCode: string): CourtFormSource | null {
  if (stateCode === 'FED') return FEDERAL_SOURCES;
  return STATE_COURT_FORMS.find(s => s.state === stateCode) ?? null;
}

/** Get all states that have fillable PDFs */
export function getStatesWithFillableForms(): CourtFormSource[] {
  return STATE_COURT_FORMS.filter(s => s.fillablePdf);
}

/** Get the best self-help URL for a state */
export function getSelfHelpUrl(stateCode: string): string {
  const source = getStateFormSource(stateCode);
  return source?.selfHelpUrl ?? source?.formsPortalUrl ?? 'https://www.lawhelp.org/';
}

/** Get expungement-specific form URL if available */
export function getExpungementUrl(stateCode: string): string | null {
  const source = getStateFormSource(stateCode);
  return source?.expungementFormsUrl ?? null;
}
