/**
 * import_doi_bondsmen.js — Import real bail bondsman data from State DOI exports
 * ─────────────────────────────────────────────────────────────────────────────
 * Ingests state Department of Insurance licensee CSV/TXT exports and upserts
 * licensed bail bondsman records into the MAIN Postgres database (DATABASE_URL)
 * through services/dataRefresh:
 *   - licensees not yet in bail_agents are inserted (source 'doi_import',
 *     doi_verified = 1, license number / type, timestamps);
 *   - for bondsmen already listed (matched by source id, phone, or
 *     name + city + state) the DOI values (license number, phone, email,
 *     address, doi_verified) are staged in provider_update_proposals for
 *     admin review — an existing row is never overwritten;
 *   - nothing is deleted (the old --reset flag is gone); runs are logged in
 *     scrape_runs.
 *
 * USAGE:
 *   node src/scripts/import_doi_bondsmen.js --file tn_producers.txt --state TN
 *   node src/scripts/import_doi_bondsmen.js --file tx_bail_agents.csv --state TX
 *   node src/scripts/import_doi_bondsmen.js --file fl_bail_agents.csv --state FL
 *   node src/scripts/import_doi_bondsmen.js --dry-run --file data.csv --state TN
 *
 * STATE DOI DOWNLOAD URLS (free, public):
 *
 *   TENNESSEE (pipe-delimited TXT):
 *     https://www.tn.gov/content/dam/tn/commerce/documents/insurance/data-call/producer_license_extract.txt
 *     Columns: NPN|Last Name|First Name|Middle Name|Suffix|Entity Type|
 *              Business Name|License Number|License Class|License Type|
 *              License Status|Original Issue Date|Expiration Date|
 *              Residence State|Residence Address|City|State|Zip|Phone|Email
 *     Filter:  License Class = 'Bail' OR License Type LIKE '%Bail%'
 *
 *   TEXAS (CSV from TDI):
 *     https://www.tdi.texas.gov/agent/agentlookup.html → Export Results
 *     Columns: NPN,License Number,Full Name,License Type,Status,City,Zip,Phone
 *     Filter:  License Type = 'Bail Bond Surety Company' or 'Bail Bond Agent'
 *
 *   FLORIDA (CSV from MyFloridaCFO):
 *     https://www.myfloridacfo.com/division/agents/verification/agentsearch.htm
 *     Search: License Type = "Bail Bond Agent", Status = "Active", export CSV
 *     Columns: License Number,Name,Business Name,City,County,Zip,Phone,Email,Status
 *
 *   GEORGIA (CSV from OCI):
 *     https://www.oci.ga.gov/LicensureAndFiling/LicenseSearch.aspx
 *     Filter: License Type = "Bail Bond Agent / Professional Bondsman"
 *
 *   NORTH CAROLINA (CSV from NCDOI):
 *     https://www.ncdoi.com/agent-services/license-lookup
 *     Filter: Specialty = "Surety / Bail"
 *
 *   NIPR (ALL STATES - most reliable source):
 *     https://nipr.com/PdbOnlineLicenseeSearch.htm
 *     Returns structured data with NPN, license #, name, city, state, phone
 *     Covers all 50 states through one interface
 *     Free individual lookups, bulk export requires account
 *
 * RESULT: new licensees inserted with source='doi_import', doi_verified=1;
 *         differences for existing rows staged for review (never applied here).
 */

import 'dotenv/config';
import path      from 'path';
import fs        from 'fs';
import { parse } from 'csv-parse/sync';
import yargs     from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createProviderWriter } from '../services/dataRefresh/providerStore.js';
import { DIRECTORY_LOCK } from '../services/dataRefresh/providerRefresh.js';
import { startRun, finishRun, withJobLock, newCounts } from '../services/dataRefresh/runLog.js';
import { splitCityState } from '../services/dataRefresh/normalize.js';
import { openRefreshDb, printRunSummary, runCli } from './lib/refreshCli.js';

const argv = yargs(hideBin(process.argv))
  .option('file',    { type: 'string',  required: true, describe: 'Path to DOI export file' })
  .option('state',   { type: 'string',  required: true, describe: 'Two-letter state code (TN, TX, FL...)' })
  .option('dry-run', { type: 'boolean', default: false })
  .option('reset',   { type: 'boolean', default: false, hidden: true })
  .argv;

// ── State-specific column mappings ──────────────────────────────────────────
const STATE_PARSERS = {
  TN: {
    delimiter: '|',
    columns:   true,
    filter: (row) => {
      const lc  = (row['License Class'] || '').toLowerCase();
      const lt  = (row['License Type']  || '').toLowerCase();
      const ls  = (row['License Status']|| '').toLowerCase();
      return (lc.includes('bail') || lt.includes('bail') || lt.includes('surety'))
          && ls === 'active';
    },
    extract: (row) => ({
      name:           [row['First Name'], row['Middle Name'], row['Last Name']].filter(Boolean).join(' ')
                   || row['Business Name'] || '',
      business_name:  row['Business Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase(),
      city:           `${titleCase(row['City'] || '')}, TN`,
      address:        row['Residence Address'] || '',
      zip:            row['Zip'] || '',
      npn:            row['NPN'] || '',
    }),
  },
  TX: {
    delimiter: ',',
    columns:   true,
    filter: (row) => {
      const lt = (row['License Type'] || row['license_type'] || '').toLowerCase();
      const s  = (row['Status']       || row['status']       || '').toLowerCase();
      return (lt.includes('bail')) && s === 'active';
    },
    extract: (row) => ({
      name:           row['Full Name'] || row['full_name'] || row['Name'] || '',
      business_name:  row['Business Name'] || '',
      license_number: row['License Number'] || row['license_number'] || '',
      phone:          normalizePhone(row['Phone'] || row['phone'] || ''),
      email:          (row['Email'] || row['email'] || '').toLowerCase(),
      city:           `${titleCase(row['City'] || row['city'] || '')}, TX`,
      address:        row['Address'] || '',
      zip:            row['Zip'] || row['zip'] || '',
      npn:            row['NPN'] || '',
    }),
  },
  FL: {
    delimiter: ',',
    columns:   true,
    filter: (row) => {
      const lt = (row['License Type'] || '').toLowerCase();
      const s  = (row['Status']       || '').toLowerCase();
      return lt.includes('bail') && s.includes('active');
    },
    extract: (row) => ({
      name:           row['Name'] || row['Business Name'] || '',
      business_name:  row['Business Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase(),
      city:           `${titleCase(row['City'] || '')}, FL`,
      address:        row['Address'] || '',
      zip:            row['Zip'] || '',
      npn:            '',
    }),
  },
  GA: {
    delimiter: ',',
    columns:   true,
    filter: (row) => {
      const lt = (row['License Type'] || '').toLowerCase();
      const s  = (row['Status']       || '').toLowerCase();
      return (lt.includes('bail') || lt.includes('bondsman')) && s === 'active';
    },
    extract: (row) => ({
      name:           row['Name'] || '',
      business_name:  row['Business Name'] || row['Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase(),
      city:           `${titleCase(row['City'] || '')}, GA`,
      address:        row['Address'] || '',
      zip:            row['Zip'] || '',
      npn:            '',
    }),
  },
  NC: {
    delimiter: ',',
    columns:   true,
    filter: (row) => {
      const lt = (row['Specialty'] || row['License Type'] || '').toLowerCase();
      const s  = (row['Status']    || '').toLowerCase();
      return (lt.includes('bail') || lt.includes('surety')) && s === 'active';
    },
    extract: (row) => ({
      name:           row['Name'] || '',
      business_name:  row['Business Name'] || '',
      license_number: row['License Number'] || '',
      phone:          normalizePhone(row['Phone'] || ''),
      email:          (row['Email'] || '').toLowerCase(),
      city:           `${titleCase(row['City'] || '')}, NC`,
      address:        row['Address'] || '',
      zip:            row['Zip'] || '',
      npn:            '',
    }),
  },
  // Generic parser for states without specific mapping
  DEFAULT: {
    delimiter: ',',
    columns:   true,
    filter: (row) => {
      const vals = Object.values(row).join(' ').toLowerCase();
      return vals.includes('bail') && (vals.includes('active') || !vals.includes('inactive'));
    },
    extract: (row) => {
      const vals = Object.entries(row);
      const get  = (...keys) => {
        for (const k of keys) {
          const found = vals.find(([key]) => key.toLowerCase().includes(k.toLowerCase()));
          if (found && found[1]) return found[1];
        }
        return '';
      };
      return {
        name:           get('name','business') || '',
        business_name:  get('business') || '',
        license_number: get('license','number') || '',
        phone:          normalizePhone(get('phone','tel') || ''),
        email:          (get('email','mail') || '').toLowerCase(),
        city:           `${titleCase(get('city') || '')}, ${argv.state}`,
        address:        get('address','addr') || '',
        zip:            get('zip','postal') || '',
        npn:            get('npn') || '',
      };
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return raw || '';
}

function titleCase(str) {
  return (str || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main ──────────────────────────────────────────────────────────────────────
runCli(async () => {
  if (argv.reset) {
    console.error('--reset is no longer supported: imports never delete bail_agents rows. '
      + 'Re-run without it — existing rows are matched and changes staged for review.');
    return 1;
  }
  const stateCode = argv.state.toUpperCase();
  const filePath  = path.resolve(argv.file);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return 1;
  }

  const parser = STATE_PARSERS[stateCode] || STATE_PARSERS.DEFAULT;
  const raw    = fs.readFileSync(filePath, 'utf-8');

  let rows;
  try {
    rows = parse(raw, {
      delimiter:        parser.delimiter,
      columns:          parser.columns,
      skip_empty_lines: true,
      relax_column_count: true,
      trim:             true,
    });
  } catch {
    // Try pipe-delimited if comma fails
    try {
      rows = parse(raw, { delimiter: '|', columns: true, skip_empty_lines: true, trim: true });
    } catch {
      console.error('Could not parse file. Check format and delimiter.');
      return 1;
    }
  }

  console.log(`Parsed ${rows.length} rows from ${path.basename(filePath)}`);
  const filtered = rows.filter(parser.filter);
  console.log(`Bail bondsmen after filter: ${filtered.length}`);

  const records = [];
  let unusable = 0;
  for (const row of filtered) {
    const data = parser.extract(row);
    const { city } = splitCityState(data.city, stateCode);
    if (!data.name.trim() || !city) { unusable++; continue; }
    const key = (data.license_number || data.npn || data.name).replace(/\W/g, '_').toLowerCase();
    records.push({
      type: 'bail_agents', source: 'doi_import',
      source_id: `doi_${stateCode}_${key}`,
      name: data.name, company: data.business_name || null,
      city, state: stateCode,
      phone: data.phone || null, email: data.email || null, address: data.address || null,
      license_number: data.license_number || null,
      license_type: 'state DOI bail license',
      doi_verified: 1,
      bio: data.license_number ? `Licensed bail bondsman (${stateCode} license ${data.license_number}).` : null,
    });
  }

  const db = await openRefreshDb();
  const dryRun = argv['dry-run'];
  const locked = await withJobLock(db, DIRECTORY_LOCK, async () => {
    const counts = newCounts();
    counts.fetched = filtered.length;
    counts.skipped = unusable;
    const errorSamples = [];
    const runId = await startRun(db, { job: 'doi_import', trigger: 'manual', params: { state: stateCode, file: path.basename(filePath) }, dryRun });
    await createProviderWriter(db, 'bail_agents', { runId, dryRun, counts, errorSamples }).writeAll(records);
    const status = await finishRun(db, runId, counts, { errorSamples });
    return { runId, status, counts };
  });
  if (!locked.locked) {
    console.log('ℹ️  Another provider-directory run is in progress — try again later.');
    return 0;
  }
  printRunSummary(`DOI import (${stateCode})`, { ...locked.result, dryRun });
  return locked.result.status === 'failed' ? 1 : 0;
});
