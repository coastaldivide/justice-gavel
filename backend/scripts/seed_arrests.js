#!/usr/bin/env node
/**
 * seed_arrests.js — Populate arrest_records table for Justice Gavel
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/seed_arrests.js
 *   OR: Run as a Railway one-off command
 *
 * Inserts 600 realistic arrest records across 10 states.
 * Uses ON CONFLICT DO NOTHING — safe to run multiple times.
 */

import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const FIRST_NAMES = [
  "James","Robert","John","Michael","William","David","Richard","Joseph","Thomas","Charles",
  "Christopher","Daniel","Matthew","Anthony","Mark","Donald","Steven","Paul","Andrew","Joshua",
  "Kenneth","Kevin","Brian","George","Timothy","Ronald","Edward","Jason","Jeffrey","Ryan",
  "Maria","Jennifer","Lisa","Nancy","Karen","Betty","Helen","Sandra","Donna","Carol",
  "Latoya","DeShawn","Marcus","Darius","Jamal","Tyrone","Keisha","Tamara","Malik","Tanya",
  "Jose","Miguel","Carlos","Juan","Ana","Rosa","Luis","Jorge","Roberto","Sofia",
  "Brittany","Ashley","Amber","Crystal","Destiny","Tyler","Logan","Dylan","Austin","Hunter",
];
const LAST_NAMES = [
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
  "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
  "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
  "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
  "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
];
const COUNTIES = [
  ['TN','Davidson','Nashville','Davidson County Criminal Justice Center'],
  ['TN','Shelby','Memphis','Shelby County Correctional Center'],
  ['TN','Knox','Knoxville','Knox County Detention Facility'],
  ['TN','Hamilton','Chattanooga','Hamilton County Jail'],
  ['TN','Montgomery','Clarksville','Montgomery County Jail'],
  ['TX','Harris','Houston','Harris County Jail'],
  ['TX','Dallas','Dallas','Dallas County Jail'],
  ['TX','Tarrant','Fort Worth','Tarrant County Jail'],
  ['TX','Bexar','San Antonio','Bexar County Adult Detention Center'],
  ['TX','Travis','Austin','Travis County Correctional Complex'],
  ['GA','Fulton','Atlanta','Fulton County Jail'],
  ['GA','Cobb','Marietta','Cobb County Detention Center'],
  ['GA','DeKalb','Decatur','DeKalb County Jail'],
  ['GA','Chatham','Savannah','Chatham County Detention Center'],
  ['FL','Miami-Dade','Miami','Turner Guilford Knight Correctional Center'],
  ['FL','Hillsborough','Tampa','Hillsborough County Jail'],
  ['FL','Orange','Orlando','Orange County Corrections'],
  ['FL','Duval','Jacksonville','Duval County Jail'],
  ['NC','Mecklenburg','Charlotte','Mecklenburg County Jail'],
  ['NC','Wake','Raleigh','Wake County Detention Center'],
  ['OH','Cuyahoga','Cleveland','Cuyahoga County Jail'],
  ['OH','Franklin','Columbus','Franklin County Correctional Center'],
  ['IL','Cook','Chicago','Cook County Jail'],
  ['VA','Fairfax','Fairfax','Fairfax County Adult Detention Center'],
  ['AZ','Maricopa','Phoenix','Maricopa County Jail'],
  ['CO','Denver','Denver','Denver County Jail'],
  ['CO','El Paso','Colorado Springs','El Paso County Jail'],
];
const CHARGES = [
  ['DUI - .08 BAC or Greater',             500,    5000],
  ['DUI - 2nd Offense',                   1500,   10000],
  ['Possession of Marijuana',              500,    2500],
  ['Possession of Controlled Substance — Schedule II', 1000, 10000],
  ['Possession of Methamphetamine',       2500,   25000],
  ['Drug Trafficking — Cocaine',         25000,  250000],
  ['Simple Assault — Class A Misdemeanor',1000,    5000],
  ['Domestic Assault — 1st Offense',     2500,   10000],
  ['Aggravated Assault with Deadly Weapon',15000,  75000],
  ['Shoplifting — Misdemeanor',           500,    2000],
  ['Theft — $1,000–$10,000',            2500,   15000],
  ['Burglary — Residential',            25000,  100000],
  ['Robbery — Armed',                   50000,  250000],
  ['Unlawful Possession of Firearm',     5000,   50000],
  ['Felon in Possession of Firearm',    25000,  150000],
  ['Failure to Appear — Bench Warrant',  1000,   25000],
  ['Violation of Probation',            2500,   50000],
  ['Identity Theft',                    5000,   25000],
  ['Credit Card Fraud',                 5000,   25000],
  ['Murder — 2nd Degree',             500000, 1000000],
  ['Aggravated Rape',                 250000, 1000000],
  ['Reckless Driving',                  500,    2500],
  ['Driving on Suspended License',      500,    1500],
  ['Public Intoxication',               250,    1000],
  ['Trespassing',                       500,    2000],
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function courtDate() {
  const d = new Date();
  d.setDate(d.getDate() + randInt(14, 90));
  return d.toISOString().split('T')[0];
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to database');

    // Check current count
    const { rows: existing } = await client.query(
      "SELECT COUNT(*) as n FROM arrest_records WHERE source = 'seed_v1'"
    );
    if (parseInt(existing[0].n) > 100) {
      console.log(`ℹ️  Already have ${existing[0].n} seed records — skipping (use --force to re-seed)`);
      if (!process.argv.includes('--force')) return;
    }

    let inserted = 0;
    const BATCH  = 50;
    const TOTAL  = 600;
    const rows   = [];

    for (let i = 0; i < TOTAL; i++) {
      const [state, county, city, jail] = pick(COUNTIES);
      const [charge, bailMin, bailMax]  = pick(CHARGES);
      const hasAtty    = Math.random() < 0.30 ? 1 : 0;  // 70% no attorney
      const hasBail    = Math.random() > 0.18;           // 82% have bail set
      const bail       = hasBail ? Math.round(randInt(bailMin, bailMax) / 500) * 500 : 0;
      const name       = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const bookDate   = daysAgo(randInt(0, 14));
      const cDate      = Math.random() > 0.3 ? courtDate() : null;
      const caseNum    = `${state}-2026-CR-${randInt(10000,99999)}`;

      rows.push([name, bookDate, charge, bail, cDate, hasAtty, caseNum, jail, county, state, 'seed_v1', 0]);
    }

    // Insert in batches
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch  = rows.slice(i, i + BATCH);
      const values = batch.map((row, ri) => {
        const base = i + ri;
        const ph   = row.map((_, ci) => `$${base * row.length + ci + 1}`).join(', ');
        return `(${ph})`;
      }).join(',\n');

      const flat = batch.flat();
      await client.query(
        `INSERT INTO arrest_records
           (name,booking_date,charges,bail_amount,court_date,
            has_attorney,case_number,jail_location,county,state,source,alert_sent)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        flat
      );
      inserted += batch.length;
      process.stdout.write(`\r  Inserted ${inserted}/${rows.length}...`);
    }

    const { rows: counts } = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN has_attorney = 0 AND bail_amount > 0 THEN 1 ELSE 0 END) as available_leads,
        SUM(bail_amount) as total_bail_value,
        COUNT(DISTINCT state) as states_covered
      FROM arrest_records WHERE source = 'seed_v1'
    `);
    const c = counts[0];
    console.log(`\n\n✅ Seed complete:`);
    console.log(`   Total records:     ${c.total}`);
    console.log(`   Available leads:   ${c.available_leads} (no attorney + bail set)`);
    console.log(`   Total bail value:  $${Number(c.total_bail_value).toLocaleString()}`);
    console.log(`   States covered:    ${c.states_covered}`);
    console.log(`\n   Bondsman lead marketplace is now populated.`);
    console.log(`   Bondsmen can view leads at: GET /api/billing/leads`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
