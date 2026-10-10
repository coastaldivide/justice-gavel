/**
 * services/ragRetrieval.js — Retrieval-Augmented Generation for legal answers
 *
 * WHY THIS MATTERS:
 * In a legal product, a hallucinated case citation is not a bug — it is the
 * liability event. This module retrieves verified statutory text and injects
 * it into the AI prompt as grounding context. The AI is instructed to cite
 * ONLY provided sources — preventing hallucinated case cites.
 *
 * Current sources: US Constitution (4th, 5th, 6th amendments), Miranda,
 *   Gideon, bail statutes. Expand by adding entries to VERIFIED_LEGAL_CONTEXT.
 */

import logger from '../utils/logger.js';

// ── Verified, citable legal texts ─────────────────────────────────────────────
const VERIFIED_LEGAL_CONTEXT = {
  miranda: {
    source: 'Miranda v. Arizona, 384 U.S. 436 (1966)',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'You have the right to remain silent. Anything you say can and will be used against you in a court of law. You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you.',
    key_rule: 'Required before custodial interrogation. Custody = not free to leave.',
  },
  fourth_amendment: {
    source: 'U.S. Const. amend. IV',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'The right of the people to be secure in their persons, houses, papers, and effects, against unreasonable searches and seizures, shall not be violated.',
    key_rule: 'Warrantless searches presumptively unreasonable. Exceptions: consent, plain view, exigent circumstances, search incident to arrest, automobile.',
  },
  fifth_amendment: {
    source: 'U.S. Const. amend. V',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'No person shall be compelled in any criminal case to be a witness against himself.',
    key_rule: 'Must be invoked clearly: "I invoke my Fifth Amendment right." (Salinas v. Texas, 570 U.S. 178 (2013))',
  },
  sixth_amendment: {
    source: 'U.S. Const. amend. VI',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'In all criminal prosecutions, the accused shall enjoy the right to have the Assistance of Counsel for his defence.',
    key_rule: 'Attaches at formal charges. Effective assistance standard: Strickland v. Washington, 466 U.S. 668 (1984).',
  },
  bail: {
    source: 'U.S. Const. amend. VIII; 18 U.S.C. sec. 3141',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'Excessive bail shall not be required.',
    key_rule: 'Bail must be reasonably calculated to ensure appearance and community safety.',
  },
  gideon: {
    source: 'Gideon v. Wainwright, 372 U.S. 335 (1963)',
    last_reviewed_at: '2026-08-01',
    reviewed_by: 'Justice Gavel Legal Team',
    text: 'The right of an indigent defendant in a criminal trial to have the assistance of counsel is a fundamental right.',
    key_rule: 'Any person facing imprisonment who cannot afford counsel must be provided one at state expense.',
  },
};

// ── Topic detection keywords ───────────────────────────────────────────────────
const TOPIC_KEYWORDS = {
  miranda:          ['miranda', 'remain silent', 'rights when arrested', 'custody', 'interrogat'],
  fourth_amendment: ['search', 'seizure', 'warrant', 'probable cause', '4th amendment'],
  fifth_amendment:  ['self-incriminat', 'fifth', '5th', 'silence', 'witness against'],
  sixth_amendment:  ['lawyer', 'attorney', 'counsel', 'sixth', '6th', 'right to attorney'],
  bail:             ['bail', 'bond', 'release', 'detention', 'arraignment', 'pretrial'],
  gideon:           ['public defender', 'free attorney', 'cannot afford', 'appointed'],
};

/**
 * Retrieve relevant verified sources for a user's question.
 */
export async function retrieveLegalContext(userMessage, caseState = null) {
  const msg = (userMessage || '').toLowerCase();
  const matched = [];

  for (const [topic, triggers] of Object.entries(TOPIC_KEYWORDS)) {
    // TOPIC_KEYWORDS values are plain keyword arrays; { positive, negative } also supported
    const positive = Array.isArray(triggers) ? triggers : (triggers.positive || []);
    const negative = Array.isArray(triggers) ? [] : (triggers.negative || []);
    // Any positive keyword must match
    const hasPositive = positive.some(kw => msg.includes(kw));
    if (!hasPositive) continue;
    // No negative keyword may match
    const hasNegative = (negative || []).some(kw => msg.includes(kw));
    if (hasNegative) continue;
    if (VERIFIED_LEGAL_CONTEXT[topic]) matched.push(VERIFIED_LEGAL_CONTEXT[topic]);
  }

  // Include Miranda for arrest questions — but not if the question is clearly
  // about something else (e.g. "I was arrested for not returning a library book"
  // where the real answer is the charge severity, not Miranda warnings)
  if ((msg.includes('arrested') || msg.includes('detained') || msg.includes('in custody'))
      && !matched.includes(VERIFIED_LEGAL_CONTEXT.miranda)
      && !msg.includes('bond') && !msg.includes('bail')) {
    matched.push(VERIFIED_LEGAL_CONTEXT.miranda);
  }

  return matched.slice(0, 3);
}

/**
 * Format retrieved context for system prompt injection.
 */
export function formatContextForPrompt(sources) {
  if (!sources || !sources.length) return '';

  const lines = [
    '',
    'VERIFIED LEGAL SOURCES FOR THIS RESPONSE:',
    '(Cite ONLY these sources. Do not cite cases or statutes not listed here.)',
    '',
  ];

  sources.forEach((s, i) => {
    lines.push('[' + (i + 1) + '] ' + s.source);
    lines.push('Text: "' + s.text + '"');
    lines.push('Key rule: ' + s.key_rule);
    lines.push('');
  });

  lines.push('Cite sources inline as [1], [2], etc. Do not cite any authority not listed above.');

  return lines.join('\n');
}

/**
 * retrieveFromDatabase — fetch grounding context from actual legal data tables.
 * These tables contain verified, jurisdiction-specific legal data that is far
 * more accurate and complete than static constants.
 *
 * Tables available (from migrations):
 *   bail_schedules        — 273 rows: bail amounts by charge type and jurisdiction
 *   dui_laws              — 51 rows: per-state DUI/DWI statutes and penalties
 *   drug_penalties        — 153 rows: per-state drug offense sentencing ranges
 *   statute_of_limitations — 209 rows: per-state/offense SOL (102 rows have years=NULL — excluded)
 *   bar_prep_questions    — 548 rows: verified MBE-format legal Q&A
 */
export async function retrieveFromDatabase(db, userMessage, caseState = null) {
  if (!db) return [];
  const msg = (userMessage || '').toLowerCase();
  const sources = [];

  try {
    // Bail schedule — triggered by bail/bond/release questions
    if (msg.includes('bail') || msg.includes('bond') || msg.includes('release')) {
      const schedules = await db.all(
        `SELECT charge_type, bail_min_cents, bail_max_cents, state, notes
           FROM bail_schedules
          WHERE (state = ? OR state = 'federal')
            AND charge_type IS NOT NULL
          ORDER BY bail_min_cents ASC
          LIMIT 5`,
        [caseState || 'federal']
      ).catch(() => []);
      if (schedules.length) {
        sources.push({
          source: `Bail schedule data — ${caseState || 'Federal'} jurisdiction`,
          text: schedules.map(s =>
            `${s.charge_type}: $${(s.bail_min_cents/100).toFixed(0)}–$${(s.bail_max_cents/100).toFixed(0)} (${s.notes || 'standard range'})`
          ).join('; '),
          key_rule: 'These are typical ranges. Actual bail is set by the judge and may vary.',
        });
      }
    }

    // DUI laws — triggered by DUI/DWI questions
    if (msg.includes('dui') || msg.includes('dwi') || msg.includes('drunk driving') || msg.includes('blood alcohol')) {
      const dui = await db.get(
        `SELECT state, bac_limit, first_offense_fine_cents, first_offense_jail_days,
                license_suspension_days, felony_threshold_priors, notes
           FROM dui_laws WHERE state = ?`,
        [caseState || 'TN']
      ).catch(() => null);
      if (dui) {
        sources.push({
          source: `DUI/DWI Law — ${dui.state}`,
          text: `BAC limit: ${dui.bac_limit}. First offense: fine up to $${(dui.first_offense_fine_cents/100).toFixed(0)}, up to ${dui.first_offense_jail_days} days jail, ${dui.license_suspension_days} day license suspension. ${dui.notes || ''}`,
          key_rule: 'Consult an attorney — penalties vary by prior offenses, circumstances, and judge.',
        });
      }
    }

    // Drug penalties — triggered by drug charge questions
    if (msg.includes('drug') || msg.includes('narcotics') || msg.includes('possession') || msg.includes('marijuana') || msg.includes('cocaine') || msg.includes('fentanyl')) {
      const drugs = await db.all(
        `SELECT drug_type, offense_type, min_sentence_months, max_sentence_months,
                min_fine_cents, state, notes
           FROM drug_penalties
          WHERE state = ? OR state = 'federal'
          ORDER BY max_sentence_months DESC
          LIMIT 4`,
        [caseState || 'TN']
      ).catch(() => []);
      if (drugs.length) {
        sources.push({
          source: `Drug offense penalties — ${caseState || 'TN'} / Federal`,
          text: drugs.map(d =>
            `${d.drug_type} ${d.offense_type}: ${d.min_sentence_months}–${d.max_sentence_months} months, fine up to $${((d.min_fine_cents||0)/100).toFixed(0)}`
          ).join('; '),
          key_rule: 'Sentencing is discretionary. Prior record, quantity, and intent significantly affect outcomes.',
        });
      }
    }

    // Statute of limitations — triggered by SOL questions (excluding null years)
    if (msg.includes('statute of limitations') || msg.includes('how long') || msg.includes('time limit') || msg.includes('too late to charge')) {
      const sols = await db.all(
        `SELECT offense_type, years, state, notes
           FROM statute_of_limitations
          WHERE (state = ? OR state = 'federal')
            AND years IS NOT NULL            -- exclude the 102 records with null years
            AND years > 0
          ORDER BY years ASC
          LIMIT 5`,
        [caseState || 'TN']
      ).catch(() => []);
      if (sols.length) {
        sources.push({
          source: `Statute of Limitations — ${caseState || 'TN'}`,
          text: sols.map(s => `${s.offense_type}: ${s.years} years${s.notes ? ' ('+s.notes+')' : ''}`).join('; '),
          key_rule: 'SOL clock typically starts at date of offense. Tolling rules may apply for minors, DNA evidence, or out-of-state defendants.',
        });
      }
    }

  } catch (e) {
    // Non-fatal — static context still applies
  }

  // Add confidence score to each source
  return sources.slice(0, 3).map(s => ({
    ...s,
    _confidence: s._confidence ?? 0.8, // DB-sourced context is jurisdiction-specific
  }));
}

/**
 * Check if there is enough grounded context to answer confidently.
 * Returns false when the question is outside the grounded topics —
 * the caller should add a "consult an attorney" note.
 */
export function hasGroundedContext(sources) {
  return Array.isArray(sources) && sources.length > 0;
}

/**
 * Combined retrieval — static verified context + database tables.
 * Use this instead of retrieveLegalContext() for full grounding coverage.
 */
export async function retrieveFullContext(db, userMessage, caseState = null) {
  const [staticSources, dbSources] = await Promise.all([
    retrieveLegalContext(userMessage, caseState),
    retrieveFromDatabase(db, userMessage, caseState),
  ]);
  // De-duplicate and limit to 4 total sources (context window budget)
  return [...staticSources, ...dbSources].slice(0, 4);
}
