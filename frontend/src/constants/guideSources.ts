/**
 * guideSources.ts — the official pages behind "Going to court: how to dress and act" and
 * "Your case, step by step" (docs/COURT_GUIDE.md). Every section / stage names its sources
 * here; each source is the publisher's own page, with the date we read it.
 *
 * `org` and `page` are the publisher's own names, shown as published (proper names, not
 * translated — the page itself is in English). Two sources are the app's own sourced content
 * (`labelKey`, translated): the rights card and the record-clearing check, each of which shows
 * its own citations.
 */
export const GUIDE_CHECKED = '2026-11-01';

export type SourceId =
  | 'tn_dhs' | 'ny_tips' | 'tx_help' | 'ne_judicial' | 'or_yamhill' | 'nash_gs_security' | 'hamilton_gs'
  | 'allegheny_pd' | 'pinal_pd' | 'de_ocd' | 'shelby_da' | 'mn_lprb'
  | 'az_steps' | 'ny_steps' | 'ca_overview' | 'usao_mn' | 'tned_pretrial' | 'nj_probation'
  | 'jg_rights' | 'jg_expungement';

export interface GuideSource {
  /** Publisher (proper name, shown as published). */
  org?: string;
  /** The page's own title (shown as published). */
  page?: string;
  /** The app's own sourced content: an i18n key instead of org / page. */
  labelKey?: string;
  url: string | null;
  checked: string;
}

/* eslint-disable max-len */
export const GUIDE_SOURCES: Readonly<Record<SourceId, GuideSource>> = Object.freeze({
  // i18n-exempt: publisher and page names are proper names, shown as published
  tn_dhs:           { org: 'Tennessee Department of Human Services', page: 'What to Expect in Court', url: 'https://www.tn.gov/content/dam/tn/human-services/documents/Child%20Support%20What%20to%20Expect%20in%20Court.pdf', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  ny_tips:          { org: 'New York State Unified Court System', page: 'Tips for Your Day in Court', url: 'https://nycourts.gov/courtsnyccivil/tips.shtml', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  tx_help:          { org: 'Texas Court Help (Texas Office of Court Administration and partners)', page: 'Appearing in Court', url: 'https://texascourthelp.gov/civil/appearing-in-court/', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  ne_judicial:      { org: 'Nebraska Judicial Branch', page: 'What You Need to Know Before Going to Court', url: 'https://nebraskajudicial.gov/self-help/need-to-know', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  or_yamhill:       { org: 'Oregon Judicial Department, Yamhill County Circuit Court', page: 'Courtroom Etiquette', url: 'https://courts.oregon.gov/courts/yamhill/go/Pages/etiquette.aspx', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  nash_gs_security: { org: 'General Sessions Court of Metropolitan Nashville & Davidson County', page: 'Security', url: 'https://gscourt.nashville.gov/coming-to-court/security/', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  hamilton_gs:      { org: 'Hamilton County (Tennessee) General Sessions Court', page: 'Guidelines and Helpful Information for People with a Case in General Sessions Court', url: 'https://www.hamiltontn.gov/PDF/Courts/Sessions/Courtroom%20Guidelines%20080825.pdf', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  allegheny_pd:     { org: 'Allegheny County (Pennsylvania) Office of the Public Defender', page: 'New client advice', url: 'https://www.alleghenycounty.us/files/assets/county/v/1/government/public-defender/documents/new-client-advice.pdf', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  pinal_pd:         { org: 'Pinal County (Arizona) Public Defender', page: 'Frequently Asked Questions', url: 'https://www.pinal.gov/m/faq?cat=64', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  de_ocd:           { org: 'Delaware Office of Conflicts Counsel', page: 'Client Responsibilities', url: 'https://conflictscounsel.delaware.gov/clients-responsibility/', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  shelby_da:        { org: 'Shelby County (Tennessee) District Attorney General', page: 'Frequently Asked Questions', url: 'https://scdag.squarespace.com/faq', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  mn_lprb:          { org: 'Minnesota Office of Lawyers Professional Responsibility', page: 'Clients should be aware of social media pitfalls', url: 'https://lprb.mncourts.gov/articles/Articles/Ethics%20Clients%20should%20be%20aware%20of%20social%20media%20pitfalls.pdf', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  az_steps:         { org: 'Arizona Judicial Branch', page: 'Steps in a Criminal Case', url: 'https://www.azcourts.gov/legalinfohub/Legal-Info-Sheets/Criminal/Steps-in-a-Criminal-Case', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  ny_steps:         { org: 'New York State Unified Court System, CourtHelp', page: 'Basic Steps in a Criminal Case', url: 'https://nycourts.gov/Courthelp/Criminal/caseBasicsCriminal.shtml', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  ca_overview:      { org: 'California Courts Self-Help Guide', page: 'Criminal court overview', url: 'https://selfhelp.courts.ca.gov/fil/node/1597', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  usao_mn:          { org: "U.S. Attorney's Office, District of Minnesota (U.S. Department of Justice)", page: 'Criminal Procedures', url: 'https://www.justice.gov/usao-mn/criminal-procedures', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  tned_pretrial:    { org: 'U.S. Probation and Pretrial Services, Eastern District of Tennessee', page: 'Pretrial Expectations', url: 'https://www.tnep.uscourts.gov/content/pretrial-expectations', checked: GUIDE_CHECKED },
  // i18n-exempt: publisher and page names are proper names, shown as published
  nj_probation:     { org: 'New Jersey Judiciary, Probation Services', page: 'Probation Supervision: What Happens Next?', url: 'https://www.njcourts.gov/sites/default/files/forms/12629_prob_sprv_what_expect.pdf', checked: GUIDE_CHECKED },
  jg_rights:        { labelKey: 'cst_src_jg_rights', url: null, checked: GUIDE_CHECKED },
  jg_expungement:   { labelKey: 'cst_src_jg_expungement', url: null, checked: GUIDE_CHECKED },
});
/* eslint-enable max-len */
