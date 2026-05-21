/**
 * seed_providers.js — Foundational attorney & bail bondsman data
 * ──────────────────────────────────────────────────────────────
 * Covers all 50 US states + DC across 97 cities (pop. 200k+).
 * Data is realistic and structured (real coordinates, real phone
 * area codes, real bar number formats) but NOT verified real attorneys.
 *
 * SOURCE FLAG: source='seed' | verified=0
 * These records are the FRAMEWORK. The scrape_state_bars.js and
 * scrape_providers_national.js scripts will OVERWRITE these with
 * real verified data when run on production (with API keys + live network).
 *
 * The upsert key is source_id — real records use bar_STATEXXXXX format.
 * Seed records use seed_CITY_N format so real records always win.
 *
 * Run:
 *   node src/scripts/seed_providers.js
 *   node src/scripts/seed_providers.js --city "Nashville, TN"
 *   node src/scripts/seed_providers.js --reset
 */

import 'dotenv/config';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../data/providers.sqlite');

const argv = yargs(hideBin(process.argv))
  .option('city',  { type: 'string',  describe: 'Seed only this city' })
  .option('reset', { type: 'boolean', default: false, describe: 'Delete seed records before inserting' })
  .option('dry-run', { type: 'boolean', default: false })
  .argv;

// ── Phone formatter ──────────────────────────────────────────────────────────
const fmt = (areaCode, n) => `+1${areaCode}${String(n).padStart(7,'0')}`;

// ── Bar number formatter ─────────────────────────────────────────────────────
const bar = (state, n) => `${state}${String(n).padStart(6,'0')}`;

// ── Bail license formatter ───────────────────────────────────────────────────
const bail = (state, n) => `BA-${state}-${String(n).padStart(5,'0')}`;

// ────────────────────────────────────────────────────────────────────────────
// SEED DATA — 97 cities × 5 lawyers + 2 bail agents = ~679 records
// Ordered by city arrest volume (highest-need markets first)
// ────────────────────────────────────────────────────────────────────────────
const SEED = [

  // ── TENNESSEE ─────────────────────────────────────────────────────────────
  {city:'Memphis, TN', lat:35.1495, lng:-90.0490, state:'TN', area:'901', lawyers:[
    {n:1,name:'River City Defense Group',addr:'119 S Main St Ste 400',bar:24381,specs:['DUI','Drug Offenses','Assault'],rating:4.8,reviews:134},
    {n:2,name:'Beale Street Legal Defense',addr:'200 Jefferson Ave',bar:19742,specs:['Criminal Defense','Federal Cases'],rating:4.6,reviews:87},
    {n:3,name:'Mid-South Criminal Attorneys',addr:'6060 Poplar Ave Ste 140',bar:31205,specs:['DUI','Domestic Violence'],rating:4.5,reviews:63},
    {n:4,name:'Memphis Defense Law Firm',addr:'40 S Main St',bar:17893,specs:['Drug Offenses','Assault','Theft'],rating:4.3,reviews:41},
    {n:5,name:'Bluff City Legal Group',addr:'88 Union Ave Ste 1000',bar:28614,specs:['DUI','Expungement'],rating:4.7,reviews:98},
  ], bail:[
    {n:1,name:'River City Bail Bonds',addr:'234 Poplar Ave',lic:10234,rate:10,hours:'24/7'},
    {n:2,name:'Memphis Fast Release Bonds',addr:'417 N 3rd St',lic:10891,rate:10,hours:'24/7'},
  ]},

  {city:'Nashville, TN', lat:36.1627, lng:-86.7816, state:'TN', area:'615', lawyers:[
    {n:1,name:'Music City Defense Lawyers',addr:'424 Church St Ste 2000',bar:22145,specs:['DUI','Drug Offenses'],rating:4.9,reviews:178},
    {n:2,name:'Capitol Hill Criminal Defense',addr:'150 4th Ave N',bar:18330,specs:['Federal Cases','White Collar'],rating:4.7,reviews:112},
    {n:3,name:'Davidson County Defense Group',addr:'209 10th Ave S Ste 322',bar:33412,specs:['Assault','Domestic Violence'],rating:4.5,reviews:74},
    {n:4,name:'Tennessee Criminal Law Center',addr:'303 Broadway Ste 305',bar:27891,specs:['DUI','Expungement','Drug Offenses'],rating:4.6,reviews:89},
    {n:5,name:'Gulch Legal Services',addr:'1100 Broadway',bar:15672,specs:['Criminal Defense','Juvenile'],rating:4.4,reviews:55},
  ], bail:[
    {n:1,name:'Nashville Bail Bonds',addr:'200 James Robertson Pkwy',lic:20145,rate:10,hours:'24/7'},
    {n:2,name:'Music City Bail Bonds',addr:'543 Gallatin Ave',lic:21033,rate:10,hours:'24/7'},
  ]},

  {city:'Knoxville, TN', lat:35.9606, lng:-83.9207, state:'TN', area:'865', lawyers:[
    {n:1,name:'Smoky Mountain Defense',addr:'620 Market St Ste 300',bar:29341,specs:['DUI','Drug Offenses'],rating:4.6,reviews:67},
    {n:2,name:'Knox County Criminal Law',addr:'800 S Gay St',bar:21567,specs:['Assault','Criminal Defense'],rating:4.4,reviews:43},
    {n:3,name:'East Tennessee Legal Group',addr:'550 W Main St',bar:31890,specs:['DUI','Expungement'],rating:4.5,reviews:51},
    {n:4,name:'University District Defense',addr:'2607 Kingston Pike',bar:17234,specs:['Drug Offenses','Theft'],rating:4.3,reviews:38},
    {n:5,name:'Marble Springs Law',addr:'400 Main St',bar:24678,specs:['DUI','Federal Cases'],rating:4.7,reviews:82},
  ], bail:[
    {n:1,name:'Knox County Bail Bonds',addr:'712 N Central St',lic:30211,rate:10,hours:'24/7'},
    {n:2,name:'East TN Fast Release',addr:'1011 Sevier Ave',lic:31045,rate:10,hours:'24/7'},
  ]},

  // ── TEXAS ─────────────────────────────────────────────────────────────────
  {city:'Houston, TX', lat:29.7604, lng:-95.3698, state:'TX', area:'713', lawyers:[
    {n:1,name:'Bayou City Defense Group',addr:'440 Louisiana St Ste 1500',bar:24156789,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:234},
    {n:2,name:'Harris County Criminal Law',addr:'1415 Louisiana St Ste 3450',bar:24089123,specs:['DUI','Assault','Domestic Violence'],rating:4.7,reviews:187},
    {n:3,name:'Space City Legal Defense',addr:'2900 Weslayan St Ste 400',bar:24201456,specs:['Drug Offenses','White Collar'],rating:4.6,reviews:143},
    {n:4,name:'Gulf Coast Defense Attorneys',addr:'5850 San Felipe St Ste 500',bar:24312789,specs:['DUI','Theft','Criminal Defense'],rating:4.5,reviews:98},
    {n:5,name:'Houston Criminal Law Firm',addr:'3151 Briarpark Dr Ste 200',bar:24178345,specs:['Federal Cases','Expungement'],rating:4.8,reviews:167},
  ], bail:[
    {n:1,name:'Houston Bail Bonds',addr:'1111 Congress Ave',lic:10567,rate:10,hours:'24/7'},
    {n:2,name:'Harris County Fast Bail',addr:'49 San Jacinto St',lic:11234,rate:10,hours:'24/7'},
  ]},

  {city:'Dallas, TX', lat:32.7767, lng:-96.7970, state:'TX', area:'214', lawyers:[
    {n:1,name:'Big D Defense Law',addr:'1700 Pacific Ave Ste 3800',bar:24567890,specs:['DUI','Drug Offenses'],rating:4.8,reviews:198},
    {n:2,name:'Dallas Criminal Defense Group',addr:'2777 N Stemmons Fwy Ste 1000',bar:24423567,specs:['Federal Cases','Assault'],rating:4.7,reviews:156},
    {n:3,name:'Trinity River Legal',addr:'4245 N Central Expy Ste 440',bar:24689012,specs:['DUI','Theft','Drug Offenses'],rating:4.5,reviews:112},
    {n:4,name:'Oak Cliff Criminal Attorneys',addr:'100 N Central Expy',bar:24534678,specs:['Domestic Violence','Criminal Defense'],rating:4.4,reviews:87},
    {n:5,name:'Deep Ellum Defense',addr:'2400 Commerce St',bar:24745891,specs:['Expungement','DUI'],rating:4.6,reviews:134},
  ], bail:[
    {n:1,name:'Dallas County Bail Bonds',addr:'505 Main St',lic:20789,rate:10,hours:'24/7'},
    {n:2,name:'Big D Bail Bonds',addr:'310 W Commerce St',lic:21345,rate:10,hours:'24/7'},
  ]},

  {city:'San Antonio, TX', lat:29.4241, lng:-98.4936, state:'TX', area:'210', lawyers:[
    {n:1,name:'Alamo City Defense',addr:'700 N St Marys St Ste 1700',bar:24812345,specs:['DUI','Drug Offenses','Assault'],rating:4.7,reviews:145},
    {n:2,name:'River Walk Legal Group',addr:'1100 N W Loop 410 Ste 700',bar:24723456,specs:['Criminal Defense','Federal Cases'],rating:4.6,reviews:98},
    {n:3,name:'Bexar County Criminal Law',addr:'110 Broadway Ste 500',bar:24901234,specs:['DUI','Theft','Domestic Violence'],rating:4.5,reviews:76},
    {n:4,name:'San Antonio Defense Lawyers',addr:'403 E Commerce St Ste 116',bar:24656789,specs:['Drug Offenses','Expungement'],rating:4.4,reviews:61},
    {n:5,name:'Lone Star Criminal Defense',addr:'8600 NW Military Hwy Ste 105',bar:24834567,specs:['DUI','Assault'],rating:4.8,reviews:112},
  ], bail:[
    {n:1,name:'Alamo Bail Bonds',addr:'207 W Nueva St',lic:30456,rate:10,hours:'24/7'},
    {n:2,name:'San Antonio 24Hr Bail',addr:'512 N Flores St',lic:31012,rate:10,hours:'24/7'},
  ]},

  // ── CALIFORNIA ────────────────────────────────────────────────────────────
  {city:'Los Angeles, CA', lat:34.0522, lng:-118.2437, state:'CA', area:'213', lawyers:[
    {n:1,name:'LA Criminal Defense Group',addr:'355 S Grand Ave Ste 2450',bar:287654,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:312},
    {n:2,name:'Hollywood Defense Lawyers',addr:'6300 Wilshire Blvd Ste 1500',bar:312890,specs:['DUI','Assault','Domestic Violence'],rating:4.8,reviews:267},
    {n:3,name:'Downtown LA Legal Defense',addr:'445 S Figueroa St Ste 3100',bar:298765,specs:['Drug Offenses','White Collar'],rating:4.7,reviews:198},
    {n:4,name:'West LA Criminal Attorneys',addr:'11377 W Olympic Blvd',bar:275432,specs:['DUI','Theft','Criminal Defense'],rating:4.6,reviews:143},
    {n:5,name:'South Bay Defense Group',addr:'444 W Ocean Blvd Ste 800',bar:321456,specs:['Federal Cases','Expungement'],rating:4.8,reviews:221},
  ], bail:[
    {n:1,name:'LA Bail Bonds',addr:'211 W Temple St',lic:40234,rate:10,hours:'24/7'},
    {n:2,name:'Hollywood Bail Bonds',addr:'6464 Sunset Blvd',lic:41567,rate:10,hours:'24/7'},
  ]},

  {city:'San Diego, CA', lat:32.7157, lng:-117.1611, state:'CA', area:'619', lawyers:[
    {n:1,name:'Gaslamp Defense Law',addr:'501 W Broadway Ste 800',bar:256789,specs:['DUI','Drug Offenses'],rating:4.8,reviews:189},
    {n:2,name:'San Diego Criminal Group',addr:'1420 Kettner Blvd Ste 100',bar:234567,specs:['Federal Cases','Assault'],rating:4.7,reviews:145},
    {n:3,name:'Pacific Defense Attorneys',addr:'655 W Broadway Ste 900',bar:278901,specs:['DUI','Theft'],rating:4.6,reviews:112},
    {n:4,name:'Hillcrest Legal Defense',addr:'3440 Kearney Villa Rd',bar:245678,specs:['Drug Offenses','Criminal Defense'],rating:4.5,reviews:89},
    {n:5,name:'Mission Valley Law Group',addr:'2355 Northside Dr Ste 150',bar:289012,specs:['DUI','Expungement'],rating:4.7,reviews:134},
  ], bail:[
    {n:1,name:'San Diego Bail Bonds',addr:'220 W Broadway',lic:50789,rate:10,hours:'24/7'},
    {n:2,name:'County Bail Bonds SD',addr:'937 Kline St',lic:51234,rate:10,hours:'24/7'},
  ]},

  {city:'Oakland, CA', lat:37.8044, lng:-122.2712, state:'CA', area:'510', lawyers:[
    {n:1,name:'East Bay Criminal Defense',addr:'1300 Clay St Ste 600',bar:334567,specs:['Drug Offenses','Federal Cases'],rating:4.8,reviews:167},
    {n:2,name:'Oakland Defense Group',addr:'555 12th St Ste 1200',bar:312345,specs:['DUI','Assault','Criminal Defense'],rating:4.7,reviews:134},
    {n:3,name:'Alameda County Legal Defense',addr:'409 13th St',bar:345678,specs:['Drug Offenses','Theft'],rating:4.5,reviews:98},
    {n:4,name:'Lake Merritt Law',addr:'1970 Broadway Ste 1250',bar:323456,specs:['Domestic Violence','DUI'],rating:4.6,reviews:112},
    {n:5,name:'Bay Area Criminal Lawyers',addr:'2150 Franklin St',bar:356789,specs:['Federal Cases','Expungement'],rating:4.7,reviews:145},
  ], bail:[
    {n:1,name:'Oakland Bail Bonds',addr:'661 Washington St',lic:60345,rate:10,hours:'24/7'},
    {n:2,name:'Alameda Bail Services',addr:'1000 Broadway Ste 100',lic:61012,rate:10,hours:'24/7'},
  ]},

  // ── FLORIDA ───────────────────────────────────────────────────────────────
  {city:'Miami, FL', lat:25.7617, lng:-80.1918, state:'FL', area:'305', lawyers:[
    {n:1,name:'Brickell Criminal Defense',addr:'1221 Brickell Ave Ste 900',bar:112345,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:287},
    {n:2,name:'Magic City Legal Group',addr:'80 SW 8th St Ste 2000',bar:134567,specs:['DUI','Assault','Immigration'],rating:4.8,reviews:234},
    {n:3,name:'South Florida Defense Law',addr:'2333 Ponce de Leon Blvd',bar:123456,specs:['Drug Offenses','White Collar'],rating:4.7,reviews:189},
    {n:4,name:'Wynwood Criminal Attorneys',addr:'888 Brickell Ave',bar:145678,specs:['DUI','Theft','Criminal Defense'],rating:4.6,reviews:143},
    {n:5,name:'Little Havana Defense Group',addr:'3401 NW 82nd Ave Ste 370',bar:156789,specs:['Federal Cases','Expungement'],rating:4.8,reviews:198},
  ], bail:[
    {n:1,name:'Miami Bail Bonds',addr:'1351 NW 12th St',lic:70456,rate:10,hours:'24/7'},
    {n:2,name:'Dade County Bail Bonds',addr:'1100 NW 20th St',lic:71123,rate:10,hours:'24/7'},
  ]},

  {city:'Jacksonville, FL', lat:30.3322, lng:-81.6557, state:'FL', area:'904', lawyers:[
    {n:1,name:'First Coast Criminal Defense',addr:'1000 Riverside Ave Ste 100',bar:167890,specs:['DUI','Drug Offenses'],rating:4.7,reviews:134},
    {n:2,name:'Duval County Defense Group',addr:'200 W Forsyth St Ste 1450',bar:178901,specs:['Assault','Criminal Defense'],rating:4.6,reviews:98},
    {n:3,name:'Jacksonville Legal Defense',addr:'1 Independent Dr Ste 1902',bar:189012,specs:['DUI','Theft'],rating:4.5,reviews:76},
    {n:4,name:'St Johns River Law',addr:'300 W Adams St',bar:156789,specs:['Drug Offenses','Domestic Violence'],rating:4.4,reviews:61},
    {n:5,name:'River City Defense',addr:'4720 Salisbury Rd Ste 100',bar:145678,specs:['DUI','Federal Cases'],rating:4.8,reviews:112},
  ], bail:[
    {n:1,name:'Jacksonville Bail Bonds',addr:'224 E Forsyth St',lic:80234,rate:10,hours:'24/7'},
    {n:2,name:'First Coast Bail Bonds',addr:'1512 Powers Ave',lic:81567,rate:10,hours:'24/7'},
  ]},

  // ── NEW YORK ──────────────────────────────────────────────────────────────
  {city:'New York City, NY', lat:40.7128, lng:-74.0060, state:'NY', area:'212', lawyers:[
    {n:1,name:'Manhattan Criminal Defense',addr:'40 Wall St 28th Floor',bar:4512345,specs:['Federal Cases','White Collar','Drug Offenses'],rating:4.9,reviews:389},
    {n:2,name:'Bronx Defense Group',addr:'198 E 161st St Ste 600',bar:4634567,specs:['DUI','Assault','Drug Offenses'],rating:4.8,reviews:312},
    {n:3,name:'Brooklyn Criminal Lawyers',addr:'26 Court St Ste 2306',bar:4523456,specs:['Drug Offenses','Theft','Criminal Defense'],rating:4.7,reviews:267},
    {n:4,name:'Queens Criminal Defense',addr:'118-35 Queens Blvd Ste 400',bar:4645678,specs:['DUI','Domestic Violence'],rating:4.6,reviews:198},
    {n:5,name:'Staten Island Legal Defense',addr:'1 Edgewater Plaza Ste 503',bar:4556789,specs:['Federal Cases','Expungement'],rating:4.7,reviews:234},
  ], bail:[
    {n:1,name:'NYC Bail Bonds',addr:'100 Centre St',lic:90678,rate:10,hours:'24/7'},
    {n:2,name:'Manhattan Bail Services',addr:'111 Centre St',lic:91234,rate:10,hours:'24/7'},
  ]},

  // ── ILLINOIS ──────────────────────────────────────────────────────────────
  {city:'Chicago, IL', lat:41.8781, lng:-87.6298, state:'IL', area:'312', lawyers:[
    {n:1,name:'Windy City Criminal Defense',addr:'77 W Wacker Dr Ste 4500',bar:6312345,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:312},
    {n:2,name:'Loop Legal Defense Group',addr:'20 N Clark St Ste 3300',bar:6334567,specs:['DUI','Assault'],rating:4.8,reviews:256},
    {n:3,name:'South Side Criminal Attorneys',addr:'79 W Monroe St',bar:6323456,specs:['Drug Offenses','Theft','Criminal Defense'],rating:4.7,reviews:198},
    {n:4,name:'North Shore Defense Law',addr:'180 N LaSalle St Ste 3700',bar:6345678,specs:['DUI','Domestic Violence'],rating:4.6,reviews:145},
    {n:5,name:'Chicago Criminal Law Group',addr:'30 N LaSalle St Ste 3200',bar:6356789,specs:['Federal Cases','White Collar'],rating:4.8,reviews:221},
  ], bail:[
    {n:1,name:'Chicago Bail Bonds',addr:'2600 S California Ave',lic:100456,rate:10,hours:'24/7'},
    {n:2,name:'Cook County Bail Bonds',addr:'1100 S Hamilton Ave',lic:101123,rate:10,hours:'24/7'},
  ]},

  // ── GEORGIA ───────────────────────────────────────────────────────────────
  {city:'Atlanta, GA', lat:33.7490, lng:-84.3880, state:'GA', area:'404', lawyers:[
    {n:1,name:'Peach State Defense Group',addr:'191 Peachtree St NE Ste 3600',bar:123456,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:278},
    {n:2,name:'Buckhead Criminal Defense',addr:'3340 Peachtree Rd NE Ste 2400',bar:145678,specs:['DUI','Assault','White Collar'],rating:4.8,reviews:223},
    {n:3,name:'Midtown Atlanta Legal',addr:'1360 Peachtree St NE',bar:134567,specs:['Drug Offenses','Theft'],rating:4.7,reviews:178},
    {n:4,name:'Fulton County Defense Law',addr:'200 Peachtree St NW',bar:156789,specs:['DUI','Domestic Violence'],rating:4.6,reviews:134},
    {n:5,name:'Capitol City Criminal Attorneys',addr:'1170 Peachtree St NE Ste 1200',bar:167890,specs:['Federal Cases','Expungement'],rating:4.8,reviews:198},
  ], bail:[
    {n:1,name:'Atlanta Bail Bonds',addr:'185 Central Ave SW',lic:110234,rate:10,hours:'24/7'},
    {n:2,name:'Fulton County Bail Bonds',addr:'185 Pryor St SW',lic:111567,rate:10,hours:'24/7'},
  ]},

  // ── NORTH CAROLINA ────────────────────────────────────────────────────────
  {city:'Charlotte, NC', lat:35.2271, lng:-80.8431, state:'NC', area:'704', lawyers:[
    {n:1,name:'Queen City Defense Group',addr:'301 S College St Ste 2800',bar:35234,specs:['DUI','Drug Offenses'],rating:4.8,reviews:167},
    {n:2,name:'Mecklenburg Criminal Law',addr:'200 S Tryon St Ste 1400',bar:35456,specs:['Assault','Federal Cases'],rating:4.7,reviews:134},
    {n:3,name:'Carolina Defense Attorneys',addr:'525 N Tryon St Ste 1600',bar:35345,specs:['DUI','Theft','Drug Offenses'],rating:4.6,reviews:98},
    {n:4,name:'Charlotte Legal Defense',addr:'121 W Trade St Ste 1000',bar:35567,specs:['Domestic Violence','Criminal Defense'],rating:4.5,reviews:76},
    {n:5,name:'NoDa Criminal Law Group',addr:'1115 N Tryon St',bar:35678,specs:['DUI','Expungement'],rating:4.7,reviews:112},
  ], bail:[
    {n:1,name:'Charlotte Bail Bonds',addr:'832 E 4th St',lic:120345,rate:10,hours:'24/7'},
    {n:2,name:'Mecklenburg Bail Bonds',addr:'500 N College St',lic:121012,rate:10,hours:'24/7'},
  ]},

  // ── OHIO ──────────────────────────────────────────────────────────────────
  {city:'Columbus, OH', lat:39.9612, lng:-82.9988, state:'OH', area:'614', lawyers:[
    {n:1,name:'Buckeye State Defense',addr:'41 S High St Ste 3300',bar:87234,specs:['DUI','Drug Offenses'],rating:4.8,reviews:145},
    {n:2,name:'Columbus Criminal Law Group',addr:'250 E Broad St',bar:87456,specs:['Federal Cases','Assault'],rating:4.7,reviews:112},
    {n:3,name:'Short North Legal Defense',addr:'180 E Broad St Ste 1300',bar:87345,specs:['DUI','Theft'],rating:4.6,reviews:89},
    {n:4,name:'Franklin County Defense',addr:'100 E Broad St Ste 500',bar:87567,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:67},
    {n:5,name:'Ohio Criminal Attorneys',addr:'471 E Broad St',bar:87678,specs:['DUI','Federal Cases'],rating:4.7,reviews:98},
  ], bail:[
    {n:1,name:'Columbus Bail Bonds',addr:'375 S High St',lic:130456,rate:10,hours:'24/7'},
    {n:2,name:'Franklin County Bail Bonds',addr:'474 S High St',lic:131123,rate:10,hours:'24/7'},
  ]},

  {city:'Cleveland, OH', lat:41.4993, lng:-81.6944, state:'OH', area:'216', lawyers:[
    {n:1,name:'North Coast Defense Group',addr:'1375 E 9th St Ste 2100',bar:87789,specs:['DUI','Drug Offenses'],rating:4.7,reviews:123},
    {n:2,name:'Cuyahoga Criminal Law',addr:'600 Superior Ave E Ste 1300',bar:87890,specs:['Assault','Federal Cases'],rating:4.6,reviews:98},
    {n:3,name:'Rock & Roll City Legal',addr:'200 Public Sq Ste 3900',bar:87901,specs:['DUI','Theft'],rating:4.5,reviews:76},
    {n:4,name:'Cleveland Defense Attorneys',addr:'55 Public Sq Ste 1600',bar:88012,specs:['Drug Offenses','Criminal Defense'],rating:4.4,reviews:61},
    {n:5,name:'Lake Erie Legal Group',addr:'1001 Lakeside Ave E',bar:88123,specs:['DUI','Expungement'],rating:4.6,reviews:87},
  ], bail:[
    {n:1,name:'Cleveland Bail Bonds',addr:'1215 Ontario St',lic:140234,rate:10,hours:'24/7'},
    {n:2,name:'Cuyahoga Bail Bonds',addr:'1200 W 3rd St',lic:141567,rate:10,hours:'24/7'},
  ]},

  // ── PENNSYLVANIA ──────────────────────────────────────────────────────────
  {city:'Philadelphia, PA', lat:39.9526, lng:-75.1652, state:'PA', area:'215', lawyers:[
    {n:1,name:'City of Brotherly Defense',addr:'1515 Market St Ste 1200',bar:87654,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:267},
    {n:2,name:'Center City Criminal Law',addr:'1635 Market St',bar:89012,specs:['DUI','Assault'],rating:4.8,reviews:212},
    {n:3,name:'Philly Defense Group',addr:'1700 Market St Ste 1400',bar:88234,specs:['Drug Offenses','Theft'],rating:4.7,reviews:178},
    {n:4,name:'South Philly Legal Defense',addr:'1500 JFK Blvd Ste 900',bar:90456,specs:['DUI','Domestic Violence'],rating:4.6,reviews:134},
    {n:5,name:'Liberty Bell Criminal Attorneys',addr:'2 Penn Center Plaza Ste 1030',bar:87890,specs:['Federal Cases','White Collar'],rating:4.8,reviews:198},
  ], bail:[
    {n:1,name:'Philadelphia Bail Bonds',addr:'1301 Filbert St',lic:150345,rate:10,hours:'24/7'},
    {n:2,name:'Liberty Bell Bail Bonds',addr:'800 N Broad St',lic:151012,rate:10,hours:'24/7'},
  ]},

  // ── ARIZONA ───────────────────────────────────────────────────────────────
  {city:'Phoenix, AZ', lat:33.4484, lng:-112.0740, state:'AZ', area:'602', lawyers:[
    {n:1,name:'Valley of the Sun Defense',addr:'2398 E Camelback Rd Ste 1090',bar:12345,specs:['DUI','Drug Offenses'],rating:4.8,reviews:189},
    {n:2,name:'Maricopa Criminal Law Group',addr:'1 E Washington St Ste 500',bar:13456,specs:['Federal Cases','Assault'],rating:4.7,reviews:145},
    {n:3,name:'Desert Defense Attorneys',addr:'2929 N Central Ave',bar:14567,specs:['DUI','Theft'],rating:4.6,reviews:112},
    {n:4,name:'Phoenix Criminal Defense',addr:'3550 N Central Ave Ste 1800',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:89},
    {n:5,name:'Scottsdale Legal Defense',addr:'7025 N Scottsdale Rd Ste 200',bar:16789,specs:['DUI','White Collar'],rating:4.7,reviews:134},
  ], bail:[
    {n:1,name:'Phoenix Bail Bonds',addr:'620 W Jefferson St',lic:160456,rate:10,hours:'24/7'},
    {n:2,name:'Maricopa Bail Bonds',addr:'201 W Jefferson St',lic:161123,rate:10,hours:'24/7'},
  ]},

  // ── MICHIGAN ──────────────────────────────────────────────────────────────
  {city:'Detroit, MI', lat:42.3314, lng:-83.0458, state:'MI', area:'313', lawyers:[
    {n:1,name:'Motor City Criminal Defense',addr:'400 Renaissance Ctr Ste 2600',bar:'P23456',specs:['Drug Offenses','Federal Cases','DUI'],rating:4.8,reviews:198},
    {n:2,name:'Wayne County Defense Group',addr:'615 Griswold St Ste 900',bar:'P34567',specs:['DUI','Assault'],rating:4.7,reviews:156},
    {n:3,name:'Detroit Legal Defense',addr:'211 W Fort St Ste 2800',bar:'P45678',specs:['Drug Offenses','Theft'],rating:4.6,reviews:123},
    {n:4,name:'Midtown Detroit Attorneys',addr:'2 Woodward Ave',bar:'P56789',specs:['DUI','Domestic Violence'],rating:4.5,reviews:98},
    {n:5,name:'Corktown Criminal Law',addr:'1000 Woodward Ave',bar:'P67890',specs:['Federal Cases','Expungement'],rating:4.7,reviews:134},
  ], bail:[
    {n:1,name:'Detroit Bail Bonds',addr:'201 E Jefferson Ave',lic:170234,rate:10,hours:'24/7'},
    {n:2,name:'Wayne County Bail Bonds',addr:'1023 E Forest Ave',lic:171567,rate:10,hours:'24/7'},
  ]},

  // ── COLORADO ──────────────────────────────────────────────────────────────
  {city:'Denver, CO', lat:39.7392, lng:-104.9903, state:'CO', area:'303', lawyers:[
    {n:1,name:'Mile High Defense Group',addr:'999 18th St Ste 3000',bar:42345,specs:['Drug Offenses','DUI'],rating:4.9,reviews:223},
    {n:2,name:'Rocky Mountain Criminal Law',addr:'1700 Lincoln St Ste 2200',bar:43456,specs:['Federal Cases','Assault'],rating:4.8,reviews:178},
    {n:3,name:'Denver Criminal Defense',addr:'1301 Bannock St',bar:44567,specs:['DUI','Theft'],rating:4.7,reviews:145},
    {n:4,name:'Capitol Hill Defense',addr:'825 E Colfax Ave',bar:45678,specs:['Drug Offenses','Domestic Violence'],rating:4.6,reviews:112},
    {n:5,name:'LoDo Legal Group',addr:'1700 Wynkoop St',bar:46789,specs:['DUI','White Collar'],rating:4.8,reviews:167},
  ], bail:[
    {n:1,name:'Denver Bail Bonds',addr:'435 W Colfax Ave',lic:180345,rate:10,hours:'24/7'},
    {n:2,name:'Adams County Bail Bonds',addr:'1881 Pierce St',lic:181012,rate:10,hours:'24/7'},
  ]},

  // ── WASHINGTON ────────────────────────────────────────────────────────────
  {city:'Seattle, WA', lat:47.6062, lng:-122.3321, state:'WA', area:'206', lawyers:[
    {n:1,name:'Emerald City Defense',addr:'1111 3rd Ave Ste 3000',bar:12345,specs:['Drug Offenses','DUI','Federal Cases'],rating:4.9,reviews:234},
    {n:2,name:'King County Criminal Law',addr:'701 5th Ave Ste 4200',bar:13456,specs:['DUI','Assault'],rating:4.8,reviews:189},
    {n:3,name:'Seattle Criminal Defense Group',addr:'999 3rd Ave Ste 3900',bar:14567,specs:['Drug Offenses','Theft'],rating:4.7,reviews:156},
    {n:4,name:'Capitol Hill Legal Defense',addr:'1201 Western Ave',bar:15678,specs:['DUI','Domestic Violence'],rating:4.6,reviews:123},
    {n:5,name:'Belltown Defense Attorneys',addr:'2001 6th Ave',bar:16789,specs:['Federal Cases','White Collar'],rating:4.8,reviews:178},
  ], bail:[
    {n:1,name:'Seattle Bail Bonds',addr:'516 3rd Ave',lic:190456,rate:10,hours:'24/7'},
    {n:2,name:'King County Bail Bonds',addr:'1002 2nd Ave',lic:191123,rate:10,hours:'24/7'},
  ]},

  // ── MARYLAND ──────────────────────────────────────────────────────────────
  {city:'Baltimore, MD', lat:39.2904, lng:-76.6122, state:'MD', area:'410', lawyers:[
    {n:1,name:'Charm City Defense Group',addr:'111 S Calvert St Ste 2700',bar:8812345,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.8,reviews:178},
    {n:2,name:'Inner Harbor Criminal Law',addr:'100 E Pratt St',bar:8823456,specs:['DUI','Assault'],rating:4.7,reviews:143},
    {n:3,name:'Baltimore Criminal Defense',addr:'210 E Lexington St',bar:8834567,specs:['Drug Offenses','Theft'],rating:4.6,reviews:112},
    {n:4,name:'Fells Point Legal Group',addr:'1 E Pratt St',bar:8845678,specs:['DUI','Domestic Violence'],rating:4.5,reviews:89},
    {n:5,name:'Federal Hill Attorneys',addr:'300 E Lombard St Ste 840',bar:8856789,specs:['Federal Cases','Expungement'],rating:4.7,reviews:134},
  ], bail:[
    {n:1,name:'Baltimore Bail Bonds',addr:'401 E Fayette St',lic:200234,rate:10,hours:'24/7'},
    {n:2,name:'Maryland Bail Bonds',addr:'300 N Charles St',lic:201567,rate:10,hours:'24/7'},
  ]},

  // ── VIRGINIA ──────────────────────────────────────────────────────────────
  {city:'Virginia Beach, VA', lat:36.8529, lng:-75.9780, state:'VA', area:'757', lawyers:[
    {n:1,name:'Coastal Defense Law',addr:'222 Central Park Ave Ste 2000',bar:23456,specs:['DUI','Drug Offenses'],rating:4.7,reviews:134},
    {n:2,name:'Virginia Beach Criminal Group',addr:'500 World Trade Ctr',bar:24567,specs:['Assault','Federal Cases'],rating:4.6,reviews:98},
    {n:3,name:'Hampton Roads Defense',addr:'4041 Bonney Rd Ste 100',bar:25678,specs:['DUI','Theft'],rating:4.5,reviews:76},
    {n:4,name:'Oceanfront Legal Defense',addr:'212 31st St Ste 200',bar:26789,specs:['Drug Offenses','Criminal Defense'],rating:4.4,reviews:61},
    {n:5,name:'Beach Defense Attorneys',addr:'4445 Corporation Ln',bar:27890,specs:['DUI','Domestic Violence'],rating:4.6,reviews:89},
  ], bail:[
    {n:1,name:'Virginia Beach Bail Bonds',addr:'2425 Nimmo Pkwy',lic:210345,rate:10,hours:'24/7'},
    {n:2,name:'Hampton Roads Bail Bonds',addr:'4020 Holland Rd',lic:211012,rate:10,hours:'24/7'},
  ]},

  // ── NEW JERSEY ────────────────────────────────────────────────────────────
  {city:'Newark, NJ', lat:40.7357, lng:-74.1724, state:'NJ', area:'973', lawyers:[
    {n:1,name:'Garden State Defense Group',addr:'1 Gateway Ctr Ste 2600',bar:23456,specs:['DUI','Drug Offenses','Federal Cases'],rating:4.8,reviews:156},
    {n:2,name:'Essex County Criminal Law',addr:'50 Park Pl Ste 1130',bar:24567,specs:['Assault','Criminal Defense'],rating:4.7,reviews:123},
    {n:3,name:'Newark Criminal Defense',addr:'1180 Raymond Blvd',bar:25678,specs:['DUI','Theft'],rating:4.6,reviews:98},
    {n:4,name:'Ironbound Defense Attorneys',addr:'744 Broad St',bar:26789,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:76},
    {n:5,name:'NJ Criminal Law Group',addr:'1 Penn Plaza E',bar:27890,specs:['Federal Cases','Expungement'],rating:4.7,reviews:112},
  ], bail:[
    {n:1,name:'Newark Bail Bonds',addr:'50 W Market St',lic:220456,rate:10,hours:'24/7'},
    {n:2,name:'Essex County Bail Bonds',addr:'900 Broad St',lic:221123,rate:10,hours:'24/7'},
  ]},

  // ── INDIANA ───────────────────────────────────────────────────────────────
  {city:'Indianapolis, IN', lat:39.7684, lng:-86.1581, state:'IN', area:'317', lawyers:[
    {n:1,name:'Crossroads Defense Group',addr:'111 Monument Cir Ste 4800',bar:12345,specs:['DUI','Drug Offenses'],rating:4.8,reviews:145},
    {n:2,name:'Marion County Criminal Law',addr:'101 W Ohio St Ste 1800',bar:13456,specs:['Assault','Federal Cases'],rating:4.7,reviews:112},
    {n:3,name:'Indy Criminal Defense',addr:'135 N Pennsylvania St Ste 1600',bar:14567,specs:['DUI','Theft'],rating:4.6,reviews:89},
    {n:4,name:'Fountain Square Legal Group',addr:'320 N Meridian St',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:67},
    {n:5,name:'Broad Ripple Defense',addr:'9000 Keystone Crossing Ste 1000',bar:16789,specs:['DUI','Criminal Defense'],rating:4.7,reviews:98},
  ], bail:[
    {n:1,name:'Indianapolis Bail Bonds',addr:'40 S Alabama St',lic:230234,rate:10,hours:'24/7'},
    {n:2,name:'Marion County Bail Bonds',addr:'251 E Ohio St',lic:231567,rate:10,hours:'24/7'},
  ]},

  // ── MISSOURI ──────────────────────────────────────────────────────────────
  {city:'Kansas City, MO', lat:39.0997, lng:-94.5786, state:'MO', area:'816', lawyers:[
    {n:1,name:'KC Defense Group',addr:'1201 Walnut St Ste 2900',bar:31234,specs:['DUI','Drug Offenses'],rating:4.8,reviews:134},
    {n:2,name:'Crossroads Criminal Law',addr:'700 W 47th St Ste 1000',bar:32345,specs:['Federal Cases','Assault'],rating:4.7,reviews:98},
    {n:3,name:'Kansas City Criminal Defense',addr:'1000 Walnut St',bar:33456,specs:['DUI','Theft'],rating:4.6,reviews:76},
    {n:4,name:'Power & Light Defense',addr:'106 W 14th St Ste 1600',bar:34567,specs:['Drug Offenses','Criminal Defense'],rating:4.5,reviews:61},
    {n:5,name:'Westport Legal Group',addr:'4600 Madison Ave Ste 1000',bar:35678,specs:['DUI','Domestic Violence'],rating:4.7,reviews:89},
  ], bail:[
    {n:1,name:'Kansas City Bail Bonds',addr:'1026 Troost Ave',lic:240345,rate:10,hours:'24/7'},
    {n:2,name:'Jackson County Bail Bonds',addr:'415 E 12th St',lic:241012,rate:10,hours:'24/7'},
  ]},

  {city:'St. Louis, MO', lat:38.6270, lng:-90.1994, state:'MO', area:'314', lawyers:[
    {n:1,name:'Gateway City Defense',addr:'190 Carondelet Plaza Ste 400',bar:36789,specs:['DUI','Drug Offenses'],rating:4.8,reviews:123},
    {n:2,name:'St Louis Criminal Law Group',addr:'7700 Forsyth Blvd Ste 1700',bar:37890,specs:['Assault','Federal Cases'],rating:4.7,reviews:98},
    {n:3,name:'Soulard Defense Attorneys',addr:'100 N Broadway Ste 1600',bar:38901,specs:['DUI','Theft'],rating:4.6,reviews:76},
    {n:4,name:'Arch City Legal Defense',addr:'200 N Broadway',bar:39012,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:61},
    {n:5,name:'Cherokee Street Law',addr:'1 Metropolitan Sq',bar:40123,specs:['Criminal Defense','DUI'],rating:4.7,reviews:89},
  ], bail:[
    {n:1,name:'St Louis Bail Bonds',addr:'1114 Market St',lic:250456,rate:10,hours:'24/7'},
    {n:2,name:'Gateway Bail Bonds',addr:'600 Washington Ave',lic:251123,rate:10,hours:'24/7'},
  ]},

  // ── LOUISIANA ─────────────────────────────────────────────────────────────
  {city:'New Orleans, LA', lat:29.9511, lng:-90.0715, state:'LA', area:'504', lawyers:[
    {n:1,name:'Crescent City Defense',addr:'400 Poydras St Ste 2800',bar:12345,specs:['Drug Offenses','DUI','Federal Cases'],rating:4.9,reviews:245},
    {n:2,name:'French Quarter Legal Group',addr:'650 Poydras St Ste 2750',bar:13456,specs:['DUI','Assault'],rating:4.8,reviews:198},
    {n:3,name:'NOLA Criminal Defense',addr:'1100 Poydras St Ste 1300',bar:14567,specs:['Drug Offenses','Theft'],rating:4.7,reviews:156},
    {n:4,name:'Garden District Defense',addr:'201 St Charles Ave Ste 3300',bar:15678,specs:['DUI','Domestic Violence'],rating:4.6,reviews:123},
    {n:5,name:'Warehouse District Law',addr:'365 Canal St Ste 2000',bar:16789,specs:['Federal Cases','Expungement'],rating:4.8,reviews:178},
  ], bail:[
    {n:1,name:'New Orleans Bail Bonds',addr:'819 Magazine St',lic:260234,rate:10,hours:'24/7'},
    {n:2,name:'Orleans Parish Bail Bonds',addr:'2700 Tulane Ave',lic:261567,rate:10,hours:'24/7'},
  ]},

  // ── WASHINGTON DC ─────────────────────────────────────────────────────────
  {city:'Washington, DC', lat:38.9072, lng:-77.0369, state:'DC', area:'202', lawyers:[
    {n:1,name:'Capitol Defense Group',addr:'1300 I St NW Ste 400',bar:501234,specs:['Federal Cases','White Collar','Drug Offenses'],rating:4.9,reviews:312},
    {n:2,name:'DC Criminal Law Firm',addr:'700 12th St NW Ste 700',bar:502345,specs:['DUI','Assault','Federal Cases'],rating:4.8,reviews:267},
    {n:3,name:'Georgetown Defense Lawyers',addr:'1625 I St NW',bar:503456,specs:['Drug Offenses','Theft'],rating:4.7,reviews:212},
    {n:4,name:'Adams Morgan Legal Group',addr:'2000 Pennsylvania Ave NW',bar:504567,specs:['DUI','Domestic Violence'],rating:4.6,reviews:178},
    {n:5,name:'NoMa Criminal Defense',addr:'401 9th St NW Ste 800',bar:505678,specs:['Federal Cases','White Collar'],rating:4.8,reviews:234},
  ], bail:[
    {n:1,name:'DC Bail Bonds',addr:'500 Indiana Ave NW',lic:270345,rate:10,hours:'24/7'},
    {n:2,name:'District Bail Bonds',addr:'300 Indiana Ave NW',lic:271012,rate:10,hours:'24/7'},
  ]},

  // ── NEVADA ────────────────────────────────────────────────────────────────
  {city:'Las Vegas, NV', lat:36.1699, lng:-115.1398, state:'NV', area:'702', lawyers:[
    {n:1,name:'Vegas Strip Defense Group',addr:'3800 Howard Hughes Pkwy Ste 1000',bar:12345,specs:['DUI','Drug Offenses'],rating:4.9,reviews:267},
    {n:2,name:'Clark County Criminal Law',addr:'300 S 4th St Ste 1600',bar:13456,specs:['Federal Cases','Assault'],rating:4.8,reviews:212},
    {n:3,name:'Sin City Legal Defense',addr:'400 S 4th St',bar:14567,specs:['DUI','Theft'],rating:4.7,reviews:178},
    {n:4,name:'Fremont Street Attorneys',addr:'400 N Rancho Dr Ste 120',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.6,reviews:145},
    {n:5,name:'Summerlin Defense Law',addr:'10000 W Charleston Blvd Ste 140',bar:16789,specs:['DUI','Criminal Defense'],rating:4.8,reviews:198},
  ], bail:[
    {n:1,name:'Vegas Bail Bonds',addr:'330 S Casino Center Blvd',lic:280456,rate:10,hours:'24/7'},
    {n:2,name:'Clark County Bail Bonds',addr:'200 Lewis Ave',lic:281123,rate:10,hours:'24/7'},
  ]},

  // ── WISCONSIN ─────────────────────────────────────────────────────────────
  {city:'Milwaukee, WI', lat:43.0389, lng:-87.9065, state:'WI', area:'414', lawyers:[
    {n:1,name:'Cream City Defense Group',addr:'111 E Wisconsin Ave Ste 1800',bar:1012345,specs:['DUI','Drug Offenses'],rating:4.7,reviews:123},
    {n:2,name:'Milwaukee Criminal Law',addr:'250 E Wisconsin Ave Ste 1200',bar:1023456,specs:['Assault','Federal Cases'],rating:4.6,reviews:98},
    {n:3,name:'Brady Street Legal Defense',addr:'780 N Water St Ste 600',bar:1034567,specs:['DUI','Theft'],rating:4.5,reviews:76},
    {n:4,name:'Walker\'s Point Defense',addr:'1233 N Mayfair Rd Ste 402',bar:1045678,specs:['Drug Offenses','Domestic Violence'],rating:4.4,reviews:61},
    {n:5,name:'Riverwest Criminal Attorneys',addr:'759 N Milwaukee St Ste 400',bar:1056789,specs:['DUI','Expungement'],rating:4.6,reviews:89},
  ], bail:[
    {n:1,name:'Milwaukee Bail Bonds',addr:'821 W State St',lic:290234,rate:10,hours:'24/7'},
    {n:2,name:'Milwaukee County Bail Bonds',addr:'901 N 9th St',lic:291567,rate:10,hours:'24/7'},
  ]},

  // ── KENTUCKY ──────────────────────────────────────────────────────────────
  {city:'Louisville, KY', lat:38.2527, lng:-85.7585, state:'KY', area:'502', lawyers:[
    {n:1,name:'Derby City Defense Group',addr:'400 W Market St Ste 1800',bar:12345,specs:['DUI','Drug Offenses'],rating:4.8,reviews:134},
    {n:2,name:'Jefferson County Criminal Law',addr:'101 W Main St',bar:13456,specs:['Assault','Federal Cases'],rating:4.7,reviews:98},
    {n:3,name:'Louisville Criminal Defense',addr:'600 W Main St Ste 100',bar:14567,specs:['DUI','Theft'],rating:4.6,reviews:76},
    {n:4,name:'Highlands Legal Group',addr:'2950 Breckenridge Ln Ste 9',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:61},
    {n:5,name:'NuLu Defense Attorneys',addr:'560 S 4th St Ste 200',bar:16789,specs:['DUI','Criminal Defense'],rating:4.7,reviews:89},
  ], bail:[
    {n:1,name:'Louisville Bail Bonds',addr:'600 W Jefferson St',lic:300345,rate:10,hours:'24/7'},
    {n:2,name:'Jefferson County Bail Bonds',addr:'514 W Liberty St',lic:301012,rate:10,hours:'24/7'},
  ]},

  // ── SOUTH CAROLINA ────────────────────────────────────────────────────────
  {city:'Columbia, SC', lat:34.0007, lng:-81.0348, state:'SC', area:'803', lawyers:[
    {n:1,name:'Palmetto State Defense',addr:'1221 Main St Ste 2100',bar:12345,specs:['DUI','Drug Offenses'],rating:4.7,reviews:112},
    {n:2,name:'Richland County Criminal Law',addr:'1300 Main St',bar:13456,specs:['Assault','Federal Cases'],rating:4.6,reviews:89},
    {n:3,name:'Five Points Legal Defense',addr:'1329 Assembly St Ste 1000',bar:14567,specs:['DUI','Theft'],rating:4.5,reviews:67},
    {n:4,name:'Congaree Defense Group',addr:'1501 Main St Ste 600',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.4,reviews:51},
    {n:5,name:'Vista Defense Attorneys',addr:'903 Richland St',bar:16789,specs:['DUI','Criminal Defense'],rating:4.6,reviews:76},
  ], bail:[
    {n:1,name:'Columbia Bail Bonds',addr:'1600 Main St',lic:310234,rate:10,hours:'24/7'},
    {n:2,name:'SC Bail Bonds',addr:'1401 Hampton St',lic:311567,rate:10,hours:'24/7'},
  ]},

  // ── ALABAMA ───────────────────────────────────────────────────────────────
  {city:'Birmingham, AL', lat:33.5186, lng:-86.8104, state:'AL', area:'205', lawyers:[
    {n:1,name:'Magic City Defense Group',addr:'1901 6th Ave N Ste 2600',bar:'ASB12345',specs:['DUI','Drug Offenses'],rating:4.7,reviews:123},
    {n:2,name:'Jefferson County Criminal Law',addr:'420 20th St N Ste 1800',bar:'ASB13456',specs:['Assault','Federal Cases'],rating:4.6,reviews:98},
    {n:3,name:'Southside Legal Defense',addr:'2100 3rd Ave N',bar:'ASB14567',specs:['DUI','Theft'],rating:4.5,reviews:76},
    {n:4,name:'Avondale Defense Attorneys',addr:'3440 Colonnade Pkwy Ste 200',bar:'ASB15678',specs:['Drug Offenses','Domestic Violence'],rating:4.4,reviews:61},
    {n:5,name:'Red Mountain Law Group',addr:'600 Vestavia Pkwy Ste 3500',bar:'ASB16789',specs:['DUI','Criminal Defense'],rating:4.6,reviews:89},
  ], bail:[
    {n:1,name:'Birmingham Bail Bonds',addr:'2009 1st Ave N',lic:320345,rate:10,hours:'24/7'},
    {n:2,name:'Jefferson County Bail Bonds',addr:'716 Richard Arrington Jr Blvd N',lic:321012,rate:10,hours:'24/7'},
  ]},

  // ── OREGON ────────────────────────────────────────────────────────────────
  {city:'Portland, OR', lat:45.5051, lng:-122.6750, state:'OR', area:'503', lawyers:[
    {n:1,name:'Rose City Defense Group',addr:'1300 SW 5th Ave Ste 3400',bar:12345,specs:['Drug Offenses','DUI'],rating:4.9,reviews:198},
    {n:2,name:'Multnomah Criminal Law',addr:'900 SW 5th Ave Ste 2400',bar:13456,specs:['Federal Cases','Assault'],rating:4.8,reviews:156},
    {n:3,name:'Pearl District Defense',addr:'1211 SW 5th Ave Ste 900',bar:14567,specs:['DUI','Theft'],rating:4.7,reviews:123},
    {n:4,name:'Alberta Arts Defense',addr:'1001 SW 5th Ave Ste 1100',bar:15678,specs:['Drug Offenses','Domestic Violence'],rating:4.6,reviews:98},
    {n:5,name:'Hawthorne Legal Group',addr:'805 SW Broadway Ste 2400',bar:16789,specs:['DUI','White Collar'],rating:4.8,reviews:145},
  ], bail:[
    {n:1,name:'Portland Bail Bonds',addr:'1 SW Columbia St',lic:330456,rate:10,hours:'24/7'},
    {n:2,name:'Multnomah Bail Bonds',addr:'1120 SW 3rd Ave',lic:331123,rate:10,hours:'24/7'},
  ]},

  // ── MINNESOTA ─────────────────────────────────────────────────────────────
  {city:'Minneapolis, MN', lat:44.9778, lng:-93.2650, state:'MN', area:'612', lawyers:[
    {n:1,name:'Twin Cities Defense Group',addr:'225 S 6th St Ste 3900',bar:123456,specs:['Drug Offenses','DUI'],rating:4.8,reviews:167},
    {n:2,name:'Hennepin Criminal Law',addr:'100 S 5th St Ste 1900',bar:134567,specs:['Federal Cases','Assault'],rating:4.7,reviews:134},
    {n:3,name:'Uptown Defense Attorneys',addr:'80 S 8th St Ste 900',bar:145678,specs:['DUI','Theft'],rating:4.6,reviews:112},
    {n:4,name:'North Loop Legal Defense',addr:'50 S 6th St Ste 1500',bar:156789,specs:['Drug Offenses','Domestic Violence'],rating:4.5,reviews:89},
    {n:5,name:'Warehouse District Law Group',addr:'330 2nd Ave S',bar:167890,specs:['DUI','White Collar'],rating:4.7,reviews:134},
  ], bail:[
    {n:1,name:'Minneapolis Bail Bonds',addr:'300 S 6th St',lic:340234,rate:10,hours:'24/7'},
    {n:2,name:'Hennepin County Bail Bonds',addr:'401 4th Ave S',lic:341567,rate:10,hours:'24/7'},
  ]},

  // ── NEW MEXICO ────────────────────────────────────────────────────────────
  {city:'Albuquerque, NM', lat:35.0844, lng:-106.6504, state:'NM', area:'505', lawyers:[
    {n:1,name:'Duke City Defense Group',addr:'500 4th St NW Ste 1000',bar:12345,specs:['DUI','Drug Offenses'],rating:4.7,reviews:112},
    {n:2,name:'Bernalillo Criminal Law',addr:'320 Gold Ave SW Ste 1300',bar:13456,specs:['Assault','Federal Cases'],rating:4.6,reviews:89},
    {n:3,name:'Old Town Legal Defense',addr:'201 3rd St NW',bar:14567,specs:['DUI','Theft'],rating:4.5,reviews:67},
    {n:4,name:'Nob Hill Defense Attorneys',addr:'400 Gold Ave SW Ste 900',bar:15678,specs:['Drug Offenses','Criminal Defense'],rating:4.4,reviews:51},
    {n:5,name:'New Mexico Criminal Law',addr:'1650 University Blvd NE',bar:16789,specs:['DUI','Domestic Violence'],rating:4.6,reviews:76},
  ], bail:[
    {n:1,name:'Albuquerque Bail Bonds',addr:'1100 4th St NW',lic:350345,rate:10,hours:'24/7'},
    {n:2,name:'Bernalillo County Bail',addr:'400 Lomas Blvd NW',lic:351012,rate:10,hours:'24/7'},
  ]},

  // ── MASSACHUSETTS ─────────────────────────────────────────────────────────
  {city:'Boston, MA', lat:42.3601, lng:-71.0589, state:'MA', area:'617', lawyers:[
    {n:1,name:'Beacon Hill Defense Group',addr:'155 Federal St Ste 1700',bar:123456,specs:['Drug Offenses','Federal Cases','DUI'],rating:4.9,reviews:234},
    {n:2,name:'Suffolk Criminal Law',addr:'200 State St',bar:134567,specs:['DUI','Assault'],rating:4.8,reviews:189},
    {n:3,name:'Fenway Defense Attorneys',addr:'One Boston Pl Ste 2600',bar:145678,specs:['Drug Offenses','Theft'],rating:4.7,reviews:156},
    {n:4,name:'South End Legal Defense',addr:'125 Summer St',bar:156789,specs:['DUI','Domestic Violence'],rating:4.6,reviews:123},
    {n:5,name:'South Boston Law Group',addr:'101 Federal St',bar:167890,specs:['Federal Cases','White Collar'],rating:4.8,reviews:178},
  ], bail:[
    {n:1,name:'Boston Bail Bonds',addr:'40 Thorndike St',lic:360456,rate:10,hours:'24/7'},
    {n:2,name:'Suffolk County Bail Bonds',addr:'1 New Sudbury St',lic:361123,rate:10,hours:'24/7'},
  ]},
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildLawyer(entry, lawyer) {
  const barNum = typeof lawyer.bar === 'string'
    ? lawyer.bar : bar(entry.state, lawyer.bar);
  return {
    source_id:    `seed_${entry.city.replace(/[^a-z]/gi,'_').toLowerCase()}_law_${lawyer.n}`,
    city:          entry.city,
    name:          lawyer.name,
    phone:         fmt(entry.area, 4500000 + (lawyer.n * 1111) + (lawyer.bar % 1000)),
    address:       `${lawyer.addr}, ${entry.city} ${entry.state}`,
    lat:           entry.lat + (lawyer.n * 0.004),
    lng:           entry.lng + (lawyer.n * 0.003),
    website:       `https://${lawyer.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.com`,
    email:         `contact@${lawyer.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,20)}.com`,
    hours:         'Mon-Fri 9am-5pm, 24/7 emergency line',
    rating:        lawyer.rating,
    reviews:       lawyer.reviews,
    bar_number:    barNum,
    verified:      0,                          // ← seed data: NOT verified
    pro_bono:      lawyer.n === 5 ? 1 : 0,    // last lawyer per city offers pro bono
    sliding_scale: lawyer.n >= 4 ? 1 : 0,
    free_consultation: 1,
    years_experience: 5 + (lawyer.bar % 20),
    specialties:   JSON.stringify((() => {
      const base = lawyer.specs || ['Criminal Defense'];
      const city = (lawyer.city||'').toLowerCase();
      const state = (lawyer.state||'');
      const bar = lawyer.bar || 0;
      // DUI specialist — high-traffic states
      if (base.includes('DUI') && bar % 3 === 0) return [...base, 'DUI Specialist'];
      // Sex crimes defense — criminal defense specialists
      if (base.includes('Criminal Defense') && bar % 17 === 1) return [...base, 'Sex Crimes Defense'];
      // Weapons charges — military + high-gun-crime cities
      if (['TX','FL','GA','TN','AL'].includes(state) && bar % 13 === 1) return [...base, 'Weapons Charges'];
      // Wrongful conviction — cities with innocence projects
      if (['NY','CA','IL','TX','OH'].includes(state) && bar % 23 === 1) return [...base, 'Wrongful Conviction'];
      // Cybercrime — tech hubs
      if (['CA','WA','TX','NY','MA'].includes(state) && bar % 29 === 1) return [...base, 'Cybercrime'];
      // Federal tax / white collar — financial centers
      if (['NY','IL','CA','TX'].includes(state) && bar % 31 === 1) return [...base, 'Federal Tax', 'White Collar'];
      return base;
    })()),
    languages:     JSON.stringify((() => {
      const langs = ['English'];
      const city = (lawyer.city||'').toLowerCase();
      const state = (lawyer.state||'');
      // Mandarin: CA, NY, WA tech/finance hubs
      if (['CA','NY','WA'].includes(state) && (city.includes('san francisco')||city.includes('los angeles')||city.includes('new york')||city.includes('seattle')||city.includes('boston')||city.includes('houston'))) {
        if (lawyer.bar % 7 === 0) langs.push('Mandarin');
      }
      // Korean: LA, NYC, Atlanta, Seattle, Chicago
      if (['CA','NY','GA','WA','IL'].includes(state) && lawyer.bar % 9 === 0) langs.push('Korean');
      // Tagalog: CA, WA, NV, HI
      if (['CA','WA','NV','HI'].includes(state) && lawyer.bar % 11 === 0) langs.push('Tagalog');
      // Arabic: MI (Dearborn), IL, TX, NY, CA
      if (['MI','IL','TX','NY','CA'].includes(state) && lawyer.bar % 13 === 0) langs.push('Arabic');
      // Spanish: TX, CA, FL, NY, IL, NM, AZ
      if (['TX','CA','FL','NY','IL','NM','AZ'].includes(state) && lawyer.bar % 3 === 0) langs.push('Spanish');
      // Vietnamese: TX, CA
      if (['TX','CA'].includes(state) && lawyer.bar % 17 === 0) langs.push('Vietnamese');
      // Portuguese: MA, NJ, CA
      if (['MA','NJ','CA'].includes(state) && lawyer.bar % 19 === 0) langs.push('Portuguese');
      return langs;
    })()),
    source:        'seed',
    availability:  'accepting',
    active:        1,
    jtb_verified:  0,
    golden_gavel:  0,
    gavel_level:   0,
    bio:           `Experienced criminal defense attorney serving ${entry.city} and surrounding areas. Specializing in ${(lawyer.specs||['Criminal Defense'])[0]} cases.`,
  };
}

function buildBailAgent(entry, agent) {
  return {
    source_id:    `seed_${entry.city.replace(/[^a-z]/gi,'_').toLowerCase()}_bail_${agent.n}`,
    city:          entry.city,
    name:          agent.name,
    phone:         fmt(entry.area, 5800000 + (agent.n * 2222) + (agent.lic % 1000)),
    address:       `${agent.addr}, ${entry.city} ${entry.state}`,
    lat:           entry.lat - (agent.n * 0.006),
    lng:           entry.lng - (agent.n * 0.005),
    website:       `https://${agent.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,25)}.com`,
    email:         `info@${agent.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,20)}.com`,
    license_number: bail(entry.state, agent.lic),
    bond_rate:     agent.rate,
    payment_plans: 1,
    hours:         agent.hours,
    verified:      0,                          // ← seed data: NOT verified
    active:        1,
    source:        'seed',
    bio:           `Licensed bail bondsman serving ${entry.city}. ${agent.hours} availability. Payment plans available.`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const targetCity = argv.city?.toLowerCase();

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA journal_mode=WAL');
  await db.run('PRAGMA foreign_keys=ON');

  if (argv.reset) {
    console.log('🗑  Removing existing seed records…');
    await db.run("DELETE FROM lawyers     WHERE source='seed'");
    await db.run("DELETE FROM bail_agents WHERE source='seed'");
    console.log('   Done.\n');
  }

  if (argv['dry-run']) {
    console.log('🔍 DRY RUN — no writes\n');
  }

  let totalLaw = 0, totalBail = 0, skipped = 0;

  for (const entry of SEED) {
    if (targetCity && !entry.city.toLowerCase().includes(targetCity)) continue;

    console.log(`📍 ${entry.city}`);

    // Lawyers
    for (const l of entry.lawyers) {
      const lawyer = buildLawyer(entry, l);
      if (argv['dry-run']) {
        console.log(`   [DRY] 👔 ${lawyer.name}`);
        totalLaw++;
        continue;
      }
      try {
        const existing = await db.get(
          "SELECT id FROM lawyers WHERE source_id=?", [lawyer.source_id]
        );
        if (existing) {
          await db.run(
            `UPDATE lawyers SET name=?,phone=?,address=?,lat=?,lng=?,rating=?,
             reviews=?,bar_number=?,specialties=?,hours=?,website=?,email=?,
             bio=?,updated_at=datetime('now') WHERE source_id=?`,
            [lawyer.name, lawyer.phone, lawyer.address, lawyer.lat, lawyer.lng,
             lawyer.rating, lawyer.reviews, lawyer.bar_number,
             lawyer.specialties, lawyer.hours, lawyer.website, lawyer.email,
             lawyer.bio, lawyer.source_id]
          );
          skipped++;
        } else {
          await db.run(
            `INSERT INTO lawyers
             (source_id,city,name,phone,address,lat,lng,website,email,hours,
              rating,reviews,bar_number,verified,pro_bono,sliding_scale,
              free_consultation,years_experience,specialties,languages,
              source,availability,active,jtb_verified,golden_gavel,
              gavel_level,bio,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                     datetime('now'),datetime('now'))`,
            [lawyer.source_id, lawyer.city, lawyer.name, lawyer.phone,
             lawyer.address, lawyer.lat, lawyer.lng, lawyer.website,
             lawyer.email, lawyer.hours, lawyer.rating, lawyer.reviews,
             lawyer.bar_number, lawyer.verified, lawyer.pro_bono,
             lawyer.sliding_scale, lawyer.free_consultation,
             lawyer.years_experience, lawyer.specialties, lawyer.languages,
             lawyer.source, lawyer.availability, lawyer.active,
             lawyer.jtb_verified, lawyer.golden_gavel, lawyer.gavel_level,
             lawyer.bio]
          );
          totalLaw++;
          console.log(`   ✓ 👔 ${lawyer.name}`);
        }
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) console.warn(`   ✗ ${lawyer.name}: ${e.message}`);
        else skipped++;
      }
    }

    // Bail agents
    for (const b of entry.bail) {
      const agent = buildBailAgent(entry, b);
      if (argv['dry-run']) {
        console.log(`   [DRY] 🔒 ${agent.name}`);
        totalBail++;
        continue;
      }
      try {
        const existing = await db.get(
          "SELECT id FROM bail_agents WHERE source_id=?", [agent.source_id]
        );
        if (existing) {
          await db.run(
            `UPDATE bail_agents SET name=?,phone=?,address=?,lat=?,lng=?,
             hours=?,website=?,email=?,bio=?,updated_at=datetime('now')
             WHERE source_id=?`,
            [agent.name, agent.phone, agent.address, agent.lat, agent.lng,
             agent.hours, agent.website, agent.email, agent.bio, agent.source_id]
          );
          skipped++;
        } else {
          await db.run(
            `INSERT INTO bail_agents
             (source_id,city,name,phone,address,lat,lng,website,email,
              license_number,bond_rate,payment_plans,hours,verified,
              active,source,bio,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
            [agent.source_id, agent.city, agent.name, agent.phone,
             agent.address, agent.lat, agent.lng, agent.website, agent.email,
             agent.license_number, agent.bond_rate, agent.payment_plans,
             agent.hours, agent.verified, agent.active, agent.source, agent.bio]
          );
          totalBail++;
          console.log(`   ✓ 🔒 ${agent.name}`);
        }
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) console.warn(`   ✗ ${agent.name}: ${e.message}`);
        else skipped++;
      }
    }
  }

  const lCount = await db.get("SELECT COUNT(*) as n FROM lawyers WHERE active=1");
  const bCount = await db.get("SELECT COUNT(*) as n FROM bail_agents WHERE active=1");

  console.log(`
${'='.repeat(55)}
✅ Seed complete
   Lawyers inserted:     ${totalLaw}
   Bail agents inserted: ${totalBail}
   Already existed:      ${skipped}
${'─'.repeat(55)}
   DB totals:  ${lCount.n} active lawyers
               ${bCount.n} active bail agents
${'─'.repeat(55)}
NOTE: source='seed' | verified=0
These are framework records. Run the production scrapers
to replace them with real verified attorneys:
  node src/scripts/scrape_state_bars.js --state all
  node src/scripts/scrape_providers_national.js
${'='.repeat(55)}`);

  await 
// ── 30 lesson articles (Know Your Rights) ───────────────────────────────────
const LESSONS = [
  // Arrest & Rights (articles 1-8)
  { category:'arrest', title:'What to do in the first 24 hours after arrest', slug:'first-24-hours', content:'The first 24 hours are the most critical. Immediately: (1) Say nothing except "I want a lawyer." Even innocent statements can be twisted. (2) Do not consent to searches of your phone, car, or home. (3) Memorize or write down what happened before you forget. (4) Call an attorney or ask for a public defender — do this before any lineup, polygraph, or interrogation. Officers are allowed to lie to you about evidence. Anything you say WILL be used against you.', read_time:5 },
  { category:'arrest', title:'How to survive a jail booking process', slug:'jail-booking', content:'Booking takes 2-8 hours. During booking: you will be photographed, fingerprinted, and have your property inventoried. You have the right to make a phone call — use it to contact an attorney or family member who can hire one. Do not discuss your charges with other detainees or on recorded jail phone lines. Everything said in jail is recorded. Request medical attention in writing if you have health conditions. Ask about your bail amount immediately.', read_time:4 },
  { category:'arrest', title:'Miranda rights — what they actually mean', slug:'miranda-rights', content:'Miranda rights apply when two conditions are met: you are in custody AND officers intend to question you. If you are not being questioned, Miranda doesn't require anything. The critical rule: once you say "I want a lawyer," ALL questioning must stop immediately. If it doesn't, those statements may be suppressed. You cannot be punished for invoking Miranda. "I invoke my right to remain silent" is all you need to say — then say nothing else.', read_time:5 },
  { category:'arrest', title:'The right to a public defender — what it covers', slug:'public-defender-rights', content:'If you cannot afford an attorney, the Sixth Amendment guarantees one for any charge that could result in imprisonment. Request one at your arraignment. Public defenders are licensed attorneys — many are highly experienced. Limitations: high caseloads mean less time per case. Maximize your public defender: be responsive, provide all documents they request, be honest about your history, and prepare a written summary of events. You can request a different PD if there is a conflict.', read_time:5 },
  { category:'arrest', title:'Searches and seizures — when police can and cannot search', slug:'search-seizure', content:'Fourth Amendment protections: Police need a warrant to search your home. Exceptions: consent (never give it), hot pursuit, plain view, incident to arrest, exigent circumstances. Traffic stops: officer can order you out of the car; cannot search without consent or probable cause. Cell phones: Riley v. California (2014) — warrant required. Always say: "I do not consent to searches." This preserves your rights even if the search happens anyway.', read_time:6 },
  { category:'arrest', title:'How to find out if you have an outstanding warrant', slug:'warrant-check', content:'Check your county court's online case search (most counties have this free). Call the court clerk — they can confirm active warrants by name. Do NOT call the police directly if you suspect a warrant — they may arrest you immediately. If you find a warrant: contact an attorney before turning yourself in. An attorney can often arrange a surrender with favorable conditions (weekday morning, specific facility) and may be able to have the warrant quashed before arrest.', read_time:4 },
  { category:'arrest', title:'Resisting arrest — what it means and the consequences', slug:'resisting-arrest', content:'Resisting arrest is a separate criminal charge regardless of whether the underlying arrest was lawful. In most states it is a misdemeanor; if force is used against an officer it becomes a felony. The correct response to an unlawful arrest: verbally state "I do not consent to this arrest" and comply physically. Your remedy for an unlawful arrest is the courtroom, not the street. Passive non-compliance (going limp) is treated differently than active resistance — consult your attorney about your specific situation.', read_time:4 },
  { category:'arrest', title:'What happens at arraignment', slug:'arraignment', content:'Arraignment is your first court appearance, usually within 48-72 hours of arrest. What happens: (1) Formal charges are read. (2) You enter a plea — almost always "not guilty" at arraignment even if you plan to take a deal later. (3) Bail is set or continued. (4) Next court date is scheduled. Bring an attorney or request a public defender before arraignment. Do not plead guilty at arraignment without attorney advice — you waive constitutional rights you cannot get back.', read_time:4 },

  // DUI (articles 9-13)
  { category:'dui', title:'The 15-minute rule and DUI breath tests', slug:'dui-breath-test', content:'Before administering a breathalyzer, officers must observe you for 15 continuous minutes to ensure you haven't eaten, drunk, smoked, belched, or vomited — all of which can affect readings. If the 15-minute observation was not done properly, the test result may be suppressible. Request the observation log through your attorney. Field sobriety tests (walk-and-turn, one-leg-stand, HGN eye test) are NOT mandatory in most states — politely decline them. Only the chemical test (breath/blood) carries implied consent consequences.', read_time:5 },
  { category:'dui', title:'DUI blood tests — your rights and how to challenge them', slug:'dui-blood-test', content:'You have the right to an independent blood test at your own expense. Request this immediately and in writing. Blood test challenges include: chain of custody errors, improper storage, fermentation of sample, lab technician qualifications. Get the lab's ASCLD accreditation status and the specific technician's records through discovery. Blood alcohol rises after driving stops — a sample taken 2 hours post-arrest may be higher than your BAC while driving. This "retrograde extrapolation" is a valid defense.', read_time:5 },
  { category:'dui', title:'DUI and your driver's license — the DMV hearing', slug:'dui-dmv-hearing', content:'After a DUI arrest, you have two separate cases: criminal court AND a DMV administrative hearing. The DMV hearing is about your license only — you must request it within 7-10 days of arrest (varies by state) or you automatically lose your license. The DMV hearing is independent of the criminal case — you can win one and lose the other. An attorney can use DMV hearing testimony to gather information useful in the criminal case. Never skip this deadline.', read_time:5 },
  { category:'dui', title:'DUI diversion and first-offender programs', slug:'dui-diversion', content:'Many states offer first-offender DUI diversion programs: complete treatment, pay fines, serve probation → charges dismissed or reduced. California's Wet Reckless plea, Arizona's diversion program, Florida's DUI school. Requirements typically: no prior DUI, BAC under a threshold (varies), no accident or injury. Successful completion often allows expungement. Ask your attorney about diversion at the earliest hearing — not all prosecutors offer it voluntarily.', read_time:4 },
  { category:'dui', title:'DUI and professional licenses — what is at risk', slug:'dui-professional-license', content:'A DUI conviction can trigger professional licensing board review for: doctors, nurses, lawyers, teachers, pharmacists, CDL drivers, pilots, and real estate agents. Each licensing board has different rules. Some require self-reporting within 30 days of conviction — failure to report is often treated more seriously than the DUI itself. Check your licensing board's rules immediately. An attorney experienced in both criminal defense and professional licensing is ideal for these cases.', read_time:5 },

  // Expungement (articles 14-17)
  { category:'expungement', title:'Expungement vs. sealing vs. set aside — what's the difference', slug:'expungement-vs-sealing', content:'Expungement: record is destroyed or erased — as if the arrest or conviction never happened. Sealing: record still exists but is hidden from most public searches — law enforcement can still see it. Set aside/dismissal: conviction is dismissed after probation — still shows on record but shows "dismissed." Eligibility, waiting periods, and effects vary dramatically by state. California, Michigan, and Washington have some of the most generous expungement laws. Virginia and New Jersey have very limited options. Use the Expungement tool to check your state's exact rules.', read_time:5 },
  { category:'expungement', title:'How to file for expungement without an attorney', slug:'expungement-pro-se', content:'In most states you can file for expungement yourself (pro se). Steps: (1) Obtain your criminal history from state police (usually $15-25). (2) Download the expungement petition form from your county court's website. (3) Complete the form — include case numbers, conviction dates, sentences completed. (4) File with the court clerk — filing fee usually $50-150. (5) Serve the prosecutor's office. (6) Attend the hearing if required. The process takes 3-6 months. Errors in the petition can cause rejection — an attorney review of the completed form is valuable even if they don't file for you.', read_time:6 },
  { category:'expungement', title:'What expungement does NOT erase', slug:'expungement-limits', content:'Even after expungement, your record may still appear in: (1) FBI background checks for federal employment, (2) Military enlistment reviews, (3) Immigration proceedings — a huge caveat for non-citizens, (4) Some professional licensing boards, (5) Certain sex offender registry requirements, (6) Gun purchase background checks for violent offenses in some states. Also: private background check companies (like Checkr, Sterling) may have data they haven't updated. You can dispute this under the FCRA. Expungement is powerful but not absolute.', read_time:5 },
  { category:'expungement', title:'Marijuana convictions — automatic expungement in your state', slug:'marijuana-expungement', content:'Over 20 states now have automatic or simplified expungement for marijuana convictions after legalization. California automatically reviews and resentences prior cannabis convictions under Prop 64. Illinois automatically expunges marijuana arrests. New York, Virginia, and New Jersey have similar provisions. You do NOT need to file — it happens automatically. Check your state's cannabis authority website for status. If your state does it automatically, you should still verify your record was updated 6-12 months after the law took effect.', read_time:4 },

  // Immigration (articles 18-21)
  { category:'immigration', title:'Immigration consequences of criminal charges — what every defendant must know', slug:'immigration-criminal', content:'If you are not a US citizen, ANY criminal matter — arrest, charge, plea, or conviction — can affect your immigration status. Even a misdemeanor can trigger deportation, bar naturalization, or prevent re-entry. Under Padilla v. Kentucky (2010), your criminal attorney MUST advise you of immigration consequences. If they don't, that is ineffective assistance of counsel. Before ANY plea, ask your attorney: "What are the immigration consequences of this plea?" Certain charges (aggravated felonies, crimes of moral turpitude) are deportation triggers regardless of sentence length.', read_time:6 },
  { category:'immigration', title:'Sanctuary cities — what protection they actually provide', slug:'sanctuary-cities', content:'Sanctuary policies limit local law enforcement cooperation with ICE — they don't make cities "off limits" to federal immigration enforcement. What sanctuary policies typically do: local police won't honor ICE detainers (requests to hold people for immigration), won't share information about immigration status, won't arrest people solely for immigration violations. What they don't do: prevent ICE from operating in the city, prevent immigration arrests by federal agents, protect people in federal facilities. Know your city's specific policy — they vary significantly.', read_time:5 },
  { category:'immigration', title:'ICE detention — your rights and what to do', slug:'ice-detention-rights', content:'If detained by ICE: (1) You have the right to remain silent. (2) Do not sign any documents without an attorney — signing a "voluntary departure" waives your appeal rights. (3) You have the right to contact your country's consulate. (4) You have the right to a deportation hearing before an immigration judge — do not waive this. (5) Ask for a bond hearing immediately. (6) You have the right to contact an attorney — ICE must give you a list of free legal services. Memorize this number: 1-844-363-1423 (RAICES hotline).', read_time:5 },
  { category:'immigration', title:'DACA and criminal charges — what happens to your status', slug:'daca-criminal', content:'A DACA recipient can lose status for: any felony conviction, three or more misdemeanors, one "significant misdemeanor" (DV, sexual abuse, burglary, unlawful possession of firearm, DUI, drug distribution, or any offense with 90+ day sentence). An arrest alone does not terminate DACA — a conviction does. If you have DACA and face criminal charges: get an attorney who understands both criminal and immigration law immediately. The stakes are permanent — deportation, bar from legal status, separation from family.', read_time:5 },

  // Juvenile Justice (articles 22-25)
  { category:'juvenile', title:'Juvenile vs. adult court — how cases get transferred', slug:'juvenile-transfer', content:'Juvenile court is designed for rehabilitation, not punishment. Cases can be transferred to adult court through: (1) Judicial waiver — judge decides after a hearing, (2) Prosecutorial discretion — DA directly files in adult court (varies by state), (3) Statutory exclusion — certain serious offenses are automatically adult court (murder, rape in most states). Transferred juveniles face adult sentences and adult criminal records. If your child faces transfer, get an attorney immediately — the transfer hearing may be your best opportunity to keep the case in juvenile court.', read_time:5 },
  { category:'juvenile', title:'Juvenile records — sealing and confidentiality', slug:'juvenile-records', content:'Juvenile records are generally confidential — not available to the public. But: employers may ask about adjudications that would be felonies if committed as an adult. Military service branches can access juvenile records. Some states allow prosecutors to disclose juvenile records in adult proceedings. Sealing: most states automatically seal juvenile records at age 18 or 21. Some require a petition. Once sealed: you can legally say you were not convicted of a crime on most applications. Exceptions: sex offender registry requirements, which can follow juveniles into adulthood.', read_time:5 },
  { category:'juvenile', title:'Zero tolerance policies at school and your child's rights', slug:'school-zero-tolerance', content:'School zero tolerance policies (weapons, drugs, fighting) can lead to suspension, expulsion, and criminal charges for behavior that would have previously been handled administratively. Your child's rights in school discipline: (1) Due process before suspension over 10 days, (2) Right to appeal expulsion, (3) IEP students have additional protections under IDEA, (4) Right to be represented by a parent or advocate at disciplinary hearings. Never let your child give a statement to school officials about a potential crime without first consulting an attorney — school officials are not bound by Miranda.', read_time:5 },
  { category:'juvenile', title:'When juveniles are tried as adults — state-by-state rules', slug:'juvenile-adult-age', content:'The age of criminal responsibility varies: most states use 18 as the juvenile/adult cutoff, but 3 states (Georgia, Michigan, Texas) use 17, and some use 16. "Raise the Age" laws have moved many states toward 18 in recent years. For serious crimes, any juvenile can face adult prosecution through transfer. If convicted as an adult: the juvenile has an adult criminal record with all its lifelong consequences. Research shows juvenile brain development is incomplete until 25 — courts are increasingly recognizing this in sentencing.', read_time:4 },

  // Housing & Civil (articles 26-30)
  { category:'housing', title:'Tenant rights when you have a criminal record', slug:'tenant-criminal-record', content:'HUD guidance limits landlords from blanket bans on renting to people with criminal records — it may violate the Fair Housing Act as disparate impact discrimination. Landlords must consider: nature of conviction, how long ago, evidence of rehabilitation. Arrests (not convictions) cannot be used as basis for denial in many jurisdictions. Some cities (Seattle, San Francisco, Portland) have "Fair Chance Housing" ordinances restricting criminal history inquiries until after a conditional offer. Know your city's laws — they are often stronger than federal guidelines.', read_time:5 },
  { category:'housing', title:'Eviction defense — your rights as a tenant', slug:'eviction-defense', content:'Eviction requires a court order — a landlord cannot legally change locks, remove belongings, or shut off utilities without going through court. Defenses to eviction: (1) Improper notice — most states require 3-30 days written notice, (2) Landlord's failure to maintain habitable conditions (warranty of habitability), (3) Retaliation for complaining to inspectors, (4) Discrimination. Even if you owe rent: you have the right to appear in court, present defenses, and negotiate payment plans. An eviction on your record makes future housing harder — fight it in court even if the situation seems hopeless.', read_time:5 },
  { category:'housing', title:'Asset forfeiture — can police take your property?', slug:'civil-forfeiture', content:'Civil asset forfeiture allows law enforcement to seize property suspected of being connected to crime — without charging the owner with a crime. You must sue to get your property back — the burden of proof is on you in most states. Federal equitable sharing lets local police partner with federal agencies to seize property under federal law (which requires less proof). States with strong protections: New Mexico, North Carolina, Nebraska (require criminal conviction before forfeiture). If your property is seized: file a claim immediately — deadlines are often 30-45 days and missing them means automatic forfeiture.', read_time:6 },
  { category:'housing', title:'Protective orders — how to get one and what they do', slug:'protective-orders', content:'A protective order (restraining order) prohibits contact between parties. Types: Emergency Protective Order (EPO) — issued by police at scene, lasts 5-7 days. Temporary Restraining Order (TRO) — issued by court ex parte (without the other party), lasts 20-25 days. Permanent Protective Order — issued after hearing, lasts 1-5 years. To get a TRO: file at your county courthouse, describe the abuse or threats, get a hearing date (usually same day). Violation of a protective order is a criminal offense. For DV situations: contact the National DV Hotline: 1-800-799-7233.', read_time:5 },
  { category:'housing', title:'Record clearing after drug convictions — housing and employment', slug:'record-clearing-reentry', content:'A criminal record affects housing, employment, and benefits. Federal public housing: drug-related evictions trigger ineligibility but HUD has "one-strike" policy flexibility. SNAP/food stamps: drug felony bans lifted in most states. Student loans: drug convictions no longer trigger automatic federal aid suspension (restored by FAFSA Simplification Act 2021). Employment: "Ban the Box" laws in 37 states delay criminal history questions until later in hiring process. The combination of expungement + Ban the Box + Fair Chance Housing gives people the best path to stable reentry.', read_time:5 },

  // State-specific Rights (articles 31-36)
  { category:'rights', title:'Your rights during a traffic stop in California', slug:'ca-traffic-stop-rights', read_time:4, content:'California law gives you specific rights during traffic stops. You must provide your license, registration, and insurance, but you do not have to answer questions beyond identifying yourself. You can refuse a search of your vehicle — say clearly: "I do not consent to a search." CHP officers cannot detain you beyond the time needed to complete the stop unless they have reasonable suspicion of a crime. If you are a passenger, you can ask if you are free to go.' },
  { category:'rights', title:'Your rights during a traffic stop in Texas', slug:'tx-traffic-stop-rights', read_time:4, content:'Texas law requires you to provide your license, registration, and proof of insurance. You are not required to answer questions about where you are going or what you have been doing. You can refuse a vehicle search — Texas courts have upheld this right. Under Texas Transportation Code § 545.421, you cannot be arrested solely for a traffic violation if the officer issues a citation. Say: "I do not consent to this search" and "Am I free to go?"' },
  { category:'rights', title:'Your rights during a traffic stop in Florida', slug:'fl-traffic-stop-rights', read_time:4, content:'Florida is a stop-and-identify state but only requires you to identify yourself if you are lawfully stopped. You must provide your license and registration. You can refuse searches — Florida v. Bostick established that consent must be voluntary. If police smell marijuana, they now have a more difficult burden since Amendment 3 (2024) legalized adult use. Record the stop if you can do so safely — Florida is a two-party consent state for audio recordings, but recording video in public is protected.' },
  { category:'rights', title:'Your rights during a traffic stop in New York', slug:'ny-traffic-stop-rights', read_time:4, content:'New York requires you to provide your license, registration, and insurance. You are not required to answer questions beyond that. New York has some of the strongest protections against vehicle searches — CPL § 140.50 limits Terry stops. The NYPD has specific stop-and-frisk restrictions under the Floyd v. City of New York consent decree. If stopped in NYC, ask for the officer's badge number and name — they are required to provide it.' },
  { category:'rights', title:'Veterans' courts — what they are and how to get in', slug:'veterans-courts', read_time:6, content:'Veterans Treatment Courts (VTCs) are specialized dockets that handle criminal cases involving military veterans. They exist in over 600 jurisdictions nationwide. Eligibility typically requires: honorable or general discharge (some courts accept OTH), a diagnosed mental health condition or substance use disorder connected to military service, and a non-violent charge (some courts accept certain violent charges). The program combines treatment, mentorship by veteran mentors, and court supervision. Successful completion results in reduced charges or dismissal. Find your local VTC at justiceforvets.org or through your state court administrator.' },
  { category:'rights', title:'Mental health holds — 5150, Baker Act, and what happens next', slug:'mental-health-holds', read_time:5, content:'Mental health holds go by different names in different states: 5150 in California (WIC § 5150), Baker Act in Florida (394.463), TDO in Virginia, 302 in Pennsylvania. All allow involuntary psychiatric detention for up to 72 hours when a person is a danger to themselves or others, or is gravely disabled. You retain rights during a hold: you can refuse medication in most states absent a court order, you have the right to be told why you are being held, and you can request a patient advocate. A criminal charge does not automatically result in a hold — they are civil proceedings.' },
  // Bail and Court Process (articles 37-40)
  { category:'bail', title:'Bail hearings — what to say, what to wear, what matters', slug:'bail-hearing-strategy', read_time:5, content:'Your bail hearing happens within 24-72 hours of arrest. The judge weighs: (1) flight risk — ties to the community, employment, family, how long you have lived locally; (2) danger to the community — nature of the charge, prior record. Wear clean, conservative clothing if possible — first impressions matter. Your attorney should argue: stable employment, family ties, no prior failures to appear, willingness to surrender passport, agree to electronic monitoring. If bail is set too high, your attorney can request a bail reduction hearing. A 10% bondsman fee is not refundable even if charges are dropped.' },
  { category:'bail', title:'How to read a bail schedule', slug:'how-to-read-bail-schedule', read_time:4, content:'A bail schedule is a pre-set amount for common offenses that allows defendants to post bail before seeing a judge. The schedule lists charges by statute code, with a minimum and maximum amount. The actual amount set by a judge may differ. Bail schedule amounts are starting points — judges routinely deviate up or down based on prior record, flight risk, and community ties. In states with bail reform (New Jersey, Illinois, New York), cash bail has been significantly reduced or eliminated for many offenses. Understanding the schedule helps you know approximately what to expect.' },
  { category:'court', title:'How to read a charging document', slug:'how-to-read-charging-document', read_time:5, content:'A charging document — called an indictment (felony by grand jury), information (felony by prosecutor), or complaint (misdemeanor) — is the formal accusation against you. It lists: the charges by name and statute number, the alleged date and location of the offense, and the elements the prosecution must prove. Critical items to check: whether the statute of limitations has run, whether the facts alleged actually match the elements of the crime, any co-defendants named, and the maximum sentence exposure. Every element listed must be proven beyond a reasonable doubt.' },
  { category:'court', title:'Victim impact statements — what they are and your rights', slug:'victim-impact-statements', read_time:4, content:'A victim impact statement (VIS) is a written or oral statement presented at sentencing describing how the crime affected the victim physically, emotionally, and financially. Under the Crime Victims Rights Act (18 U.S.C. § 3771), victims have the right to present a VIS in federal cases. All 50 states have similar protections. As a defendant, your attorney has the right to review the VIS before sentencing and may respond to it. The VIS cannot introduce new facts — it addresses impact only. The judge considers the VIS as one factor in sentencing alongside the guidelines, your prior record, and mitigating circumstances.' },
  // Diversion and Alternatives (articles 41-44)
  { category:'court', title:'Diversion programs — how to qualify and what to expect', slug:'diversion-programs', read_time:6, content:'Diversion programs allow defendants to avoid conviction by completing treatment, community service, or supervision. Common types: Deferred Prosecution (charges dismissed after compliance), Deferred Adjudication (plea entered but conviction withheld), Pretrial Diversion (no plea required), and Drug Court (intensive supervision program). Eligibility typically requires: first-time offense or limited prior record, non-violent charge, willingness to admit facts (not always a guilty plea). Successful completion results in case dismissal. The record of the arrest may still appear — expungement is a separate step. Ask your attorney about diversion before entering any plea.' },
  { category:'expungement', title:'Record sealing vs. expungement — exact differences by state', slug:'sealing-vs-expungement-states', read_time:6, content:'Expungement destroys or erases the record — in theory it never existed. Record sealing hides the record from public view but it still exists and can be seen by law enforcement, courts, and some government agencies. The practical difference: a sealed record may still appear on FBI background checks; an expunged record typically does not. California (Penal Code § 1203.4) offers expungement but the record still shows on certain background checks. New York's Clean Slate Act (2024) automatically seals most convictions after 3-8 years. Texas offers Orders of Nondisclosure (sealing) but not full expungement for convictions. Always confirm what each process actually erases in your specific state.' },
  { category:'expungement', title:'Sex offender registry — can you ever get off it?', slug:'sex-offender-registry-removal', read_time:5, content:'Sex offender registration requirements are set by both federal law (SORNA, 34 U.S.C. § 20901) and state law. Registration periods: Tier I (15 years), Tier II (25 years), Tier III (lifetime). Petition for removal: some states allow a petition after a clean period — typically 10-25 years. Federal law sets minimums but states can be more restrictive. Juvenile offenders have additional removal pathways under SORNA. The process requires a court petition, risk assessment, and hearing. Success rates vary widely by state and judge. An attorney who specializes in SORNA compliance is essential for this process.' },
  { category:'civil', title:'Asset forfeiture after criminal charges — fighting back', slug:'asset-forfeiture-defense', read_time:5, content:'Civil asset forfeiture allows police to seize property suspected of being connected to crime — even without a conviction, or sometimes without charges at all. Federal law and most states allow this. Fighting back: (1) File a claim within the deadline (often 30-60 days — missing it forfeits your right to contest). (2) The government must prove the property is connected to crime by a preponderance of the evidence in most states, clear and convincing in a few. (3) Innocent owner defense: prove you did not know about the illegal use. (4) The Institute for Justice (ij.org) provides free resources and sometimes litigates forfeiture cases. Some states (New Mexico, North Carolina) require a criminal conviction before forfeiture.' },
  // Housing and Employment (articles 45-47)
  { category:'civil', title:'Criminal records and housing — tenant rights and what landlords can ask', slug:'criminal-records-housing', read_time:5, content:'Federal Fair Housing Act (42 U.S.C. § 3604) prohibits blanket bans on renting to people with criminal records if they have a disparate racial impact (HUD guidance 2016). Many cities have Ban the Box ordinances for housing. What landlords can legally consider: conviction type, how long ago, evidence of rehabilitation. What they cannot do: reject solely for an arrest without conviction, apply different standards to different races. Some states have specific protections: California (AB 2597), Connecticut (CGS § 46a-80), Colorado (SB 173). Section 8 voucher holders: PHAs can only deny for certain serious crimes — check your local PHA policy.' },
  { category:'civil', title:'Employment rights with a criminal record — Ban the Box and beyond', slug:'employment-criminal-record', read_time:5, content:'Ban the Box laws prevent employers from asking about criminal history on initial applications. Federal contractors are covered by Executive Order 13932 (2020). States with Ban the Box for private employers: California, Colorado, Connecticut, Hawaii, Illinois, Maryland, Massachusetts, Minnesota, New Jersey, New Mexico, New York, Oregon, Rhode Island, Vermont, Washington. EEOC guidance requires individualized assessment of criminal history — blanket disqualifications may be discriminatory. Professional licenses: many states have Reformed Occupational Licensing laws (NOLO laws) that require boards to consider rehabilitation. The Clean Slate Initiative tracks state-by-state reforms.' },
  { category:'civil', title:'Civil liability after criminal charges — can you be sued too?', slug:'civil-liability-after-criminal', read_time:4, content:'A criminal acquittal does not prevent a civil lawsuit. The O.J. Simpson case is the most famous example — acquitted criminally, found liable civilly. Why: different standards of proof (beyond reasonable doubt criminal vs. preponderance civil), different parties (state criminal vs. victim civil). Common civil claims following criminal charges: personal injury, wrongful death, property damage, intentional infliction of emotional distress. Fifth Amendment protection applies in civil proceedings too — you can refuse to testify. If a civil suit is filed while criminal charges are pending, your attorney should coordinate both defenses carefully. Settlements in civil cases do not affect criminal proceedings.' },
  // Additional Topics (articles 48-50)
  { category:'rights', title:'Recording police — your rights in all 50 states', slug:'recording-police-rights', read_time:5, content:'The First Amendment protects the right to record police performing their duties in public. Federal circuit courts are unanimous on this. State wiretapping laws vary: one-party consent states (most states) allow you to record if you are a participant. Two-party/all-party consent states (California, Florida, Illinois, Massachusetts, Maryland, Pennsylvania, Washington) require all parties to consent to audio recording — but courts have generally held that openly recording police who know they are being recorded satisfies consent. What to do: hold the phone openly, state you are recording, do not interfere with police activity, back up footage immediately to the cloud.' },
  { category:'bail', title:'What happens if you cannot afford bail', slug:'cannot-afford-bail', read_time:5, content:'If you cannot afford bail, you have several options: (1) Bail bondsman — pay 10% (non-refundable) and they guarantee the full amount. (2) Property bond — use real estate equity as collateral. (3) Release on Recognizance (ROR) — judge releases you on your promise to appear; ask your attorney to request this. (4) Bail reduction hearing — attorney argues for lower bail based on financial inability. (5) Pretrial Services — many jurisdictions have supervision programs as an alternative to cash bail. (6) Bail funds — nonprofit organizations in many cities post bail for qualifying defendants. The Bail Project (bailproject.org) operates in multiple cities and posts bail at no cost.' },
  { category:'court', title:'Probation and parole — the exact differences and your obligations', slug:'probation-vs-parole', read_time:5, content:'Probation is a sentence served in the community instead of prison. Parole is early release from prison under supervision. Both involve: regular check-ins with an officer, travel restrictions, no new criminal charges, often no alcohol or drug use, sometimes electronic monitoring. Violations can result in revocation — return to jail/prison. Key rights: you can refuse searches of your person and home in some states (varies by conditions); you have the right to a revocation hearing before being sent back; you have the right to an attorney at that hearing. Successful completion: expungement may be available after probation completion in many states.' },

  // State Rights (31-36)
  { category:'rights', title:'Your rights during a traffic stop in California', slug:'ca-traffic-stop', read_time:4, content:'You must provide license, registration, and insurance. You are not required to answer questions beyond identifying yourself. Clearly say: "I do not consent to a search." You cannot be detained beyond the time to complete the stop without reasonable suspicion of a crime.' },
  { category:'rights', title:'Your rights during a traffic stop in Texas', slug:'tx-traffic-stop', read_time:4, content:'Texas requires license, registration, and proof of insurance. You are not required to answer questions about your destination. You can refuse a vehicle search. Under Texas Transportation Code 545.421, you cannot be arrested solely for a traffic violation if the officer issues a citation.' },
  { category:'rights', title:'Your rights during a traffic stop in Florida', slug:'fl-traffic-stop', read_time:4, content:'Florida is a stop-and-identify state but only requires identification if lawfully stopped. You can refuse searches. Amendment 3 (2024) legalized adult cannabis use, affecting probable cause arguments based on odor.' },
  { category:'rights', title:'Your rights during a traffic stop in New York', slug:'ny-traffic-stop', read_time:4, content:'New York requires license, registration, and insurance. New York has strong protections against vehicle searches. Ask for the officer badge number and name — NYPD officers are required to provide it under the Floyd consent decree.' },
  { category:'rights', title:'Veterans courts — what they are and how to qualify', slug:'veterans-courts', read_time:6, content:'Veterans Treatment Courts (VTCs) exist in over 600 jurisdictions. Eligibility: honorable or general discharge, diagnosed mental health or substance use disorder connected to service, typically non-violent charge. Successful completion results in reduced charges or dismissal. Find your local VTC at justiceforvets.org.' },
  { category:'rights', title:'Mental health holds — 5150, Baker Act, and what happens next', slug:'mental-health-holds', read_time:5, content:'Mental health holds go by different names by state: 5150 in California (WIC 5150), Baker Act in Florida (394.463), TDO in Virginia, 302 in Pennsylvania. All allow involuntary detention up to 72 hours. You retain rights: you can refuse medication absent a court order, and you have the right to be told why you are being held.' },
  // Bail and Court Process (37-40)
  { category:'bail', title:'Bail hearings — what to say, what to wear, what matters', slug:'bail-hearing-strategy', read_time:5, content:'Bail hearings happen within 24-72 hours. The judge weighs flight risk and danger to community. Wear clean conservative clothing. Your attorney should argue stable employment, family ties, no prior failures to appear, willingness to surrender passport, and electronic monitoring consent.' },
  { category:'bail', title:'How to read a bail schedule', slug:'how-to-read-bail-schedule', read_time:4, content:'A bail schedule lists pre-set amounts for common offenses. The schedule amount is a starting point — judges routinely deviate based on prior record and community ties. In bail reform states like New Jersey, Illinois, and New York, cash bail has been significantly reduced or eliminated for many offenses.' },
  { category:'court', title:'How to read a charging document', slug:'how-to-read-charging-document', read_time:5, content:'A charging document — indictment, information, or complaint — lists the charges by name and statute, the alleged date and location, and the elements the prosecution must prove. Check: whether the statute of limitations has run, whether the facts actually match the elements, and your maximum sentence exposure.' },
  { category:'court', title:'Victim impact statements — what they are and your rights', slug:'victim-impact-statements', read_time:4, content:'A victim impact statement is presented at sentencing. Under the Crime Victims Rights Act (18 USC 3771), victims have the right to present one. Your attorney has the right to review it before sentencing and respond. The VIS cannot introduce new facts — it addresses impact only.' },
  // Diversion (41-44)
  { category:'court', title:'Diversion programs — how to qualify and what to expect', slug:'diversion-programs', read_time:6, content:'Diversion programs allow defendants to avoid conviction by completing treatment or supervision. Types: Deferred Prosecution (charges dismissed after compliance), Pretrial Diversion (no plea required), Drug Court (intensive supervision). Successful completion results in case dismissal. Expungement is a separate step.' },
  { category:'expungement', title:'Record sealing vs. expungement — exact differences by state', slug:'sealing-vs-expungement-states', read_time:6, content:'Expungement destroys the record. Sealing hides it from public view but it still exists for law enforcement. California PC 1203.4 offers expungement but the record still appears on some background checks. New York Clean Slate Act (2024) automatically seals most convictions after 3-8 years. Texas offers nondisclosure orders but not full expungement for convictions.' },
  { category:'expungement', title:'Sex offender registry — can you ever get off it?', slug:'sex-offender-registry-removal', read_time:5, content:'SORNA registration periods: Tier I (15 years), Tier II (25 years), Tier III (lifetime). Some states allow petition for removal after 10-25 clean years. Federal law sets minimums but states can be more restrictive. Juvenile offenders have additional pathways under SORNA. An attorney specializing in SORNA is essential.' },
  { category:'civil', title:'Asset forfeiture after criminal charges — fighting back', slug:'asset-forfeiture-defense', read_time:5, content:'Civil asset forfeiture allows seizure of property without a conviction. File a claim within the deadline (often 30-60 days). The innocent owner defense: prove you did not know about the illegal use. New Mexico and North Carolina require a criminal conviction before forfeiture. The Institute for Justice provides free resources.' },
  // Housing and Employment (45-47)
  { category:'civil', title:'Criminal records and housing — what landlords can legally ask', slug:'criminal-records-housing', read_time:5, content:'HUD 2016 guidance prohibits blanket bans on renting to people with criminal records. Landlords cannot reject solely for an arrest without conviction. Many cities have Ban the Box ordinances for housing. Section 8 voucher holders: PHAs can only deny for certain serious crimes — check your local PHA policy.' },
  { category:'civil', title:'Employment rights with a criminal record — Ban the Box explained', slug:'employment-criminal-record', read_time:5, content:'Ban the Box laws prevent employers from asking about criminal history on initial applications. States with Ban the Box for private employers include California, Colorado, Illinois, Maryland, Massachusetts, Minnesota, New Jersey, New York, and Washington. EEOC guidance requires individualized assessment — blanket disqualifications may be discriminatory.' },
  { category:'civil', title:'Civil liability after criminal charges — can you be sued too?', slug:'civil-liability-after-criminal', read_time:4, content:'A criminal acquittal does not prevent a civil lawsuit. Different standards of proof apply: beyond reasonable doubt criminal vs. preponderance civil. You can still invoke the Fifth Amendment in civil proceedings. If a civil suit is filed while criminal charges are pending, coordinate both defenses carefully.' },
  // Additional Topics (48-50)
  { category:'rights', title:'Recording police — your rights in all 50 states', slug:'recording-police-rights', read_time:5, content:'The First Amendment protects recording police in public. One-party consent states allow you to record if you are a participant. All-party consent states (California, Florida, Illinois) require all parties to consent to audio — but openly recording police who know they are being recorded generally satisfies consent. Back up footage to cloud immediately.' },
  { category:'bail', title:'What to do if you cannot afford bail', slug:'cannot-afford-bail', read_time:5, content:'Options when you cannot afford bail: (1) Bondsman — pay 10% non-refundable, (2) Property bond using real estate equity, (3) Request Release on Recognizance (ROR), (4) Bail reduction hearing, (5) Pretrial Services supervision program, (6) Nonprofit bail funds — the Bail Project operates in multiple cities and posts bail at no cost.' },
  { category:'court', title:'Probation and parole — the exact differences and your obligations', slug:'probation-vs-parole', read_time:5, content:'Probation is a sentence served in the community. Parole is early release from prison under supervision. Both require regular check-ins, travel restrictions, no new charges. Violations can result in revocation. You have the right to a revocation hearing and an attorney at that hearing. Expungement may be available after successful probation completion.' },
];

const lessonStmt = db.prepare(`
  INSERT OR IGNORE INTO lessons (category, title, slug, content, read_time)
  VALUES (@category, @title, @slug, @content, @read_time)
`);
let lessonCount = 0;
const insertLessons = db.transaction(() => {
  for (const lesson of LESSONS) {
    lessonStmt.run(lesson);
    lessonCount++;
  }
});
try {
  insertLessons();
  console.log(`  ✓ Lessons: ${lessonCount} articles seeded`);
} catch(e) {
  console.log('  Lesson table may not exist yet:', e.message);
}


// ── Bail Schedules — 44 remaining states ────────────────────────────────────
// Adds to existing TN, CA, TX, FL, NY, IL, AL entries
const BAIL_SCHEDULES = [
  // Alabama
  { state:'AL', charge:'DUI - First Offense', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:7500, notes:'Varies by county; Jefferson Co uses $1000 base' },
  { state:'AL', charge:'Assault - Simple', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'AL', charge:'Drug Possession - Simple', charge_code:'DRUG-POSS', category:'Drug', bail_min:1500, bail_max:5000, notes:null },
  // Alaska
  { state:'AK', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:1500, bail_max:10000, notes:'High bail due to limited bondsmen in rural areas' },
  { state:'AK', charge:'Assault - Misdemeanor', charge_code:'ASSAULT-MISD', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'AK', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Arizona
  { state:'AZ', charge:'DUI - First Offense', charge_code:'DUI-1', category:'DUI', bail_min:1500, bail_max:7500, notes:'Maricopa Co schedule' },
  { state:'AZ', charge:'Assault - Simple', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:1500, bail_max:5000, notes:null },
  { state:'AZ', charge:'Drug Possession - Personal Use', charge_code:'DRUG-POSS', category:'Drug', bail_min:1500, bail_max:5000, notes:'Prop 207 reduced penalties' },
  // Arkansas
  { state:'AR', charge:'DUI/DWI', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:5000, notes:null },
  { state:'AR', charge:'Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'AR', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // Colorado
  { state:'CO', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:5000, notes:'Colorado uses presumptive bail schedules' },
  { state:'CO', charge:'Assault - Third Degree', charge_code:'ASSAULT-3', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'CO', charge:'Possession - Schedule I/II', charge_code:'DRUG-POSS-1', category:'Drug', bail_min:2000, bail_max:10000, notes:null },
  // Connecticut
  { state:'CT', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'Low bail typical; CT uses non-monetary conditions often' },
  { state:'CT', charge:'Assault - Third Degree', charge_code:'ASSAULT-3', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'CT', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Georgia
  { state:'GA', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:7500, notes:'Fulton Co schedule; other counties vary widely' },
  { state:'GA', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'GA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1500, bail_max:10000, notes:null },
  // Hawaii
  { state:'HI', charge:'DUI/OUI', charge_code:'DUI-1', category:'DUI', bail_min:250, bail_max:2500, notes:'Hawaii uses release on recognizance more than most states' },
  { state:'HI', charge:'Assault', charge_code:'ASSAULT-3', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'HI', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Indiana
  { state:'IN', charge:'DUI/OWI', charge_code:'DUI-1', category:'DUI', bail_min:750, bail_max:5000, notes:null },
  { state:'IN', charge:'Battery - Simple', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:'Indiana uses Battery, not Assault' },
  { state:'IN', charge:'Possession Schedule I/II', charge_code:'DRUG-POSS-1', category:'Drug', bail_min:1500, bail_max:7500, notes:null },
  // Iowa
  { state:'IA', charge:'OWI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'IA', charge:'Assault - Simple', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:3000, notes:null },
  { state:'IA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Kansas
  { state:'KS', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:2500, notes:null },
  { state:'KS', charge:'Battery', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'KS', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Kentucky
  { state:'KY', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:3000, notes:'Kentucky uses scheduled bail for most misdemeanors' },
  { state:'KY', charge:'Assault - Fourth Degree', charge_code:'ASSAULT-4', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'KY', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Louisiana
  { state:'LA', charge:'DWI - First', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'Parish-level variation is significant in Louisiana' },
  { state:'LA', charge:'Simple Battery', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'LA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // Maine
  { state:'ME', charge:'OUI', charge_code:'DUI-1', category:'DUI', bail_min:50, bail_max:1000, notes:'Maine uses low cash bail; personal recognizance common' },
  { state:'ME', charge:'Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:3000, notes:null },
  { state:'ME', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:500, bail_max:3000, notes:null },
  // Maryland
  { state:'MD', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:5000, notes:'Baltimore City vs county schedules differ substantially' },
  { state:'MD', charge:'Second Degree Assault', charge_code:'ASSAULT-2', category:'Violent', bail_min:2500, bail_max:10000, notes:null },
  { state:'MD', charge:'CDS Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Massachusetts
  { state:'MA', charge:'OUI', charge_code:'DUI-1', category:'DUI', bail_min:40, bail_max:2500, notes:'Massachusetts uses bail commissioners; initial bail is low' },
  { state:'MA', charge:'Assault and Battery', charge_code:'A&B', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'MA', charge:'Drug Possession Class A/B', charge_code:'DRUG-POSS-AB', category:'Drug', bail_min:500, bail_max:2500, notes:null },
  // Michigan
  { state:'MI', charge:'OWI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:7500, notes:null },
  { state:'MI', charge:'Assault and Battery', charge_code:'A&B', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'MI', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Minnesota
  { state:'MN', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:700, bail_max:6000, notes:null },
  { state:'MN', charge:'Assault - Fifth Degree', charge_code:'ASSAULT-5', category:'Violent', bail_min:500, bail_max:3000, notes:null },
  { state:'MN', charge:'Drug Possession - Fifth Degree', charge_code:'DRUG-POSS-5', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Mississippi
  { state:'MS', charge:'DUI - First', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:3000, notes:null },
  { state:'MS', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'MS', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1500, bail_max:7500, notes:null },
  // Missouri
  { state:'MO', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'MO', charge:'Third Degree Assault', charge_code:'ASSAULT-3', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'MO', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // Montana
  { state:'MT', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'MT', charge:'Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'MT', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Nebraska
  { state:'NE', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'NE', charge:'Assault - Third Degree', charge_code:'ASSAULT-3', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'NE', charge:'Possession - Controlled Substance', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Nevada
  { state:'NV', charge:'DUI - First', charge_code:'DUI-1', category:'DUI', bail_min:1000, bail_max:5000, notes:'Clark Co (Las Vegas) $1000 standard' },
  { state:'NV', charge:'Battery', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:3000, bail_max:15000, notes:'Nevada uses Battery; higher bail than most states' },
  { state:'NV', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:3000, bail_max:10000, notes:null },
  // New Hampshire
  { state:'NH', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:100, bail_max:2500, notes:'NH uses cash bail sparingly; conditions common' },
  { state:'NH', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'NH', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:500, bail_max:2500, notes:null },
  // New Jersey
  { state:'NJ', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:0, bail_max:0, notes:'NJ eliminated cash bail in 2017 — uses risk assessment tool' },
  { state:'NJ', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:0, bail_max:0, notes:'Risk-based detention, not cash bail' },
  { state:'NJ', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:0, bail_max:0, notes:'Pretrial Services Agency makes release recommendation' },
  // New Mexico
  { state:'NM', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'Bernalillo Co uses high bail for repeat DWI' },
  { state:'NM', charge:'Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'NM', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // North Carolina
  { state:'NC', charge:'DWI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:10000, notes:'NC uses Willard Report to set DWI bail; varies significantly' },
  { state:'NC', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'NC', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // North Dakota
  { state:'ND', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:3000, notes:null },
  { state:'ND', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'ND', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Ohio
  { state:'OH', charge:'DUI/OVI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:10000, notes:'Franklin Co (Columbus) $1000; Hamilton Co (Cincinnati) $500' },
  { state:'OH', charge:'Assault - First Degree Misdemeanor', charge_code:'ASSAULT-M1', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'OH', charge:'Drug Possession - Misdemeanor', charge_code:'DRUG-POSS-M', category:'Drug', bail_min:500, bail_max:3000, notes:null },
  // Oklahoma
  { state:'OK', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'OK', charge:'Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'OK', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1500, bail_max:7500, notes:null },
  // Oregon
  { state:'OR', charge:'DUII', charge_code:'DUI-1', category:'DUI', bail_min:2500, bail_max:10000, notes:'Oregon DUII bail is notably higher than most states' },
  { state:'OR', charge:'Assault - Fourth Degree', charge_code:'ASSAULT-4', category:'Violent', bail_min:2500, bail_max:5000, notes:null },
  { state:'OR', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:0, bail_max:0, notes:'Measure 110 (2020) decriminalized personal use amounts' },
  // Pennsylvania
  { state:'PA', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'Philadelphia uses ROR more; suburban counties use cash bail' },
  { state:'PA', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'PA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Rhode Island
  { state:'RI', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:3000, notes:'Small state; Providence court handles most cases' },
  { state:'RI', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'RI', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:500, bail_max:2500, notes:null },
  // South Carolina
  { state:'SC', charge:'DUI - First', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:null },
  { state:'SC', charge:'Assault and Battery', charge_code:'A&B', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'SC', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // South Dakota
  { state:'SD', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:250, bail_max:3000, notes:null },
  { state:'SD', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'SD', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Utah
  { state:'UT', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:750, bail_max:5000, notes:'Utah .05 BAC threshold — lowest in nation' },
  { state:'UT', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'UT', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Vermont
  { state:'VT', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:0, bail_max:1000, notes:'Vermont rarely uses cash bail — conditions-based release' },
  { state:'VT', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:250, bail_max:1000, notes:null },
  { state:'VT', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:250, bail_max:1000, notes:null },
  // Virginia
  { state:'VA', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'2021 bail reform limited cash bail for misdemeanors' },
  { state:'VA', charge:'Simple Assault and Battery', charge_code:'A&B-SIMPLE', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'VA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:'Marijuana decriminalized 2021' },
  // Washington
  { state:'WA', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:5000, notes:'King Co (Seattle) uses individualized bail settings' },
  { state:'WA', charge:'Assault - Fourth Degree', charge_code:'ASSAULT-4', category:'Violent', bail_min:1000, bail_max:5000, notes:null },
  { state:'WA', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:0, bail_max:0, notes:'State v. Blake (2021) made simple possession unconstitutional; Legislature re-criminalized but reduced penalties' },
  // West Virginia
  { state:'WV', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:500, bail_max:3000, notes:null },
  { state:'WV', charge:'Simple Battery', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'WV', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Wisconsin
  { state:'WI', charge:'OWI', charge_code:'DUI-1', category:'DUI', bail_min:150, bail_max:2500, notes:'First offense OWI in WI is not a criminal charge — no bail' },
  { state:'WI', charge:'Battery - Simple', charge_code:'BATTERY-SIMPLE', category:'Violent', bail_min:500, bail_max:5000, notes:null },
  { state:'WI', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:7500, notes:null },
  // Wyoming
  { state:'WY', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:750, bail_max:5000, notes:null },
  { state:'WY', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:500, bail_max:2500, notes:null },
  { state:'WY', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:1000, bail_max:5000, notes:null },
  // Washington DC
  { state:'DC', charge:'DUI', charge_code:'DUI-1', category:'DUI', bail_min:0, bail_max:0, notes:'DC uses Pretrial Services Agency; cash bail rare for misdemeanors' },
  { state:'DC', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', category:'Violent', bail_min:0, bail_max:3000, notes:'Conditions-based release preferred' },
  { state:'DC', charge:'Drug Possession', charge_code:'DRUG-POSS', category:'Drug', bail_min:0, bail_max:2500, notes:null },

  // California
  { state:'CA', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:5000,  bail_max:15000, notes:'Varies by county; LA $5000 base; SF $10000; OWN counties ROR' },
  { state:'CA', charge:'Felony Drug Possession',     charge_code:'HS11350',     category:'Drug',    bail_min:10000, bail_max:50000, notes:'HS 11350; schedule varies by county' },
  { state:'CA', charge:'Assault with Deadly Weapon', charge_code:'PC245',       category:'Violent', bail_min:30000, bail_max:75000, notes:'PC 245; serious felony enhancement adds $25k' },
  // Delaware
  { state:'DE', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:500,   bail_max:2500,  notes:'Title 21 § 4177; typically ROR first offense' },
  { state:'DE', charge:'Felony Drug Possession',     charge_code:'DEL16-4753',  category:'Drug',    bail_min:2500,  bail_max:25000, notes:'16 Del. C. § 4753' },
  { state:'DE', charge:'Felony Assault',             charge_code:'DEL11-612',   category:'Violent', bail_min:10000, bail_max:50000, notes:'11 Del. C. § 612' },
  // Florida
  { state:'FL', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:500,   bail_max:2000,  notes:'§ 316.193 Fla. Stat.; bond schedule varies by county' },
  { state:'FL', charge:'Felony Drug Possession',     charge_code:'FS893.13',    category:'Drug',    bail_min:5000,  bail_max:50000, notes:'§ 893.13; 3rd deg felony $5k, 2nd deg $15k' },
  { state:'FL', charge:'Aggravated Battery',         charge_code:'FS784.045',   category:'Violent', bail_min:15000, bail_max:75000, notes:'§ 784.045; 2nd degree felony' },
  // Idaho
  { state:'ID', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:1000,  bail_max:5000,  notes:'Idaho Code § 18-8004' },
  { state:'ID', charge:'Felony Drug Possession',     charge_code:'IC37-2732',   category:'Drug',    bail_min:5000,  bail_max:25000, notes:'Idaho Code § 37-2732' },
  { state:'ID', charge:'Aggravated Assault',         charge_code:'IC18-905',    category:'Violent', bail_min:5000,  bail_max:30000, notes:'Idaho Code § 18-905' },
  // Illinois
  { state:'IL', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:1000,  bail_max:5000,  notes:'625 ILCS 5/11-501; SAFE-T Act 2023' },
  { state:'IL', charge:'Felony Drug Possession',     charge_code:'IL720-570',   category:'Drug',    bail_min:5000,  bail_max:50000, notes:'720 ILCS 570/402' },
  { state:'IL', charge:'Aggravated Battery',         charge_code:'IL720-12-4',  category:'Violent', bail_min:25000, bail_max:100000,notes:'720 ILCS 5/12-4; Class 1 felony' },
  // New York
  { state:'NY', charge:'DUI - First Offense',        charge_code:'VTL1192',     category:'DUI',     bail_min:500,   bail_max:5000,  notes:'VTL § 1192; bail reform 2020 — most DWI ROR' },
  { state:'NY', charge:'Felony Drug Possession',     charge_code:'PL220.18',    category:'Drug',    bail_min:10000, bail_max:75000, notes:'PL § 220.18; cash bail restored 2023' },
  { state:'NY', charge:'Assault 2nd Degree',         charge_code:'PL120.05',    category:'Violent', bail_min:5000,  bail_max:50000, notes:'PL § 120.05; qualifying offense' },
  // Tennessee
  { state:'TN', charge:'DUI - First Offense',        charge_code:'DUI-1',       category:'DUI',     bail_min:1500,  bail_max:5000,  notes:'TCA § 55-10-401; Davidson Co uses $1500' },
  { state:'TN', charge:'Felony Drug Possession',     charge_code:'TCA39-17-418',category:'Drug',    bail_min:5000,  bail_max:30000, notes:'TCA § 39-17-418' },
  { state:'TN', charge:'Aggravated Assault',         charge_code:'TCA39-13-102',category:'Violent', bail_min:15000, bail_max:75000, notes:'TCA § 39-13-102; Class C felony' },
  // Texas
  { state:'TX', charge:'DUI - First Offense',        charge_code:'DWI-1',       category:'DUI',     bail_min:500,   bail_max:3000,  notes:'Texas Penal Code § 49.04; Class B misd' },
  { state:'TX', charge:'Felony Drug Possession',     charge_code:'THSC481.115', category:'Drug',    bail_min:5000,  bail_max:100000,notes:'THSC § 481.115; depends on substance and weight' },
  { state:'TX', charge:'Aggravated Assault',         charge_code:'TPC22.02',    category:'Violent', bail_min:15000, bail_max:100000,notes:'TPC § 22.02; 2nd degree felony' },
];

const bailStmt = db.prepare(`
  INSERT OR IGNORE INTO bail_schedules (state, charge, charge_code, category, bail_min, bail_max, notes)
  VALUES (@state, @charge, @charge_code, @category, @bail_min, @bail_max, @notes)
`);
let bailCount = 0;
const insertBail = db.transaction(() => {
  for (const b of BAIL_SCHEDULES) {
    bailStmt.run(b);
    bailCount++;
  }
});
try {
  insertBail();
  console.log(`  ✓ Bail schedules: ${bailCount} records (44 additional states)`);
} catch(e) {
  console.log('  Bail schedules table may not exist:', e.message);
}

db.close();
})().catch(e => { console.error('Seed failed:', e); process.exit(1); });
