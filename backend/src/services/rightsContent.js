/**
 * services/rightsContent.js — the ONE place the app's know-your-rights content
 * lives on the server (rights card, 30-second script, AI grounding, legacy
 * /api/lessons/rights-card).
 *
 * Legal-content rules (owner):
 *   - Nothing here is new law. The general card is the app's existing bundled
 *     card (frontend/src/i18n/en.json rc_h1…rc_b8 — rights_content.test.js
 *     fails if the two drift) and the state notes are the existing per-state
 *     summaries that used to live in routes/lessons.js.
 *   - Every section carries the source the repo records for it and the date
 *     the repo records it was last reviewed ("2026-04"). lawyer_reviewed is
 *     false everywhere until a licensed attorney signs it off (owner action;
 *     reviewed rows go in the rights_cards table with reviewed_by set, and a
 *     database row replaces the bundled section with the same key).
 *   - A state section is shown (and given to the AI) ONLY when it carries a
 *     real citation — a source_url, or a specific statute cite in its source
 *     ("Tenn. Code Ann. § 40-7-123") — or a reviewer (reviewed_by). See
 *     isReviewedStateSection(). The built-in per-state summaries below
 *     (STATE_RIGHTS) have neither, so they are kept in the repo as unreviewed
 *     draft material and are never rendered or sent to the AI: every state gets
 *     the general card plus REVIEW_PENDING_NOTICE until a cited / reviewed
 *     rights_cards row is added, which then shows automatically.
 *   - The unsourced "a bondsman charges about 10%" line was removed from the
 *     card: there is no sourced per-state premium data in the repo.
 */

import { msg, normalizeLang, stateName as localStateName } from '../i18n/index.js';

export const CONTENT_LAST_REVIEWED = '2026-04';
const STATE_SOURCE = msg('en', 'rights.source.state');

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington D.C.', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  // Territories: listed so people there can pick them; no state notes recorded yet.
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

/** 'tn' / ' TN ' → 'TN'; anything that is not a known code → null. */
export function normalizeState(s) {
  const code = String(s ?? '').trim().toUpperCase().slice(0, 2);
  return STATE_NAMES[code] ? code : null;
}

const section = (key, topic, heading, body, source) => ({
  key, topic, heading, body, source, source_url: null,
  last_reviewed: CONTENT_LAST_REVIEWED, lawyer_reviewed: false, reviewed_by: null,
});

const GENERAL_TOPICS = Object.freeze([
  ['rc_1', 'silence'], ['rc_2', 'lawyer'], ['rc_3', 'search'], ['rc_4', 'charges'],
  ['rc_5', 'traffic_stop'], ['rc_6', 'arrest'], ['rc_7', 'bail'], ['rc_8', 'phone_call'],
]);
const SOURCE_KEY = { rc_1: 'rights.source.rc_1', rc_2: 'rights.source.rc_2', rc_3: 'rights.source.rc_3' };

/**
 * The general (federal / constitutional) card in `lang` (en / es / pt / vi).
 * The text is the app's bundled card (frontend/src/i18n/<lang>.json rc_h1-8 /
 * rc_b1-8 — i18n_server_content.test.js fails if they drift); `key` is the
 * i18n suffix (rc_h1 / rc_b1 → 'rc_1'). Every section says which language it is in.
 */
export function generalSections(lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  return GENERAL_TOPICS.map(([key, topic]) => ({
    ...section(key, topic, msg(l, `rights.${key}.heading`), msg(l, `rights.${key}.body`), msg(l, SOURCE_KEY[key] || 'rights.source.card')),
    language: l,
  }));
}

/** The English general card (AI grounding, legacy callers, tests). */
export const GENERAL_SECTIONS = Object.freeze(generalSections('en').map(s => Object.freeze(s)));

/**
 * The 30-second "what to say / what not to do" script. Every line is lifted
 * from the card above (or the existing Just Arrested guidance on jail calls);
 * `from` names the section it comes from. i18n keys: rs_say_N / rs_dont_N.
 */
const SCRIPT_FROM = Object.freeze({
  say: [['rs_say_1', 'rc_1'], ['rs_say_2', 'rc_2'], ['rs_say_3', 'rc_3'], ['rs_say_4', 'rc_5'], ['rs_say_5', 'rc_4']],
  dont: [['rs_dont_1', 'rc_2'], ['rs_dont_2', 'rc_6'], ['rs_dont_3', 'rc_6'], ['rs_dont_4', 'rc_3'], ['rs_dont_5', 'just_arrested']],
});
export function scriptFor(lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  const line = ([key, from]) => ({ key, text: msg(l, `rights.${key}`), from });
  return {
    say: SCRIPT_FROM.say.map(line),
    dont: SCRIPT_FROM.dont.map(line),
    source: msg(l, 'rights.script.source'),
    last_reviewed: CONTENT_LAST_REVIEWED,
    lawyer_reviewed: false,
    language: l,
  };
}
export const SCRIPT = Object.freeze(scriptFor('en'));

// ── Per-state notes (moved unchanged from routes/lessons.js) ────────────────
// Source recorded with them: "Published state statutes and case law —
// Last verified: April 2026".
export const STATE_RIGHTS = Object.freeze({
  AL: {
    stopRule: 'Alabama: You must provide your name if lawfully detained. You do not have to show ID.',
    bailNote: 'Alabama sets bail at initial appearance, usually within 72 hours of arrest.',
    mustID: true,
  },
  AK: {
    stopRule: 'Alaska: You must provide your name and address if lawfully stopped by police.',
    bailNote: 'Alaska arraignment typically within 24–48 hours.',
    mustID: true,
  },
  AZ: {
    stopRule: 'Arizona: You must provide your name if detained. You may also be asked for your address and an explanation of your actions.',
    bailNote: 'Arizona: Initial appearance within 24 hours. Release on recognizance possible for minor offenses.',
    mustID: true,
  },
  AR: {
    stopRule: 'Arkansas: You must provide your name, address, and an explanation of your actions if lawfully stopped.',
    bailNote: 'Arkansas bail set at arraignment, typically within 48 hours.',
    mustID: true,
  },
  CA: {
    stopRule: 'California: You do NOT have to provide ID unless you are driving or under arrest. You may calmly state: "I do not wish to answer questions."',
    bailNote: 'California: Bail schedule varies by county. Some offenses have zero-bail policies. Contact a bondsman immediately.',
    mustID: false,
  },
  CO: {
    stopRule: 'Colorado: You must provide your name and address if lawfully detained.',
    bailNote: 'Colorado: Initial appearance within 48 hours. PR bonds (release without bail) available for non-violent charges.',
    mustID: true,
  },
  CT: {
    stopRule: 'Connecticut: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Connecticut: Arraignment within 24–48 hours. Bail commissioner may set bond before court.',
    mustID: false,
  },
  DE: {
    stopRule: 'Delaware: You must provide your name if lawfully detained.',
    bailNote: 'Delaware: Initial appearance within 24 hours of arrest.',
    mustID: true,
  },
  DC: {
    stopRule: 'Washington D.C.: You are not required to identify yourself to police during a Terry stop.',
    bailNote: 'D.C.: Arraignment within 24 hours. Pretrial Services Agency may recommend release conditions.',
    mustID: false,
  },
  FL: {
    stopRule: 'Florida: You must provide your name and address if lawfully stopped. You do not have to produce a photo ID unless driving.',
    bailNote: 'Florida: First appearance within 24 hours. Bond amount set by judge at first appearance.',
    mustID: true,
  },
  GA: {
    stopRule: 'Georgia: You must provide your name and address if lawfully detained.',
    bailNote: 'Georgia: First appearance typically within 48–72 hours. Bail bondsmen are common.',
    mustID: true,
  },
  HI: {
    stopRule: 'Hawaii: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Hawaii: Arraignment within 48 hours. Hawaii has a bail reform program prioritizing non-monetary release.',
    mustID: false,
  },
  ID: {
    stopRule: 'Idaho: You must provide your name if lawfully detained.',
    bailNote: 'Idaho: Initial appearance within 48 hours. Bail set by magistrate.',
    mustID: true,
  },
  IL: {
    stopRule: 'Illinois: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Illinois: Pretrial Fairness Act (2023) — cash bail abolished. Release conditions set by judge.',
    mustID: true,
  },
  IN: {
    stopRule: 'Indiana: You must provide your name if lawfully stopped. You do not have to provide your address.',
    bailNote: 'Indiana: Initial hearing within 48 hours. PR bonds available.',
    mustID: true,
  },
  IA: {
    stopRule: 'Iowa: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Iowa: Initial appearance within 24 hours. Bail schedule set by county.',
    mustID: false,
  },
  KS: {
    stopRule: 'Kansas: You must provide your name if detained on reasonable suspicion.',
    bailNote: 'Kansas: First appearance within 48 hours of arrest.',
    mustID: true,
  },
  KY: {
    stopRule: 'Kentucky: You must provide your name if lawfully stopped.',
    bailNote: 'Kentucky: Arraignment within 24–48 hours. Bail set by District Court judge.',
    mustID: true,
  },
  LA: {
    stopRule: 'Louisiana: You must provide your name and, if applicable, address if detained. Louisiana uses the Civil Code — your rights follow federal standards during stops.',
    bailNote: 'Louisiana: First appearance within 72 hours. Bail bondsmen widely available.',
    mustID: true,
  },
  ME: {
    stopRule: 'Maine: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Maine: Initial appearance within 48 hours. Court commissioners set bail.',
    mustID: false,
  },
  MD: {
    stopRule: 'Maryland: You are not required to identify yourself during a Terry stop. You may calmly decline to answer.',
    bailNote: 'Maryland: Initial appearance within 24 hours. Pretrial release is common for non-violent charges.',
    mustID: false,
  },
  MA: {
    stopRule: 'Massachusetts: You must provide your name if stopped on reasonable suspicion. You do not have to show ID unless driving.',
    bailNote: 'Massachusetts: Arraignment typically within 24 hours. Bail set by District Court.',
    mustID: true,
  },
  MI: {
    stopRule: 'Michigan: You are not required to identify yourself during a Terry stop. However, you must identify yourself if operating a vehicle.',
    bailNote: 'Michigan: Arraignment within 48 hours. Michigan Clean Slate law (2021) expanded bail reform.',
    mustID: false,
  },
  MN: {
    stopRule: 'Minnesota: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Minnesota: First appearance within 36 hours (48 on weekends). Omnibus hearing follows.',
    mustID: true,
  },
  MS: {
    stopRule: 'Mississippi: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Mississippi: Initial appearance within 48 hours. Justice Court handles bail for misdemeanors.',
    mustID: false,
  },
  MO: {
    stopRule: 'Missouri: You are not required to identify yourself during a Terry stop. Remain calm and silent.',
    bailNote: 'Missouri: Initial appearance within 24 hours. Bail set at first appearance.',
    mustID: false,
  },
  MT: {
    stopRule: 'Montana: You must provide your name and present ID if you have it when lawfully stopped.',
    bailNote: 'Montana: Initial appearance within 48 hours.',
    mustID: true,
  },
  NE: {
    stopRule: 'Nebraska: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Nebraska: First appearance within 24–48 hours. County courts set bail.',
    mustID: true,
  },
  NV: {
    stopRule: 'Nevada: You must identify yourself if stopped on reasonable suspicion. Provide your name.',
    bailNote: 'Nevada: Initial appearance within 48 hours. Justice Courts handle bail.',
    mustID: true,
  },
  NH: {
    stopRule: 'New Hampshire: You are not required to identify yourself during a Terry stop.',
    bailNote: 'New Hampshire: Arraignment within 24 hours. Bail commissioner may set conditions before court.',
    mustID: false,
  },
  NJ: {
    stopRule: 'New Jersey: You are not required to identify yourself during a Terry stop. New Jersey eliminated cash bail in 2017.',
    bailNote: 'New Jersey: Pretrial detention hearing within 48 hours. No cash bail — risk assessment determines release.',
    mustID: false,
  },
  NM: {
    stopRule: 'New Mexico: You are not required to identify yourself during a Terry stop.',
    bailNote: 'New Mexico: Eliminated cash bail in 2016. Detention hearing within 24 hours.',
    mustID: false,
  },
  NY: {
    stopRule: 'New York: You are not required to show ID during a stop. You must provide your name if detained. You may say: "I am exercising my right to remain silent."',
    bailNote: 'New York: Arraignment within 24 hours (less in NYC). Bail eliminated for most misdemeanors and non-violent felonies (2020 reform).',
    mustID: false,
  },
  NC: {
    stopRule: 'North Carolina: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'North Carolina: First appearance within 48 hours. Bail bondsmen widely available.',
    mustID: true,
  },
  ND: {
    stopRule: 'North Dakota: You must provide your name if lawfully stopped.',
    bailNote: 'North Dakota: Initial appearance within 48 hours.',
    mustID: true,
  },
  OH: {
    stopRule: 'Ohio: You must provide your name and address if lawfully detained.',
    bailNote: 'Ohio: Arraignment within 48 hours. Bail reform ongoing at county level.',
    mustID: true,
  },
  OK: {
    stopRule: 'Oklahoma: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Oklahoma: First appearance within 48 hours. Bail reform (SQ 805) failed in 2020 — traditional bail bondsmen.',
    mustID: true,
  },
  OR: {
    stopRule: 'Oregon: You are not required to identify yourself during a Terry stop. Measure 110 (2021) affects drug-related stops.',
    bailNote: 'Oregon: First appearance within 36 hours. Release on recognizance common for minor charges.',
    mustID: false,
  },
  PA: {
    stopRule: 'Pennsylvania: You are not required to identify yourself during a Terry stop. You may decline to answer questions.',
    bailNote: 'Pennsylvania: Preliminary arraignment within 6 hours of arrest (must be prompt). Bail set by Magisterial District Judge.',
    mustID: false,
  },
  RI: {
    stopRule: 'Rhode Island: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Rhode Island: Bail set at District Court arraignment within 48 hours.',
    mustID: false,
  },
  SC: {
    stopRule: 'South Carolina: You must provide your name and address if lawfully detained.',
    bailNote: 'South Carolina: Bond hearing within 24 hours. Note: UPL laws in SC are strict — get a licensed attorney.',
    mustID: true,
  },
  SD: {
    stopRule: 'South Dakota: You must provide your name and address if lawfully stopped.',
    bailNote: 'South Dakota: Initial appearance within 48 hours.',
    mustID: true,
  },
  TN: {
    stopRule: 'Tennessee: You must provide your name if police have reasonable suspicion you committed a crime (T.C.A. § 40-7-123). You do not have to answer other questions.',
    bailNote: 'Tennessee: Commissioner sets bail within hours. General Sessions Court handles bail review.',
    mustID: true,
  },
  TX: {
    stopRule: 'Texas: You must provide your name, address, and date of birth if lawfully stopped (Tex. Penal Code § 38.02). Failure to identify is a Class C misdemeanor.',
    bailNote: 'Texas: Magistrate appearance within 48 hours. Personal bonds available for most misdemeanors.',
    mustID: true,
  },
  UT: {
    stopRule: 'Utah: You must provide your name if stopped on reasonable suspicion.',
    bailNote: 'Utah: Initial appearance within 72 hours. Utah has a legal tech sandbox — bail reform ongoing.',
    mustID: true,
  },
  VT: {
    stopRule: 'Vermont: You are not required to identify yourself during a Terry stop.',
    bailNote: 'Vermont: Arraignment within 48 hours. Vermont has no commercial bail bondsmen — court sets conditions.',
    mustID: false,
  },
  VA: {
    stopRule: 'Virginia: You are not required to identify yourself during a Terry stop. You may remain silent.',
    bailNote: 'Virginia: Bail hearing within 72 hours. Virginia eliminated cash bail for most misdemeanors (2021).',
    mustID: false,
  },
  WA: {
    stopRule: 'Washington: You are not required to identify yourself during a Terry stop. You may politely decline to answer.',
    bailNote: 'Washington: First appearance within 72 hours. Release on personal recognizance common for non-violent offenses.',
    mustID: false,
  },
  WV: {
    stopRule: 'West Virginia: You must provide your name and address if lawfully stopped.',
    bailNote: 'West Virginia: Magistrate hearing within 24 hours of arrest.',
    mustID: true,
  },
  WI: {
    stopRule: 'Wisconsin: You must provide your name and address if stopped on reasonable suspicion.',
    bailNote: 'Wisconsin: Initial appearance within 48 hours. Bail set by Circuit Court commissioner.',
    mustID: true,
  },
  WY: {
    stopRule: 'Wyoming: You must provide your name if lawfully stopped.',
    bailNote: 'Wyoming: Initial appearance within 48 hours.',
    mustID: true,
  },
});
/** Shown for a state until a cited / reviewed state section exists. */
export const reviewPendingNotice = (name, lang = 'en') => msg(lang, 'rights.notice.review_pending', { state: name });

// A specific statute / code citation in a source string: a section sign, or a
// code / statute abbreviation followed by a number ("Tex. Penal Code 38.02",
// "Fla. Stat. 856.021", "18 U.S.C. 3142"). Generic text ("published state
// statutes and case law") does not match.
const STATUTE_CITE_RE = /§\s*\d|\b(?:Code|Stat|Stats|Ann|Laws|Rev|Penal|Crim|Proc|C\.R\.S|U\.S\.C|ILCS|RCW|ORS|MCL|CGS)\b\.?[^\n]{0,40}?\d/;
export function hasStatuteCitation(source) {
  return STATUTE_CITE_RE.test(String(source || ''));
}
/** True when a state section may be shown / given to the AI: cited (URL or statute cite) or lawyer-reviewed. */
export function isReviewedStateSection(s) {
  return !!(s && (s.source_url || s.reviewed_by || hasStatuteCitation(s.source)));
}

/**
 * The built-in (UNREVIEWED) per-state summaries for a state code, as sections.
 * Draft material for a reviewer — never rendered to users or fed to the AI
 * (no citation, no reviewer; isReviewedStateSection() is false for all).
 */
export function unreviewedStateNotes(code) {
  const s = STATE_RIGHTS[code];
  if (!s) return [];
  const name = STATE_NAMES[code] || code;
  const out = [];
  if (s.stopRule) out.push({ ...section(`state_stop_${code}`, 'stop_identify', `IF STOPPED — ${name.toUpperCase()}`, s.stopRule, STATE_SOURCE), must_id: s.mustID ?? null });
  if (s.bailNote) out.push(section(`state_bail_${code}`, 'state_bail', `BAIL — ${name.toUpperCase()}`, s.bailNote, STATE_SOURCE));
  return out;
}

function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** rights_cards row → section (database content wins over the bundled text). */
function rowToSection(r) {
  return {
    key: String(r.topic), topic: String(r.topic), heading: r.title || '', body: r.content || '',
    source: r.source || null, source_url: r.source_url || null,
    last_reviewed: dateOnly(r.content_verified_at),
    lawyer_reviewed: !!r.reviewed_by, reviewed_by: r.reviewed_by || null,
    needs_review: Number(r.needs_review || 0) === 1,
    language: normalizeLang(r.language) || 'en',
  };
}

/**
 * Overlay database rows on `base`. `lang` is the language being served:
 * a row in that language replaces the bundled section; an English row
 * replaces a translated section only when a lawyer reviewed it (reviewed text
 * beats an unreviewed translation — the section then says language 'en').
 */
function mergeRows(base, rows, lang = 'en') {
  const out = base.map(s => ({ ...s }));
  const ordered = [...rows].sort((a, b) => (normalizeLang(a.language) === lang ? 1 : 0) - (normalizeLang(b.language) === lang ? 1 : 0));
  for (const r of ordered) {
    const s = rowToSection(r);
    // Never show a database row that has no recorded source (owner rule).
    if (!s.source) continue;
    const i = out.findIndex(x => x.key === s.key || x.topic === s.topic);
    if (s.language !== lang) {
      if (i >= 0 && out[i].language === lang && !s.lawyer_reviewed) continue;
    }
    if (i >= 0) out[i] = s; else out.push(s);
  }
  return out;
}

/** State codes that have at least one cited / reviewed rights_cards row (shown as state-specific). */
export async function reviewedStateCodes(db) {
  const out = new Set();
  if (!db) return out;
  try {
    const rows = await db.all(
      `SELECT UPPER(state) AS state, topic, title, content, source, source_url, content_verified_at, reviewed_by, needs_review
         FROM rights_cards WHERE state IS NOT NULL AND UPPER(state) <> 'US' LIMIT 2000`);
    for (const r of rows) {
      const sec = rowToSection(r);
      if (sec.source && isReviewedStateSection(sec) && STATE_NAMES[r.state]) out.add(r.state);
    }
  } catch { /* no table / DB down → none */ }
  return out;
}

/**
 * The full rights card for a state, in `lang` (en / es / pt / vi; anything
 * else → English): general (federal) sections + the state's sourced sections
 * + the 30-second script. `language` is the language the card's bundled text
 * is in; every section carries its own `language` (a reviewed English
 * database section may appear in a translated card — `mixed_language` is then
 * true). `db` is optional (rights_cards overlay); a database failure falls
 * back to the bundled content.
 */
export async function getRightsCard(db, rawState, { lang = 'en' } = {}) {
  const code = normalizeState(rawState);
  const language = normalizeLang(lang) || 'en';
  let general = generalSections(language);
  // Only cited / reviewed rights_cards rows become state sections; the
  // built-in unreviewed summaries are never shown.
  let specific = [];
  if (db) {
    try {
      const rows = await db.all(
        `SELECT topic, title, content, state, source, source_url, content_verified_at, reviewed_by, needs_review, language
           FROM rights_cards
          WHERE language IN (?, 'en') AND (state IS NULL OR UPPER(state) IN ('US', ?))
          ORDER BY COALESCE(sort_order, 1000), id
          LIMIT 200`,
        [language, code || 'US']);
      general  = mergeRows(general, rows.filter(r => !r.state || String(r.state).toUpperCase() === 'US'), language);
      if (code) {
        const stateRows = rows.filter(r => r.state && String(r.state).toUpperCase() === code);
        // Per topic: the row in the served language when there is one, else the English row.
        const byTopic = new Map();
        for (const r of stateRows) {
          const prev = byTopic.get(r.topic);
          if (!prev || (normalizeLang(r.language) === language && normalizeLang(prev.language) !== language)) byTopic.set(r.topic, r);
        }
        specific = mergeRows([], [...byTopic.values()], language).filter(isReviewedStateSection);
      }
    } catch { /* bundled content stays */ }
  }
  const name = code ? STATE_NAMES[code] : null;
  const localName = code ? localStateName(code, name, language) : null;
  const sections = [...general, ...specific];
  return {
    state: code || 'US',
    state_name: name,
    state_name_local: localName,
    language,
    requested_language: String(lang || 'en').slice(0, 5),
    mixed_language: sections.some(s => s.language !== language),
    general,
    state_specific: specific,
    state_specific_available: specific.length > 0,
    state_notice: !code
      ? msg(language, 'rights.notice.choose_state')
      : specific.length ? null : reviewPendingNotice(localName, language),
    script: scriptFor(language),
    lawyer_review: 'pending',
    disclaimer: msg(language, 'rights.disclaimer'),
  };
}

/**
 * Short grounding block for the AI chat: the general card text, with section
 * keys to cite. The unreviewed per-state summaries are NOT included.
 */
export function rightsPromptBlock(rawState) {
  const code = normalizeState(rawState);
  const parts = ['[VERIFIED RIGHTS CONTENT — Justice Gavel rights card]'];
  for (const s of GENERAL_SECTIONS) {
    parts.push(`(${s.key}) ${s.heading}: ${s.body.replace(/\s+/g, ' ').trim()}`);
  }
  parts.push('[END VERIFIED RIGHTS CONTENT]');
  if (code) parts.push(`No reviewed state-specific rights content exists yet for ${STATE_NAMES[code]}. Do not state ${STATE_NAMES[code]}-specific rules (ID laws, deadlines, bail rules) as fact; say they vary by state and suggest asking a local lawyer or public defender.`);
  parts.push('When the question is about rights during a stop, search, questioning or arrest, answer ONLY from the verified content above and name the section you used, e.g. "(see your rights card: rc_1)". If the verified content does not answer the question, say that you are not sure and that they should talk to a lawyer or public defender — do not guess.');
  return parts.join('\n');
}

const REF_RULES = [
  [/silen|miranda|question|interrogat|talk to (the )?police/i, 'rc_1'],
  [/lawyer|attorney|public defender|counsel/i, 'rc_2'],
  [/search|warrant|consent|phone.*(look|unlock)|car.*search/i, 'rc_3'],
  [/charge|arraign|accus/i, 'rc_4'],
  [/traffic|pulled over|pull(ed)? me over|license|registration|drinking/i, 'rc_5'],
  [/arrest|handcuff|resist/i, 'rc_6'],
  [/bail|bond|release/i, 'rc_7'],
  [/phone call|one call|call (my )?(family|mom|dad)/i, 'rc_8'],
];

/** Which rights-card sections a question is about (for "From your rights card →" links). */
export function rightsRefsFor(text, reply = '') {
  const refs = new Set();
  const cited = String(reply).match(/\brc_[1-8]\b/g) || [];
  cited.forEach(k => refs.add(k));
  for (const [re, key] of REF_RULES) if (re.test(String(text))) refs.add(key);
  return [...refs].slice(0, 3).map(key => {
    const s = GENERAL_SECTIONS.find(x => x.key === key);
    return { key, heading: s.heading, source: s.source, last_reviewed: s.last_reviewed };
  });
}

/** Shape of the old GET /api/lessons/rights-card response, built from the same content (in `lang`). */
export function buildLegacyRightsCard(rawState, lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  const code = normalizeState(rawState) || 'US';
  const stateName = localStateName(code, STATE_NAMES[code] || code, l);
  const sections = generalSections(l);
  // The built-in state summaries are unreviewed: never shown (see top of file).
  const general = sections.slice(0, 3).map(s => ({ heading: s.heading, body: s.body }));
  const phrases = ['rs_say_1', 'rs_say_2', 'rs_say_3'].map(k => `"${msg(l, `rights.${k}`)}"`).join('\n');
  const rights = [
    ...general,
    { heading: msg(l, 'rights.legacy.during_arrest'), body: sections[5].body },
    { heading: msg(l, 'rights.legacy.key_phrases'), body: phrases },
  ];
  return {
    state: code,
    stateName,
    language: l,
    mustID: null,
    title: msg(l, 'rights.legacy.title'),
    subtitle: msg(l, 'rights.legacy.subtitle', { state: stateName }),
    brandLine: msg(l, 'rights.legacy.brand'),
    rights,
    emergency: [
      msg(l, 'rights.legacy.bail_help', { state: stateName }),
      msg(l, 'rights.legacy.lawyer', { state: stateName }),
    ],
    footer: msg(l, 'rights.legacy.footer'),
    state_notice: code === 'US' ? null : reviewPendingNotice(stateName, l),
    last_updated: CONTENT_LAST_REVIEWED,
    source_note: msg(l, 'rights.legacy.source_note'),
  };
}
