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

export const CONTENT_LAST_REVIEWED = '2026-04';
const CARD_SOURCE = 'Justice Gavel rights card — based on published state statutes and case law (as recorded April 2026)';
const STATE_SOURCE = 'Published state statutes and case law (Justice Gavel state summary, as recorded April 2026; no specific citation recorded)';

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

/**
 * The general (federal / constitutional) card. Text is identical to the
 * English bundled card (en.json rc_h1-8 / rc_b1-8), which the app shows offline and
 * translates; `key` is the i18n suffix (rc_h1 / rc_b1 → 'rc_1').
 */
export const GENERAL_SECTIONS = Object.freeze([
  section('rc_1', 'silence', '1. RIGHT TO REMAIN SILENT  (5th Amendment)',
    'Say clearly: "I am invoking my right to remain silent."\n\nThen stop talking. You do NOT have to answer any questions — not your name, not where you came from, nothing. Anything you say CAN and WILL be used against you in court. Silence cannot be used as evidence of guilt.\n\nThis right applies: during a traffic stop · at your door · at the police station · after arrest.',
    'U.S. Constitution, 5th Amendment (as summarized in the Justice Gavel rights card)'),
  section('rc_2', 'lawyer', '2. RIGHT TO A LAWYER  (6th Amendment)',
    'Say clearly: "I want a lawyer. I will not answer questions without a lawyer present."\n\nOnce you ask for a lawyer, police MUST stop questioning you immediately. Do not answer any more questions until your lawyer arrives — even if they say it will help you, even if they say the lawyer is on the way.\n\nIf you cannot afford a lawyer, one will be appointed for you at no cost. Ask: "I want a public defender."',
    'U.S. Constitution, 6th Amendment (as summarized in the Justice Gavel rights card)'),
  section('rc_3', 'search', '3. RIGHT AGAINST UNLAWFUL SEARCH  (4th Amendment)',
    'Say clearly: "I do not consent to a search."\n\nPolice CANNOT search your home without a warrant signed by a judge. They cannot search your car without probable cause or your consent. Your refusal cannot be used as probable cause.\n\nIf they search anyway: do not physically resist. Say "I do not consent" calmly and clearly. Challenge the illegal search in court — that is how suppression motions win.',
    'U.S. Constitution, 4th Amendment (as summarized in the Justice Gavel rights card)'),
  section('rc_4', 'charges', '4. RIGHT TO KNOW THE CHARGES',
    'After arrest you have the right to be told what you are charged with. Ask: "What am I being charged with?"\n\nYou have the right to an arraignment — usually within 24 to 72 hours of arrest — where charges are formally read and bail is set. You have the right to enter a plea.',
    CARD_SOURCE),
  section('rc_5', 'traffic_stop', '5. DURING A TRAFFIC STOP',
    'You must provide: driver\'s license, registration, and proof of insurance.\n\nYou do NOT have to: answer questions about where you are going, consent to a search of your vehicle, or answer questions about whether you have been drinking.\n\nKeep your hands visible. Move slowly. Say: "I do not consent to a search. Am I free to go?"',
    CARD_SOURCE),
  section('rc_6', 'arrest', '6. DURING ARREST — STAY CALM',
    'Do not physically resist — even if the arrest is unlawful. Resisting adds new charges.\n\nDo NOT: argue, run, reach into your clothing, make sudden movements, sign anything.\n\nDO: stay calm, say "I am invoking my right to remain silent and I want a lawyer," remember badge numbers and officer names, call a lawyer or family member as soon as possible.',
    CARD_SOURCE),
  section('rc_7', 'bail', '7. BAIL AND RELEASE',
    'At your bail hearing, the judge considers: severity of charges, criminal history, flight risk, and community ties.\n\nYou have the right to argue for lower bail. A bail bondsman can post the bail for you for a fee — ask the agent what they charge before you sign anything.\n\nOpen Justice Gavel → tap HELP NOW to find a bondsman and lawyer instantly.',
    CARD_SOURCE),
  section('rc_8', 'phone_call', '8. PHONE CALL RIGHT',
    'After arrest, ask to make a phone call. Most (not all) states allow this within a reasonable time after booking.\n\nUse the call for:\n• A criminal defense attorney\n• A bail bondsman\n• A trusted family member\n\nNote: The right to a phone call varies by state. Some states have no statutory guarantee. If denied, document when you asked.',
    CARD_SOURCE),
]);

/**
 * The 30-second "what to say / what not to do" script. Every line is lifted
 * from the card above (or the existing Just Arrested guidance on jail calls);
 * `from` names the section it comes from. i18n keys: rs_say_N / rs_dont_N.
 */
export const SCRIPT = Object.freeze({
  say: [
    { key: 'rs_say_1', text: 'I am invoking my right to remain silent.', from: 'rc_1' },
    { key: 'rs_say_2', text: 'I want a lawyer.', from: 'rc_2' },
    { key: 'rs_say_3', text: 'I do not consent to a search.', from: 'rc_3' },
    { key: 'rs_say_4', text: 'Am I free to go?', from: 'rc_5' },
    { key: 'rs_say_5', text: 'What am I being charged with?', from: 'rc_4' },
  ],
  dont: [
    { key: 'rs_dont_1', text: 'Do not answer questions without a lawyer.', from: 'rc_2' },
    { key: 'rs_dont_2', text: 'Do not physically resist, run or argue.', from: 'rc_6' },
    { key: 'rs_dont_3', text: 'Do not sign anything.', from: 'rc_6' },
    { key: 'rs_dont_4', text: 'Do not consent to a search.', from: 'rc_3' },
    { key: 'rs_dont_5', text: 'Do not talk about your case on jail phone calls — they are recorded.', from: 'just_arrested' },
  ],
  source: 'Summarized from the Justice Gavel rights card (sections 1–6) and its Just Arrested guidance',
  last_reviewed: CONTENT_LAST_REVIEWED,
  lawyer_reviewed: false,
});

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
export const reviewPendingNotice = (name) =>
  `State-specific details for ${name} haven't been reviewed yet — ask a local lawyer or public defender.`;

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
  };
}

function mergeRows(base, rows) {
  const out = base.map(s => ({ ...s }));
  for (const r of rows) {
    const s = rowToSection(r);
    // Never show a database row that has no recorded source (owner rule).
    if (!s.source) continue;
    const i = out.findIndex(x => x.key === s.key || x.topic === s.topic);
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
         FROM rights_cards WHERE language = 'en' AND state IS NOT NULL AND UPPER(state) <> 'US' LIMIT 2000`);
    for (const r of rows) {
      const sec = rowToSection(r);
      if (sec.source && isReviewedStateSection(sec) && STATE_NAMES[r.state]) out.add(r.state);
    }
  } catch { /* no table / DB down → none */ }
  return out;
}

/**
 * The full rights card for a state: general (federal) sections + the state's
 * sourced sections + the 30-second script. `db` is optional (rights_cards
 * overlay); a database failure falls back to the bundled content.
 */
export async function getRightsCard(db, rawState, { lang = 'en' } = {}) {
  const code = normalizeState(rawState);
  const language = 'en'; // only English content is recorded on the server; the app translates the bundled card
  let general = GENERAL_SECTIONS.map(s => ({ ...s }));
  // Only cited / reviewed rights_cards rows become state sections; the
  // built-in unreviewed summaries are never shown.
  let specific = [];
  if (db) {
    try {
      const rows = await db.all(
        `SELECT topic, title, content, state, source, source_url, content_verified_at, reviewed_by, needs_review
           FROM rights_cards
          WHERE language = ? AND (state IS NULL OR UPPER(state) IN ('US', ?))
          ORDER BY COALESCE(sort_order, 1000), id
          LIMIT 100`,
        [language, code || 'US']);
      general  = mergeRows(general, rows.filter(r => !r.state || String(r.state).toUpperCase() === 'US'));
      if (code) {
        specific = mergeRows([], rows.filter(r => r.state && String(r.state).toUpperCase() === code))
          .filter(isReviewedStateSection);
      }
    } catch { /* bundled content stays */ }
  }
  const name = code ? STATE_NAMES[code] : null;
  return {
    state: code || 'US',
    state_name: name,
    language,
    requested_language: String(lang || 'en').slice(0, 5),
    general,
    state_specific: specific,
    state_specific_available: specific.length > 0,
    state_notice: !code
      ? 'Choose your state to see state-specific details.'
      : specific.length ? null : reviewPendingNotice(name),
    script: SCRIPT,
    lawyer_review: 'pending',
    disclaimer: 'General legal information only — not legal advice. Laws vary by state and change. Talk to a licensed attorney about your situation.',
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

/** Shape of the old GET /api/lessons/rights-card response, built from the same content. */
export function buildLegacyRightsCard(rawState) {
  const code = normalizeState(rawState) || 'US';
  const stateName = STATE_NAMES[code] || code;
  // The built-in state summaries are unreviewed: never shown (see top of file).
  const general = GENERAL_SECTIONS.slice(0, 3).map(s => ({ heading: s.heading, body: s.body }));
  const rights = [
    ...general,
    { heading: '4. DURING ARREST', body: GENERAL_SECTIONS[5].body },
    { heading: '5. YOUR KEY PHRASES', body: '"I am invoking my right to remain silent."\n"I want a lawyer."\n"I do not consent to a search."' },
  ];
  return {
    state: code,
    stateName,
    mustID: null,
    title: 'Know Your Rights',
    subtitle: `${stateName} — What to say & do if you're stopped or arrested`,
    brandLine: 'JusticeGavel.app  ·  Free legal help  ·  Available 24/7',
    rights,
    emergency: [
      `Bail help:  JusticeGavel.app → Bail Finder (${stateName})`,
      `Lawyer:     JusticeGavel.app → Find a Lawyer (${stateName})`,
    ],
    footer: 'General legal information only — not legal advice. Laws change. Verify with a licensed attorney in your state.',
    state_notice: code === 'US' ? null : reviewPendingNotice(stateName),
    last_updated: CONTENT_LAST_REVIEWED,
    source_note: 'Based on published state statutes and case law as of April 2026.',
  };
}
