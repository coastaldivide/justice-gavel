/**
 * scrape_providers_national.js — National Attorney & Bail Agent Scraper
 * ───────────────────────────────────────────────────────────────────────
 * Pulls criminal defense, civil, and specialty attorney information plus bail bondsman data
 * from public state bar directories and Google Places / Yelp for all
 * 97 US cities covered by the arrest scraper (population 200k+).
 *
 * Data sources per city:
 *   1. State bar association public directory (verified, licensed attorneys)
 *   2. Google Places API (broadest coverage, real phone/address/hours)
 *   3. Yelp API (ratings, reviews, additional contact info)
 *
 * Usage:
 *   node src/scripts/scrape_providers_national.js                  # all 97 cities
 *   node src/scripts/scrape_providers_national.js --state TX       # one state
 *   node src/scripts/scrape_providers_national.js --city Houston   # one city
 *   node src/scripts/scrape_providers_national.js --type lawyers   # criminal attorneys only
 *   node src/scripts/scrape_providers_national.js --type civil     # civil attorneys only (PI, family, immigration, employment, bankruptcy, civil rights)
 *   node src/scripts/scrape_providers_national.js --type bail      # bail agents only
 *   node src/scripts/scrape_providers_national.js --source bar     # state bar only
 *   node src/scripts/scrape_providers_national.js --source google  # Google only
 *   node src/scripts/scrape_providers_national.js --dry-run
 *   node src/scripts/scrape_providers_national.js --list
 *
 * Requires at least one of:
 *   GOOGLE_PLACES_KEY in .env  (for Google Places)
 *   YELP_API_KEY in .env       (for Yelp)
 *   State bar scraping works without any API key.
 */

import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ── Junk business filter ─────────────────────────────────────────────────────
// Prevents Google Places results that are not bail/legal providers from
// being inserted. Updated after full data audit — v1.9.1
const JUNK_KEYWORDS = [
  // Auto parts (note: use double quotes for apostrophes)
  'autozone',"o'reilly",'advance auto','napa auto','pep boys',
  'jiffy lube','firestone','midas','mavis tire',
  // Grocery / big box retail
  'walmart','target','costco','kroger','safeway','albertsons','publix',
  'whole foods','trader joe','aldi ','meijer','h-e-b','food lion',
  'wegmans','winn dixie','piggly','dollar general','dollar tree',
  'family dollar','fred meyer','king soopers','heb plus',
  // Drug stores
  'walgreens','cvs pharmacy','rite aid','duane reade',
  // Home improvement
  'home depot','lowes hardware','menards','ace hardware',
  // Farm / fleet
  'farm & fleet','fleet farm','tractor supply',
  // Fast food
  "mcdonald's",'mcdonalds','burger king','wendy','taco bell','kfc ',
  'popeyes','chick-fil','subway ','dominos','pizza hut','papa john',
  'sonic drive','dairy queen','hardees',"arby's",'arbys',
  'panda express','chipotle','five guys','whataburger','in-n-out',
  // Coffee / cafe
  'starbucks','dunkin donuts','tim horton','dutch bros','panera bread',
  // Gas stations
  'shell gas','exxon','chevron gas','bp gas','sunoco','marathon gas',
  'valero','circle k','speedway gas','pilot travel','7-eleven',
  // Bars / restaurants (not bail-named)
  'emporium','provisions bar','dog house','gators and ghosts',
  'frontier days','botanical garden','outdoor campus',
  // Hospitals / medical
  'medical center','urgent care','veterinary','animal hospital',
  'familycare health','m.d. medical',
  // Government (non-commercial)
  'police department',"sheriff's office",'county jail','city jail',
  'state prison','federal bureau of investigation','fbi field office',
  'us marshals service','department of corrections','county corrections',
  'state police hq','highway patrol','superior court','district court',
  'county courthouse','city courthouse','crime stopper','crimestoppers',
  // Media
  'nbc news','abc news','cbs news','fox news','tv station','radio station',
  // Insurance / finance (not bail)
  'insurance agency','mortgage company','financial advisor',
  'investment firm','accounting firm','cpa office',
  // Fan / manufacturer
  'fan company','fan manufacturer',
  // Other
  'hotel ','motel ','bank of ','real estate agency',
  'funeral home','cemetery','ymca ','planet fitness',
  'car dealership','auto sales dealer',
  'school ','elementary school','high school',
  'botanical ','garden center','tour company','travel agency',
];

function isJunkBusiness(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  // Must NOT be a bail/legal business with these words in the name
  const isBailRelated = lower.includes('bail') || lower.includes('bond') ||
    lower.includes(' law') || lower.includes('legal') || lower.includes('attorney') ||
    lower.includes('defense') || lower.includes('recovery') || lower.includes('surety') ||
    lower.includes('enforce') || lower.includes('dui') || lower.includes('criminal') ||
    lower.includes('fugitive') || lower.includes('bounty') || lower.includes('investigat') ||
    lower.includes('detective') || lower.includes('process serv') || lower.includes('skip trac');
  if (isBailRelated) return false; // Always keep bail-related businesses
  return JUNK_KEYWORDS.some(kw => lower.includes(kw));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');
const UA = 'JusticeGavel/1.0 (legal services directory; admin@justicegavel.app)';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string', default: 'all' })
  .option('city',    { type: 'string', default: 'all' })
  .option('type',    { type: 'string', choices: ['lawyers','bail','civil','all'], default: 'all' })
  .option('source',  { type: 'string', choices: ['bar','google','yelp','all'], default: 'all' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('list',    { type: 'boolean', default: false })
  .option('limit',   { type: 'number',  default: 50 })
  .argv;

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY;
const YELP_KEY   = process.env.YELP_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── ALL 97 CITIES — state bar URLs + major cities ─────────────────────────────
const ALL_CITIES = [
  // AK
  { city: 'Anchorage', state: 'AK', bar: 'https://www.alaskabar.org/membership/member-directory/' },
  // AL
  { city: 'Birmingham', state: 'AL', bar: 'https://www.alabar.org/for-the-public/find-a-lawyer/' },
  { city: 'Montgomery', state: 'AL', bar: 'https://www.alabar.org/for-the-public/find-a-lawyer/' },
  // AR
  { city: 'Little Rock', state: 'AR', bar: 'https://www.arkbar.com/for-the-public/find-an-attorney' },
  { city: 'Fort Smith', state: 'AR', bar: 'https://www.arkbar.com/for-the-public/find-an-attorney' },
  // AZ
  { city: 'Phoenix', state: 'AZ', bar: 'https://www.azbar.org/for-the-public/lawyer-referral-service/' },
  { city: 'Tucson', state: 'AZ', bar: 'https://www.azbar.org/for-the-public/lawyer-referral-service/' },
  // CA
  { city: 'Los Angeles', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Diego', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Francisco', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'San Jose', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  { city: 'Sacramento', state: 'CA', bar: 'https://www.calbar.ca.gov/Attorneys/Conduct-Discipline/Attorney-Search' },
  // CO
  { city: 'Denver', state: 'CO', bar: 'https://www.cobar.org/for-the-public/find-a-lawyer/' },
  { city: 'Colorado Springs', state: 'CO', bar: 'https://www.cobar.org/for-the-public/find-a-lawyer/' },
  // CT
  { city: 'Hartford', state: 'CT', bar: 'https://jud.ct.gov/AttorneyDiscipline/FindAttorney.aspx' },
  { city: 'Bridgeport', state: 'CT', bar: 'https://jud.ct.gov/AttorneyDiscipline/FindAttorney.aspx' },
  // FL
  { city: 'Jacksonville', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  { city: 'Miami', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  { city: 'Tampa', state: 'FL', bar: 'https://www.floridabar.org/public/referral/' },
  // GA
  { city: 'Atlanta', state: 'GA', bar: 'https://www.gabar.org/barinaction/findalawyer.cfm' },
  { city: 'Savannah', state: 'GA', bar: 'https://www.gabar.org/barinaction/findalawyer.cfm' },
  // HI
  { city: 'Honolulu', state: 'HI', bar: 'https://www.hsba.org/HSBA/Public/FindaLawyer.aspx' },
  // IA
  { city: 'Des Moines', state: 'IA', bar: 'https://www.iowabar.org/page/FindaLawyer' },
  // ID
  { city: 'Boise', state: 'ID', bar: 'https://isb.idaho.gov/members/member-directory/' },
  // IL
  { city: 'Chicago', state: 'IL', bar: 'https://www.iardc.org/LawyerSearch.aspx' },
  { city: 'Springfield', state: 'IL', bar: 'https://www.iardc.org/LawyerSearch.aspx' },
  // IN
  { city: 'Indianapolis', state: 'IN', bar: 'https://www.inbar.org/page/FindAttorney' },
  { city: 'Fort Wayne', state: 'IN', bar: 'https://www.inbar.org/page/FindAttorney' },
  // KS
  { city: 'Wichita', state: 'KS', bar: 'https://www.ksbar.org/page/Find_An_Attorney' },
  // KY
  { city: 'Louisville', state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  { city: 'Lexington', state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  // LA
  { city: 'New Orleans', state: 'LA', bar: 'https://www.lsba.org/public/findalawyer.aspx' },
  { city: 'Baton Rouge', state: 'LA', bar: 'https://www.lsba.org/public/findalawyer.aspx' },
  // MA
  { city: 'Boston', state: 'MA', bar: 'https://www.massbar.org/for-the-public/find-a-lawyer' },
  // MD
  { city: 'Baltimore', state: 'MD', bar: 'https://www.msba.org/for-public/find-a-lawyer/' },
  // MI
  { city: 'Detroit', state: 'MI', bar: 'https://www.michbar.org/member/directory' },
  { city: 'Grand Rapids', state: 'MI', bar: 'https://www.michbar.org/member/directory' },
  // MN
  { city: 'Minneapolis', state: 'MN', bar: 'https://lprb.mncourts.gov/AttorneySearch/' },
  // MO
  { city: 'Kansas City', state: 'MO', bar: 'https://mobar.org/site/For-the-Public/Find-a-Lawyer.aspx' },
  { city: 'St. Louis', state: 'MO', bar: 'https://mobar.org/site/For-the-Public/Find-a-Lawyer.aspx' },
  // MS
  { city: 'Jackson', state: 'MS', bar: 'https://www.msbar.org/for-the-public/find-a-lawyer/' },
  // NC
  { city: 'Charlotte', state: 'NC', bar: 'https://www.nclawyer.org/directory/' },
  { city: 'Raleigh', state: 'NC', bar: 'https://www.nclawyer.org/directory/' },
  // NE
  { city: 'Omaha', state: 'NE', bar: 'https://www.nebar.com/page/find_a_lawyer' },
  // NJ
  { city: 'Newark', state: 'NJ', bar: 'https://www.njcourts.gov/forms/10153_atty_search.pdf' },
  { city: 'Jersey City', state: 'NJ', bar: 'https://www.njcourts.gov/forms/10153_atty_search.pdf' },
  // NM
  { city: 'Albuquerque', state: 'NM', bar: 'https://www.nmbar.org/Attorneys/FindaLawyer.aspx' },
  // NV
  { city: 'Las Vegas', state: 'NV', bar: 'https://www.nvbar.org/member-search/' },
  { city: 'Reno', state: 'NV', bar: 'https://www.nvbar.org/member-search/' },
  // NY
  { city: 'New York', state: 'NY', bar: 'https://iapps.courts.state.ny.us/attorney/AttorneySearch' },
  { city: 'Buffalo', state: 'NY', bar: 'https://iapps.courts.state.ny.us/attorney/AttorneySearch' },
  // OH
  { city: 'Columbus', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  { city: 'Cleveland', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  { city: 'Cincinnati', state: 'OH', bar: 'https://www.ohiobar.org/find-a-lawyer/' },
  // OK
  { city: 'Oklahoma City', state: 'OK', bar: 'https://www.okbar.org/members/lawyerreferral/' },
  { city: 'Tulsa', state: 'OK', bar: 'https://www.okbar.org/members/lawyerreferral/' },
  // OR
  { city: 'Portland', state: 'OR', bar: 'https://www.osbar.org/members/membersearch.html' },
  // PA
  { city: 'Philadelphia', state: 'PA', bar: 'https://www.pabar.org/site/For-the-Public/Find-a-Lawyer' },
  { city: 'Pittsburgh', state: 'PA', bar: 'https://www.pabar.org/site/For-the-Public/Find-a-Lawyer' },
  // SC
  { city: 'Columbia', state: 'SC', bar: 'https://www.scbar.org/public/find-a-lawyer/' },
  // TN
  { city: 'Memphis', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  { city: 'Nashville', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  { city: 'Knoxville', state: 'TN', bar: 'https://www.tba.org/member-directory' },
  // TX
  { city: 'Houston', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'Dallas', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'San Antonio', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  { city: 'Austin', state: 'TX', bar: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_A_Lawyer' },
  // UT
  { city: 'Salt Lake City', state: 'UT', bar: 'https://services.utahbar.org/Member-Services/Member-Directory' },
  // VA
  { city: 'Virginia Beach', state: 'VA', bar: 'https://www.vsb.org/site/public/find-a-lawyer' },
  { city: 'Richmond', state: 'VA', bar: 'https://www.vsb.org/site/public/find-a-lawyer' },
  // WA
  { city: 'Seattle', state: 'WA', bar: 'https://www.wsba.org/for-the-public/find-a-lawyer' },
  { city: 'Spokane', state: 'WA', bar: 'https://www.wsba.org/for-the-public/find-a-lawyer' },
  // WI
  { city: 'Milwaukee', state: 'WI', bar: 'https://www.wisbar.org/forPublic/Pages/FindaLawyer.aspx' },
  { city: 'Madison', state: 'WI', bar: 'https://www.wisbar.org/forPublic/Pages/FindaLawyer.aspx' },
  // DC
  { city: 'Washington', state: 'DC', bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  // DE
  { city: 'Wilmington', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Newark', state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  // ME
  { city: 'Portland', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Lewiston', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Augusta', state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  // MT
  { city: 'Billings', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Bozeman', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Helena', state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  // ND
  { city: 'Fargo', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Grand Forks', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Minot', state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  // NH
  { city: 'Manchester', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Derry', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Portsmouth', state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  // RI
  { city: 'Providence', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Warwick', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Cranston', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Pawtucket', state: 'RI', bar: 'https://www.ribar.com/for-the-public' },
  // SD
  { city: 'Sioux Falls', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Aberdeen', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Watertown', state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  // VT
  { city: 'Burlington', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'South Burlington', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rutland', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Barre', state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  // WV
  { city: 'Charleston', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Parkersburg', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Wheeling', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Weirton', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Beckley', state: 'WV', bar: 'https://wvlawyerreferral.com' },
  // WY
  { city: 'Cheyenne', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Laramie', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Gillette', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rock Springs', state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function httpGet(url, params = {}, headers = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(url + qs, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function normalizePhone(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

function normalizeUrl(s) {
  if (!s) return null;
  const u = String(s).trim();
  return u.startsWith('http') ? u : u ? 'https://' + u : null;
}

// ── Google Places ─────────────────────────────────────────────────────────────
async function fetchGooglePlaces(city, state, type) {
  if (!GOOGLE_KEY) return [];
  const records = [];
  const queries = [];

  if (type === 'all' || type === 'lawyers') {
    queries.push({ q: `criminal defense attorney ${city} ${state}`, type: 'lawyers' });
    queries.push({ q: `DUI defense lawyer ${city} ${state}`, type: 'lawyers' });
    queries.push({ q: `criminal law firm ${city} ${state}`, type: 'lawyers' });
    queries.push({ q: `defense attorney ${city} ${state}`, type: 'lawyers' });

    // Civil attorney types — added v6.7
    if (['civil','all'].includes(argv.type)) {
      queries.push({ q: `personal injury attorney ${city} ${state}`,      type: 'lawyers', specialty: 'Personal Injury'   });
      queries.push({ q: `family law attorney ${city} ${state}`,           type: 'lawyers', specialty: 'Family Law'         });
      queries.push({ q: `immigration attorney ${city} ${state}`,          type: 'lawyers', specialty: 'Immigration'        });
      queries.push({ q: `employment attorney ${city} ${state}`,           type: 'lawyers', specialty: 'Employment'         });
      queries.push({ q: `bankruptcy attorney ${city} ${state}`,           type: 'lawyers', specialty: 'Bankruptcy'         });
      queries.push({ q: `tenant rights eviction attorney ${city} ${state}`, type: 'lawyers', specialty: 'Real Estate'     });
      queries.push({ q: `civil rights attorney ${city} ${state}`,         type: 'lawyers', specialty: 'Civil Rights'       });
    }
    queries.push({ q: `DUI lawyer ${city} ${state}`, type: 'lawyers' });
  }
  if (type === 'all' || type === 'bail') {
    queries.push({ q: `bail bonds ${city} ${state}`, type: 'bail' });
    queries.push({ q: `bail bondsman ${city} ${state}`, type: 'bail' });
    queries.push({ q: `bail agent ${city} ${state}`, type: 'bail' });
    queries.push({ q: `surety bond ${city} ${state}`, type: 'bail' });
    queries.push({ q: `bail bondsman ${city} ${state}`, type: 'bail' });
  }

  for (const { q, type: pType } of queries) {
    try {
      await sleep(200);
      const searchRes = await httpGet(
        'https://maps.googleapis.com/maps/api/place/textsearch/json',
        { query: q, key: GOOGLE_KEY }
      );

      for (const place of (searchRes.results || []).slice(0, 10)) {
        try {
          await sleep(120);
          const detail = await httpGet(
            'https://maps.googleapis.com/maps/api/place/details/json',
            {
              place_id: place.place_id, key: GOOGLE_KEY,
              fields: 'name,formatted_address,formatted_phone_number,geometry,website,rating,user_ratings_total,opening_hours'
            }
          );
          const d = detail.result;
          if (!d || !d.name) continue;
          if (isJunkBusiness(d.name || place.name)) continue; // Skip non-bail businesses
          records.push({
            type: pType, source: 'google',
            source_id: 'google_' + place.place_id,
            city: `${city}, ${state}`,
            name: d.name || place.name || 'Unknown',
            phone: normalizePhone(d.formatted_phone_number),
            address: d.formatted_address,
            lat: d.geometry?.location?.lat ?? null,
            lng: d.geometry?.location?.lng ?? null,
            website: normalizeUrl(d.website),
            rating: d.rating || null,
            reviews: d.user_ratings_total || null,
            hours: d.opening_hours?.weekday_text?.join(' | ') || null,
          });
        } catch { /* skip failed detail */ }
      }
    } catch (e) {
      console.log(`    Google error (${city}): ${e.message}`);
    }
  }
  return records;
}

// ── Yelp ──────────────────────────────────────────────────────────────────────
async function fetchYelp(city, state, type) {
  if (!YELP_KEY) return [];
  const headers = { Authorization: `Bearer ${YELP_KEY}` };
  const records = [];
  const queries = [];

  if (type === 'all' || type === 'lawyers') {
    queries.push({ term: 'criminal defense attorney', type: 'lawyers' });

    // Civil attorney types — added v6.7
    if (['civil','all'].includes(argv.type)) {
      queries.push({ term: 'personal injury attorney',  type: 'lawyers', specialty: 'Personal Injury' });
      queries.push({ term: 'family law attorney',       type: 'lawyers', specialty: 'Family Law'       });
      queries.push({ term: 'immigration attorney',      type: 'lawyers', specialty: 'Immigration'      });
      queries.push({ term: 'employment attorney',       type: 'lawyers', specialty: 'Employment'       });
      queries.push({ term: 'civil rights attorney',     type: 'lawyers', specialty: 'Civil Rights'     });
    }
  }
  if (type === 'all' || type === 'bail') {
    queries.push({ term: 'bail bonds', type: 'bail' });
  }

  for (const { term, type: pType } of queries) {
    try {
      await sleep(300);
      const data = await httpGet(
        'https://api.yelp.com/v3/businesses/search',
        { term, location: `${city}, ${state}`, limit: 50, categories: pType === 'bail' ? 'bailbonds' : 'lawyers' },
        headers
      );
      for (const b of (data.businesses || [])) {
        if (isJunkBusiness(d.name || place.name)) continue; // Skip non-bail businesses
          records.push({
          type: pType, source: 'yelp',
          source_id: 'yelp_' + b.id,
          city: `${city}, ${state}`,
          name: b.name,
          phone: normalizePhone(b.phone || b.display_phone),
          address: [b.location?.address1, b.location?.city, b.location?.state, b.location?.zip_code].filter(Boolean).join(', '),
          lat: b.coordinates?.latitude ?? null,
          lng: b.coordinates?.longitude ?? null,
          website: normalizeUrl(b.url),
          rating: b.rating || null,
          reviews: b.review_count || null,
          hours: null,
        });
      }
    } catch (e) {
      console.log(`    Yelp error (${city}): ${e.message}`);
    }
  }
  return records;
}

// ── State Bar HTML scrape ─────────────────────────────────────────────────────
async function fetchStateBar(city, state, barUrl, type) {
  if (type === 'bail') return []; // bar only has attorneys
  try {
    await sleep(1500);
    const html = await httpGet(barUrl, {
      city: city, practiceArea: 'Criminal Law', specialty: 'Criminal',
      status: 'Active', type: 'search',
    });
    if (typeof html !== 'string') return [];

    const records = [];
    const blocks = html.split(/<(?:div|li|tr)[^>]*(?:attorney|member|lawyer|result)[^>]*>/gi);

    for (const block of blocks.slice(1, 100)) {
      const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const nameM = text.match(/([A-Z][A-Za-z\s,.']{4,60}(?:Esq\.?|Jr\.?|Sr\.?)?)/);
      if (!nameM) continue;
      const name = nameM[1].trim();
      if (name.length < 5 || /search|filter|result|attorney/i.test(name)) continue;

      const phoneM = text.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
      const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      const webM   = text.match(/href="(https?:\/\/[^"]{8,80})"/i);
      const barM   = text.match(/bar\s*(?:no|num|number|#)\.?\s*(\d{4,8})/i);

      if (isJunkBusiness(d.name || place.name)) continue; // Skip non-bail businesses
          records.push({
        type: 'lawyers', source: 'state_bar',
        source_id: `bar_${state}_${name.toLowerCase().replace(/\W/g,'_').substring(0,30)}`,
        city: `${city}, ${state}`,
        name: name.substring(0, 100),
        phone: phoneM ? normalizePhone(phoneM[0]) : null,
        email: emailM ? emailM[0] : null,
        address: `${city}, ${state}`,
        lat: null, lng: null,
        website: webM ? normalizeUrl(webM[1]) : null,
        rating: null, reviews: null, hours: null,
        bar_number: barM ? `${state}${barM[1]}` : null,
        verified: 1,
      });
      if (records.length >= 50) break;
    }
    return records;
  } catch (e) {
    console.log(`    Bar error (${city}, ${state}): ${e.message}`);
    return [];
  }
}

// ── DB upsert (shared logic for lawyers and bail agents) ──────────────────────
function dedupeKey(name, city) {
  return (name + '|' + city).toLowerCase().replace(/[^a-z0-9|]/g, '');
}

const TRACKED = ['phone','address','website','email','hours','rating','reviews','lat','lng'];

async function upsertProvider(db, record, dryRun) {
  if (!record.name || record.name === 'undefined') return 'skipped';
  if (!record.source_id) return 'skipped';

  const table = record.type === 'bail' ? 'bail_agents' : 'lawyers';

  if (dryRun) {
    console.log(`    [DRY] ${table}: ${record.name} | ${record.city} | ${record.phone || 'no phone'}`);
    return 'dry';
  }

  // Find by source_id first, then dedupe key
  let existing = await db.get(`SELECT * FROM ${table} WHERE source_id=?`, [record.source_id]);
  if (!existing) {
    const dk = dedupeKey(record.name, record.city);
    existing = await db.get(
      `SELECT * FROM ${table} WHERE LOWER(REPLACE(name,' ',''))||'|'||LOWER(REPLACE(city,' ','')) = ?`,
      [dk]
    );
  }

  if (existing) {
    const updates = {};
    for (const f of TRACKED) {
      if (record[f] != null) updates[f] = record[f];
    }
    if (Object.keys(updates).length) {
      const sets = Object.keys(updates).map(k => `${k}=?`).join(',');
      await db.run(
        `UPDATE ${table} SET ${sets}, updated_at=datetime('now') WHERE id=?`,
        [...Object.values(updates), existing.id]
      );
    }
    return 'updated';
  }

  if (table === 'lawyers') {
    await db.run(`
      INSERT INTO lawyers (city,name,phone,address,lat,lng,website,email,
        bar_number,verified,pro_bono,specialties,languages,source,source_id,rating,reviews,active,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,1,datetime('now'))`,
      [record.city, record.name, record.phone, record.address, record.lat, record.lng,
       record.website, record.email||null, record.bar_number||null,
       record.verified||0,
       JSON.stringify(['Criminal Law','Criminal Defense']),
       JSON.stringify(['English']),
       record.source, record.source_id, record.rating, record.reviews]
    );
  } else {
    await db.run(`
      INSERT INTO bail_agents (city,name,phone,address,lat,lng,website,email,
        hours,source,source_id,rating,reviews,active,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`,
      [record.city, record.name, record.phone, record.address, record.lat, record.lng,
       record.website, record.email||null, record.hours||null,
       record.source, record.source_id, record.rating, record.reviews]
    );
  }
  return 'inserted';
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (argv.list) {
    console.log(`\n🇺🇸 Justice Gavel — National Provider Coverage\n`);
    const byState = {};
    ALL_CITIES.forEach(c => {
      if (!byState[c.state]) byState[c.state] = [];
      byState[c.state].push(c.city);
    });
    for (const [st, cities] of Object.entries(byState).sort()) {
      console.log(`  ${st}: ${cities.join(', ')}`);
    }
    console.log(`\n  Total: ${ALL_CITIES.length} cities | ${Object.keys(byState).length} states`);
    console.log(`  Sources: State bar + Google Places + Yelp`);
    console.log(`  Types: Criminal defense attorneys + Bail bondsmen`);
    process.exit(0);
  }

  const hasGoogleKey = !!GOOGLE_KEY;
  const hasYelpKey   = !!YELP_KEY;

  console.log(`\n⚖️  Justice Gavel — National Provider Scraper`);
  console.log(`   Cities: ${ALL_CITIES.length} | Type: ${argv.type}`);
  console.log(`   Sources: state_bar=always | google=${hasGoogleKey} | yelp=${hasYelpKey}`);
  console.log(`   Dry run: ${argv['dry-run']}\n`);

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  // Filter targets
  let targets = ALL_CITIES;
  if (argv.state !== 'all') targets = targets.filter(c => c.state.toUpperCase() === argv.state.toUpperCase());
  if (argv.city !== 'all')  targets = targets.filter(c => c.city.toLowerCase().includes(argv.city.toLowerCase()));

  let inserted = 0, updated = 0, skipped = 0;

  for (const { city, state, bar } of targets) {
    console.log(`\n📍 ${city}, ${state}`);
    const allRecords = [
  // ── Missing states added ────────────────────────────────────
  { city: 'Washington',      state: 'DC', bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  { city: 'Wilmington',      state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover',           state: 'DE', bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Portland',        state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor',          state: 'ME', bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Billings',        state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula',        state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls',     state: 'MT', bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Fargo',           state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck',        state: 'ND', bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Manchester',      state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord',         state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua',          state: 'NH', bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Providence',      state: 'RI', bar: 'https://www.ribar.com/For-The-Public/Lawyer-Referral-Service' },
  { city: 'Warwick',         state: 'RI', bar: 'https://www.ribar.com/For-The-Public/Lawyer-Referral-Service' },
  { city: 'Sioux Falls',     state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City',      state: 'SD', bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Burlington',      state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier',      state: 'VT', bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Charleston',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown',      state: 'WV', bar: 'https://wvlawyerreferral.com' },
  { city: 'Cheyenne',        state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper',          state: 'WY', bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Louisville',      state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },
  { city: 'Lexington',       state: 'KY', bar: 'https://www.kybar.org/page/FindAnAttorney' },

  // ── Missing states — added for final complete national scrape ────────────
  // DC
  { city: 'Washington',       state: 'DC',  bar: 'https://www.dcbar.org/for-the-public/find-a-member' },
  // DE
  { city: 'Wilmington',       state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Dover',            state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  { city: 'Newark',           state: 'DE',  bar: 'https://www.dsba.org/find-a-lawyer' },
  // ME
  { city: 'Portland',         state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Bangor',           state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  { city: 'Lewiston',         state: 'ME',  bar: 'https://www.mainebar.org/page/FindAnAttorney' },
  // MT
  { city: 'Billings',         state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Missoula',         state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Great Falls',      state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Bozeman',          state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  { city: 'Helena',           state: 'MT',  bar: 'https://www.montanabar.org/page/FindAnAttorney' },
  // ND
  { city: 'Fargo',            state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Bismarck',         state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Grand Forks',      state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  { city: 'Minot',            state: 'ND',  bar: 'https://www.sband.org/page/FindAnAttorney' },
  // NH
  { city: 'Manchester',       state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Nashua',           state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Concord',          state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  { city: 'Derry',            state: 'NH',  bar: 'https://www.nhbar.org/find-a-lawyer' },
  // RI
  { city: 'Providence',       state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Warwick',          state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Cranston',         state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  { city: 'Pawtucket',        state: 'RI',  bar: 'https://www.ribar.com/for-the-public' },
  // SD
  { city: 'Sioux Falls',      state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Rapid City',       state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  { city: 'Aberdeen',         state: 'SD',  bar: 'https://www.statebarofsouthdakota.com/page/FindAnAttorney' },
  // VT
  { city: 'Burlington',       state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'South Burlington', state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Montpelier',       state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rutland',          state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  { city: 'Barre',            state: 'VT',  bar: 'https://www.vtbar.org/for-the-public/find-a-lawyer' },
  // WV
  { city: 'Charleston',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Huntington',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Morgantown',       state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Parkersburg',      state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Wheeling',         state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  { city: 'Weirton',          state: 'WV',  bar: 'https://wvlawyerreferral.com' },
  // WY
  { city: 'Cheyenne',         state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Casper',           state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Laramie',          state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Gillette',         state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },
  { city: 'Rock Springs',     state: 'WY',  bar: 'https://www.wyomingbar.org/for-the-public/find-a-lawyer' },

];

    // 1. State bar (always)
    if (argv.source === 'all' || argv.source === 'bar') {
      const barRecords = await fetchStateBar(city, state, bar, argv.type);
      console.log(`   Bar: ${barRecords.length} attorneys`);
      allRecords.push(...barRecords);
    }

    // 2. Google Places
    if ((argv.source === 'all' || argv.source === 'google') && hasGoogleKey) {
      const gRecords = await fetchGooglePlaces(city, state, argv.type);
      console.log(`   Google: ${gRecords.length} providers`);
      allRecords.push(...gRecords);
    }

    // 3. Yelp
    if ((argv.source === 'all' || argv.source === 'yelp') && hasYelpKey) {
      const yRecords = await fetchYelp(city, state, argv.type);
      console.log(`   Yelp: ${yRecords.length} providers`);
      allRecords.push(...yRecords);
    }

    // Deduplicate across sources by name+city
    const seen = new Set();
    const deduped = allRecords.filter(r => {
      const k = dedupeKey(r.name, r.city);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    console.log(`   Unique: ${deduped.length} providers`);

    for (const record of deduped) {
      try {
        const result = await upsertProvider(db, record, argv['dry-run']);
        if (result === 'inserted') inserted++;
        else if (result === 'updated') updated++;
        else skipped++;
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) console.warn(`   ✗ ${record.name}: ${e.message}`);
        skipped++;
      }
    }

    await sleep(1000);
  }

  if (!argv['dry-run']) {
    const lawyers    = await db.get(`SELECT COUNT(*) as n FROM lawyers WHERE active=1`);
    const bail       = await db.get(`SELECT COUNT(*) as n FROM bail_agents WHERE active=1`);
    const lCities    = await db.get(`SELECT COUNT(DISTINCT city) as n FROM lawyers`);
    const bCities    = await db.get(`SELECT COUNT(DISTINCT city) as n FROM bail_agents`);

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`✅ National provider scrape complete`);
    console.log(`   This run:  +${inserted} new | ${updated} updated | ${skipped} skipped`);
    console.log(`   Attorneys: ${lawyers.n} active across ${lCities.n} cities`);
    console.log(`   Bail agents: ${bail.n} active across ${bCities.n} cities`);
  }

  await db.close();
})().catch(e => { console.error('Scraper failed:', e); process.exit(1); });
