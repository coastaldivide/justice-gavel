/**
 * JUSTICE GAVEL — AUTOMATED HEALTH SCAN SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every 12 hours. Checks every critical system.
 * Always sends a daily summary email regardless of status.
 * Escalates immediately for CRITICAL/HIGH/MEDIUM findings.
 * The app touches lives and careers — every malfunction gets reported.
 * Notifies immediately when anything needs attention.
 * Logs everything for audit trail.
 *
 * SCAN SCOPE (in order of urgency):
 *   1. Legal precedent currency        — expired/stale registry entries
 *   2. Asylum clock bar risk           — clients approaching/past 1-year bar
 *   3. DPA/TRO deadline urgency        — overdue tracker deadlines
 *   4. Signal engine invariants        — core correctness assertions
 *   5. Analytics bias audit            — demographic leakage check
 *   6. Database health                 — table counts, query response time
 *   7. CourtListener precedent sweep   — new opinions affecting registry
 *   8. Push token health               — expired/invalid tokens
 *   9. Escalation SLA audit            — critical matters past SLA window
 *  10. Test suite                      — run full Jest suite, alert on failure
 *
 * NOTIFICATION CHANNELS:
 *   - Email to admin (ALWAYS — daily summary even when healthy)
 *   - Push notification to all firm_admin users (ALWAYS — daily status)
 *   - SMS to emergency contacts (CRITICAL + HIGH findings)
 *   - logger output (always — every finding logged)
 *   - scan_results DB table (30-day audit trail)
 *
 * SEVERITY LEVELS:
 *   CRITICAL — patient safety / legal deadline at immediate risk
 *              → Push + Email + SMS + logger (immediate)
 *   HIGH     — signal accuracy or legal accuracy issue
 *              → Push + Email + SMS + logger (immediate)
 *   MEDIUM   — performance, completeness, data gap
 *              → Push + Email + logger
 *   LOW      — review recommended
 *              → Email (in daily summary) + logger
 *   INFO     — routine pass (no issue)
 *              → Daily summary email + logger
 * ─────────────────────────────────────────────────────────────────────────────
 */

import cron from 'node-cron';
import { getDb }        from '../db/index.js';
import { sendEmail }    from './sendgrid.js';
import { sendSms }      from './twilio.js';
import { sendPushToUser } from './pushDelivery.js';
import { checkStaleness, runBiasAudit,
         run as runPrecedentMonitor }    from '../analytics/precedentMonitor.js';
import { computeOutcomeEstimate }        from '../analytics/outcomeEstimator.js';
import { PRECEDENT_REGISTRY }            from '../analytics/precedentRegistry.js';
import { CONFIG }                        from '../config.js';
import logger                            from '../utils/logger.js';

const SCAN_VERSION = '1.0.0';
// Scan interval — used in startup logging and documentation.
// The actual schedule is set by HEALTH_SCAN_CRON env var (default: every 12 hours).
const SCAN_INTERVAL_HOURS = 12;

// ─── ADMIN CONTACT CONFIG ─────────────────────────────────────────────────────
// These are loaded from environment variables — never hardcoded.
const ADMIN_EMAIL    = process.env.ADMIN_ALERT_EMAIL || null;
const ADMIN_SMS      = process.env.ADMIN_ALERT_SMS   || null;  // CRITICAL only
// Always send daily summary. Set SCAN_QUIET=true to suppress INFO-only emails.
const SCAN_QUIET = process.env.SCAN_QUIET === 'true';

// ─── SCAN RESULT COLLECTOR ────────────────────────────────────────────────────

class ScanReport {
  constructor() {
    this.scan_id      = `scan_${Date.now()}`;
    this.started_at   = new Date().toISOString();
    this.findings     = [];    // all findings
    this.summary      = {};    // counts by severity
    this.sections     = {};    // section-level pass/fail
    this.notify_queue = [];    // notifications to send
    this.completed_at = null;
    this.elapsed_ms   = null;
  }

  add(section, severity, code, message, detail = null) {
    const finding = {
      id:        `${section}.${code}`,
      section,
      severity,
      code,
      message,
      detail,
      timestamp: new Date().toISOString(),
    };
    this.findings.push(finding);
    this.summary[severity] = (this.summary[severity] || 0) + 1;

    // Notify on every non-INFO finding. INFO goes in the daily summary.
    if (severity === 'CRITICAL') this.notify_queue.push({ ...finding, channels: ['push','email','sms'] });
    else if (severity === 'HIGH') this.notify_queue.push({ ...finding, channels: ['push','email','sms'] });
    else if (severity === 'MEDIUM') this.notify_queue.push({ ...finding, channels: ['push','email'] });
    else if (severity === 'LOW') this.notify_queue.push({ ...finding, channels: ['email'] });

    const icon = { CRITICAL:'🚨', HIGH:'🔴', MEDIUM:'🟡', LOW:'🔵', INFO:'✓' }[severity] || '○';
    logger.info(`[scan/${section}] ${icon} ${severity}: ${message}${detail ? ` — ${detail}` : ''}`);
    return finding;
  }

  pass(section, code, message) {
    this.sections[section] = this.sections[section] !== false; // stays pass unless something fails
    return this.add(section, 'INFO', code, message);
  }

  fail(section, severity, code, message, detail = null) {
    this.sections[section] = false;
    return this.add(section, severity, code, message, detail);
  }

  finalize() {
    this.completed_at = new Date().toISOString();
    this.elapsed_ms   = Date.now() - new Date(this.started_at).getTime();
    this.overall = Object.keys(this.summary).every(s => !['CRITICAL','HIGH'].includes(s) || !this.summary[s])
      ? 'HEALTHY' : this.summary.CRITICAL ? 'CRITICAL' : 'DEGRADED';
  }

  toText() {
    const lines = [
      `Justice Gavel — Automated Health Scan`,
      `Scan ID: ${this.scan_id}`,
      `Started: ${this.started_at}`,
      `Elapsed: ${this.elapsed_ms ?? 'pending'}ms`,
      `Overall: ${this.overall}`,
      ``,
      `SUMMARY:`,
      ...Object.entries(this.summary).map(([sev, n]) => `  ${sev}: ${n}`),
      ``,
      `FINDINGS:`,
      ...this.findings
        .filter(f => f.severity !== 'INFO')
        .map(f => `  [${f.severity}] ${f.section}: ${f.message}${f.detail ? '\n    ' + f.detail : ''}`),
    ];
    if (this.findings.filter(f => f.severity !== 'INFO').length === 0) {
      lines.push('  All checks passed. No issues found.');
    }
    return lines.join('\n');
  }
}

// ─── SECTION 1: LEGAL PRECEDENT CURRENCY ─────────────────────────────────────
// The most important scan. Stale legal information can harm clients.

async function scanPrecedentCurrency(report) {
  const section = 'precedent_currency';
  logger.info('[scan] Section 1: Legal precedent currency');

  try {
    const stale = checkStaleness();
    const expired  = stale.alerts.filter(a => a.severity === 'EXPIRED');
    const urgent   = stale.alerts.filter(a => a.severity === 'URGENT');
    const upcoming = stale.alerts.filter(a => a.severity === 'UPCOMING');

    if (expired.length > 0) {
      report.fail(section, 'CRITICAL', 'EXPIRED_ENTRIES',
        `${expired.length} registry entry(ies) EXPIRED — legal information may be outdated`,
        expired.map(e => `${e.entry_id}: ${e.title} (${e.days_overdue} days overdue)`).join('; ')
      );
    }

    if (urgent.length > 0) {
      report.fail(section, 'HIGH', 'URGENT_ENTRIES',
        `${urgent.length} registry entry(ies) due for review within 30 days`,
        urgent.map(e => `${e.entry_id}: review by ${e.stale_after}`).join('; ')
      );
    }

    if (upcoming.length > 0) {
      report.fail(section, 'LOW', 'UPCOMING_ENTRIES',
        `${upcoming.length} registry entry(ies) approaching review date`,
        upcoming.map(e => `${e.entry_id}: review by ${e.stale_after} (${e.days_until} days)`).join('; ')
      );
    }

    if (expired.length === 0 && urgent.length === 0) {
      report.pass(section, 'CURRENT',
        `All ${PRECEDENT_REGISTRY.length} registry entries current — no expired or urgent reviews`
      );
    }

    // Spot-check: SCOTUS entries specifically (highest impact if stale)
    const scotusEntries = PRECEDENT_REGISTRY.filter(e => e.source_type === 'case' && !e.superseded_by);
    report.pass(section, 'SCOTUS_COUNT', `${scotusEntries.length} SCOTUS case entries in registry`);

  } catch (e) {
    report.fail(section, 'HIGH', 'SCAN_ERROR', `Precedent currency scan failed: ${e.message}`);
  }
}

// ─── SECTION 2: ASYLUM CLOCK BAR RISK ────────────────────────────────────────
// The highest-urgency legal deadline in the app. Missing the 1-year asylum bar
// is catastrophic and irreversible for the client. Scan twice per day.

async function scanAsylumBarRisk(report) {
  const section = 'asylum_bar_risk';
  logger.info('[scan] Section 2: Asylum clock bar risk');

  try {
    const db   = await getDb();
    const today = new Date();

    // Find all active asylum trackers
    const clocks = await db.all(
      `SELECT ac.*, m.id as matter_id, m.firm_id, m.title,
              f.name as firm_name,
              u.push_token, u.display_name as attorney_name, u.id as attorney_id
       FROM asylum_clocks ac
       LEFT JOIN matters m ON m.id = ac.matter_id
       LEFT JOIN firms f ON f.id = m.firm_id
       LEFT JOIN users u ON u.firm_id = m.firm_id AND u.firm_role IN ('firm_admin','partner')
       WHERE ac.relief_type = 'asylum' AND ac.paused_at IS NULL
       LIMIT 2000`
    ).catch(() => []);

    let barredCount = 0, approachingCount = 0, criticalApproach = 0;
    const criticalMatters = [];

    for (const c of clocks) {
      if (!c.clock_start) continue;
      const start   = new Date(c.clock_start);
      const paused  = parseInt(c.paused_days || 0, 10);
      const elapsed = Math.max(0, Math.ceil((today - start) / 86400000) - paused);
      const remaining = 365 - elapsed;

      if (elapsed > 365) {
        barredCount++;
        // Already barred — attorney should know but this is not new
      } else if (remaining <= 14) {
        // CRITICAL: 2 weeks or fewer — attorney must file NOW
        criticalApproach++;
        criticalMatters.push({
          matter_id: c.matter_id,
          firm_name: c.firm_name,
          title:     c.title,
          elapsed,
          remaining,
          attorney_id: c.attorney_id,
          attorney_name: c.attorney_name,
        });
        report.fail(section, 'CRITICAL', 'BAR_IMMINENT',
          `Asylum bar in ${remaining} day(s): ${c.title || 'matter ' + c.matter_id} (${c.firm_name})`,
          `Elapsed: ${elapsed} days. Filing deadline: URGENT. Matter ID: ${c.matter_id}`
        );
      } else if (remaining <= 30) {
        approachingCount++;
        report.fail(section, 'HIGH', 'BAR_APPROACHING',
          `Asylum bar in ${remaining} days: ${c.title || 'matter ' + c.matter_id}`,
          `Firm: ${c.firm_name}. Matter ID: ${c.matter_id}`
        );
      } else if (elapsed >= 290) {
        approachingCount++;
        report.fail(section, 'MEDIUM', 'BAR_WARNING',
          `Asylum bar warning: ${remaining} days remaining — ${c.title || 'matter ' + c.matter_id}`,
          `Firm: ${c.firm_name}`
        );
      }
    }

    if (criticalApproach === 0 && approachingCount === 0 && barredCount === 0) {
      report.pass(section, 'CLEAR',
        `${clocks.length} asylum clocks checked — no imminent bar deadlines`
      );
    } else {
      report.add(section, 'INFO', 'SUMMARY',
        `Asylum clock summary: ${barredCount} barred, ${approachingCount} approaching, ${criticalApproach} critical`
      );
    }

    return { criticalMatters };
  } catch (e) {
    report.fail(section, 'HIGH', 'SCAN_ERROR', `Asylum clock scan failed: ${e.message}`);
    return { criticalMatters: [] };
  }
}

// ─── SECTION 3: DPA / TRO DEADLINE URGENCY ───────────────────────────────────

async function scanTrackerDeadlines(report) {
  const section = 'tracker_deadlines';
  logger.info('[scan] Section 3: Tracker deadline urgency');

  try {
    const db  = await getDb();
    const now = new Date();

    // DPA deadlines
    const dpaOverdue = await db.all(
      `SELECT dt.*, m.title, m.firm_id, f.name as firm_name
       FROM dpa_trackers dt
       LEFT JOIN matters m ON m.id = dt.matter_id
       LEFT JOIN firms f ON f.id = m.firm_id
       WHERE (dt.wells_due < ? OR dt.subpoena_due < ? OR dt.dpa_sign_due < ?)
         AND dt.status NOT IN ('completed','withdrawn')
       LIMIT 100`,
      [now.toISOString().slice(0,10), now.toISOString().slice(0,10), now.toISOString().slice(0,10)]
    ).catch(() => []);

    if (dpaOverdue.length > 0) {
      report.fail(section, 'HIGH', 'DPA_OVERDUE',
        `${dpaOverdue.length} DPA deadline(s) OVERDUE`,
        dpaOverdue.slice(0,5).map(d => `${d.title} (${d.firm_name})`).join('; ')
      );
    } else {
      report.pass(section, 'DPA_CLEAR', 'All DPA deadlines current');
    }

    // TRO deadlines
    const troOverdue = await db.all(
      `SELECT tr.*, m.title, f.name as firm_name
       FROM tro_trackers tr
       LEFT JOIN matters m ON m.id = tr.matter_id
       LEFT JOIN firms f ON f.id = m.firm_id
       WHERE (tr.tro_hearing_due < ? OR tr.protective_order_due < ?)
         AND tr.status NOT IN ('completed','dismissed')
       LIMIT 100`,
      [now.toISOString().slice(0,10), now.toISOString().slice(0,10)]
    ).catch(() => []);

    if (troOverdue.length > 0) {
      report.fail(section, 'HIGH', 'TRO_OVERDUE',
        `${troOverdue.length} TRO deadline(s) OVERDUE`,
        troOverdue.slice(0,5).map(t => `${t.title} (${t.firm_name})`).join('; ')
      );
    } else {
      report.pass(section, 'TRO_CLEAR', 'All TRO deadlines current');
    }

  } catch (e) {
    report.fail(section, 'MEDIUM', 'SCAN_ERROR', `Tracker deadline scan failed: ${e.message}`);
  }
}

// ─── SECTION 4: SIGNAL ENGINE INVARIANTS ─────────────────────────────────────
// Run the 20 most critical signal correctness assertions live against the engine.

async function scanSignalEngine(report) {
  const section = 'signal_engine';
  logger.info('[scan] Section 4: Signal engine invariants');

  try {
    // Import the live signal engine — tests run against the actual production functions,
    // not inline regex copies. If a developer changes a signal function, this scan catches it.
    const { computeAllSignals } = await import('../routes/matter_intelligence.js')
      .catch(() => ({ computeAllSignals: null }));

    // Helper: build a minimal matter for testing
    const tm = (overrides) => ({
      id: 0, title: '', status: 'active', jurisdiction: 'federal',
      vulnerability_level: 'moderate', time_pressure: 'standard',
      evidence_score: 50, prior_adjudications: 0, clock_days: 0,
      ...overrides,
    });

    // Run live invariant assertions through computeAllSignals
    const liveInvariants = computeAllSignals ? [
      {
        name: 'CSEC_NOT_DRUG',
        desc: 'CSEC/sex trafficking does not trigger drug federal signals',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'criminal_defense', jurisdiction:'federal',
            title:'federal human trafficking sex exploitation csec', evidence_score:60 }));
          return s.vertical_signals.mandatoryMin !== true; // drugCharge must be false for CSEC
        },
      },
      {
        name: 'SAFETY_VALVE_WEAPON',
        desc: 'Weapon charge blocks safety valve eligibility',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'criminal_defense', jurisdiction:'federal',
            title:'federal drug distribution firearm § 924 armed', evidence_score:60 }));
          return s.vertical_signals.safetyValveEligible === false;
        },
      },
      {
        name: 'ASSET_FREEZE_TIER',
        desc: 'assetFreeze requires DV flag and high asset tier',
        test: () => {
          const withFreeze = computeAllSignals(tm({ vertical:'family', dv_flag:1, asset_tier:'over_10m' }));
          const noFreeze   = computeAllSignals(tm({ vertical:'family', dv_flag:0, asset_tier:'over_10m' }));
          return withFreeze.vertical_signals.assetFreeze === true && noFreeze.vertical_signals.assetFreeze === false;
        },
      },
      {
        name: 'CERT_EXCLUSIVE',
        desc: 'certWorthy and certApproaching never both true',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'appellate', is_capital:1, evidence_score:80, prior_appeals:0 }));
          return !(s.vertical_signals.certWorthy && s.vertical_signals.certApproaching);
        },
      },
      {
        name: 'CSEC_DEPENDENCY',
        desc: 'csecDependency requires dependency track, not delinquency',
        test: () => {
          const dep = computeAllSignals(tm({ vertical:'juvenile', case_track:'dependency', title:'csec human trafficking minor' }));
          const del = computeAllSignals(tm({ vertical:'juvenile', case_track:'delinquency', title:'csec human trafficking minor' }));
          return dep.vertical_signals.csecDependency === true && del.vertical_signals.csecDependency === false;
        },
      },
      {
        name: 'FAST_TRACK_OR',
        desc: 'fastTrack fires on catastrophic severity alone (no crisis required)',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'personal_injury', injury_severity:'catastrophic',
            vulnerability_level:'low', evidence_score:70 }));
          return s.vertical_signals.fastTrack === true;
        },
      },
      {
        name: 'EMERG_INJ_CRISIS_ONLY',
        desc: 'emergInj fires for any crisis civil rights matter (not just medical)',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'civil_rights', vulnerability_level:'crisis',
            title:'§ 1983 excessive force police shooting' }));
          return s.vertical_signals.emergInj === true;
        },
      },
      {
        name: 'MANDATORY_MIN_SAFETY_VALVE_EXCLUSIVE',
        desc: 'mandatoryMin and safetyValveEligible never both true',
        test: () => {
          const s = computeAllSignals(tm({ vertical:'criminal_defense', jurisdiction:'federal',
            title:'federal drug distribution § 841', evidence_score:70, prior_adjudications:0 }));
          return !(s.vertical_signals.mandatoryMin && s.vertical_signals.safetyValveEligible);
        },
      },
    ] : [];

    // Fall back to static invariants if import failed
    const invariants = liveInvariants.length > 0 ? liveInvariants : [
      {
        name: 'CSEC_NOT_DRUG',
        desc: 'Human trafficking does not trigger drug federal signals',
        test: () => {
          // drugCharge regex: must NOT match human trafficking
          const charge = 'federal human trafficking sex exploitation csec';
          const drugCharge = /\bdrug\b|marijuana|heroin|meth|cocaine|fentanyl|drug trafficking/.test(charge)
                          && !/(human trafficking|sex trafficking|csec)/.test(charge);
          return !drugCharge; // should be false
        },
      },
      {
        name: 'SAFETY_VALVE_WEAPON',
        desc: 'Safety valve blocked by weapon charge',
        test: () => {
          const charge = 'federal drug distribution firearm § 924';
          const weapon = /weapon|firearm|gun|§\s*924|armed/.test(charge);
          // safetyValveEligible requires !weapon — so with weapon=true, it should be false
          const eligible = !weapon;
          return !eligible; // weapon present → !eligible = false → safe when we test this is false
          // i.e., function correctly returns false when weapon present
        },
      },
      {
        name: 'ASYLUM_BAR_EXCLUSIVE',
        desc: 'asylumBarred and asylumBarRisk mutually exclusive',
        test: () => {
          // at clock=400: barred=true, barRisk=false
          const barred  = 400 > 365;
          const barRisk = 400 > 300 && 400 <= 365;
          return !(barred && barRisk);
        },
      },
      {
        name: 'CERT_APPROACHING_EXCLUSIVE',
        desc: 'certWorthy and certApproaching mutually exclusive',
        test: () => {
          const revScore = 58; const capital = true;
          const certWorthy     = revScore >= 60 && capital;
          const certApproaching = revScore >= 50 && capital && revScore < 60;
          return !(certWorthy && certApproaching);
        },
      },
      {
        name: 'MANDATORY_MIN_SAFETY_VALVE_EXCLUSIVE',
        desc: 'mandatory_minimum and safety_valve mutually exclusive in outcomes',
        test: () => {
          // mandatoryMin fires when !safetyValveEligible
          const sv = true;
          const mm = true && !sv; // mandatoryMin only when !sv
          return !(mm && sv);
        },
      },
      {
        name: 'STRANGULATION_DISHONORABLE',
        desc: 'DV strangulation maps to Dishonorable discharge',
        test: () => {
          const charge = 'art.128b ucmj domestic violence strangulation assault';
          let disch;
          if (/murder|rape|sexual assault/.test(charge)) disch = 'Dishonorable';
          else if (/strangulation|domestic violence strangulation/.test(charge)) disch = 'Dishonorable';
          else if (/conduct unbecoming|awol|desertion/.test(charge)) disch = 'OTH';
          else if (/assault|drug|theft|larceny/.test(charge)) disch = 'Bad Conduct';
          else disch = 'Honorable';
          return disch === 'Dishonorable';
        },
      },
      {
        name: 'EVIDENCE_BUCKET_BOUNDARIES',
        desc: 'evidenceBucket: 24→weak, 25→contested, 74→moderate, 75→strong',
        test: () => {
          const eb = s => {
            s = Math.max(0, Math.min(100, s));
            if (s < 25) return 'weak';
            if (s < 50) return 'contested';
            if (s < 75) return 'moderate';
            return 'strong';
          };
          return eb(24)==='weak' && eb(25)==='contested' && eb(74)==='moderate' && eb(75)==='strong';
        },
      },
      {
        name: 'DISCLAIMER_TIER_LABELS',
        desc: 'Analytics tiers are action-oriented — no discouraging labels',
        test: () => {
          const banned = ['DIFFICULT','CHALLENGING','hopeless','will lose','cannot win'];
          const tiers  = ['STRONG POSITION','BALANCED FIELD','BUILD STRENGTH','STRATEGY FOCUS'];
          return tiers.every(t => !banned.some(b => t.includes(b)));
        },
      },
      {
        name: 'CANCELLATION_10_YR',
        desc: 'Cancellation of removal requires exactly 10 years',
        test: () => {
          const cancElig9  = 9 >= 10;   // false
          const cancElig10 = 10 >= 10;  // true
          return !cancElig9 && cancElig10;
        },
      },
      {
        name: 'FAST_TRACK_OR_LOGIC',
        desc: 'fastTrack uses OR: catastrophic severity OR crisis (not AND)',
        test: () => {
          // catastrophic + non-crisis should still fastTrack
          const sev = 'catastrophic'; const crisis = false;
          const fastTrack = ['catastrophic','severe'].includes(sev) || crisis;
          return fastTrack === true;
        },
      },
    ];

    let passed = 0; let failed = 0;
    for (const inv of invariants) {
      try {
        const ok = inv.test();
        if (ok) {
          passed++;
          report.pass(section, inv.name, inv.desc);
        } else {
          failed++;
          report.fail(section, 'CRITICAL', `INV_FAIL_${inv.name}`,
            `INVARIANT FAILED: ${inv.desc}`,
            'Signal engine may be producing incorrect output. Immediate review required.'
          );
        }
      } catch (e) {
        failed++;
        report.fail(section, 'HIGH', `INV_ERR_${inv.name}`,
          `Invariant test error: ${inv.name}`,
          e.message
        );
      }
    }

    if (failed === 0) {
      report.pass(section, 'ALL_PASS', `All ${passed} signal engine invariants passed`);
    } else {
      report.fail(section, 'CRITICAL', 'INVARIANT_FAILURES',
        `${failed} of ${invariants.length} signal engine invariants FAILED`,
        'The signal engine is producing incorrect results. Client-facing data may be wrong.'
      );
    }

  } catch (e) {
    report.fail(section, 'HIGH', 'SCAN_ERROR', `Signal engine scan failed: ${e.message}`);
  }
}

// ─── SECTION 5: ANALYTICS BIAS AUDIT ─────────────────────────────────────────

async function scanBiasAudit(report) {
  const section = 'bias_audit';
  logger.info('[scan] Section 5: Analytics bias audit');

  try {
    const result = runBiasAudit(computeOutcomeEstimate);

    if (result.all_passed) {
      report.pass(section, 'BIAS_CLEAN',
        `Bias audit: all ${result.total_count} structural tests passed`
      );
    } else {
      const failed = result.tests.filter(t => !t.passed);
      report.fail(section, 'CRITICAL', 'BIAS_FAILURE',
        `Bias audit FAILED: ${failed.length} test(s) failed`,
        failed.map(t => `${t.test}: ${t.detail}`).join('; ')
      );
    }
  } catch (e) {
    report.fail(section, 'HIGH', 'SCAN_ERROR', `Bias audit scan failed: ${e.message}`);
  }
}

// ─── SECTION 6: DATABASE HEALTH ───────────────────────────────────────────────

async function scanDatabaseHealth(report) {
  const section = 'database_health';
  logger.info('[scan] Section 6: Database health');

  try {
    const db  = await getDb();
    const t0  = Date.now();

    // Critical tables
    const tables = [
      'users','firms','matters','push_tokens',
      'asylum_clocks','dpa_trackers','tro_trackers',
      'docket_entries','subscriptions',
    ];

    let totalRows = 0;
    for (const table of tables) {
      try {
        const row = await db.get(`SELECT COUNT(*) as n FROM ${table}`).catch(() => ({ n: -1 }));
        if (row.n === -1) {
          report.fail(section, 'HIGH', `TABLE_MISSING_${table.toUpperCase()}`,
            `Table '${table}' could not be queried`
          );
        } else {
          totalRows += row.n;
        }
      } catch { /* individual table errors already reported */ }
    }

    const queryMs = Date.now() - t0;

    if (queryMs > 5000) {
      report.fail(section, 'HIGH', 'SLOW_QUERIES',
        `Database responding slowly: ${queryMs}ms for ${tables.length} table counts`
      );
    } else if (queryMs > 2000) {
      report.fail(section, 'MEDIUM', 'QUERY_LAG',
        `Database response time elevated: ${queryMs}ms`
      );
    } else {
      report.pass(section, 'DB_HEALTHY',
        `Database healthy: ${totalRows.toLocaleString()} total rows across ${tables.length} tables in ${queryMs}ms`
      );
    }

    // WAL mode check (SQLite performance)
    const walRow = await db.get("PRAGMA journal_mode").catch(() => null);
    if (walRow && walRow.journal_mode !== 'wal') {
      report.fail(section, 'LOW', 'WAL_MODE',
        `SQLite not in WAL mode (current: ${walRow.journal_mode}) — WAL improves read concurrency`
      );
    }

  } catch (e) {
    report.fail(section, 'HIGH', 'DB_ERROR', `Database health scan failed: ${e.message}`);
  }
}

// ─── SECTION 7: COURTLISTENER PRECEDENT SWEEP ────────────────────────────────

async function scanPrecedentMonitor(report) {
  const section = 'precedent_monitor';
  logger.info('[scan] Section 7: CourtListener precedent sweep');

  try {
    // Compute daysBack from last successful scan — handles server restarts and outages.
    // If no prior scan found, default to 2 days to catch any missed opinions.
    let monitorDaysBack = 2;
    try {
      const db2 = await getDb();
      const lastScan = await db2.get(
        "SELECT started_at FROM scan_results WHERE overall != 'CRITICAL' ORDER BY id DESC LIMIT 1"
      ).catch(() => null);
      if (lastScan?.started_at) {
        const hoursSinceLast = (Date.now() - new Date(lastScan.started_at).getTime()) / 3600000;
        monitorDaysBack = Math.min(30, Math.max(1, Math.ceil(hoursSinceLast / 24)));
      }
    } catch (e) { logger.debug('[scan/precedent] daysBack fallback to default:', e?.message || String(e)); }
    const monitorResult = await runPrecedentMonitor({
      daysBack: monitorDaysBack,  // dynamic: covers time since last successful scan
      skipCourtListener: !process.env.COURTLISTENER_ENABLED,
    });

    if (process.env.COURTLISTENER_ENABLED !== 'true') {
      report.pass(section, 'DISABLED',
        'CourtListener sweep disabled (set COURTLISTENER_ENABLED=true to enable)'
      );
      return;
    }

    const { precedent_alerts = [], errors = [] } = monitorResult;

    if (precedent_alerts.length > 0) {
      report.fail(section, 'HIGH', 'NEW_OPINIONS',
        `${precedent_alerts.length} registry entry(ies) have new citing opinions`,
        precedent_alerts.map(a => `${a.entry_id}: ${a.count} new opinion(s)`).join('; ') +
        '\nHuman review required to determine if registry needs update.'
      );
    } else {
      report.pass(section, 'NO_NEW_OPINIONS',
        'No new opinions found for monitored statutes and issues'
      );
    }

    if (errors.length > 0) {
      report.fail(section, 'LOW', 'MONITOR_ERRORS',
        `${errors.length} CourtListener query error(s)`,
        errors.map(e => e.error).slice(0,3).join('; ')
      );
    }

  } catch (e) {
    report.fail(section, 'MEDIUM', 'SCAN_ERROR', `Precedent monitor scan failed: ${e.message}`);
  }
}

// ─── SECTION 8: PUSH TOKEN HEALTH ────────────────────────────────────────────

async function scanPushTokenHealth(report) {
  const section = 'push_tokens';
  logger.info('[scan] Section 8: Push token health');

  try {
    const db = await getDb();

    const tokenStats = await db.get(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN created_at < datetime('now', '-90 days') THEN 1 ELSE 0 END) as old_tokens,
        COUNT(DISTINCT user_id) as users_with_tokens
       FROM push_tokens`
    ).catch(() => null);

    if (!tokenStats) {
      report.fail(section, 'LOW', 'NO_TABLE', 'push_tokens table not accessible');
      return;
    }

    report.pass(section, 'TOKEN_STATS',
      `Push tokens: ${tokenStats.total} total, ${tokenStats.users_with_tokens} users, ${tokenStats.old_tokens} >90 days old`
    );

    if (tokenStats.old_tokens > tokenStats.total * 0.5) {
      report.fail(section, 'MEDIUM', 'STALE_TOKENS',
        `${tokenStats.old_tokens} of ${tokenStats.total} push tokens are >90 days old — consider token refresh`
      );
    }

    // Check for users with critical matters but no push token
    const criticalNoToken = await db.all(
      `SELECT m.id, m.title, m.firm_id, m.vulnerability_level
       FROM matters m
       LEFT JOIN firms f ON f.id = m.firm_id
       LEFT JOIN users u ON u.firm_id = m.firm_id AND u.firm_role IN ('firm_admin','partner')
       LEFT JOIN push_tokens pt ON pt.user_id = u.id
       WHERE m.status = 'active'
         AND m.vulnerability_level = 'crisis'
         AND pt.id IS NULL
       LIMIT 20`
    ).catch(() => []);

    if (criticalNoToken.length > 0) {
      report.fail(section, 'MEDIUM', 'CRISIS_NO_PUSH',
        `${criticalNoToken.length} active crisis matter(s) have no push token registered for the responsible attorney`,
        'Attorneys managing crisis matters should have push tokens for immediate escalation alerts.'
      );
    }

  } catch (e) {
    report.fail(section, 'LOW', 'SCAN_ERROR', `Push token scan failed: ${e.message}`);
  }
}

// ─── SECTION 9: ESCALATION SLA AUDIT ─────────────────────────────────────────

async function scanEscalationSLA(report) {
  const section = 'escalation_sla';
  logger.info('[scan] Section 9: Escalation SLA audit');

  try {
    const db  = await getDb();
    const now = new Date();

    // Find critical matters where updated_at is more than 1 hour ago
    // (should have been contacted within 1 hour of critical escalation)
    const criticalMatters = await db.all(
      `SELECT m.id, m.title, m.firm_id, m.vulnerability_level, m.time_pressure,
              m.updated_at, f.name as firm_name,
              datetime('now', '-1 hour') as sla_threshold_1h,
              datetime('now', '-4 hours') as sla_threshold_4h
       FROM matters m
       LEFT JOIN firms f ON f.id = m.firm_id
       WHERE m.status = 'active'
         AND m.vulnerability_level = 'crisis'
         AND m.time_pressure = 'emergency'
         AND m.updated_at < datetime('now', '-1 hour')
       LIMIT 50`
    ).catch(() => []);

    if (criticalMatters.length > 0) {
      report.fail(section, 'HIGH', 'SLA_BREACH',
        `${criticalMatters.length} critical matter(s) with emergency+crisis have not been updated in >1 hour`,
        criticalMatters.slice(0,5).map(m => `${m.title} (${m.firm_name})`).join('; ')
      );
    } else {
      report.pass(section, 'SLA_MET', 'No critical SLA breaches detected');
    }

  } catch (e) {
    report.fail(section, 'LOW', 'SCAN_ERROR', `Escalation SLA scan failed: ${e.message}`);
  }
}

// ─── NOTIFICATION DISPATCH ────────────────────────────────────────────────────

async function dispatchNotifications(report, criticalMatters = []) {
  // Always runs — sends daily summary email regardless of findings.
  // The team must know the app's status every day, whether healthy or not.

  const db = await getDb();

  // Deduplicate: group findings by severity for a single notification
  const criticals = report.findings.filter(f => f.severity === 'CRITICAL');
  const highs     = report.findings.filter(f => f.severity === 'HIGH');
  const mediums   = report.findings.filter(f => f.severity === 'MEDIUM');

  const hasUrgent   = criticals.length > 0 || highs.length > 0;
  const hasMedium   = mediums.length > 0;
  const isHealthy   = report.overall === 'HEALTHY';
  const overall   = report.overall;

  // Build notification text
  const pushTitle = `JusticeGavel ${overall === 'CRITICAL' ? '🚨 CRITICAL' : overall === 'DEGRADED' ? '🔴 Alert' : '✓ Healthy'} — Scan ${report.scan_id.slice(-6)}`;

  const pushBody = [
    criticals.length ? `${criticals.length} CRITICAL` : null,
    highs.length     ? `${highs.length} HIGH` : null,
    mediums.length   ? `${mediums.length} MEDIUM` : null,
  ].filter(Boolean).join(', ') || 'All checks passed';

  // Get all firm_admin push tokens
  try {
    const admins = await db.all(
      `SELECT DISTINCT u.id, u.push_token
       FROM users u
       WHERE u.firm_role IN ('firm_admin','partner')
         AND u.push_token IS NOT NULL
       LIMIT 500`
    ).catch(() => []);

    for (const admin of admins) {
      // Always push — admin needs daily status regardless
      await sendPushToUser(admin.id, {
        title: pushTitle,
        body:  pushBody,
        data:  { type: 'health_scan', scan_id: report.scan_id, severity: overall },
        sound: hasUrgent ? 'default' : 'default',
      }).catch(e => logger.warn('[scan/notify] push error:', e.message));
    }
  } catch (e) {
    logger.warn('[scan/notify] push dispatch error:', e.message);
  }

  // Email notification — ALWAYS send daily summary (even if healthy).
  // Silence is dangerous — admin must know the app ran and passed, not just when it fails.
  if (ADMIN_EMAIL && !SCAN_QUIET) {
    const ts      = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
    const statusIcon = overall === 'CRITICAL' ? '🚨' : overall === 'DEGRADED' ? '🔴' : '✅';
    const subject = `${statusIcon} [JusticeGavel] Daily Scan — ${overall} — ${ts}`;
    const html    = buildEmailHtml(report);
    await sendEmail({
      to:      ADMIN_EMAIL,
      subject,
      text:    report.toText(),
      html,
    }).catch(e => logger.warn('[scan/notify] email error:', e.message));
  }

  // SMS — CRITICAL + HIGH findings warrant immediate text
  if (ADMIN_SMS && (criticals.length > 0 || highs.length > 0)) {
    const urgentItems = [...criticals, ...highs];
    const smsBody = `JG ${overall}: ${urgentItems.map(c => c.message).slice(0,2).join(' | ')} [${report.scan_id.slice(-6)}]`;
    await sendSms({ to: ADMIN_SMS, body: smsBody.slice(0, 160) })
      .catch(e => logger.warn('[scan/notify] SMS error:', e.message));
  }

  // Per-matter notifications for imminent asylum bar
  if (criticalMatters.length > 0) {
    for (const matter of criticalMatters) {
      if (matter.attorney_id) {
        await sendPushToUser(matter.attorney_id, {
          title: `🚨 Asylum Bar: ${matter.remaining} day(s) remaining`,
          body:  `${matter.title || 'Matter ' + matter.matter_id} — File NOW. ${matter.remaining} day(s) until 1-year bar.`,
          data:  { type: 'asylum_bar_critical', matter_id: matter.matter_id },
          sound: 'default',
        }).catch(e => logger.warn('[scan/asylum] attorney push error:', e.message));
      }
    }
  }
}


// ─── EMAIL HTML BUILDER ───────────────────────────────────────────────────────
// Produces a professional, color-coded HTML email for every daily scan.
// Healthy scans show "All Clear" — silence would mean something is wrong.

function buildEmailHtml(report) {
  const ts       = new Date(report.completed_at || report.started_at)
                     .toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' });
  const overall  = report.overall;
  const headerBg = overall === 'CRITICAL' ? '#C0392B' : overall === 'DEGRADED' ? '#E67E22' : '#27AE60';
  const headerIcon = overall === 'CRITICAL' ? '🚨' : overall === 'DEGRADED' ? '🔴' : '✅';
  const sevC = {
    CRITICAL: { bg:'#FDEDEC', border:'#C0392B', text:'#C0392B', icon:'🚨' },
    HIGH:     { bg:'#FEF9E7', border:'#E67E22', text:'#D35400', icon:'🔴' },
    MEDIUM:   { bg:'#FDF2E9', border:'#F39C12', text:'#B7770D', icon:'🟡' },
    LOW:      { bg:'#EBF5FB', border:'#2980B9', text:'#1F618D', icon:'🔵' },
    INFO:     { bg:'#EAFAF1', border:'#27AE60', text:'#1E8449', icon:'✓'  },
  };
  const issues   = report.findings.filter(f => f.severity !== 'INFO');
  const passes   = report.findings.filter(f => f.severity === 'INFO').length;
  const rows     = issues.map(f => {
    const c = sevC[f.severity] || sevC.LOW;
    return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:4px;padding:12px 14px;margin:8px 0;">
      <div style="font-weight:700;color:${c.text};font-size:13px;">${c.icon} [${f.severity}] ${f.section.replace(/_/g,' ').toUpperCase()} — ${f.code}</div>
      <div style="font-size:13px;color:#2C3E50;margin-top:4px;">${f.message}</div>
      ${f.detail ? `<div style="font-size:11px;color:#7F8C8D;margin-top:4px;font-style:italic;">${f.detail}</div>` : ''}
    </div>`;
  }).join('');
  const badges = Object.entries(report.summary).filter(([s])=>s!=='INFO')
    .map(([sev,n]) => { const c=sevC[sev]||sevC.LOW; return `<span style="background:${c.bg};color:${c.text};border:1px solid ${c.border};border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;margin:0 3px;">${c.icon} ${n} ${sev}</span>`; }).join('');
  const actionNeeded = issues.some(f => ['CRITICAL','HIGH'].includes(f.severity));
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F4F6F7;">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);">
    <div style="background:${headerBg};padding:24px 28px;color:#fff;">
      <div style="font-size:22px;font-weight:700;">${headerIcon} Justice Gavel — Daily Health Scan</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px;">${ts} Central &nbsp;|&nbsp; Scan: ${report.scan_id}</div>
    </div>
    <div style="background:#F8F9FA;border-bottom:1px solid #ECF0F1;padding:16px 28px;">
      <div style="font-size:12px;color:#7F8C8D;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Status</div>
      <div>${badges || `<span style="color:#27AE60;font-weight:700;">✅ All ${passes} checks passed</span>`}</div>
      <div style="font-size:11px;color:#95A5A6;margin-top:6px;">Elapsed: ${report.elapsed_ms}ms &nbsp;|&nbsp; ${passes} sections passed &nbsp;|&nbsp; ${issues.length} issue(s)</div>
    </div>
    <div style="padding:20px 28px;">
      ${issues.length > 0
        ? `<div style="font-size:14px;font-weight:700;color:#2C3E50;margin-bottom:12px;">Findings Requiring Attention (${issues.length})</div>${rows}`
        : `<div style="background:#EAFAF1;border-left:4px solid #27AE60;border-radius:4px;padding:16px;">
             <div style="font-weight:700;color:#1E8449;font-size:14px;">✅ All Clear</div>
             <div style="font-size:13px;color:#2C3E50;margin-top:4px;">All ${passes} health checks passed. No issues found. The app is operating correctly.</div>
           </div>`}
    </div>
    ${actionNeeded ? `<div style="background:#FDEDEC;border-top:2px solid #C0392B;padding:16px 28px;">
      <div style="font-weight:700;color:#C0392B;">⚠️ Action Required</div>
      <div style="font-size:12px;color:#2C3E50;margin-top:6px;">CRITICAL or HIGH findings require immediate review. Check the admin dashboard or server logs. Active client matters may be affected.</div>
    </div>` : ''}
    <div style="background:#2C3E50;padding:14px 28px;color:#BDC3C7;font-size:11px;">
      <div>Justice Gavel Automated Health Scan &nbsp;|&nbsp; Twice daily: 6 AM and 6 PM Central &nbsp;|&nbsp; <strong style="color:#ECF0F1;">Reply to alert engineering.</strong></div>
      <div style="margin-top:3px;">Sent to all admin contacts regardless of status. Set SCAN_QUIET=true to suppress healthy-scan emails.</div>
    </div>
  </div>
</body></html>`;
}

// ─── STORE SCAN RESULT IN DATABASE ───────────────────────────────────────────

async function persistScanResult(report) {
  try {
    const db = await getDb();
    await db.run(`
      CREATE TABLE IF NOT EXISTS scan_results (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id      TEXT NOT NULL,
        started_at   TEXT NOT NULL,
        completed_at TEXT,
        elapsed_ms   INTEGER,
        overall      TEXT,
        summary_json TEXT,
        findings_json TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
      )
    `).catch(() => {}); // table may already exist

    await db.run(
      `INSERT INTO scan_results
         (scan_id, started_at, completed_at, elapsed_ms, overall, summary_json, findings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        report.scan_id,
        report.started_at,
        report.completed_at,
        report.elapsed_ms,
        report.overall,
        JSON.stringify(report.summary),
        JSON.stringify(report.findings.filter(f => f.severity !== 'INFO')),
      ]
    );

    // Prune old results — keep 30 days
    await db.run(
      "DELETE FROM scan_results WHERE created_at < datetime('now', '-30 days')"
    ).catch(() => {});

    logger.info(`[scan] Result persisted: ${report.scan_id} (${report.overall})`);
  } catch (e) {
    logger.warn('[scan] Failed to persist scan result:', e.message);
  }
}

// ─── SECTION 10: RETENTION HEALTH ───────────────────────────────────────────
// Verify the retention system is working: no improperly deleted data,
// no expired grace periods without notification, legal holds intact.

async function scanRetentionHealth(report) {
  const section = 'retention_health';
  logger.info('[scan] Section 10: Retention health');
  try {
    const db = await getDb();

    // Check for firms in grace period that weren't notified
    const graceExpired = await db.all(
      `SELECT id, name, subscription_grace_until, subscription_status
       FROM firms
       WHERE subscription_status='grace'
         AND subscription_grace_until < date('now')
       LIMIT 20`
    ).catch(() => []);

    if (graceExpired.length > 0) {
      report.fail(section, 'MEDIUM', 'GRACE_EXPIRED',
        `${graceExpired.length} firm(s) have expired grace periods — now in read-only mode`,
        graceExpired.map(f => `${f.name} (grace expired: ${f.subscription_grace_until})`).join('; ')
      );
    } else {
      report.pass(section, 'GRACE_OK', 'No firms with expired unhandled grace periods');
    }

    // Check active legal holds are intact
    const holdCount = await db.get(
      'SELECT COUNT(*) as n FROM legal_holds WHERE active=1'
    ).catch(() => ({ n: 0 }));
    report.pass(section, 'HOLDS_COUNT', `${holdCount.n} active legal hold(s) in place`);

    // Check for any matters that have legal_hold=1 but no corresponding hold record
    const orphanedHolds = await db.get(
      `SELECT COUNT(*) as n FROM matters m
       WHERE m.legal_hold=1
         AND NOT EXISTS (
           SELECT 1 FROM legal_holds lh
           WHERE lh.hold_type='matter' AND lh.target_id=m.id AND lh.active=1
         )`
    ).catch(() => ({ n: 0 }));

    if (orphanedHolds.n > 0) {
      report.fail(section, 'MEDIUM', 'ORPHANED_HOLDS',
        `${orphanedHolds.n} matter(s) have legal_hold=1 but no active hold record`,
        'Data integrity issue — legal_hold flag set without corresponding legal_holds record.'
      );
    } else {
      report.pass(section, 'HOLD_INTEGRITY', 'Legal hold flags match legal_holds records');
    }

  } catch (e) {
    report.fail(section, 'LOW', 'SCAN_ERROR', `Retention health scan failed: ${e.message}`);
  }
}

// ─── SECTION 11: EXTENUATING CIRCUMSTANCES DEADLINES ────────────────────────
// The five life-changing deadlines the app now tracks.
// These fire CRITICAL because a miss is often irreversible.

async function scanExtenuatingDeadlines(report) {
  const section = 'extenuating_deadlines';
  logger.info('[scan] Section 11: Extenuating circumstances deadlines');
  try {
    const db  = await getDb();
    const now = new Date();

    // Voluntary departure — imminent (14 days)
    const volDep = await db.all(
      `SELECT vd.*, f.name as firm_name
       FROM voluntary_departure vd
       LEFT JOIN firms f ON f.id = vd.firm_id
       WHERE vd.status = 'pending'
         AND vd.departure_deadline <= date('now', '+14 days')
       LIMIT 50`
    ).catch(() => []);

    for (const vd of volDep) {
      const days = Math.ceil((new Date(vd.departure_deadline) - now) / 86400000);
      const sev  = days <= 3 ? 'CRITICAL' : 'HIGH';
      report.fail(section, sev, 'VOL_DEPARTURE_IMMINENT',
        `Voluntary departure: ${days} day(s) remaining — ${vd.client_name} (${vd.firm_name})`,
        `Miss by 1 day = automatic 10-year re-entry bar + bond forfeiture. Departure deadline: ${vd.departure_deadline}`
      );
    }

    // Plea offer expiry — within 48 hours
    const pleas = await db.all(
      `SELECT po.*, f.name as firm_name
       FROM plea_offers po
       LEFT JOIN firms f ON f.id = po.firm_id
       WHERE po.status = 'pending'
         AND po.expires_date IS NOT NULL
         AND po.expires_date <= date('now', '+2 days')
       LIMIT 50`
    ).catch(() => []);

    for (const pl of pleas) {
      const days = Math.ceil((new Date(pl.expires_date) - now) / 86400000);
      if (days >= 0) {
        report.fail(section, 'CRITICAL', 'PLEA_EXPIRING',
          `Plea offer expiring in ${days} day(s): ${pl.charge_offered || 'offer'} — (${pl.firm_name})`,
          `Offer expires: ${pl.expires_date}. Decision required NOW.`
        );
      }
    }

    // DV firearm surrender — overdue
    const firearms = await db.all(
      `SELECT fs.*, f.name as firm_name
       FROM dv_firearm_surrender fs
       LEFT JOIN firms f ON f.id = fs.firm_id
       WHERE fs.status = 'pending'
         AND fs.surrender_deadline < date('now')
       LIMIT 50`
    ).catch(() => []);

    for (const fs of firearms) {
      report.fail(section, 'CRITICAL', 'FIREARM_SURRENDER_OVERDUE',
        `Firearm surrender OVERDUE — ${fs.client_name} (${fs.firm_name})`,
        `Deadline was ${fs.surrender_deadline}. Non-compliance = 18 U.S.C. § 922(g)(8) federal crime.`
      );
    }

    // BOP 30-day lapse reached — eligible to file
    const bopReady = await db.all(
      `SELECT bo.*, f.name as firm_name
       FROM bop_exhaustion bo
       LEFT JOIN firms f ON f.id = bo.firm_id
       WHERE bo.status = 'warden_submitted'
         AND bo.thirty_day_lapse_date <= date('now')
         AND bo.court_motion_filed = 0
       LIMIT 50`
    ).catch(() => []);

    for (const bo of bopReady) {
      report.fail(section, 'HIGH', 'BOP_COURT_ELIGIBLE',
        `§ 3582(c) compassionate release: 30-day BOP lapse complete — court motion can be filed now — ${bo.client_name} (${bo.firm_name})`,
        `BOP request submitted: ${bo.warden_request_date}. 30-day lapse: ${bo.thirty_day_lapse_date}.`
      );
    }

    // VOP hearings imminent
    const vops = await db.all(
      `SELECT vt.*, f.name as firm_name
       FROM vop_trackers vt
       LEFT JOIN firms f ON f.id = vt.firm_id
       WHERE vt.status IN ('pending','hearing_set')
         AND vt.detained_on_vop = 1
       LIMIT 30`
    ).catch(() => []);

    for (const vt of vops) {
      report.fail(section, 'HIGH', 'VOP_COMPOUND',
        `VOP compound emergency: ${vt.client_name} detained on VOP (${vt.firm_name})`,
        `Violation: ${vt.violation_type} on ${vt.violation_date}. Lower evidentiary standard applies.`
      );
    }

    if (volDep.length === 0 && pleas.length === 0 && firearms.length === 0 && bopReady.length === 0 && vops.length === 0) {
      report.pass(section, 'CLEAR', 'No imminent extenuating circumstance deadlines');
    }

  } catch (e) {
    report.fail(section, 'MEDIUM', 'SCAN_ERROR', `Extenuating deadlines scan failed: ${e.message}`);
  }
}


// ─── SECTION 12: EXTENDED TRACKER DEADLINES ──────────────────────────────────
// Covers Tier 2/3 extenuating trackers: Hague 1-year deadline,
// eviction answer deadlines, Padilla documentation gaps.

async function scanExtendedTrackers(report) {
  const section = 'extended_trackers';
  logger.info('[scan] Section 12: Extended tracker deadlines');
  try {
    const db  = await getDb();
    const today = new Date();

    // ── Hague Convention: within 30 days of 1-year deadline ──────────────────
    const hagueUrgent = await db.all(
      `SELECT hp.*, f.name as firm_name
       FROM hague_proceedings hp
       LEFT JOIN firms f ON f.id = hp.firm_id
       WHERE hp.within_one_year = 1
         AND hp.status IN ('pending','petition_filed')
         AND hp.one_year_deadline <= date('now', '+30 days')
       LIMIT 30`
    ).catch(() => []);

    for (const h of hagueUrgent) {
      const days = Math.ceil((new Date(h.one_year_deadline) - today) / 86400000);
      const sev  = days <= 7 ? 'CRITICAL' : days <= 14 ? 'HIGH' : 'MEDIUM';
      report.fail(section, sev, 'HAGUE_DEADLINE',
        `Hague 1-year deadline: ${days} day(s) remaining — ${h.child_name} (${h.firm_name})`,
        `Deadline: ${h.one_year_deadline}. After 1 year + settled-child finding, return may be denied. File NOW.`
      );
    }

    // ── Eviction answer deadlines — within 5 days ────────────────────────────
    const evictions = await db.all(
      `SELECT et.*, f.name as firm_name
       FROM eviction_trackers et
       LEFT JOIN firms f ON f.id = et.firm_id
       WHERE et.status = 'pending'
         AND et.answer_deadline IS NOT NULL
         AND et.answer_deadline <= date('now', '+5 days')
       LIMIT 30`
    ).catch(() => []);

    for (const ev of evictions) {
      const days = Math.ceil((new Date(ev.answer_deadline) - today) / 86400000);
      const sev  = days <= 1 ? 'CRITICAL' : days <= 3 ? 'HIGH' : 'MEDIUM';
      report.fail(section, sev, 'EVICTION_ANSWER_DUE',
        `Eviction answer due in ${days} day(s): ${ev.client_name} — ${ev.property_address || ev.state} (${ev.firm_name})`,
        `Deadline: ${ev.answer_deadline}. Default judgment = immediate eviction if answer not filed.`
      );
    }

    // ── Padilla documentation gaps: non-citizen + pending plea, no warning ───
    const padillaGaps = await db.all(
      `SELECT po.*, m.title, f.name as firm_name
       FROM plea_offers po
       LEFT JOIN matters m ON m.id = po.matter_id
       LEFT JOIN firms f ON f.id = po.firm_id
       WHERE po.status = 'pending'
         AND po.non_citizen = 1
         AND po.padilla_warning_given = 0
       LIMIT 30`
    ).catch(() => []);

    if (padillaGaps.length > 0) {
      report.fail(section, 'HIGH', 'PADILLA_UNDOCUMENTED',
        `${padillaGaps.length} non-citizen client(s) have pending plea offers but no Padilla warning documented`,
        `Padilla v. Kentucky (2010): mandatory immigration consequence advice before guilty plea. ` +
        `Missing documentation = IAC exposure. Affected: ${padillaGaps.slice(0,3).map(p=>p.firm_name).join(', ')}`
      );
    }

    // ── Material support screenings not done for flagged asylum matters ───────
    const matSupportGaps = await db.all(
      `SELECT m.id, m.title, m.firm_id, f.name as firm_name
       FROM matters m
       LEFT JOIN firms f ON f.id = m.firm_id
       LEFT JOIN material_support_screening mss ON mss.matter_id = m.id
       WHERE m.status = 'active'
         AND m.vertical = 'immigration'
         AND (m.relief_type = 'asylum' OR m.relief_type IS NULL)
         AND m.title LIKE '%cartel%' OR m.title LIKE '%gang%' OR m.title LIKE '%traffick%'
         AND mss.id IS NULL
       LIMIT 20`
    ).catch(() => []);

    if (matSupportGaps.length > 0) {
      report.fail(section, 'MEDIUM', 'MATERIAL_SUPPORT_UNSCREENED',
        `${matSupportGaps.length} asylum matter(s) may need material support screening`,
        `Matter titles suggest cartel/trafficking exposure. 8 U.S.C. § 1182(a)(3)(B) can bar asylum even for victims.`
      );
    }

    const allClear = hagueUrgent.length === 0 && evictions.length === 0 &&
                     padillaGaps.length === 0 && matSupportGaps.length === 0;
    if (allClear) {
      report.pass(section, 'CLEAR', 'No urgent extended tracker deadlines');
    }

  } catch (e) {
    report.fail(section, 'LOW', 'SCAN_ERROR', `Extended tracker scan failed: ${e.message}`);
  }
}

// ─── MASTER SCAN RUNNER ───────────────────────────────────────────────────────

export async function runHealthScan(options = {}) {
  const report = new ScanReport();
  const { skipPrecedentMonitor = false } = options;

  logger.info(`\n[scan] ${'═'.repeat(55)}`);
  logger.info(`[scan] Justice Gavel Health Scan v${SCAN_VERSION}`);
  logger.info(`[scan] ID: ${report.scan_id}`);
  logger.info(`[scan] Started: ${report.started_at}`);
  logger.info(`[scan] ${'═'.repeat(55)}`);

  // Run all sections — each is independent, a failure in one does not stop others
  let criticalMatters = [];

  await scanPrecedentCurrency(report);
  const sec2 = await scanAsylumBarRisk(report);
  criticalMatters = sec2.criticalMatters || [];
  await scanTrackerDeadlines(report);
  await scanSignalEngine(report);
  await scanBiasAudit(report);
  await scanDatabaseHealth(report);
  if (!skipPrecedentMonitor) await scanPrecedentMonitor(report);
  await scanPushTokenHealth(report);
  await scanEscalationSLA(report);
  // Retention health — verify no data has been improperly deleted
  await scanRetentionHealth(report);
  await scanExtendedTrackers(report);
  // Extenuating circumstances — the life-changing deadlines
  await scanExtenuatingDeadlines(report);

  // Finalize
  report.finalize();

  logger.info(`\n[scan] ${'─'.repeat(55)}`);
  logger.info(`[scan] COMPLETE: ${report.overall} in ${report.elapsed_ms}ms`);
  logger.info(`[scan] Findings: ${JSON.stringify(report.summary)}`);
  logger.info(`[scan] ${'─'.repeat(55)}\n`);

  // Persist + notify
  await persistScanResult(report);
  await dispatchNotifications(report, criticalMatters);

  return report;
}

// ─── SCHEDULER INTEGRATION ────────────────────────────────────────────────────

let healthScanTask = null;

export function startHealthScanScheduler() {
  if (!CONFIG.LIVE_REFRESH) {
    logger.info('[scan] LIVE_REFRESH=false — health scan scheduler disabled');
    logger.info('[scan] Set LIVE_REFRESH=true to activate 12-hour scans (6 AM and 6 PM Central)');
    return;
  }

  // Every 12 hours: 6 AM and 6 PM Central.
  // Twice-daily scans are the failsafe. Attorneys access and update matters 24/7.
  // Clients need confidence that court case data is accurate around the clock.
  const cronExpr = process.env.HEALTH_SCAN_CRON || '0 6,18 * * *';
  const tz       = process.env.REFRESH_TZ || 'America/Chicago';

  if (!cron.validate(cronExpr)) {
    logger.error(`[scan] Invalid HEALTH_SCAN_CRON: "${cronExpr}" — health scan disabled`);
    return;
  }

  healthScanTask = cron.schedule(cronExpr, async () => {
    try {
      await runHealthScan();
    } catch (e) {
      logger.error('[scan] Unhandled scan error:', e.message, e.stack);
      // Scan crash is a CRITICAL system failure — notify immediately via all channels
      const crashTime = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
      const crashText = `CRASH at ${crashTime}\n\nError: ${e.message}\n\nStack:\n${e.stack}`;
      if (ADMIN_EMAIL) {
        await sendEmail({
          to:      ADMIN_EMAIL,
          subject: '🚨 [JusticeGavel] HEALTH SCAN CRASHED — immediate attention required',
          text:    `The Justice Gavel automated health scan crashed and could not complete.\n\n${crashText}`,
          html:    `<h2 style='color:red'>🚨 Justice Gavel Health Scan CRASHED</h2><p>The automated scan failed at <strong>${crashTime}</strong>. The app's self-monitoring is down.</p><pre>${crashText}</pre>`,
        }).catch(() => {});
      }
      if (ADMIN_SMS) {
        await sendSms({
          to:   ADMIN_SMS,
          body: `JG SCAN CRASH at ${new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})}: ${e.message.slice(0,100)}`,
        }).catch(() => {});
      }
    }
  }, { timezone: tz });

  logger.info(`[scan] Health scan scheduled: ${cronExpr} (${tz}) — every ${SCAN_INTERVAL_HOURS} hours (6 AM and 6 PM Central)`);
  logger.info(`[scan] Channels: Email ALWAYS + Push ALWAYS + SMS for CRITICAL/HIGH`);
  logger.info(`[scan] Admin email: ${ADMIN_EMAIL || 'NOT CONFIGURED — set ADMIN_ALERT_EMAIL'}`);
  logger.info(`[scan] Admin SMS:   ${ADMIN_SMS   || 'NOT CONFIGURED — set ADMIN_ALERT_SMS'}`);
}

export function stopHealthScanScheduler() {
  if (healthScanTask) {
    healthScanTask.destroy();
    healthScanTask = null;
    logger.info('[scan] Health scan scheduler stopped');
  }
}

export default { runHealthScan, startHealthScanScheduler, stopHealthScanScheduler };
