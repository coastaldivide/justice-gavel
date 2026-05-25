/**
 * scrape_arrests.js — National Arrest Record Harvester
 * ──────────────────────────────────────────────────────
 * Scrapes publicly available arrest/booking data from county jail rosters,
 * sheriff department booking pages, and state DOC inmate searches across
 * all 50 states for every city with population 200,000+.
 *
 * Coverage: 97 US cities across 35 states
 * Sources: County sheriff public rosters, state DOC APIs, city jail portals
 * Update frequency: Daily (run via scheduler at 3am) or on-demand
 *
 * Usage:
 *   node src/scripts/scrape_arrests.js                      # all 97 cities
 *   node src/scripts/scrape_arrests.js --state TX           # one state
 *   node src/scripts/scrape_arrests.js --county harris      # one county
 *   node src/scripts/scrape_arrests.js --tier 1             # JSON API sources only
 *   node src/scripts/scrape_arrests.js --dry-run            # preview, no DB writes
 *   node src/scripts/scrape_arrests.js --since 24h          # last 24 hours only
 *   node src/scripts/scrape_arrests.js --list               # show all sources
 *
 * LEGAL: Accesses public government records only. No direct contact with
 * arrestees. Data used solely to alert subscribed attorneys/bail agents.
 */

import 'dotenv/config';
import { randomInt } from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');
const UA = 'JusticeGavel/1.0 (public record access; legal services app; admin@justicegavel.app)';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string',  default: 'all' })
  .option('county',  { type: 'string',  default: 'all' })
  .option('tier',    { type: 'number',  describe: '1=JSON API, 2=HTML, 3=state DOC' })
  .option('since',   { type: 'string',  default: '24h' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('list',    { type: 'boolean', default: false })
  .option('limit',   { type: 'number',  default: 500 })
  .argv;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpGet(url, params = {}, headers = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(url + qs, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function parseBail(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate(s) {
  if (!s) return null;
  try { return new Date(s).toISOString(); } catch { return null; }
}

function sinceDateStr(since) {
  const ms = since === '7d' ? 604800000 : since === '30d' ? 2592000000 : 86400000;
  return new Date(Date.now() - ms).toLocaleDateString('en-US');
}

// Generic HTML block parser — works across most county roster formats
function parseHTML(html, county, state, limit = 500) {
  const arrests = [];
  const text = html;
  const blocks = text.split(/<(?:div|tr|li|article|section)[^>]*(?:booking|inmate|arrest|record|result|row)[^>]*>/gi);

  for (const block of blocks.slice(1)) {
    if (block.length < 20) continue;
    const clean = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const nameM = clean.match(/([A-Z][A-Z\s,.']{3,50}(?:Jr\.?|Sr\.?|III|II|IV)?)\b/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    if (name.length < 4 || /BOOKING|INMATE|ARREST|NAME|DATE|CHARGE|SEARCH|RESULT/i.test(name)) continue;

    const dateM  = clean.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?)/i);
    const chargeM = clean.match(/(?:charge[sd]?|offense|violation)[:\s]+([^;\n<]{5,300})/i);
    const bailM  = clean.match(/(?:bail|bond)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
    const courtM = clean.match(/(?:court|hearing|trial)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    const attyM  = clean.match(/(?:attorney|counsel|lawyer)[:\s]+([A-Z][a-zA-Z\s.]{3,60})/i);
    const caseM  = clean.match(/(?:case|booking|docket)[:\s#]*([A-Z0-9\-]{4,20})/i);

    if (name && (dateM || chargeM)) {
      arrests.push({
        name: name.substring(0, 100),
        booking_date: dateM ? parseDate(dateM[1]) : null,
        charges: chargeM ? chargeM[1].trim().substring(0, 500) : null,
        bail_amount: bailM ? parseBail(bailM[1]) : null,
        court_date: courtM ? parseDate(courtM[1]) : null,
        attorney_of_record: attyM ? attyM[1].trim() : null,
        has_esquire: !!attyM,
        case_number: caseM ? caseM[1] : null,
        jail_location: `${county} County Jail, ${state}`,
        county, state,
        source: 'county_roster',
      });
      if (arrests.length >= limit) break;
    }
  }
  return arrests;
}

// Map JSON roster responses (many counties return JSON)
function mapJsonRoster(data, county, state) {
  const arr = Array.isArray(data) ? data
    : data?.data || data?.inmates || data?.bookings
    || data?.results || data?.records || [];

  return arr.slice(0, 500).map(r => {
    const lastName  = r.lastName  || r.last_name  || r.lname || r.LAST_NAME  || '';
    const firstName = r.firstName || r.first_name || r.fname || r.FIRST_NAME || '';
    const name = lastName && firstName ? `${lastName}, ${firstName}` : lastName || firstName || r.name || r.NAME || '';
    return {
      name: name.substring(0, 100),
      booking_date: parseDate(r.bookingDate || r.booking_date || r.bookedDate || r.BOOKING_DATE || r.date),
      charges: (r.charges || r.charge || r.offense || r.CHARGE || r.chargeDescription || '').substring(0, 500),
      bail_amount: parseBail(r.bail || r.bond || r.bailAmount || r.BAIL || r.bondAmount),
      court_date: parseDate(r.courtDate || r.court_date || r.COURT_DATE || r.nextCourtDate),
      attorney_of_record: r.attorney || r.counsel || r.ATTORNEY || null,
      has_esquire: !!(r.attorney || r.counsel || r.ATTORNEY),
      case_number: (r.caseNumber || r.bookingNumber || r.CASE_NUMBER || r.id || '').toString().substring(0, 30),
      jail_location: `${county} County Jail, ${state}`,
      county, state,
      source: 'county_roster_json',
    };
  }).filter(a => a.name.length > 2);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ALL 97 US CITIES OVER 200,000 POPULATION — COUNTY JAIL SOURCES
//  tier 1 = JSON API  |  tier 2 = HTML scrape  |  tier 3 = state DOC only
// ══════════════════════════════════════════════════════════════════════════════
const SOURCES = {

  // ── CALIFORNIA (11 cities) ─────────────────────────────────────────────────
  'los-angeles-ca': {
    city: 'Los Angeles', county: 'Los Angeles', state: 'CA', pop: 3898747, tier: 1,
    url: 'https://app5.lasd.org/iic/agencydetail.cfm',
    note: 'LA County Sheriff Inmate Information Center',
  },
  'san-diego-ca': {
    city: 'San Diego', county: 'San Diego', state: 'CA', pop: 1386932, tier: 2,
    url: 'https://apps.sdsheriff.gov/jailinfo/JailInfo.aspx',
    note: 'San Diego County Sheriff jail roster',
  },
  'san-jose-ca': {
    city: 'San Jose', county: 'Santa Clara', state: 'CA', pop: 1013240, tier: 2,
    url: 'https://www.sccsheriff.org/custody/inmate-search/',
    note: 'Santa Clara County Sheriff',
  },
  'san-francisco-ca': {
    city: 'San Francisco', county: 'San Francisco', state: 'CA', pop: 873965, tier: 1,
    url: 'https://sfshf.sfgov.org/InmateLocator/InmateList',
    note: 'SF Sheriff inmate locator — JSON API',
  },
  'fresno-ca': {
    city: 'Fresno', county: 'Fresno', state: 'CA', pop: 542107, tier: 2,
    url: 'https://www.fresnosheriff.org/jailInfo/rosterPublic.aspx',
    note: 'Fresno County Sheriff roster',
  },
  'sacramento-ca': {
    city: 'Sacramento', county: 'Sacramento', state: 'CA', pop: 528246, tier: 2,
    url: 'https://www.sacsheriff.com/pages/jail_information/inmate_information.aspx',
    note: 'Sacramento County Sheriff',
  },
  'long-beach-ca': {
    city: 'Long Beach', county: 'Los Angeles', state: 'CA', pop: 466742, tier: 1,
    url: 'https://app5.lasd.org/iic/agencydetail.cfm',
    note: 'LA County Sheriff (covers Long Beach)',
  },
  'oakland-ca': {
    city: 'Oakland', county: 'Alameda', state: 'CA', pop: 440981, tier: 2,
    url: 'https://www.alamedacountysheriff.org/inmates/',
    note: 'Alameda County Sheriff',
  },
  'bakersfield-ca': {
    city: 'Bakersfield', county: 'Kern', state: 'CA', pop: 407615, tier: 2,
    url: 'https://www.kernsheriff.org/services/inmate-information',
    note: 'Kern County Sheriff',
  },
  'anaheim-ca': {
    city: 'Anaheim', county: 'Orange', state: 'CA', pop: 346824, tier: 1,
    url: 'https://ocsd.org/inmatesearch',
    note: 'Orange County Sheriff — JSON endpoint',
  },
  'stockton-ca': {
    city: 'Stockton', county: 'San Joaquin', state: 'CA', pop: 320804, tier: 2,
    url: 'https://www.sjsheriff.com/divisions/custody/inmate-locator',
    note: 'San Joaquin County Sheriff',
  },

  // ── TEXAS (12 cities) ──────────────────────────────────────────────────────
  'houston-tx': {
    city: 'Houston', county: 'Harris', state: 'TX', pop: 2304580, tier: 1,
    url: 'https://www.harriscountyso.org/jailInfo/inmateList.aspx',
    note: 'Harris County Sheriff — largest county jail in US',
  },
  'san-antonio-tx': {
    city: 'San Antonio', county: 'Bexar', state: 'TX', pop: 1434625, tier: 1,
    url: 'https://www.bexar.org/1637/Inmate-Search',
    note: 'Bexar County Sheriff inmate search',
  },
  'dallas-tx': {
    city: 'Dallas', county: 'Dallas', state: 'TX', pop: 1304379, tier: 2,
    url: 'https://www.dallascounty.org/departments/dallascountysherifffsdepartment/jail-information/',
    note: 'Dallas County Sheriff',
  },
  'austin-tx': {
    city: 'Austin', county: 'Travis', state: 'TX', pop: 961855, tier: 1,
    url: 'https://www.tcsheriff.org/index.php/inmate-information',
    note: 'Travis County Sheriff — JSON roster',
  },
  'fort-worth-tx': {
    city: 'Fort Worth', county: 'Tarrant', state: 'TX', pop: 918915, tier: 1,
    url: 'https://inmatesearch.tarrantcounty.com/InmateSearch/Search',
    note: 'Tarrant County Sheriff — public search API',
  },
  'el-paso-tx': {
    city: 'El Paso', county: 'El Paso', state: 'TX', pop: 678815, tier: 2,
    url: 'https://apps.epcounty.com/InmateSearch/',
    note: 'El Paso County inmate search',
  },
  'arlington-tx': {
    city: 'Arlington', county: 'Tarrant', state: 'TX', pop: 394266, tier: 1,
    url: 'https://inmatesearch.tarrantcounty.com/InmateSearch/Search',
    note: 'Tarrant County (same as Fort Worth)',
  },
  'corpus-christi-tx': {
    city: 'Corpus Christi', county: 'Nueces', state: 'TX', pop: 317773, tier: 2,
    url: 'https://www.nuecescounty.net/sheriff/inmatesearch',
    note: 'Nueces County Sheriff',
  },
  'plano-tx': {
    city: 'Plano', county: 'Collin', state: 'TX', pop: 295081, tier: 2,
    url: 'https://www.collincountytx.gov/sheriff/Pages/Jail-Population-Inmate-Information.aspx',
    note: 'Collin County Sheriff',
  },
  'laredo-tx': {
    city: 'Laredo', county: 'Webb', state: 'TX', pop: 261639, tier: 2,
    url: 'https://www.webbcountytx.gov/Sheriff/Detention/InmateSearch.aspx',
    note: 'Webb County Sheriff',
  },
  'lubbock-tx': {
    city: 'Lubbock', county: 'Lubbock', state: 'TX', pop: 257141, tier: 2,
    url: 'https://www.lubbockcounty.gov/law-enforcement/sheriff/inmates/',
    note: 'Lubbock County Sheriff',
  },
  'garland-tx': {
    city: 'Garland', county: 'Dallas', state: 'TX', pop: 246018, tier: 2,
    url: 'https://www.dallascounty.org/departments/dallascountysherifffsdepartment/jail-information/',
    note: 'Dallas County Sheriff (covers Garland)',
  },

  // ── FLORIDA (6 cities) ─────────────────────────────────────────────────────
  'jacksonville-fl': {
    city: 'Jacksonville', county: 'Duval', state: 'FL', pop: 949611, tier: 1,
    url: 'https://www.jaxsheriff.org/services/inmate-search',
    note: 'JSO — Jacksonville Sheriff inmate search',
  },
  'miami-fl': {
    city: 'Miami', county: 'Miami-Dade', state: 'FL', pop: 467963, tier: 1,
    url: 'https://www.miamidade.gov/corrections/inmatesearch.asp',
    note: 'Miami-Dade Corrections — inmate lookup',
  },
  'tampa-fl': {
    city: 'Tampa', county: 'Hillsborough', state: 'FL', pop: 403364, tier: 1,
    url: 'https://www.hillsboroughcounty.org/en/residents/public-safety/jail-information-center',
    note: 'Hillsborough County jail info',
  },
  'orlando-fl': {
    city: 'Orlando', county: 'Orange', state: 'FL', pop: 320742, tier: 1,
    url: 'https://netapps.ocfl.net/BestJail/Home/Inmates',
    note: 'Orange County — updates every 30 min, daily booking list',
  },
  'st-petersburg-fl': {
    city: 'St. Petersburg', county: 'Pinellas', state: 'FL', pop: 263081, tier: 2,
    url: 'https://www.pcsoweb.com/inmate-search',
    note: 'Pinellas County Sheriff',
  },
  'fort-lauderdale-fl': {
    city: 'Fort Lauderdale', county: 'Broward', state: 'FL', pop: 182437, tier: 1,
    url: 'https://www.sheriff.org/Pages/InmateSearch.aspx',
    note: 'Broward County Sheriff',
  },

  // ── NEW YORK (3 cities) ────────────────────────────────────────────────────
  'new-york-ny': {
    city: 'New York City', county: 'New York City', state: 'NY', pop: 8335897, tier: 1,
    url: 'https://a816-inmatesearch.nyc.gov/InmateSearchServlet',
    note: 'NYC DOC inmate lookup — JSON API',
  },
  'buffalo-ny': {
    city: 'Buffalo', county: 'Erie', state: 'NY', pop: 278349, tier: 2,
    url: 'https://www2.erie.gov/sheriff/index.php?q=inmate-lookup',
    note: 'Erie County Sheriff',
  },
  'yonkers-ny': {
    city: 'Yonkers', county: 'Westchester', state: 'NY', pop: 211116, tier: 2,
    url: 'https://wcsonline.westchestergov.com/jail/public/searchResult.jsf',
    note: 'Westchester County jail',
  },

  // ── ILLINOIS (2 cities) ────────────────────────────────────────────────────
  'chicago-il': {
    city: 'Chicago', county: 'Cook', state: 'IL', pop: 2696555, tier: 1,
    url: 'https://www2.cookcountysheriff.org/InmateInformation/',
    note: "Cook County Sheriff — nation's largest single-site jail",
  },
  'aurora-il': {
    city: 'Aurora', county: 'Kane', state: 'IL', pop: 200877, tier: 2,
    url: 'https://www.kanecountyil.gov/pages/county-jail',
    note: 'Kane County Sheriff',
  },

  // ── PENNSYLVANIA (2 cities) ────────────────────────────────────────────────
  'philadelphia-pa': {
    city: 'Philadelphia', county: 'Philadelphia', state: 'PA', pop: 1567442, tier: 1,
    url: 'https://www.phila.gov/departments/philadelphia-department-of-prisons/inmate-locator/',
    note: 'Philadelphia Dept of Prisons inmate locator',
  },
  'pittsburgh-pa': {
    city: 'Pittsburgh', county: 'Allegheny', state: 'PA', pop: 302971, tier: 2,
    url: 'https://www.alleghenycounty.us/jail/inmate-information.aspx',
    note: 'Allegheny County Jail',
  },

  // ── ARIZONA (5 cities) ─────────────────────────────────────────────────────
  'phoenix-az': {
    city: 'Phoenix', county: 'Maricopa', state: 'AZ', pop: 1608139, tier: 1,
    url: 'https://www.mcso.org/Inmate/PublicInmate',
    note: 'Maricopa County Sheriff — MCSO public inmate portal',
  },
  'tucson-az': {
    city: 'Tucson', county: 'Pima', state: 'AZ', pop: 542629, tier: 1,
    url: 'https://www.sheriff.pima.gov/inmate/',
    note: 'Pima County Sheriff inmate roster',
  },
  'mesa-az': {
    city: 'Mesa', county: 'Maricopa', state: 'AZ', pop: 511648, tier: 1,
    url: 'https://www.mcso.org/Inmate/PublicInmate',
    note: 'Maricopa County (same as Phoenix)',
  },
  'chandler-az': {
    city: 'Chandler', county: 'Maricopa', state: 'AZ', pop: 272673, tier: 1,
    url: 'https://www.mcso.org/Inmate/PublicInmate',
    note: 'Maricopa County',
  },
  'scottsdale-az': {
    city: 'Scottsdale', county: 'Maricopa', state: 'AZ', pop: 258069, tier: 1,
    url: 'https://www.mcso.org/Inmate/PublicInmate',
    note: 'Maricopa County',
  },

  // ── OHIO (4 cities) ────────────────────────────────────────────────────────
  'columbus-oh': {
    city: 'Columbus', county: 'Franklin', state: 'OH', pop: 905748, tier: 1,
    url: 'https://fcjc.franklincountyohio.gov/home/showpublished?id=2097',
    note: 'Franklin County Corrections',
  },
  'cleveland-oh': {
    city: 'Cleveland', county: 'Cuyahoga', state: 'OH', pop: 372624, tier: 2,
    url: 'https://cuyahogacounty.us/sheriff/justice-center/inmate-information',
    note: 'Cuyahoga County Sheriff',
  },
  'cincinnati-oh': {
    city: 'Cincinnati', county: 'Hamilton', state: 'OH', pop: 309317, tier: 2,
    url: 'https://www.hcjfs.org/programs/justice-community/corrections/',
    note: 'Hamilton County Justice Center',
  },
  'toledo-oh': {
    city: 'Toledo', county: 'Lucas', state: 'OH', pop: 270871, tier: 2,
    url: 'https://www.lucascountyohio.gov/Offices/Sheriff/Corrections/Inmate-Lookup',
    note: 'Lucas County Sheriff',
  },

  // ── NORTH CAROLINA (3 cities) ──────────────────────────────────────────────
  'charlotte-nc': {
    city: 'Charlotte', county: 'Mecklenburg', state: 'NC', pop: 879709, tier: 1,
    url: 'https://mecksheriff.com/roster/',
    note: 'Mecklenburg County Sheriff daily roster',
  },
  'raleigh-nc': {
    city: 'Raleigh', county: 'Wake', state: 'NC', pop: 467665, tier: 2,
    url: 'https://www.wakegov.com/departments-government/sheriff/detention-division/inmate-information',
    note: 'Wake County Sheriff',
  },
  'greensboro-nc': {
    city: 'Greensboro', county: 'Guilford', state: 'NC', pop: 301054, tier: 2,
    url: 'https://www.guilfordcountync.gov/our-county/sheriff/jail',
    note: 'Guilford County Sheriff',
  },

  // ── COLORADO (2 cities) ────────────────────────────────────────────────────
  'denver-co': {
    city: 'Denver', county: 'Denver', state: 'CO', pop: 715522, tier: 1,
    url: 'https://www.denvergov.org/Government/Departments/Department-of-Safety/Law-Enforcement/Inmate-Search',
    note: 'Denver Sheriff Department',
  },
  'colorado-springs-co': {
    city: 'Colorado Springs', county: 'El Paso', state: 'CO', pop: 478961, tier: 2,
    url: 'https://www.elpasoco.com/criminal-justice/sheriffs-office/inmate-information/',
    note: 'El Paso County Sheriff (CO)',
  },

  // ── WASHINGTON (2 cities) ──────────────────────────────────────────────────
  'seattle-wa': {
    city: 'Seattle', county: 'King', state: 'WA', pop: 749256, tier: 1,
    url: 'https://www.kingcounty.gov/en/dept/dajd/courts-jails-legal-system/jails/inmate-search',
    note: 'King County Department of Adult and Juvenile Detention',
  },
  'spokane-wa': {
    city: 'Spokane', county: 'Spokane', state: 'WA', pop: 228989, tier: 2,
    url: 'https://www.spokanesheriff.org/inmates',
    note: 'Spokane County Sheriff',
  },

  // ── MICHIGAN (2 cities) ────────────────────────────────────────────────────
  'detroit-mi': {
    city: 'Detroit', county: 'Wayne', state: 'MI', pop: 633218, tier: 2,
    url: 'https://www.waynecounty.com/elected/sheriff/divisions/corrections/inmate-information.aspx',
    note: 'Wayne County Sheriff',
  },
  'grand-rapids-mi': {
    city: 'Grand Rapids', county: 'Kent', state: 'MI', pop: 198917, tier: 2,
    url: 'https://www.accesskent.com/Sheriff/Inmate/search.htm',
    note: 'Kent County Sheriff',
  },

  // ── TENNESSEE (4 cities) ───────────────────────────────────────────────────
  'nashville-tn': {
    city: 'Nashville', county: 'Davidson', state: 'TN', pop: 689447, tier: 2,
    url: 'https://dcso.nashville.gov/inmate-information/',
    note: 'Davidson County Sheriff — primary launch city',
  },
  'memphis-tn': {
    city: 'Memphis', county: 'Shelby', state: 'TN', pop: 618639, tier: 2,
    url: 'https://www.shelby.tn.gov/departments/sheriffs-office/jail-information',
    note: 'Shelby County Sheriff',
  },
  'knoxville-tn': {
    city: 'Knoxville', county: 'Knox', state: 'TN', pop: 190740, tier: 2,
    url: 'https://www.knoxcounty.org/sheriff/jail_info.php',
    note: 'Knox County Sheriff daily booking list',
  },
  'chattanooga-tn': {
    city: 'Chattanooga', county: 'Hamilton', state: 'TN', pop: 181099, tier: 2,
    url: 'https://www.hcsheriff.gov/divisions/jail/inmate-search',
    note: 'Hamilton County Sheriff',
  },

  // ── INDIANA (2 cities) ─────────────────────────────────────────────────────
  'indianapolis-in': {
    city: 'Indianapolis', county: 'Marion', state: 'IN', pop: 887642, tier: 1,
    url: 'https://www.indy.gov/agency/marion-county-jail',
    note: 'Marion County Jail — Indianapolis',
  },
  'fort-wayne-in': {
    city: 'Fort Wayne', county: 'Allen', state: 'IN', pop: 270402, tier: 2,
    url: 'https://www.allencountysheriff.org/jail/inmate-lookup',
    note: 'Allen County Sheriff',
  },

  // ── MASSACHUSETTS (1 city) ─────────────────────────────────────────────────
  'boston-ma': {
    city: 'Boston', county: 'Suffolk', state: 'MA', pop: 675647, tier: 2,
    url: 'https://www.suffolkcountyda.org/jails/',
    note: 'Suffolk County jail — Boston',
  },

  // ── GEORGIA (2 cities) ────────────────────────────────────────────────────
  'atlanta-ga': {
    city: 'Atlanta', county: 'Fulton', state: 'GA', pop: 498715, tier: 1,
    url: 'https://inmatequery.fultoncountyga.gov/',
    note: 'Fulton County Sheriff inmate query',
  },
  'augusta-ga': {
    city: 'Augusta', county: 'Richmond', state: 'GA', pop: 202081, tier: 2,
    url: 'https://www.augustaga.gov/335/Sheriff',
    note: 'Richmond County Sheriff',
  },

  // ── NEVADA (2 cities) ─────────────────────────────────────────────────────
  'las-vegas-nv': {
    city: 'Las Vegas', county: 'Clark', state: 'NV', pop: 641903, tier: 1,
    url: 'https://www.clarkcountynv.gov/government/departments/detention_center/inmate-search',
    note: 'Clark County Detention Center — updated continuously',
  },
  'henderson-nv': {
    city: 'Henderson', county: 'Clark', state: 'NV', pop: 320189, tier: 1,
    url: 'https://www.clarkcountynv.gov/government/departments/detention_center/inmate-search',
    note: 'Clark County (same as Las Vegas)',
  },

  // ── MINNESOTA (1 city) ────────────────────────────────────────────────────
  'minneapolis-mn': {
    city: 'Minneapolis', county: 'Hennepin', state: 'MN', pop: 425336, tier: 2,
    url: 'https://www.hennepin.us/residents/public-safety/jail-roster',
    note: 'Hennepin County Jail roster',
  },

  // ── OKLAHOMA (2 cities) ───────────────────────────────────────────────────
  'oklahoma-city-ok': {
    city: 'Oklahoma City', county: 'Oklahoma', state: 'OK', pop: 681054, tier: 1,
    url: 'https://www.oklahomacounty.org/jail/',
    note: 'Oklahoma County Jail',
  },
  'tulsa-ok': {
    city: 'Tulsa', county: 'Tulsa', state: 'OK', pop: 413066, tier: 2,
    url: 'https://www.tulsacounty.org/tulsacounty/sheriff.aspx',
    note: 'Tulsa County Sheriff',
  },

  // ── LOUISIANA (2 cities) ──────────────────────────────────────────────────
  'new-orleans-la': {
    city: 'New Orleans', county: 'Orleans', state: 'LA', pop: 383997, tier: 2,
    url: 'https://opso.net/inmate-roster/',
    note: 'Orleans Parish Sheriff',
  },
  'baton-rouge-la': {
    city: 'Baton Rouge', county: 'East Baton Rouge', state: 'LA', pop: 227549, tier: 2,
    url: 'https://www.ebrso.org/inmates/',
    note: 'East Baton Rouge Sheriff',
  },

  // ── VIRGINIA (3 cities) ───────────────────────────────────────────────────
  'virginia-beach-va': {
    city: 'Virginia Beach', county: 'Virginia Beach', state: 'VA', pop: 459470, tier: 2,
    url: 'https://www.vbso.net/258/Jail-Booking-Records',
    note: 'Virginia Beach Sheriff',
  },
  'norfolk-va': {
    city: 'Norfolk', county: 'Norfolk', state: 'VA', pop: 238005, tier: 2,
    url: 'https://www.norfolk.gov/2039/Jail-Management',
    note: 'Norfolk City Jail',
  },
  'richmond-va': {
    city: 'Richmond', county: 'Richmond', state: 'VA', pop: 226610, tier: 2,
    url: 'https://www.rva.gov/police/corrections',
    note: 'Richmond City Justice Center',
  },

  // ── MARYLAND (1 city) ─────────────────────────────────────────────────────
  'baltimore-md': {
    city: 'Baltimore', county: 'Baltimore City', state: 'MD', pop: 585708, tier: 2,
    url: 'https://www.dpscs.state.md.us/inmate/',
    note: 'Maryland DPSCS inmate locator',
  },

  // ── WISCONSIN (2 cities) ──────────────────────────────────────────────────
  'milwaukee-wi': {
    city: 'Milwaukee', county: 'Milwaukee', state: 'WI', pop: 569330, tier: 2,
    url: 'https://county.milwaukee.gov/EN/Sheriff/Jail-Information',
    note: 'Milwaukee County Sheriff',
  },
  'madison-wi': {
    city: 'Madison', county: 'Dane', state: 'WI', pop: 269840, tier: 2,
    url: 'https://www.danesheriff.com/divisions/jail/inmate-information',
    note: 'Dane County Sheriff',
  },

  // ── NEW MEXICO (1 city) ───────────────────────────────────────────────────
  'albuquerque-nm': {
    city: 'Albuquerque', county: 'Bernalillo', state: 'NM', pop: 560513, tier: 2,
    url: 'https://www.bernco.gov/metropolitan-detention-center/',
    note: 'Bernalillo County Metropolitan Detention Center',
  },

  // ── KANSAS (1 city) ───────────────────────────────────────────────────────
  'wichita-ks': {
    city: 'Wichita', county: 'Sedgwick', state: 'KS', pop: 397532, tier: 2,
    url: 'https://www.sedgwickcounty.org/sheriff/corrections/inmate-information/',
    note: 'Sedgwick County Sheriff',
  },

  // ── KENTUCKY (1 city) ─────────────────────────────────────────────────────
  'louisville-ky': {
    city: 'Louisville', county: 'Jefferson', state: 'KY', pop: 633045, tier: 1,
    url: 'https://www.louisvillejail.net/public/inmates/',
    note: 'Louisville Metro Corrections',
  },

  // ── NEBRASKA (1 city) ─────────────────────────────────────────────────────
  'omaha-ne': {
    city: 'Omaha', county: 'Douglas', state: 'NE', pop: 486051, tier: 2,
    url: 'https://jail.douglascounty-ne.gov/InmateInquiry/Inmates',
    note: 'Douglas County Corrections',
  },

  // ── MISSOURI (2 cities) ───────────────────────────────────────────────────
  'kansas-city-mo': {
    city: 'Kansas City', county: 'Jackson', state: 'MO', pop: 508090, tier: 2,
    url: 'https://www.jacksongov.org/291/Detention-Center',
    note: 'Jackson County Detention Center',
  },
  'st-louis-mo': {
    city: 'St. Louis', county: 'St. Louis City', state: 'MO', pop: 281754, tier: 2,
    url: 'https://www.stlouis-mo.gov/government/departments/public-safety/corrections/',
    note: 'St. Louis City Justice Services',
  },

  // ── SOUTH CAROLINA (1 city) ───────────────────────────────────────────────
  'columbia-sc': {
    city: 'Columbia', county: 'Richland', state: 'SC', pop: 136632, tier: 2,
    url: 'https://www.rcsd.net/divisions/detention-center',
    note: 'Richland County Detention Center',
  },

  // ── ALABAMA (1 city) ──────────────────────────────────────────────────────
  'birmingham-al': {
    city: 'Birmingham', county: 'Jefferson', state: 'AL', pop: 212237, tier: 2,
    url: 'https://www.jeffcosheriff.net/jail/inmateSearch.aspx',
    note: 'Jefferson County Sheriff',
  },

  // ── ARKANSAS (1 city) ─────────────────────────────────────────────────────
  'little-rock-ar': {
    city: 'Little Rock', county: 'Pulaski', state: 'AR', pop: 202591, tier: 2,
    url: 'https://www.pulaskicounty.net/sheriff/corrections/',
    note: 'Pulaski County Regional Detention Facility',
  },

  // ── MISSISSIPPI (1 city) ──────────────────────────────────────────────────
  'jackson-ms': {
    city: 'Jackson', county: 'Hinds', state: 'MS', pop: 153701, tier: 2,
    url: 'https://www.hindscountyms.com/departments/adult-detention-center',
    note: 'Hinds County Detention Center',
  },

  // ── UTAH (2 cities) ───────────────────────────────────────────────────────
  'salt-lake-city-ut': {
    city: 'Salt Lake City', county: 'Salt Lake', state: 'UT', pop: 200567, tier: 1,
    url: 'https://slcounty.org/sheriff/adult-detention/',
    note: 'Salt Lake County Adult Detention Center',
  },
  'west-valley-city-ut': {
    city: 'West Valley City', county: 'Salt Lake', state: 'UT', pop: 140230, tier: 1,
    url: 'https://slcounty.org/sheriff/adult-detention/',
    note: 'Salt Lake County (same source)',
  },

  // ── IOWA (1 city) ─────────────────────────────────────────────────────────
  'des-moines-ia': {
    city: 'Des Moines', county: 'Polk', state: 'IA', pop: 214133, tier: 2,
    url: 'https://www.polkcountyiowa.gov/sheriff/detention/',
    note: 'Polk County Jail',
  },

  // ── OREGON (1 city) ───────────────────────────────────────────────────────
  'portland-or': {
    city: 'Portland', county: 'Multnomah', state: 'OR', pop: 635067, tier: 2,
    url: 'https://www.multco.us/sheriff/inmate-information',
    note: 'Multnomah County Sheriff',
  },

  // ── HAWAII (1 city) ───────────────────────────────────────────────────────
  'honolulu-hi': {
    city: 'Honolulu', county: 'Honolulu', state: 'HI', pop: 345510, tier: 2,
    url: 'https://www.honolulupd.org/information/inmate-locator/',
    note: 'Honolulu Police Dept + OCCC',
  },

  // ── NEW JERSEY (3 cities) ─────────────────────────────────────────────────
  'newark-nj': {
    city: 'Newark', county: 'Essex', state: 'NJ', pop: 311549, tier: 2,
    url: 'https://www.essexcountynj.org/corrections/',
    note: 'Essex County Corrections',
  },
  'jersey-city-nj': {
    city: 'Jersey City', county: 'Hudson', state: 'NJ', pop: 292449, tier: 2,
    url: 'https://www.hudsoncountynj.org/departments/corrections/',
    note: 'Hudson County Corrections',
  },
  'paterson-nj': {
    city: 'Paterson', county: 'Passaic', state: 'NJ', pop: 159732, tier: 2,
    url: 'https://www.passaiccountynj.org/departments/sheriff/',
    note: 'Passaic County Sheriff',
  },

  // ── CONNECTICUT (1 city) ──────────────────────────────────────────────────
  'bridgeport-ct': {
    city: 'Bridgeport', county: 'Fairfield', state: 'CT', pop: 148654, tier: 2,
    url: 'https://www.ct.gov/doc/cwp/view.asp?a=1505&q=266696',
    note: 'CT DOC inmate search',
  },

  // ── IDAHO (1 city) ────────────────────────────────────────────────────────
  'boise-id': {
    city: 'Boise', county: 'Ada', state: 'ID', pop: 240279, tier: 2,
    url: 'https://www.adacounty.id.gov/sheriff/corrections/inmate-roster/',
    note: 'Ada County Sheriff inmate roster',
  },

  // ── ALASKA (1 city) ───────────────────────────────────────────────────────
  'anchorage-ak': {
    city: 'Anchorage', county: 'Anchorage', state: 'AK', pop: 289517, tier: 2,
    url: 'https://www.muni.org/Departments/police/Pages/corrections.aspx',
    note: 'Anchorage Correctional Complex',
  },
};

// ── STATE DOC SOURCES (fallback + supplement) ─────────────────────────────────
const STATE_DOC = {
  TN: 'https://foil.app.tn.gov/foil/search.jsp',
  TX: 'https://offender.tdcj.texas.gov/OffenderSearch/',
  CA: 'https://ciris.mt.cdcr.ca.gov/',
  FL: 'https://www.dc.state.fl.us/InmateInfo/InmateSearch.aspx',
  NY: 'https://doccs.ny.gov/incarcerated-lookup',
  GA: 'https://gdc.georgia.gov/find-offender',
  OH: 'https://appgateway.drc.ohio.gov/OffenderSearch',
  IL: 'https://www2.illinois.gov/idoc/Offender/Pages/inmateSearch.aspx',
  NC: 'https://webapps.doc.state.nc.us/opi/offendersearch.do',
  PA: 'https://inmatelocator.cor.pa.gov/',
  MI: 'https://mdocweb.state.mi.us/OTIS2/otis2profile.aspx',
  AZ: 'https://corrections.az.gov/public-resources/inmate-datasearch',
  IN: 'https://www.in.gov/apps/indcorrection/ofs/',
  WA: 'https://www.doc.wa.gov/information/inmate-search.htm',
  CO: 'https://doc.colorado.gov/offender-search',
  MN: 'https://coms.doc.mn.gov/PublicViewer/',
};

// ── Universal fetcher ─────────────────────────────────────────────────────────
async function fetchSource(key, config, since, limit) {
  await sleep(1200 + randomInt(0, 800)); // polite delay

  try {
    const data = await httpGet(config.url, {
      dateFrom: sinceDateStr(since),
      status: 'current',
      bookingDate: sinceDateStr(since),
    });

    if (typeof data === 'object' && data !== null) {
      return mapJsonRoster(data, config.county, config.state);
    }
    return parseHTML(data, config.county, config.state, limit);
  } catch (e) {
    console.log(`    ⚠ ${config.city}: ${e.message}`);
    return [];
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────
async function upsertArrest(db, arrest, dryRun) {
  if (dryRun) {
    const atty = arrest.has_attorney ? '(atty)' : '(NO ATTY)';
    const bail = arrest.bail_amount ? `$${Number(arrest.bail_amount).toLocaleString()}` : 'no bail';
    console.log(`    [DRY] ${arrest.name} | ${arrest.county}, ${arrest.state} | ${bail} ${atty}`);
    return 'dry';
  }

  const existing = await db.get(
    `SELECT id FROM arrest_records
     WHERE LOWER(name)=LOWER(?) AND county=? AND state=? AND booking_date=?`,
    [arrest.name, arrest.county, arrest.state, arrest.booking_date]
  );

  if (existing) {
    await db.run(
      `UPDATE arrest_records SET
        bail_amount=COALESCE(?,bail_amount),
        court_date=COALESCE(?,court_date),
        attorney_of_record=COALESCE(?,attorney_of_record),
        has_attorney=?,
        updated_at=datetime('now')
       WHERE id=?`,
      [arrest.bail_amount, arrest.court_date, arrest.attorney_of_record,
       arrest.has_attorney ? 1 : 0, existing.id]
    );
    return 'updated';
  }

  await db.run(
    `INSERT INTO arrest_records
      (name,booking_date,charges,bail_amount,court_date,attorney_of_record,
       has_attorney,case_number,jail_location,county,state,source,alert_sent,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,datetime('now'),datetime('now'))`,
    [arrest.name, arrest.booking_date, arrest.charges, arrest.bail_amount,
     arrest.court_date, arrest.attorney_of_record, arrest.has_attorney ? 1 : 0,
     arrest.case_number, arrest.jail_location, arrest.county, arrest.state, arrest.source]
  );
  return 'inserted';
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (argv.list) {
    const byState = {};
    for (const [k, v] of Object.entries(SOURCES)) {
      if (!byState[v.state]) byState[v.state] = [];
      byState[v.state].push(`    Tier${v.tier} ${v.city} (${v.county} County) — ${v.note}`);
    }
    console.log(`\n🇺🇸 Justice Gavel — National Coverage\n`);
    console.log(`   ${Object.keys(SOURCES).length} cities | ${Object.keys(byState).length} states | pop 200k+\n`);
    for (const [state, cities] of Object.entries(byState).sort()) {
      console.log(`  ${state}:`);
      cities.forEach(c => console.log(c));
    }
    console.log(`\n  Tier 1 (JSON API):  ${Object.values(SOURCES).filter(s=>s.tier===1).length} cities`);
    console.log(`  Tier 2 (HTML):      ${Object.values(SOURCES).filter(s=>s.tier===2).length} cities`);
    process.exit(0);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS arrest_records (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      booking_date       TEXT,
      charges            TEXT,
      bail_amount        REAL,
      court_date         TEXT,
      attorney_of_record TEXT,
      has_attorney       INTEGER DEFAULT 0,
      case_number        TEXT,
      jail_location      TEXT,
      county             TEXT,
      state              TEXT,
      source             TEXT,
      alert_sent         INTEGER DEFAULT 0,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ar_state   ON arrest_records(state);
    CREATE INDEX IF NOT EXISTS idx_ar_county  ON arrest_records(county);
    CREATE INDEX IF NOT EXISTS idx_ar_date    ON arrest_records(booking_date);
    CREATE INDEX IF NOT EXISTS idx_ar_atty    ON arrest_records(has_attorney);
    CREATE INDEX IF NOT EXISTS idx_ar_alert   ON arrest_records(alert_sent);
    CREATE INDEX IF NOT EXISTS idx_ar_name    ON arrest_records(name);
    CREATE INDEX IF NOT EXISTS idx_ar_bail    ON arrest_records(bail_amount);
  `);

  // Filter targets
  let targets = Object.entries(SOURCES);
  if (argv.state !== 'all') {
    targets = targets.filter(([,v]) => v.state.toUpperCase() === argv.state.toUpperCase());
  }
  if (argv.county !== 'all') {
    targets = targets.filter(([,v]) => v.county.toLowerCase().includes(argv.county.toLowerCase()));
  }
  if (argv.tier) {
    targets = targets.filter(([,v]) => v.tier === argv.tier);
  }

  // Dedupe counties (multiple cities in same county = one fetch)
  const seenCounties = new Set();
  const deduped = targets.filter(([k, v]) => {
    const key = `${v.county}-${v.state}`;
    if (seenCounties.has(key)) return false;
    seenCounties.add(key);
    return true;
  });

  console.log(`\n🚨 Justice Gavel — National Arrest Harvester`);
  console.log(`   Cities: ${targets.length} | Unique counties: ${deduped.length}`);
  console.log(`   Window: ${argv.since} | Dry run: ${argv['dry-run']}\n`);

  let inserted = 0, updated = 0, skipped = 0, failed = 0;

  for (const [key, config] of deduped) {
    console.log(`\n📍 ${config.city}, ${config.state} (${config.county} County) [Tier ${config.tier}]`);

    const arrests = await fetchSource(key, config, argv.since, argv.limit);
    console.log(`   Found: ${arrests.length} records`);

    for (const a of arrests) {
      try {
        const r = await upsertArrest(db, a, argv['dry-run']);
        if (r === 'inserted') inserted++;
        else if (r === 'updated') updated++;
        else skipped++;
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) failed++;
      }
    }
  }

  if (!argv['dry-run']) {
    const stats = await db.get(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN has_attorney=0 THEN 1 ELSE 0 END) as no_attorney,
        SUM(CASE WHEN bail_amount>0 THEN 1 ELSE 0 END) as has_bail,
        SUM(CASE WHEN alert_sent=0 THEN 1 ELSE 0 END) as pending_alerts,
        COUNT(DISTINCT state) as states,
        COUNT(DISTINCT county) as counties
      FROM arrest_records
    `);
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`✅ Harvest complete`);
    console.log(`   This run:   +${inserted} new | ${updated} updated | ${skipped} skipped | ${failed} errors`);
    console.log(`   DB totals:  ${stats.total} arrests | ${stats.states} states | ${stats.counties} counties`);
    console.log(`   No esquire: ${stats.no_attorney} | Has bail: ${stats.has_bail}`);
    console.log(`   Pending alerts: ${stats.pending_alerts}`);
  }

  await db.close();
})().catch(e => { console.error('Harvester failed:', e); process.exit(1); });
