/**
 * ai/sourceDomains.js — THE allow-list for the source re-check job (docs/AI_PLATFORM.md §9).
 * The one config file that decides which web pages Claude's web fetch tool may open and which
 * fetched pages the app accepts as a source. Official domains only, never commercial sites.
 *
 * A host is allowed when it is
 *   1. a .gov host (federal, state, county and city governments, courts on .gov — uscourts.gov,
 *      supremecourt.gov, tncourts.gov, nycourts.gov … are all .gov), or
 *   2. a state government host under the official state.<xx>.us namespace (e.g. leg.state.nv.us,
 *      gencourt.state.nh.us), or
 *   3. listed in EXPLICIT_DOMAINS below (official bodies that publish on a non-.gov domain,
 *      each with the reason it is official),
 * and it is NOT on NEVER_DOMAINS (commercial publishers and hosts — they win over everything,
 * so e.g. a .gov page mirrored on a commercial host is never accepted).
 *
 * Web fetch domain rules (platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools,
 * "Domain filtering", read 2026-11-02): `allowed_domains` entries have no scheme; a domain covers
 * its subdomains; web fetch matches the domain only (an entry with a path never matches); wildcards
 * are NOT allowed in the domain (`*.gov` is a 400) — so the job cannot send "*.gov". Instead each
 * request lists the exact official host(s) it needs (fetchDomainsFor()), every one of which passed
 * isAllowedHost(), and every page that comes back is checked again here before it is accepted.
 * ASCII only (the docs warn about homograph attacks): a host with any non-ASCII character is
 * refused.
 *
 * Proposals for withheld rows need somewhere official to look: PROPOSAL_SOURCES lists, per
 * jurisdiction, the official domains Claude may search through by following links (web fetch can
 * open URLs that appeared in an earlier fetch result) and the start pages. Only jurisdictions
 * listed here get proposals; add a state's legislature / courts / agency domains to enable it.
 */

/** Official bodies on non-.gov domains. host → why it is official. */
export const EXPLICIT_DOMAINS = Object.freeze({
  // State legislatures / code publishers that are the state's own office
  'ksrevisor.org': 'Kansas Office of Revisor of Statutes (the legislature\'s official statute publisher)',
  'mainelegislature.org': 'Maine Legislature (official site)',
  'oscn.net': 'Oklahoma State Courts Network (run by the Oklahoma Supreme Court)',
  'palegis.us': 'Pennsylvania General Assembly (official site)',
  // Public transit agencies (government authorities) whose own site is not on .gov — used only for
  // the transit-agency rows of "Plan your court day", never as a source of law.
  'wegotransit.com': 'WeGo Public Transit (Nashville Metropolitan Transit Authority)',
  'matatransit.com': 'Memphis Area Transit Authority',
  'katbus.com': 'Knoxville Area Transit (City of Knoxville)',
  'gocarta.org': 'Chattanooga Area Regional Transportation Authority',
  'ridects.com': 'Clarksville Transit System (City of Clarksville)',
  'ridejta.com': 'Jackson Transit Authority',
  // County governments on .us (not under state.<xx>.us)
  'alleghenycounty.us': 'Allegheny County, Pennsylvania (county government)',
  'knoxcounty.org': 'Knox County, Tennessee (county government)',
});

/** Never accepted, whatever else matches (commercial publishers, hosting platforms, aggregators). */
export const NEVER_DOMAINS = Object.freeze([
  'justia.com', 'findlaw.com', 'lexisnexis.com', 'lexis.com', 'westlaw.com', 'thomsonreuters.com',
  'casetext.com', 'courtlistener.com', 'law.cornell.edu', 'nolo.com', 'avvo.com', 'fastdemocracy.com',
  'legiscan.com', 'squarespace.com', 'wixsite.com', 'wordpress.com', 'blogspot.com', 'medium.com',
  'google.com', 'googleusercontent.com', 'amazonaws.com', 'cloudfront.net', 'archive.org',
  'ncsl.org', 'ccresourcecenter.org', 'rcfp.org', 'iihs.org', 'ghsa.org',
]);

const ASCII_HOST = /^[a-z0-9.-]+$/;
const STATE_US = /(^|\.)state\.[a-z]{2}\.us$/;

/** Normalised host of a URL, or null (only http / https; no credentials; ASCII only). */
export function hostOf(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || !ASCII_HOST.test(h) || h.startsWith('xn--') || h.includes('.xn--')) return null;
  return h;
}

const under = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** Why a host is allowed ('gov' | 'state_us' | 'explicit'), or null when it is not. */
export function allowReason(host) {
  const h = String(host || '').toLowerCase();
  if (!h || !ASCII_HOST.test(h)) return null;
  if (NEVER_DOMAINS.some((d) => under(h, d))) return null;
  if (h === 'gov' || h.endsWith('.gov')) return 'gov';
  if (STATE_US.test(h)) return 'state_us';
  if (Object.keys(EXPLICIT_DOMAINS).some((d) => under(h, d))) return 'explicit';
  return null;
}

export const isAllowedHost = (host) => allowReason(host) !== null;
export const isAllowedUrl = (url) => { const h = hostOf(url); return !!h && isAllowedHost(h); };

/**
 * The allowed_domains entry for a source URL: its host without a leading "www." (so the same
 * site's www / bare redirect still matches — a domain covers its subdomains), or null when the
 * URL is not on the allow-list. Never a wildcard, never a path.
 */
export function fetchDomainFor(url) {
  const h = hostOf(url);
  if (!h || !isAllowedHost(h)) return null;
  const bare = h.replace(/^www\./, '');
  return isAllowedHost(bare) ? bare : h;
}

/**
 * Official places to look for a source for a withheld row, by jurisdiction. `domains` go into
 * allowed_domains (each must pass isAllowedHost — a test checks); `start` pages go into the user
 * turn (web fetch only opens URLs that appeared earlier in the conversation or in a fetch result).
 */
export const PROPOSAL_SOURCES = Object.freeze({
  FED: {
    domains: ['uscourts.gov', 'supremecourt.gov', 'congress.gov', 'justice.gov', 'archives.gov'],
    start: ['https://www.uscourts.gov/', 'https://constitution.congress.gov/'],
  },
  TN: {
    domains: ['tn.gov', 'tncourts.gov'],       // tn.gov covers capitol.tn.gov (General Assembly), tn.gov agencies
    start: ['https://www.tncourts.gov/', 'https://www.capitol.tn.gov/', 'https://www.tn.gov/'],
  },
});

/** The proposal config for a jurisdiction, with every domain re-checked against the allow-list. */
export function proposalSourcesFor(jurisdiction) {
  const p = PROPOSAL_SOURCES[String(jurisdiction || '').toUpperCase()];
  if (!p) return null;
  const domains = p.domains.filter((d) => isAllowedHost(d));
  const start = p.start.filter((u) => isAllowedUrl(u));
  return domains.length && start.length ? { domains, start } : null;
}
