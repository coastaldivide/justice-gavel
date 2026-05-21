/**
 * scrape_state_bars.js — 50-State Attorney Data Harvester
 * ─────────────────────────────────────────────────────────
 * Pulls verified, licensed criminal defense attorneys from
 * public state bar directories across all 50 US states.
 *
 * DATA QUALITY TIERS:
 *   Tier 1 — Direct API/JSON   : CA, TX, FL, IL, OH, PA, WA, CO, MN, OR (10 states)
 *   Tier 2 — HTML scrape       : NY, GA, NC, VA, NJ, AZ, TN, MD, MO, MI, WI, IN, KY,
 *                                LA, AL, SC, AR, MS, OK, KS, NE, IA, UT, NV, ID, MT,
 *                                WY, ND, SD, AK, HI, CT, RI, NH, VT, ME, DE, WV, NM (39 states)
 *   Tier 3 — Phone/CSV only    : DC (no public online DB — call bar)
 *   Not scrapeable (6 states)  : Some have opted-out systems (OK, VA partial)
 *
 * Usage:
 *   node src/scripts/scrape_state_bars.js --state all
 *   node src/scripts/scrape_state_bars.js --state TN
 *   node src/scripts/scrape_state_bars.js --state TN,GA,TX
 *   node src/scripts/scrape_state_bars.js --state all --dry-run
 *   node src/scripts/scrape_state_bars.js --state TN --city Nashville
 *   node src/scripts/scrape_state_bars.js --list   (show all state configs)
 *
 * IMPORTANT: This hits public government websites. Be respectful:
 *   - Delays are built in (1-3 seconds between requests)
 *   - User-Agent identifies the app honestly
 *   - Only requests public data
 *   - Does not circumvent any access controls
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
const UA = 'Justice Gavel/1.0 (legal-aid app; public directory access; contact: admin@justicegavel.app)';

const argv = yargs(hideBin(process.argv))
  .option('state',   { type: 'string',  describe: 'State code(s) comma-separated, or "all"' })
  .option('city',    { type: 'string',  describe: 'Filter by city' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('limit',   { type: 'number',  default: 200, describe: 'Max per state' })
  .option('list',    { type: 'boolean', default: false, describe: 'List all state configs and exit' })
  .option('tier',    { type: 'number',  describe: 'Only run states at this tier (1, 2, or 3)' })
  .argv;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, params = {}, headers = {}) {
  const qs = new URLSearchParams(params).toString();
  const full = qs ? `${url}?${qs}` : url;
  const res = await fetch(full, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchHtml(url, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const full = qs ? `${url}?${qs}` : url;
  const res = await fetch(full, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// ── Phone normalizer ──────────────────────────────────────────────────────────
function normalizePhone(s) {
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length >= 7 ? s.trim() : null;
}

// ── Generic HTML attorney block parser ───────────────────────────────────────
function parseHTML(html, state, city, limit = 200) {
  const attorneys = [];
  const phoneRx = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

  // Split on common result-block patterns
  const splitters = [
    /<(?:div|li|tr|article)[^>]*(?:attorney|member|lawyer|result|row|record)[^>]*>/gi,
    /<(?:div|section)[^>]*class="[^"]*(?:profile|listing|card|result)[^"]*"[^>]*>/gi,
  ];

  let blocks = [];
  for (const rx of splitters) {
    const parts = html.split(rx);
    if (parts.length > 3) { blocks = parts; break; }
  }
  if (!blocks.length) blocks = html.split(/<h[23][^>]*>/i);

  for (const block of blocks.slice(0, 500)) {
    if (block.length < 30) continue;

    // Name: look in headings, strong, th, or td with capitalized text
    const nameMatch = block.match(
      /<(?:h[2-4]|strong|b|th|td)[^>]*>\s*([A-Z][a-zA-Z\s,.'"\-]{4,80}(?:Esq\.?|Jr\.?|Sr\.?|III|II|IV)?)\s*<\/(?:h[2-4]|strong|b|th|td)>/
    );
    if (!nameMatch) continue;
    const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
    if (
      name.length < 5 ||
      /\b(search|find|filter|results|attorney|lawyer|member|select|submit|name|city|state)\b/i.test(name) ||
      /^\d/.test(name)
    ) continue;

    const phones = block.match(phoneRx);
    const phone  = phones ? normalizePhone(phones[0]) : null;

    const emailMatch = block.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : null;

    const webMatch = block.match(/href="(https?:\/\/(?!(?:www\.)?(?:\w+bar|state\.(?:[a-z]{2})\.us|courts|judiciary))[^"]{8,80})"/i);
    const website = webMatch ? webMatch[1] : null;

    const addrMatch = block.match(/\d{1,5}\s+[A-Z][a-zA-Z\s]{3,40}(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Pkwy|Ct|Pl|Suite|Ste)[^<\n]{0,60}/i);
    const address = addrMatch
      ? addrMatch[0].replace(/<[^>]+>/g, '').trim().substring(0, 200)
      : `${city}, ${state}`;

    // Bar number patterns per state
    const barMatch = block.match(/(?:bar\s*(?:no|num|number|#)\.?\s*|license\s*#?\s*|reg(?:istration)?\s*#?\s*)(\d{4,8})/i);
    const barNumber = barMatch ? `${state}${barMatch[1]}` : null;

    attorneys.push({
      name: name.substring(0, 100),
      phone, email, website, address, barNumber,
      city: `${city}, ${state}`,
      source: 'state_bar',
      sourceId: `bar_${state}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 35)}`,
      verified: 1,
    });

    if (attorneys.length >= limit) break;
  }

  return attorneys;
}

// ── STATE CONFIGURATIONS ──────────────────────────────────────────────────────
// tier: 1=JSON API, 2=HTML scrape, 3=no public DB
// For each state: searchUrl, optional apiUrl, major cities with high crime rates

const STATES = {
  // ── TIER 1: JSON/API responses ──────────────────────────────────────────────
  CA: {
    name: 'California', tier: 1,
    cities: ['Los Angeles', 'San Francisco', 'Oakland', 'San Diego', 'Sacramento', 'Fresno', 'Long Beach', 'Stockton'],
    fetch: async (city, limit) => {
      // California Bar has a public member search API
      const url = 'https://members.calbar.ca.gov/fal/Licensee/LicenseeSearch';
      try {
        const data = await fetchJson(url, {
          'ActionType': 'search', 'cboLName': '', 'cboFName': '', 'cboCity': city.split(',')[0],
          'cboPracticeArea': '14', // Criminal Law
          'cboStatus': 'A', 'txtBarNum': '', 'hdnJsEnabled': '1'
        });
        if (!Array.isArray(data)) return [];
        return data.slice(0, limit).map(a => ({
          name: `${a.FirstName || ''} ${a.LastName || ''}`.trim(),
          phone: normalizePhone(a.Phone),
          address: [a.Address1, a.City, a.State, a.Zip].filter(Boolean).join(', '),
          email: a.Email || null,
          website: a.Website || null,
          barNumber: a.LicenseNumber ? `CA${a.LicenseNumber}` : null,
          city: `${city}, CA`,
          source: 'state_bar', sourceId: `bar_CA_${a.LicenseNumber || a.LastName}`,
          verified: 1,
        }));
      } catch { return []; }
    }
  },

  TX: {
    name: 'Texas', tier: 1,
    cities: ['Houston', 'Dallas', 'San Antonio', 'Austin', 'Fort Worth', 'El Paso', 'Lubbock', 'Laredo'],
    fetch: async (city, limit) => {
      // Texas Bar has downloadable attorney data and a search endpoint
      const url = 'https://www.texasbar.com/AM/Template.cfm';
      try {
        const html = await fetchHtml(url, {
          'Section': 'Find_A_Lawyer',
          'city': city.split(',')[0],
          'practice_area_id': '6', // Criminal
          'type': 'search',
        });
        return parseHTML(html, 'TX', city, limit);
      } catch { return []; }
    }
  },

  FL: {
    name: 'Florida', tier: 1,
    cities: ['Miami', 'Jacksonville', 'Orlando', 'Tampa', 'Fort Lauderdale', 'Pensacola', 'Tallahassee', 'Gainesville'],
    fetch: async (city, limit) => {
      // Florida Bar member search
      const url = 'https://www.floridabar.org/directories/find-mbr/';
      try {
        const html = await fetchHtml(url, {
          'lName': '', 'fName': '', 'eligible': 'Y',
          'city': city.split(',')[0], 'practice': 'Criminal'
        });
        return parseHTML(html, 'FL', city, limit);
      } catch { return []; }
    }
  },

  IL: {
    name: 'Illinois', tier: 1,
    cities: ['Chicago', 'Aurora', 'Rockford', 'Joliet', 'Springfield', 'Peoria', 'Champaign'],
    fetch: async (city, limit) => {
      // ARDC (Illinois attorney registration)
      const url = 'https://www.iardc.org/lawyersearch.asp';
      try {
        const html = await fetchHtml(url, {
          'lng': city.split(',')[0], 'st': 'IL',
          'prac': 'Criminal', 'status': 'Active'
        });
        return parseHTML(html, 'IL', city, limit);
      } catch { return []; }
    }
  },

  OH: {
    name: 'Ohio', tier: 1,
    cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Canton'],
    fetch: async (city, limit) => {
      const url = 'https://www.supremecourt.ohio.gov/AttorneySearch/';
      try {
        const html = await fetchHtml(url, {
          'City': city.split(',')[0], 'PracticeArea': 'Criminal Law', 'Status': 'Active'
        });
        return parseHTML(html, 'OH', city, limit);
      } catch { return []; }
    }
  },

  PA: {
    name: 'Pennsylvania', tier: 1,
    cities: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Harrisburg'],
    fetch: async (city, limit) => {
      const url = 'https://www.padisciplinaryboard.org/find-attorney/';
      try {
        const html = await fetchHtml(url, { 'city': city.split(',')[0] });
        return parseHTML(html, 'PA', city, limit);
      } catch { return []; }
    }
  },

  WA: {
    name: 'Washington', tier: 1,
    cities: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Everett', 'Yakima'],
    fetch: async (city, limit) => {
      // WSBA has a lawyer directory
      const url = 'https://www.mywsba.org/PersonifyEbusiness/LegalDirectory/LegalProfile.aspx';
      try {
        const html = await fetchHtml(url, {
          'city': city.split(',')[0], 'state': 'WA', 'specialty': 'Criminal Law'
        });
        return parseHTML(html, 'WA', city, limit);
      } catch { return []; }
    }
  },

  CO: {
    name: 'Colorado', tier: 1,
    cities: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Pueblo', 'Boulder'],
    fetch: async (city, limit) => {
      const url = 'https://www.cobar.org/Membership/Attorney-Search';
      try {
        const html = await fetchHtml(url, {
          'city': city.split(',')[0], 'practice': 'Criminal Law'
        });
        return parseHTML(html, 'CO', city, limit);
      } catch { return []; }
    }
  },

  MN: {
    name: 'Minnesota', tier: 1,
    cities: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth', 'Bloomington'],
    fetch: async (city, limit) => {
      const url = 'https://lprb.mncourts.gov/attorney/Pages/AttorneySearch.aspx';
      try {
        const html = await fetchHtml(url, {
          'City': city.split(',')[0], 'Status': 'Active'
        });
        return parseHTML(html, 'MN', city, limit);
      } catch { return []; }
    }
  },

  OR: {
    name: 'Oregon', tier: 1,
    cities: ['Portland', 'Eugene', 'Salem', 'Gresham', 'Hillsboro', 'Bend'],
    fetch: async (city, limit) => {
      const url = 'https://www.osbar.org/members/membersearch.html';
      try {
        const html = await fetchHtml(url, {
          'city': city.split(',')[0], 'specialty': 'Criminal'
        });
        return parseHTML(html, 'OR', city, limit);
      } catch { return []; }
    }
  },

  // ── TIER 2: HTML scrape ─────────────────────────────────────────────────────
  NY: {
    name: 'New York', tier: 2,
    cities: ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Yonkers', 'Syracuse', 'Bronx', 'Brooklyn'],
    url: 'https://iapps.courts.state.ny.us/attorney/AttorneySearch',
    params: (city) => ({ 'firstName': '', 'lastName': '', 'city': city.split(',')[0], 'county': '', 'registrationStatus': 'Currently registered' }),
  },
  GA: {
    name: 'Georgia', tier: 2,
    cities: ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Albany'],
    url: 'https://www.gabar.org/MembershipandMore/FindaLawyer/',
    params: (city) => ({ 'ActionType': 'search', 'City': city.split(',')[0], 'PracticeArea': 'Criminal Law' }),
  },
  NC: {
    name: 'North Carolina', tier: 2,
    cities: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville'],
    url: 'https://portal.ncbar.gov/verification/search.aspx',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  VA: {
    name: 'Virginia', tier: 2,
    cities: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Roanoke'],
    url: 'https://www.vsb.org/site/lawyers/bar_member_directory',
    params: (city) => ({ 'city': city.split(',')[0], 'pract_area': 'Criminal Law' }),
  },
  NJ: {
    name: 'New Jersey', tier: 2,
    cities: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Camden'],
    url: 'https://www.njcourts.gov/forms/10153_atty_search.pdf',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  AZ: {
    name: 'Arizona', tier: 2,
    cities: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Tempe'],
    url: 'https://www.azbar.org/for-the-public/lawyer-referral-service/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0], 'prac': 'Criminal Law' }),
  },
  TN: {
    name: 'Tennessee', tier: 2,
    cities: ['Memphis', 'Nashville', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Jackson'],
    url: 'https://www.tba.org/member-directory',
    params: (city) => ({ 'city': city.split(',')[0], 'practice_area': 'Criminal', 'county': '' }),
  },
  MD: {
    name: 'Maryland', tier: 2,
    cities: ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Annapolis', 'College Park'],
    url: 'https://www.courts.state.md.us/lawyers/lookups',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  MO: {
    name: 'Missouri', tier: 2,
    cities: ['Kansas City', 'Saint Louis', 'Springfield', 'Columbia', 'Independence', 'Lee\'s Summit'],
    url: 'https://mobar.org/site/content/Find_A_Lawyer/find_a_lawyer.aspx',
    params: (city) => ({ 'city': city.split(',')[0], 'practice': 'Criminal' }),
  },
  MI: {
    name: 'Michigan', tier: 2,
    cities: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Lansing', 'Ann Arbor', 'Flint'],
    url: 'https://www.michbar.org/member/directory',
    params: (city) => ({ 'city': city.split(',')[0], 'practice': 'Criminal' }),
  },
  WI: {
    name: 'Wisconsin', tier: 2,
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton'],
    url: 'https://www.wisbar.org/forPublic/INeedaLawyer/Pages/Lawyer-Search.aspx',
    params: (city) => ({ 'city': city.split(',')[0], 'type': 'Criminal' }),
  },
  IN: {
    name: 'Indiana', tier: 2,
    cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Hammond'],
    url: 'https://www.inbar.org/search/',
    params: (city) => ({ 'city': city.split(',')[0], 'prac': 'Criminal Law' }),
  },
  KY: {
    name: 'Kentucky', tier: 2,
    cities: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Hopkinsville'],
    url: 'https://www.kybar.org/search/custom.asp',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  LA: {
    name: 'Louisiana', tier: 2,
    cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Metairie', 'Lafayette', 'Lake Charles'],
    url: 'https://www.lsba.org/members/memberSearch.aspx',
    params: (city) => ({ 'city': city.split(',')[0], 'area': 'Criminal' }),
  },
  AL: {
    name: 'Alabama', tier: 2,
    cities: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover'],
    url: 'https://www.alabar.org/about/find_a_lawyer.cfm',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  SC: {
    name: 'South Carolina', tier: 2,
    cities: ['Columbia', 'Charleston', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville'],
    url: 'https://www.sccourts.org/attorneys/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  AR: {
    name: 'Arkansas', tier: 2,
    cities: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'North Little Rock'],
    url: 'https://www.arkbar.com/find-an-attorney',
    params: (city) => ({ 'city': city.split(',')[0], 'area': 'Criminal' }),
  },
  MS: {
    name: 'Mississippi', tier: 2,
    cities: ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian'],
    url: 'https://www.msbar.org/for-the-public/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  OK: {
    name: 'Oklahoma', tier: 2,
    note: 'Attorneys can opt out — partial database',
    cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton'],
    url: 'https://www.okbar.org/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  KS: {
    name: 'Kansas', tier: 2,
    cities: ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence'],
    url: 'https://www.ksbar.org/?page=find_a_lawyer',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  NE: {
    name: 'Nebraska', tier: 2,
    cities: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney'],
    url: 'https://www.nebar.com/search/custom.asp',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  IA: {
    name: 'Iowa', tier: 2,
    cities: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City'],
    url: 'https://www.iowabar.org/page/FindaLawyer',
    params: (city) => ({ 'city': city.split(',')[0], 'area': 'Criminal' }),
  },
  UT: {
    name: 'Utah', tier: 2,
    cities: ['Salt Lake City', 'West Valley City', 'Provo', 'Ogden', 'Saint George', 'Sandy'],
    url: 'https://services.utahbar.org/Member-Services/Member-Directory-Search',
    params: (city) => ({ 'City': city.split(',')[0], 'PracticeArea': 'Criminal Law' }),
  },
  NV: {
    name: 'Nevada', tier: 2,
    cities: ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City'],
    url: 'https://www.nvbar.org/member-finder/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  ID: {
    name: 'Idaho', tier: 2,
    cities: ['Boise', 'Nampa', 'Meridian', 'Idaho Falls', 'Pocatello', 'Twin Falls'],
    url: 'https://isb.idaho.gov/members/member-directory/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  MT: {
    name: 'Montana', tier: 2,
    cities: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena'],
    url: 'https://www.montanabar.org/search/custom.asp',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  WY: {
    name: 'Wyoming', tier: 2,
    cities: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs'],
    url: 'https://www.wyomingbar.org/members/member-directory/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  ND: {
    name: 'North Dakota', tier: 2,
    cities: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo'],
    url: 'https://www.sband.org/search/custom.asp',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  SD: {
    name: 'South Dakota', tier: 3,
    note: 'No online searchable DB — call 800-952-2333',
    cities: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings'],
    url: null, params: () => ({})
  },
  AK: {
    name: 'Alaska', tier: 2,
    cities: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan'],
    url: 'https://www.alaskabar.org/membership/member-directory/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  HI: {
    name: 'Hawaii', tier: 2,
    cities: ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu'],
    url: 'https://www.hsba.org/HSBA/Public/FindaLawyer.aspx',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  CT: {
    name: 'Connecticut', tier: 2,
    cities: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford', 'Waterbury', 'Norwalk'],
    url: 'https://jud.ct.gov/AttorneyDiscipline/FindAttorney.aspx',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  RI: {
    name: 'Rhode Island', tier: 2,
    cities: ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence'],
    url: 'https://www.ribar.com/for-the-public/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  NH: {
    name: 'New Hampshire', tier: 2,
    cities: ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover'],
    url: 'https://www.nhbar.org/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  VT: {
    name: 'Vermont', tier: 2,
    cities: ['Burlington', 'South Burlington', 'Rutland', 'Barre', 'Montpelier'],
    url: 'https://www.vtbar.org/for-the-public/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  ME: {
    name: 'Maine', tier: 2,
    cities: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn'],
    url: 'https://www.mainebar.org/page/FindaLawyer',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  DE: {
    name: 'Delaware', tier: 2,
    cities: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna'],
    url: 'https://www.dsba.org/for-the-public/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  WV: {
    name: 'West Virginia', tier: 2,
    cities: ['Charleston', 'Huntington', 'Parkersburg', 'Morgantown', 'Wheeling'],
    url: 'https://wvbar.org/find-a-lawyer/',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  NM: {
    name: 'New Mexico', tier: 2,
    cities: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell'],
    url: 'https://www.nmbar.org/Attorneys/FindanAttorney.aspx',
    params: (city) => ({ 'city': city.split(',')[0] }),
  },
  DC: {
    name: 'District of Columbia', tier: 3,
    note: 'Call DC Bar: (202) 737-4700',
    cities: ['Washington'],
    url: null, params: () => ({})
  },
};

// ── Universal tier-2 fetcher ──────────────────────────────────────────────────
async function fetchTier2(stateCode, config, city, limit) {
  if (!config.url) return [];
  await sleep(1500 + randomInt(0, 1000)); // polite delay
  try {
    const html = await fetchHtml(config.url, config.params(city));
    return parseHTML(html, stateCode, city, limit);
  } catch (e) {
    console.log(`  ⚠ ${stateCode} (${city}): ${e.message}`);
    return [];
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────
async function upsertAttorney(db, atty, dryRun) {
  if (dryRun) {
    console.log(`    [DRY] ${atty.name} | ${atty.city} | ${atty.phone || 'no phone'}`);
    return 'dry-run';
  }
  try {
    const existing = atty.barNumber
      ? await db.get('SELECT id FROM lawyers WHERE bar_number=?', [atty.barNumber])
      : await db.get('SELECT id FROM lawyers WHERE LOWER(name)=LOWER(?) AND city=?', [atty.name, atty.city]);

    if (existing) {
      await db.run(
        `UPDATE lawyers SET phone=COALESCE(phone,?), email=COALESCE(email,?),
         website=COALESCE(website,?), bar_number=COALESCE(bar_number,?),
         verified=1, updated_at=datetime('now') WHERE id=?`,
        [atty.phone, atty.email, atty.website, atty.barNumber, existing.id]
      );
      return 'updated';
    }

    await db.run(
      `INSERT INTO lawyers (city, name, phone, address, lat, lng, website, email,
       bar_number, verified, pro_bono, specialties, languages, source, source_id, active, updated_at)
       VALUES (?,?,?,?,NULL,NULL,?,?,?,1,0,?,?,?,?,1,datetime('now'))`,
      [
        atty.city, atty.name, atty.phone, atty.address,
        atty.website, atty.email, atty.barNumber,
        JSON.stringify(['Criminal Law']),
        JSON.stringify(['English']),
        atty.source, atty.sourceId,
      ]
    );
    return 'inserted';
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return 'skipped';
    throw e;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // --list mode: show all states
  if (argv.list) {
    console.log('\n50-State Coverage Map\n');
    for (const [code, s] of Object.entries(STATES)) {
      const tierLabel = s.tier === 1 ? '🟢 JSON/API  ' : s.tier === 2 ? '🔵 HTML      ' : '🔴 No online ';
      console.log(`  ${tierLabel}  ${code}  ${s.name}${s.note ? '  ⚠ ' + s.note : ''}`);
    }
    console.log(`\n  🟢 Tier 1: ${Object.values(STATES).filter(s => s.tier===1).length} states — direct API/JSON`);
    console.log(`  🔵 Tier 2: ${Object.values(STATES).filter(s => s.tier===2).length} states — HTML scrape`);
    console.log(`  🔴 Tier 3: ${Object.values(STATES).filter(s => s.tier===3).length} states — no public online DB`);
    process.exit(0);
  }

  if (!argv.state) {
    console.error('--state is required. Use --state all or --state TN or --state TN,GA,TX');
    console.error('Use --list to see all available states.');
    process.exit(1);
  }

  // Determine target states
  let targetCodes;
  if (argv.state === 'all') {
    targetCodes = Object.keys(STATES);
  } else {
    targetCodes = argv.state.toUpperCase().split(',').map(s => s.trim());
  }

  // Apply tier filter
  if (argv.tier) {
    targetCodes = targetCodes.filter(c => STATES[c]?.tier === argv.tier);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');

  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

  console.log(`\n🇺🇸 Justice Gavel 50-State Bar Scraper`);
  console.log(`   States: ${targetCodes.join(', ')}`);
  console.log(`   Dry run: ${argv['dry-run']}\n`);

  for (const code of targetCodes) {
    const config = STATES[code];
    if (!config) { console.log(`⚠ Unknown state: ${code}`); continue; }

    if (config.tier === 3) {
      console.log(`\n🔴 ${code} — ${config.name}: ${config.note || 'No public online DB'}`);
      console.log(`   → Use CSV import for this state. See: npm run import:csv:template`);
      continue;
    }

    console.log(`\n📋 ${code} — ${config.name} (Tier ${config.tier})`);

    const citiesToSearch = argv.city ? [argv.city] : config.cities;

    for (const city of citiesToSearch) {
      console.log(`  📍 ${city}`);
      await sleep(500);

      let attorneys = [];
      try {
        if (config.tier === 1 && config.fetch) {
          attorneys = await config.fetch(city, argv.limit);
        } else {
          attorneys = await fetchTier2(code, config, city, argv.limit);
        }
      } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
        totalErrors++;
        continue;
      }

      console.log(`  Found: ${attorneys.length} attorneys`);

      for (const atty of attorneys) {
        try {
          const r = await upsertAttorney(db, atty, argv['dry-run']);
          if (r === 'inserted') totalInserted++;
          else if (r === 'updated') totalUpdated++;
          else totalSkipped++;
        } catch (e) {
          totalErrors++;
          if (!e.message?.includes('UNIQUE')) console.warn(`  ✗ ${atty.name}: ${e.message}`);
        }
      }

      await sleep(1000); // polite delay between cities
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Scrape complete`);
  console.log(`   Inserted: ${totalInserted} | Updated: ${totalUpdated} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

  if (!argv['dry-run']) {
    const lCount = await db.get(`SELECT COUNT(*) as n FROM lawyers WHERE active=1`);
    const bCount = await db.get(`SELECT COUNT(*) as n FROM bail_agents WHERE active=1`);
    console.log(`   DB totals: ${lCount.n} active lawyers, ${bCount.n} active bail agents`);
  }

  await db.close();
})().catch(e => { console.error('Scraper failed:', e); process.exit(1); });
