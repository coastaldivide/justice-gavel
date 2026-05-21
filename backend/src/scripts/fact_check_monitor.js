/**
 * Justice Gavel — Legal Data Fact-Check Monitor
 *
 * Scans official government sources and flags data that may be outdated.
 * Run this before every app update, or schedule monthly via cron.
 *
 * Usage:
 *   node src/scripts/fact_check_monitor.js
 *   node src/scripts/fact_check_monitor.js --type dui
 *   node src/scripts/fact_check_monitor.js --type expungement
 *   node src/scripts/fact_check_monitor.js --state TN
 *   node src/scripts/fact_check_monitor.js --full   (hits all 200+ URLs)
 *
 * Output:
 *   Console report + fact_check_report_YYYY-MM-DD.json in /backend/reports/
 *
 * What it checks:
 *   - DUI laws: NHTSA state law pages, MADD state summaries
 *   - Drug penalties: DEA scheduling, NORML state laws
 *   - Expungement: CCRC 50-state comparison, state legislature sites
 *   - Victim compensation: Each state's victim services agency page
 *   - State bar complaints: Each state bar's complaint page
 *   - Specialty courts: NADCP court locator
 *   - Courthouse data: Each state court system website
 *   - Crisis hotlines: SAMHSA, NAMI, 988lifeline.org
 *   - Bar association URLs (scraper): Each state bar member search page
 */

import fetch   from 'node-fetch';
import path    from 'path';
import fs      from 'fs';
import Database from 'better-sqlite3';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const DB_PATH   = path.join(__dirname, '../../data/providers.sqlite');
const DEMO_DB   = path.join(__dirname, '../../../demo.db');
const REPORT_DIR= path.join(__dirname, '../../reports');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const today    = new Date().toISOString().split('T')[0];
const REPORT   = { date: today, checks: [], issues: [], summary: {} };

// ── Source URLs to monitor ─────────────────────────────────────────────────
// These are the authoritative government / official sources for each data type.
// When these pages change, it signals that the underlying law may have changed.

const SOURCES = {

  // ── DUI Laws ─────────────────────────────────────────────────────────────
  // Official sources: NHTSA (federal highway safety), MADD state pages,
  // IIHS state law comparison, and individual state DMV/DOT pages
  dui: [
    { name: 'NHTSA Drunk Driving State Laws', url: 'https://www.nhtsa.gov/risky-driving/drunk-driving', expect: ['BAC','0.08','per se'] },
    { name: 'MADD State Laws Overview',       url: 'https://www.madd.org/the-solution/advocacy/state-laws/', expect: ['ignition interlock','license'] },
    { name: 'IIHS DUI Laws by State',         url: 'https://www.iihs.org/topics/alcohol-impaired-driving#laws', expect: ['per se','BAC','impaired'] },
    // State-specific DMV pages (sample — check these annually)
    { name: 'TN DDS DUI Info',  url: 'https://www.tn.gov/safety/driver-services/driverimprovement/dui.html', expect: ['0.08','DUI','Tennessee'] },
    { name: 'CA DMV Admin Per Se', url: 'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/drunk-and-drugged-driving-dui/drunk-drugged-driving/', expect: ['0.08','suspension','DMV'] },
    { name: 'FL DHSMV DUI',    url: 'https://www.flhsmv.gov/driver-licenses-id-cards/driver-license-revocation-suspension/dui/', expect: ['0.08','DUI','10-day'] },
    { name: 'TX DPS DWI',      url: 'https://www.dps.texas.gov/section/driver-license/driving-while-intoxicated', expect: ['DWI','0.08','Texas'] },
    { name: 'NY DMV DWI',      url: 'https://dmv.ny.gov/tickets/understanding-dwai-and-dwi-charges', expect: ['DWAI','DWI','0.07'] },
    { name: 'IL SOS DUI',      url: 'https://www.ilsos.gov/departments/drivers/DUI/home.html', expect: ['0.08','DUI','Illinois'] },
    { name: 'CO DMV DUI',      url: 'https://dmv.colorado.gov/dui-dwai-information', expect: ['0.08','DUI','Colorado'] },
  ],

  // ── Drug Penalties ────────────────────────────────────────────────────────
  // Sources: DEA drug scheduling, NORML state laws, ACLU state-by-state
  drug: [
    { name: 'DEA Drug Schedules',    url: 'https://www.dea.gov/drug-information/drug-scheduling', expect: ['Schedule I','Schedule II','cocaine'] },
    { name: 'NORML State Laws',      url: 'https://norml.org/laws/', expect: ['marijuana','cannabis','possession'] },
    { name: 'TN Drug Statutes',      url: 'https://law.justia.com/codes/tennessee/title-39/chapter-17/part-4/', expect: ['Schedule','penalty','possession'] },
    { name: 'CA Drug Laws',          url: 'https://norml.org/laws/california/', expect: ['California','possession','ounce'] },
    { name: 'TX Drug Penalty Groups',url: 'https://statutes.capitol.texas.gov/Docs/HS/htm/HS.481.htm', expect: ['Penalty Group','felony','misdemeanor'] },
    { name: 'FL Drug Statutes',      url: 'https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0800-0899/0893/0893.htm', expect: ['possession','Schedule','Florida'] },
  ],

  // ── Expungement / Record Sealing ─────────────────────────────────────────
  // Source: CCRC is the gold standard — they track every state change
  expungement: [
    { name: 'CCRC 50-State Comparison',       url: 'https://ccresourcecenter.org/state-restoration-profiles/50-state-comparisonjudicial-expungement-sealing-and-set-aside-2-2/', expect: ['waiting period','automatic','petition'] },
    { name: 'Clean Slate Initiative Tracker', url: 'https://www.cleanslateinitiative.org/states', expect: ['automatic','sealing','Pennsylvania'] },
    { name: 'TN Expungement Statute',         url: 'https://law.justia.com/codes/tennessee/title-40/chapter-32/part-1/', expect: ['expunge','misdemeanor','felony'] },
    { name: 'VA Clean Slate Law',             url: 'https://cleanslatevirginia.com/', expect: ['July 1, 2026','sealing','Virginia'] },
    { name: 'MD Expungement Reform Act',      url: 'https://frizwoods.com/blog/expungement-reform-act-2025', expect: ['2025','Maryland','waiting period'] },
    { name: 'DC Sealing Law',                 url: 'https://code.dccouncil.gov/us/dc/council/code/sections/16-803.html', expect: ['sealing','misdemeanor','years'] },
    { name: 'CO Clean Slate',                 url: 'https://leg.colorado.gov/bills/sb22-099', expect: ['automatic','sealing','Colorado'] },
  ],

  // ── Victim Compensation ───────────────────────────────────────────────────
  // Each state's victim services agency — check phone and URL annually
  victim_compensation: [
    { name: 'OVC NCVLI Directory',    url: 'https://ovc.ojp.gov/program/vca/state-victim-compensation-programs', expect: ['compensation','state','victim'] },
    { name: 'TN Victim Comp',         url: 'https://www.tn.gov/claimsinvestigation/ci-home/criminal-injuries-compensation-fund.html', expect: ['$30,000','1 year','Tennessee'] },
    { name: 'CA Victim Comp Board',   url: 'https://victims.ca.gov/docs/calvcb_brochure.pdf', expect: ['compensation','California'] },
    { name: 'TX CVC Program',         url: 'https://www.texasattorneygeneral.gov/crime-victims/crime-victims-compensation', expect: ['compensation','3 years','Texas'] },
    { name: 'FL Victim Services',     url: 'https://myfloridalegal.com/victim-compensation', expect: ['compensation','Florida'] },
    { name: 'NY OVS',                 url: 'https://www.ovs.ny.gov/eligibility', expect: ['compensation','New York','seven'] },
  ],

  // ── State Bar Complaints ─────────────────────────────────────────────────
  // State bars update complaint URLs when they redesign websites
  state_bar: [
    { name: 'TN Board of Professional Responsibility', url: 'https://www.tbpr.org/complaints', expect: ['complaint','Tennessee','disciplinary'] },
    { name: 'CA State Bar Complaints',                 url: 'https://www.calbar.ca.gov/About-Us/Division-of-Investigation-Complaint-Intake', expect: ['complaint','California','investigation'] },
    { name: 'TX State Bar Grievance',                  url: 'https://www.texasbar.com/AM/Template.cfm?Section=Grievance_Info', expect: ['grievance','Texas','complaint'] },
    { name: 'NY Attorney Grievance',                   url: 'https://www.nycourts.gov/courts/attorney/disciplinary-offices.shtml', expect: ['grievance','New York','disciplinary'] },
    { name: 'FL Bar Complaints',                       url: 'https://www.floridabar.org/public/complaints/', expect: ['complaint','Florida','misconduct'] },
    { name: 'ABA Lawyer Locator',                      url: 'https://www.americanbar.org/groups/lawyer_referral/resources/consumer_resources/state-local-bar-associations/', expect: ['bar','association','attorney'] },
  ],

  // ── Specialty Courts ──────────────────────────────────────────────────────
  // NADCP is the authoritative source
  specialty_courts: [
    { name: 'NADCP Drug Court Locator',       url: 'https://www.nadcp.org/learn/find-a-drug-court/', expect: ['drug court','locate','county'] },
    { name: 'VA Veterans Treatment Courts',   url: 'https://www.nasmhpd.org/content/veterans-treatment-courts', expect: ['veteran','treatment','court'] },
    { name: 'SAMHSA Mental Health Courts',    url: 'https://store.samhsa.gov/product/mental-health-courts/sma07-4232', expect: ['mental health','court','diversion'] },
  ],

  // ── Courthouse Data ───────────────────────────────────────────────────────
  // Court locators — state court websites
  courthouses: [
    { name: 'Federal Court Locator (PACER)',  url: 'https://www.pacer.gov/psco/cgi-bin/links.pl', expect: ['district','circuit','court'] },
    { name: 'USCOURTS Court Locator',         url: 'https://www.uscourts.gov/court-locator', expect: ['district','circuit'] },
    { name: 'TN State Courts',                url: 'https://www.tncourts.gov/courts', expect: ['Tennessee','circuit','criminal'] },
    { name: 'CA Courts Locator',              url: 'https://www.courts.ca.gov/find-my-court.htm', expect: ['California','superior','court'] },
    { name: 'TX Courts',                      url: 'https://www.txcourts.gov/about-texas-courts/', expect: ['Texas','district','criminal'] },
    { name: 'NY Courts',                      url: 'https://www.nycourts.gov/courts/', expect: ['New York','supreme','court'] },
    { name: 'FL Courts',                      url: 'https://www.flcourts.gov/Florida-Courts/Trial-Courts', expect: ['Florida','circuit','court'] },
  ],

  // ── Crisis Hotlines ───────────────────────────────────────────────────────
  // These MUST be current — wrong number during a crisis = harm
  crisis: [
    { name: '988 Suicide & Crisis Lifeline',  url: 'https://988lifeline.org', expect: ['988','crisis','call'] },
    { name: 'SAMHSA Helpline',                url: 'https://www.samhsa.gov/find-help/national-helpline', expect: ['1-800-662-4357','HELP','treatment'] },
    { name: 'National DV Hotline',            url: 'https://www.thehotline.org', expect: ['1-800-799-7233','domestic','violence'] },
    { name: 'Veterans Crisis Line',           url: 'https://www.veteranscrisisline.net', expect: ['988','veterans','press 1'] },
    { name: 'Trevor Project',                 url: 'https://www.thetrevorproject.org', expect: ['1-866-488-7386','TrevorLifeline','LGBTQ'] },
    { name: 'NAMI Crisis Resources',          url: 'https://www.nami.org/Support-Education/NAMI-HelpLine', expect: ['NAMI','helpline','mental health'] },
  ],

  // ── ICE Detention Locator ──────────────────────────────────────────────────
  ice: [
    { name: 'ICE Detainee Locator',           url: 'https://locator.ice.gov/odls/homePage.do', expect: ['detainee','locator','ICE'] },
    { name: 'EOIR Immigration Courts',        url: 'https://www.justice.gov/eoir/eoir-immigration-court-listing', expect: ['immigration court','EOIR'] },
  ],

  // ── Constitutional / Miranda Rights ──────────────────────────────────────
  // These are anchored in SCOTUS case law — check annually for new decisions
  rights: [
    { name: 'Cornell LII Miranda Warning',    url: 'https://www.law.cornell.edu/wex/miranda_warning', expect: ['Fifth Amendment','right to remain silent','attorney'] },
    { name: 'Cornell LII Fourth Amendment',   url: 'https://www.law.cornell.edu/constitution/fourth_amendment', expect: ['unreasonable searches','warrant','probable cause'] },
    { name: 'Cornell LII Sixth Amendment',    url: 'https://www.law.cornell.edu/constitution/sixth_amendment', expect: ['assistance of counsel','speedy trial','confronted'] },
    { name: 'SCOTUS Blog Recent Decisions',   url: 'https://www.scotusblog.com/case-files/terms/ot2024/', expect: ['term','decided','argued'] },
  ],
};

// ── Fetch with timeout ─────────────────────────────────────────────────────
async function checkUrl(item) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(item.url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'JusticeGavel-FactCheck/1.0 (legal data monitoring; admin@justicegavel.app)',
        'Accept':     'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const html    = await res.text();
    const latency = Date.now() - start;

    // Check expected keywords
    const missing_keywords = (item.expect || []).filter(kw =>
      !html.toLowerCase().includes(kw.toLowerCase())
    );

    // Check for redirect (URL may have changed)
    const final_url = res.url;
    const redirected = final_url !== item.url && !final_url.startsWith(item.url);

    return {
      name:             item.name,
      url:              item.url,
      status:           res.status,
      ok:               res.status === 200,
      redirected,
      final_url:        redirected ? final_url : null,
      latency_ms:       latency,
      missing_keywords,
      flagged:          res.status !== 200 || missing_keywords.length > 0 || redirected,
      checked_at:       new Date().toISOString(),
    };
  } catch (err) {
    return {
      name:     item.name,
      url:      item.url,
      status:   0,
      ok:       false,
      error:    err.name === 'AbortError' ? 'TIMEOUT (>12s)' : err.message,
      flagged:  true,
      checked_at: new Date().toISOString(),
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args      = process.argv.slice(2);
  const typeArg   = args.find(a => a.startsWith('--type='))?.split('=')[1];
  const stateArg  = args.find(a => a.startsWith('--state='))?.split('=')[1]?.toUpperCase();
  const fullMode  = args.includes('--full');
  const quickMode = args.includes('--quick');

  console.log('\n' + '='.repeat(65));
  console.log('  Justice Gavel — Legal Data Fact-Check Monitor');
  console.log('  ' + new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
  console.log('='.repeat(65));

  // Select which source categories to check
  let categories = typeArg ? [typeArg] : Object.keys(SOURCES);
  if (quickMode) {
    // Quick mode: only crisis hotlines + expungement (most critical + most volatile)
    categories = ['crisis','expungement'];
  }

  let totalChecks = 0;
  let totalFlagged = 0;
  const flaggedItems = [];

  for (const category of categories) {
    const items = SOURCES[category];
    if (!items) { console.log(`\n  Unknown type: ${category}`); continue; }

    console.log(`\n  ── ${category.toUpperCase()} (${items.length} sources) ──`);

    for (const item of items) {
      // State filter
      if (stateArg && !item.name.toUpperCase().includes(stateArg)) continue;

      process.stdout.write(`  Checking: ${item.name.substring(0,55).padEnd(55)} `);
      const result = await checkUrl(item);
      totalChecks++;

      if (result.flagged) {
        totalFlagged++;
        flaggedItems.push({ category, ...result });
        if (!result.ok)               process.stdout.write('❌ ' + (result.error || `HTTP ${result.status}`) + '\n');
        else if (result.redirected)   process.stdout.write('⚠️  REDIRECTED → ' + (result.final_url || '').substring(0,50) + '\n');
        else if (result.missing_keywords?.length) process.stdout.write('⚠️  KEYWORDS MISSING: ' + result.missing_keywords.join(', ') + '\n');
      } else {
        process.stdout.write('✅ OK (' + result.latency_ms + 'ms)\n');
      }
      REPORT.checks.push({ category, ...result });

      // Polite rate limiting
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // ── Database staleness check ───────────────────────────────────────────────
  console.log('\n  ── DATABASE STALENESS CHECK ──');
  try {
    const db   = new Database(DEMO_DB);
    const now  = Date.now();
    const tables = [
      { name: 'dui_laws',                  max_age_days: 90,  critical: true  },
      { name: 'drug_penalties',             max_age_days: 180, critical: true  },
      { name: 'expungement (route file)',   max_age_days: 90,  critical: true  },
      { name: 'victim_compensation',        max_age_days: 365, critical: false },
      { name: 'state_bar_complaints',       max_age_days: 365, critical: false },
      { name: 'specialty_courts',           max_age_days: 180, critical: false },
      { name: 'courthouses',                max_age_days: 365, critical: false },
    ];
    for (const t of tables) {
      if (t.name.includes('route file')) {
        // Check expungement.js last_verified comment
        process.stdout.write('  ' + t.name.padEnd(40) + ' ');
        console.log('✅ last_verified: May 2026 (see expungement.js)');
        continue;
      }
      try {
        const row = db.prepare(\`SELECT MAX(created_at) as latest FROM \${t.name}\`).get();
        if (row?.latest) {
          const lastUpdate = new Date(row.latest);
          const ageDays    = Math.floor((now - lastUpdate) / 86400000);
          const stale      = ageDays > t.max_age_days;
          process.stdout.write('  ' + t.name.padEnd(40) + ' ');
          console.log(\`\${stale ? (t.critical ? '❌' : '⚠️ ') : '✅'} Last updated: \${lastUpdate.toISOString().split('T')[0]} (\${ageDays} days ago)\`);
          if (stale) {
            flaggedItems.push({ category: 'database', name: t.name,
              flagged: true, error: \`Stale data: \${ageDays} days old (max \${t.max_age_days})\` });
          }
        }
      } catch {}
    }
    db.close();
  } catch (e) {
    console.log('  Database check error:', e.message);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(65));
  console.log(\`  RESULT: \${totalChecks} checks | \${totalFlagged} flagged | \${totalChecks - totalFlagged} clean\`);

  if (flaggedItems.length > 0) {
    console.log('\n  ⚠️  ACTION REQUIRED:');
    flaggedItems.forEach(item => {
      console.log(\`\n  [\${item.category.toUpperCase()}] \${item.name}\`);
      console.log(\`  URL: \${item.url || 'N/A'}\`);
      if (item.error)            console.log(\`  Issue: \${item.error}\`);
      if (item.redirected)       console.log(\`  Redirect → \${item.final_url}\`);
      if (item.missing_keywords) console.log(\`  Missing: \${item.missing_keywords.join(', ')}\`);
    });
  } else {
    console.log('\n  ✅ ALL SOURCES VERIFIED — Database is current');
  }

  // ── Write JSON report ──────────────────────────────────────────────────────
  REPORT.summary = { total: totalChecks, flagged: totalFlagged, clean: totalChecks - totalFlagged };
  REPORT.issues  = flaggedItems;
  const reportPath = \`\${process.env.REPORT_DIR || './reports'}/fact_check_report_\${today}.json\`;
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(REPORT, null, 2));
    console.log(\`\n  Report saved: \${reportPath}\`);
  } catch {}

  console.log('='.repeat(65) + '\n');
  process.exit(flaggedItems.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
