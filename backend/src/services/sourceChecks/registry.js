/**
 * sourceChecks/registry.js — every sourced legal row the app shows or withholds, in one shape, with
 * where its source URL and "checked on" date live (docs/LEGAL_ACCURACY_REVIEW.md §3c):
 *
 *   dataset          lives in                                   source URL         checked on
 *   expungement      routes/expungement/rules_data.js           source_url         file generated 2026-10-25
 *   juvenile         routes/expungement/rules_data.js           source_url         2026-10-25
 *   recording        routes/recordingLaws_data.js               source_url         2026-10-25 (review pass)
 *   court_rules      data/court_rules.js                        url                checked (COURT_RULES_CHECKED)
 *   transit          data/transit_agencies.js                   source_url         checked (TRANSIT_CHECKED)
 *   guide            data/guideCorpus.js (copy of the app's     url                checked (GUIDE_CHECKED)
 *                    constants/guideSources.ts)
 *   tn_report        services/bondDesk/tnReport.js TN_REPORT    sources[1]         checked_on
 *   rights_card      services/rightsContent.js (rc_1–rc_3 name  none recorded      CONTENT_LAST_REVIEWED (month)
 *                    a constitutional source; no URL)
 *   deadlines        routes/docket.js RULE_SETS (rule cite,     none recorded      none (open item L7)
 *                    no URL)
 *   bail_schedules, dui_laws, drug_penalties,                  source_url         last_reviewed_at
 *   statute_of_limitations, victim_compensation, specialty_courts (database; shown only when
 *                    routes/legaldata.js isVerifiedRow())
 *   rights_cards     database state sections                    source_url         content_verified_at
 *
 * Each entry: { dataset, key, label, state, jurisdiction, source_url, text, checked, shown, storage,
 * table?, id? }. `text` is the stored rule as the re-check compares it (English; what the app
 * shows). `shown` = the app shows the row today (false = withheld — never published by a re-check).
 */
import { STATE_RULES_DATA, JUVENILE_SEALING_DATA } from '../../routes/expungement/rules_data.js';
import { RECORDING_LAWS } from '../../routes/recordingLaws_data.js';
import { COURT_RULES } from '../../data/court_rules.js';
import { TRANSIT_AGENCIES } from '../../data/transit_agencies.js';
import { GUIDE_CORPUS } from '../../data/guideCorpus.js';
import { TN_REPORT } from '../bondDesk/tnReport.js';
import { GENERAL_SECTIONS, CONTENT_LAST_REVIEWED } from '../rightsContent.js';
import { isVerifiedRow } from '../../routes/legaldata.js';
import { isAllowedUrl } from '../../ai/sourceDomains.js';

export const EXPUNGEMENT_DATE = '2026-10-25';   // rules_data.js "Generated 2026-10-25"
const CATS = ['misdemeanor', 'felony', 'dui', 'domestic', 'sexual', 'dismissed'];
const VERDICT = new Set(['verified', 'corrected']);
const ok = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : v == null ? 'unknown' : String(v));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The database tables, with the columns that make up their rule text. */
export const DB_DATASETS = Object.freeze({
  bail_schedules: { label: (r) => `${r.state} bail — ${r.charge || r.charge_type || 'charge'}`,
    text: (r) => `Bail for ${r.charge || r.charge_type} (${r.severity || ''}) in ${r.state}: ${r.bail_min_cents != null ? `$${Math.round(r.bail_min_cents / 100)}` : r.bail_min ?? '?'}–${r.bail_max_cents != null ? `$${Math.round(r.bail_max_cents / 100)}` : r.bail_max ?? '?'}. ${r.bail_note || r.notes || ''}`,
    editable: ['bail_note', 'notes'] },
  dui_laws: { label: (r) => `${r.state} DUI law`,
    text: (r) => `${r.state} DUI: BAC limit ${r.bac_limit ?? '?'}; first offense jail ${r.first_jail_min ?? '?'}–${r.first_jail_max ?? '?'} days, fine ${r.first_fine_min ?? '?'}–${r.first_fine_max ?? '?'}; license ${r.first_license_days ?? '?'} days; admin hearing deadline ${r.dmv_hearing_deadline ?? '?'} days. ${r.notes || ''}`,
    editable: ['notes'] },
  drug_penalties: { label: (r) => `${r.state} drug penalty — ${r.drug_type || r.drug_schedule || ''} ${r.offense_type || ''}`.trim(),
    text: (r) => `${r.state}: ${r.offense_type || ''} ${r.drug_type || r.drug_schedule || ''} ${r.amount_threshold || ''} — ${r.charge_level || ''}; ${r.min_days ?? '?'}–${r.max_days ?? '?'} days; fine up to ${r.max_fine ?? '?'}. ${r.notes || ''}`,
    editable: ['notes'] },
  statute_of_limitations: { label: (r) => `${r.state} time limit — ${r.crime_type || r.offense_type || ''}`,
    text: (r) => `${r.state} statute of limitations for ${r.crime_type || r.offense_type}: ${Number(r.years) === -1 ? 'no limit' : `${r.years} years`}. ${r.notes || ''}`,
    editable: ['notes'] },
  victim_compensation: { label: (r) => `${r.state} victim compensation — ${r.program_name || ''}`,
    text: (r) => `${r.program_name || ''} (${r.state}): maximum award ${r.max_award ?? '?'}; deadline ${r.deadline_days ?? '?'} days; covers ${r.covers || ''}. ${r.notes || ''}`,
    editable: ['notes', 'covers'] },
  specialty_courts: { label: (r) => `${r.state} specialty court — ${r.name || ''}`,
    text: (r) => `${r.name || ''} (${r.court_type || ''}, ${r.county || ''} ${r.state}): eligibility ${r.eligibility || ''}. ${r.notes || ''}`,
    editable: ['eligibility', 'notes'] },
  rights_cards: { label: (r) => `${r.state || 'US'} rights card — ${r.title || r.topic || ''}`,
    text: (r) => `${r.title || ''}: ${r.content || ''}`, editable: [] },
});
export const DATASETS = Object.freeze(['expungement', 'juvenile', 'recording', 'court_rules', 'transit', 'guide', 'tn_report', 'rights_card', 'deadlines', ...Object.keys(DB_DATASETS)]);
/** Datasets stored in code: an admin can withhold a row or record a correction for a developer. */
export const CODE_DATASETS = new Set(['expungement', 'juvenile', 'recording', 'court_rules', 'transit', 'guide', 'tn_report', 'rights_card', 'deadlines']);

function codeRows({ deadlineSets = null } = {}) {
  const out = [];
  for (const [st, s] of Object.entries(STATE_RULES_DATA)) {
    for (const cat of CATS) {
      const r = s?.[cat];
      if (!r) continue;
      const shown = VERDICT.has(r.status) && !!clean(r.citation) && ok(r.source_url) && r.eligible != null && r.eligible !== 'unknown';
      out.push({ dataset: 'expungement', key: `${st}.${cat}`, label: `${s.name || st} — record clearing (${cat})`, state: st, jurisdiction: st,
        source_url: ok(r.source_url) ? r.source_url.trim() : null, checked: EXPUNGEMENT_DATE, shown, storage: 'code',
        text: clean(`${s.name || st}, ${cat}: eligible ${yn(r.eligible)}; wait ${r.waitYears ?? '?'} years from ${r.waitFrom || '—'}; automatic ${yn(r.automatic)}. ${r.note || ''} (${r.citation || 'no citation'})`) });
    }
  }
  for (const [st, r] of Object.entries(JUVENILE_SEALING_DATA)) {
    const shown = VERDICT.has(r.status) && ok(r.source_url) && !!clean(r.citation);
    out.push({ dataset: 'juvenile', key: st, label: `${st} — juvenile record sealing`, state: st, jurisdiction: st,
      source_url: ok(r.source_url) ? r.source_url.trim() : null, checked: EXPUNGEMENT_DATE, shown, storage: 'code',
      text: clean(`${st} juvenile records: automatic ${yn(r.automatic)}; when: ${r.when || '—'}. ${r.notes || ''} (${r.citation || 'no citation'})`) });
  }
  for (const [st, r] of Object.entries(RECORDING_LAWS)) {
    out.push({ dataset: 'recording', key: st, label: `${st} — recording-consent law`, state: st, jurisdiction: st,
      source_url: ok(r.source_url) ? r.source_url.trim() : null, checked: EXPUNGEMENT_DATE, shown: VERDICT.has(r.status) && ok(r.source_url), storage: 'code',
      text: clean(`${st} is ${r.consent} consent (${r.citation}). ${r.note || ''}`) });
  }
  for (const r of COURT_RULES) {
    out.push({ dataset: 'court_rules', key: r.id, label: `${r.court} — ${r.title}`, state: r.state, jurisdiction: r.state,
      source_url: r.url, checked: r.checked, shown: true, storage: 'code',
      text: clean(`The court's own page "${r.title}" (${r.court}) posts rules on: ${r.covers.join(', ')}.`) });
  }
  for (const a of TRANSIT_AGENCIES) {
    out.push({ dataset: 'transit', key: `${a.state}-${a.county}`, label: `${a.agency} (${a.county} County, ${a.state})`, state: a.state, jurisdiction: a.state,
      source_url: a.source_url, checked: a.checked, shown: true, storage: 'code',
      text: clean(`${a.agency} is the public transit agency serving ${a.serves}; its website is ${a.url}.`) });
  }
  for (const [id, s] of Object.entries(GUIDE_CORPUS.sources || {})) {
    if (!ok(s.url)) continue;   // the app's own sourced content (rights card, record clearing) — checked through those rows
    out.push({ dataset: 'guide', key: id, label: `${s.org} — ${s.page}`, state: null, jurisdiction: null,
      source_url: s.url, checked: s.checked, shown: true, storage: 'code',
      text: clean(`${s.org} publishes the page "${s.page}" (used by the court guide / case steps for general court-day and case-stage information).`) });
  }
  out.push({ dataset: 'tn_report', key: 'tn_quarterly', label: 'Tennessee quarterly bail bondsman report (Bond Desk)', state: 'TN', jurisdiction: 'TN',
    source_url: TN_REPORT.sources[1], checked: TN_REPORT.checked_on, shown: true, storage: 'code',
    text: clean(`Tennessee bail bondsmen must file a quarterly report with the Department of Revenue: ${TN_REPORT.form}. Required by ${TN_REPORT.citation}.`) });
  for (const s of GENERAL_SECTIONS.slice(0, 3)) {
    out.push({ dataset: 'rights_card', key: s.key, label: `Rights card — ${s.heading}`, state: null, jurisdiction: 'FED',
      source_url: null, checked: `${CONTENT_LAST_REVIEWED}-01`, shown: true, storage: 'code',
      text: clean(`${s.heading}: ${s.body} (Source named: ${s.source})`) });
  }
  for (const [setKey, set] of Object.entries(deadlineSets || {})) {
    for (const rule of set.rules || []) {
      const federal = /\b(FRCP|FRAP|Fed\. ?R\.|U\.S\.C\.|FRE)\b/.test(String(rule.rule || ''));
      out.push({ dataset: 'deadlines', key: `${setKey}.${rule.id}`, label: `${set.label} — ${rule.title}`, state: null, jurisdiction: federal ? 'FED' : null,
        source_url: null, checked: null, shown: true, storage: 'code',
        text: clean(`${rule.title}: ${rule.days} ${rule.business ? 'business ' : ''}days after the ${String(set.trigger || '').replace(/_/g, ' ')} (${rule.rule}).`) });
    }
  }
  return out;
}

async function dbRows(db) {
  const out = [];
  if (!db || db.engine !== 'postgres') return out;
  for (const [table, def] of Object.entries(DB_DATASETS)) {
    let rows = [];
    try {
      // Bounded: these reference tables hold at most a few hundred rows each.
      rows = await db.all(`SELECT * FROM ${table} ORDER BY id ASC LIMIT 5000`);
    } catch { continue; }
    for (const r of rows) {
      const shown = table === 'rights_cards' ? !!r.source_url : isVerifiedRow(r);
      const checked = r.last_reviewed_at || r.content_verified_at || null;
      out.push({ dataset: table, key: String(r.id), id: Number(r.id), table, label: def.label(r), state: r.state ? String(r.state).toUpperCase() : null,
        jurisdiction: r.state ? (['ALL', 'FED'].includes(String(r.state).toUpperCase()) ? 'FED' : String(r.state).toUpperCase()) : null,
        source_url: ok(r.source_url) ? r.source_url.trim() : null, checked: checked ? new Date(checked).toISOString().slice(0, 10) : null,
        shown, storage: 'db', text: clean(def.text(r)) });
    }
  }
  return out;
}

/** How a row can be checked: recheck (shown, official source) | propose | not_official | no_url. */
export function checkMode(row) {
  if (!row.shown) return 'propose';                          // withheld: only ever a proposal for a human
  if (row.source_url && isAllowedUrl(row.source_url)) return 'recheck';
  return row.source_url ? 'not_official' : 'no_url';
}

/** Every row (code + database). */
export async function allRows(db) {
  const { RULE_SETS } = await import('../../routes/docket.js');
  return [...codeRows({ deadlineSets: RULE_SETS }), ...await dbRows(db)];
}

export function findRowIn(rows, dataset, key) {
  return rows.find((r) => r.dataset === dataset && r.key === String(key)) || null;
}
