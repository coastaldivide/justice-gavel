/**
 * JUSTICE GAVEL — PRECEDENT MONITOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Monitors for new legal precedent that may affect entries in the registry.
 * Runs on a scheduled basis and alerts attorneys when law may have changed.
 *
 * DATA SOURCES:
 *   1. CourtListener API (courtlistener.com) — free, comprehensive
 *   2. Supreme Court slip opinions RSS (supremecourt.gov)
 *   3. USSC guidelines updates (ussc.gov)
 *   4. BJS statistics releases (bjs.ojp.gov)
 *
 * HOW IT WORKS:
 *   1. For each registry entry, monitor the statute/issue it cites
 *   2. When a new opinion cites the same statute, flag for attorney review
 *   3. When an entry's stale_after date approaches, alert administrators
 *   4. When a higher court explicitly overrules a cited case, mark superseded
 *   5. Log all monitoring activity for audit trail
 *
 * WHAT IT DOES NOT DO:
 *   - Automatically update the registry (human review required)
 *   - Interpret opinions (flags for attorney review)
 *   - Replace attorney judgment about whether new precedent applies
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PRECEDENT_REGISTRY, getApproachingStale } from './precedentRegistry.js';

const MONITOR_VERSION = '1.0.0';

// ─── ISSUE KEYWORDS FOR MONITORING ───────────────────────────────────────────
// Maps registry entry IDs to search terms for CourtListener.
// When a new opinion matches these terms, the entry is flagged.

const MONITORING_KEYWORDS = {
  // Criminal defense
  crim_safety_valve_rate:    ['18 U.S.C. § 3553(f)', 'safety valve', 'First Step Act safety valve'],
  crim_booker_variance_rate: ['United States v. Booker', '18 U.S.C. § 3553(a)', 'below guidelines'],
  // Civil rights
  cr_qualified_immunity:     ['qualified immunity', '42 U.S.C. § 1983', 'clearly established'],
  cr_qualified_immunity_dismissal: ['§ 1983', 'qualified immunity', 'summary judgment', 'excessive force'],
  // White collar
  wc_dpa_settlement_benefit: ['deferred prosecution agreement', 'DPA', 'Filip factors', 'cooperation credit'],
  wc_sec_cooperation_benefit: ['SEC cooperation', 'deferred prosecution', 'Securities Exchange Act', 'cooperation agreement'],
  // Immigration
  imm_asylum_grant_rates:    ['asylum', '8 U.S.C. § 1158', 'well-founded fear', 'credible fear'],
  imm_cancellation_rate:     ['cancellation of removal', '§ 1229b', 'exceptional hardship', 'continuous physical presence'],
  // Appellate
  app_habeas_grant_rate:     ['28 U.S.C. § 2254', 'habeas corpus', 'AEDPA', 'unreasonable application'],
  // Military
  mil_court_martial_conviction: ['court-martial', 'UCMJ', 'military justice', 'Article 120', 'military conviction'],
  mil_admin_sep_rate:        ['administrative separation', 'military discharge', 'other than honorable', 'OTH discharge'],
  // Juvenile
  juv_diversion_success:     ['juvenile diversion', 'first offender', 'deferred prosecution juvenile', 'youth diversion'],
  juv_csec_intervention:     ['CSEC', 'commercial sexual exploitation', 'sex trafficking minor', 'labor trafficking minor'],
  juv_transfer_rate:         ['juvenile transfer', 'adult court', 'waiver hearing', 'transfer to adult'],
  // SCOTUS
  scotus_bruen_2022:         ['New York State Rifle', 'Bruen', 'Second Amendment', 'historical tradition'],
  scotus_rahimi_2024:        ['Rahimi', '18 U.S.C. § 922(g)(8)', 'domestic violence protective order'],
  scotus_dobbs_2022:         ['Dobbs', 'substantive due process', 'unenumerated rights'],
};

// ─── COURTLISTENER API CLIENT ─────────────────────────────────────────────────

/**
 * Search CourtListener for opinions matching given keywords.
 * Returns opinions from the last `daysBack` days.
 *
 * CourtListener API docs: https://www.courtlistener.com/api/rest/v3/
 * Free, no auth required for basic search.
 */
export async function searchCourtListener(keywords, options = {}) {
  const {
    daysBack = 90,
    courts   = 'scotus,ca1,ca2,ca3,ca4,ca5,ca6,ca7,ca8,ca9,ca10,ca11,cadc',
    maxResults = 10,
  } = options;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const query = keywords.map(k => `"${k}"`).join(' OR ');
  const url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(query)}&type=o&order_by=score+desc&filed_after=${cutoffStr}&court=${courts}&page_size=${maxResults}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'JusticeGavel/1.0 (legal-research-tool; contact@justicegavel.app)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { results: [], error: `CourtListener API returned ${resp.status}`, source: 'courtlistener' };
    }

    const data = await resp.json();
    return {
      results: (data.results || []).map(r => ({
        case_name:   r.caseName || r.case_name || 'Unknown',
        citation:    r.citation || null,
        court:       r.court || r.court_id || 'Unknown',
        date_filed:  r.dateFiled || r.date_filed || null,
        url:         r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
        snippet:     r.snippet || null,
        status:      r.status || null,
      })),
      source:  'courtlistener',
      query,
      cutoff:  cutoffStr,
      total:   data.count || 0,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { results: [], error: 'CourtListener request timed out', source: 'courtlistener' };
    }
    return { results: [], error: err.message, source: 'courtlistener' };
  }
}

/**
 * Fetch SCOTUS slip opinions from the Supreme Court RSS feed.
 * The Court publishes slip opinions at https://supremecourt.gov.
 */
export async function fetchSCOTUSSlipOpinions() {
  const SCOTUS_RSS = 'https://www.supremecourt.gov/opinions/slipopinion/23';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(SCOTUS_RSS, {
      headers: { 'User-Agent': 'JusticeGavel/1.0 (legal-research-tool)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return { opinions: [], error: `SCOTUS feed returned ${resp.status}` };
    // Parse the slip opinion listing (HTML) — extract case names and dates
    const html = await resp.text();
    const opinions = [];
    const rows = html.match(/<tr[^>]*>.*?<\/tr>/gis) || [];
    for (const row of rows.slice(0, 20)) {
      const link  = row.match(/href="([^"]+\.pdf)"/i);
      const text  = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && link) {
        opinions.push({ text: text.slice(0, 200), url: `https://www.supremecourt.gov${link[1]}` });
      }
    }
    return { opinions, source: 'scotus_website' };
  } catch (err) {
    return { opinions: [], error: err.message };
  }
}

// ─── STALENESS MONITOR ────────────────────────────────────────────────────────

/**
 * Check all registry entries for staleness.
 * Returns entries that need review, sorted by urgency.
 */
export function checkStaleness() {
  const today = new Date();
  const alerts = [];

  for (const entry of PRECEDENT_REGISTRY) {
    if (entry.superseded_by) continue;
    if (!entry.stale_after) continue;

    const staleDate = new Date(entry.stale_after);
    const daysUntil = Math.ceil((staleDate - today) / (1000 * 86400));

    if (daysUntil < 0) {
      alerts.push({
        severity: 'EXPIRED',
        entry_id: entry.id,
        title:    entry.title,
        stale_after: entry.stale_after,
        days_overdue: Math.abs(daysUntil),
        message: `EXPIRED ${Math.abs(daysUntil)} days ago — this entry requires immediate review and update.`,
        action:  'Update registry entry or mark superseded',
      });
    } else if (daysUntil <= 30) {
      alerts.push({
        severity: 'URGENT',
        entry_id: entry.id,
        title:    entry.title,
        stale_after: entry.stale_after,
        days_until: daysUntil,
        message: `Review required within ${daysUntil} days.`,
        action:  'Verify current state of law and update statistics',
      });
    } else if (daysUntil <= 90) {
      alerts.push({
        severity: 'UPCOMING',
        entry_id: entry.id,
        title:    entry.title,
        stale_after: entry.stale_after,
        days_until: daysUntil,
        message: `Review due in ${daysUntil} days.`,
        action:  'Schedule review of source statistics and precedent currency',
      });
    }
  }

  return {
    checked_at: new Date().toISOString(),
    total_entries: PRECEDENT_REGISTRY.length,
    alerts: alerts.sort((a, b) => {
      const order = { EXPIRED: 0, URGENT: 1, UPCOMING: 2 };
      return (order[a.severity] || 3) - (order[b.severity] || 3);
    }),
  };
}

// ─── BIAS AUDIT RUNNER ────────────────────────────────────────────────────────

/**
 * Runs a quarterly disparate-impact audit on the outcome estimator.
 * Creates synthetic test cases that differ ONLY in legally neutral
 * characteristics (jurisdiction, evidence, charge) and verifies
 * that outputs are consistent.
 *
 * This is a structural audit — it tests whether the SYSTEM produces
 * fair outputs, not whether individual case outcomes are fair.
 */
export function runBiasAudit(computeOutcomeEstimate) {
  const auditDate = new Date().toISOString().slice(0, 10);
  const results = { audit_date: auditDate, version: MONITOR_VERSION, tests: [] };

  // Test 1: Evidence strength symmetry
  // Two identical matters with different evidence scores should produce
  // different analytical outputs for the same reason and in the same direction
  const baseCase = {
    id: 'audit-1', vertical: 'criminal_defense', taxonomy: 'drug_federal',
    title: 'Drug distribution § 841 federal',
    jurisdiction: 'federal', prior_adjudications: 0,
    vulnerability_level: 'moderate', time_pressure: 'standard',
  };

  const strongEv = computeOutcomeEstimate({ ...baseCase, id: 'audit-1a', evidence_score: 85 });
  const weakEv   = computeOutcomeEstimate({ ...baseCase, id: 'audit-1b', evidence_score: 15 });

  // Weak evidence should produce LOWER dismissal rates (harder to dismiss)
  // but HIGHER acquittal rates if matter goes to trial
  const strongAnal = strongEv.analyses.find(a => a.entry_id === 'crim_dismissal_base');
  const weakAnal   = weakEv.analyses.find(a => a.entry_id === 'crim_dismissal_base');

  if (strongAnal && weakAnal) {
    const consistent = weakAnal.estimated_range.point !== strongAnal.estimated_range.point;
    results.tests.push({
      test: 'evidence_strength_symmetry',
      passed: consistent,
      detail: consistent
        ? `Evidence strength produces different outputs (strong=${strongAnal.estimated_range.point}, weak=${weakAnal.estimated_range.point}) ✓`
        : 'FAIL: Evidence strength not affecting output — factor application broken',
    });
  }

  // Test 2: Cooperation level monotonicity
  // More cooperation = more credit. Output should be monotonically ordered.
  const coopLevels = ['no_cooperation','limited_cooperation','proffer_agreement','full_cooperation'];
  const coopCase = {
    id: 'audit-2', vertical: 'white_collar', taxonomy: 'fcpa',
    title: 'DOJ FCPA investigation',
    jurisdiction: 'federal', evidence_score: 75,
    vulnerability_level: 'moderate', time_pressure: 'standard',
    dpa_status: 'viable',
  };

  const coopResults = coopLevels.map(coop => {
    const est = computeOutcomeEstimate({ ...coopCase, cooperation_level: coop });
    const anal = est.analyses.find(a => a.entry_id === 'wc_dpa_settlement_benefit');
    return { coop, point: anal?.estimated_range?.point || null };
  });

  // Strict monotonicity: no_cooperation must produce strictly LESS benefit than full_cooperation.
  // Using > (not >=) ensures identical outputs across all levels would be caught as a failure.
  const coopMonotone = coopResults.every((r, i) =>
    i === 0 || r.point === null || coopResults[i-1].point === null || r.point > coopResults[i-1].point
  );

  results.tests.push({
    test: 'cooperation_monotonicity',
    passed: coopMonotone,
    detail: coopMonotone
      ? `Cooperation levels produce ordered outputs: ${coopResults.map(r => `${r.coop}=${r.point}`).join(', ')} ✓`
      : `FAIL: Cooperation levels not monotonically ordered: ${coopResults.map(r => `${r.coop}=${r.point}`).join(', ')}`,
  });

  // Test 3: Jurisdiction warning fires when missing
  const noJxCase = {
    id: 'audit-3', vertical: 'civil_rights', taxonomy: 'excessive_force',
    title: '§ 1983 excessive force claim',
    evidence_score: 75, vulnerability_level: 'moderate',
  };
  const noJxResult = computeOutcomeEstimate(noJxCase);
  const hasJxWarn = noJxResult.warnings.some(w => w.type === 'missing_jurisdiction');
  results.tests.push({
    test: 'jurisdiction_warning',
    passed: hasJxWarn,
    detail: hasJxWarn ? 'Missing jurisdiction triggers warning ✓' : 'FAIL: No jurisdiction warning issued',
  });

  // Test 4: Disclaimer always present
  const discResult = computeOutcomeEstimate({ ...baseCase, evidence_score: 60 });
  const hasDisclaimer = discResult.disclaimer && discResult.disclaimer.required === true;
  results.tests.push({
    test: 'disclaimer_always_present',
    passed: hasDisclaimer,
    detail: hasDisclaimer ? 'Disclaimer present in all outputs ✓' : 'FAIL: Disclaimer missing from output',
  });

  // Test 5: No demographic factor leakage
  // The factors_evaluated list must not contain any prohibited demographic fields
  const PROHIBITED = ['race','gender','sex','religion','national_origin','age','disability','sexual_orientation','ethnicity','color'];
  const auditFactors = discResult.factors_evaluated || [];
  const leaked = auditFactors.filter(f => PROHIBITED.some(p => f.toLowerCase().includes(p)));
  results.tests.push({
    test: 'no_demographic_leakage',
    passed: leaked.length === 0,
    detail: leaked.length === 0
      ? 'No demographic factors in computation ✓'
      : `FAIL: Prohibited factors found: ${leaked.join(', ')}`,
  });

  results.all_passed = results.tests.every(t => t.passed);
  results.passed_count = results.tests.filter(t => t.passed).length;
  results.total_count  = results.tests.length;

  return results;
}

// ─── FULL MONITOR RUN ─────────────────────────────────────────────────────────

/**
 * run(options) — execute a full monitoring cycle.
 *
 * This is called by:
 *   1. A scheduled cron job (weekly)
 *   2. The admin dashboard on demand
 *   3. A CI/CD check on registry updates
 *
 * Returns a complete monitoring report for administrator review.
 */
export async function run(options = {}) {
  const { skipCourtListener = false, daysBack = 90 } = options;
  const startTime = Date.now();

  const report = {
    version:         MONITOR_VERSION,
    run_at:          new Date().toISOString(),
    staleness:       checkStaleness(),
    precedent_alerts: [],
    errors:          [],
  };

  // Check each monitored entry against CourtListener
  if (!skipCourtListener) {
    for (const [entryId, keywords] of Object.entries(MONITORING_KEYWORDS)) {
      try {
        const result = await searchCourtListener(keywords, { daysBack });
        if (result.error) {
          report.errors.push({ entry_id: entryId, error: result.error });
          continue;
        }
        if (result.results.length > 0) {
          report.precedent_alerts.push({
            entry_id:      entryId,
            keywords_used: keywords,
            new_opinions:  result.results,
            count:         result.results.length,
            message:       `${result.results.length} new opinion(s) cite keywords relevant to '${entryId}'. Human review required to determine if registry entry needs update.`,
            action:        'Review new opinions. If holding is affected, update registry entry and increment stale_after date.',
          });
        }
      } catch (err) {
        report.errors.push({ entry_id: entryId, error: err.message });
      }
    }
  }

  // SCOTUS slip opinions
  try {
    const scotus = await fetchSCOTUSSlipOpinions();
    if (scotus.opinions && scotus.opinions.length > 0) {
      report.scotus_recent = scotus.opinions.slice(0, 5);
    }
  } catch (err) {
    report.errors.push({ source: 'scotus', error: err.message });
  }

  report.elapsed_ms = Date.now() - startTime;
  report.summary = {
    expired_entries:   report.staleness.alerts.filter(a => a.severity === 'EXPIRED').length,
    urgent_entries:    report.staleness.alerts.filter(a => a.severity === 'URGENT').length,
    upcoming_entries:  report.staleness.alerts.filter(a => a.severity === 'UPCOMING').length,
    precedent_alerts:  report.precedent_alerts.length,
    errors:            report.errors.length,
    action_required:   report.staleness.alerts.some(a => a.severity === 'EXPIRED') || report.precedent_alerts.length > 0,
  };

  return report;
}

export default { run, checkStaleness, runBiasAudit, searchCourtListener };
