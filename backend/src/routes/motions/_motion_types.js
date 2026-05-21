/**
 * motions/_motion_types.js — Motion type definitions
 *
 * Each entry defines the motion's label, required fields, optional fields,
 * the system prompt suffix for Claude, and any subscription requirements.
 * Edit this file to add new motion types without touching route logic.
 */

// ── Motion types with their required fields ───────────────────────────────────
export const MOTION_TYPES = {
  suppress: {
    label:       'Motion to Suppress',
    description: 'Challenge illegally obtained evidence — 4th, 5th, or 6th Amendment',
    icon:        '🛡️',
    fields: [
      'defendant_name','case_number','court_name','state','charge',
      'search_date','search_location','officer_name',
      'amendment_theory','specific_violation',
      'fruit_of_poisonous_tree','good_faith_exception',
      'grounds',
    ],
    grounds_options: [
      'No probable cause for stop or arrest',
      'No warrant — warrantless search without exception',
      'Warrant lacked particularity (overbroad)',
      'Warrant issued without probable cause',
      'Fruit of the poisonous tree — derivative evidence',
      'Miranda violation — statement obtained without warnings',
      'Sixth Amendment — interrogation after counsel invoked',
      'Unlawful traffic stop — no reasonable suspicion',
      'Unlawful search of home — no exigent circumstances',
      'Unlawful search of vehicle — no probable cause or consent',
    ],
  },
  continuance: {
    label:       'Motion for Continuance',
    description: 'Request additional time to prepare',
    icon:        '📅',
    fields: ['defendant_name','case_number','court_name','state','hearing_date','reason','requested_new_date'],
    grounds_options: ['Insufficient time to prepare','New evidence received','Witness unavailable','Attorney conflict','Discovery incomplete'],
  },
  dismiss: {
    label:       'Motion to Dismiss',
    description: 'Seek dismissal of charges',
    icon:        '⚖️',
    fields: ['defendant_name','case_number','court_name','state','charge','grounds'],
    grounds_options: ['Speedy trial violation','Insufficient evidence','Prosecutorial misconduct','Double jeopardy','Lack of jurisdiction','Statute of limitations'],
  },
  bail_reduction: {
    label:       'Motion for Bail Reduction',
    description: 'Argue for lower bail or release on recognizance',
    icon:        '🔓',
    fields: [
      'defendant_name','case_number','court_name','state','charge',
      'current_bail','length_in_custody','ability_to_pay',
      'community_ties','employment','prior_record',
      'travel_documents','voluntary_surrender','other_pending_charges',
      'proposed_bail',
    ],
    grounds_options: [],
  },
  discovery: {
    label:       'Motion for Discovery',
    description: 'Compel prosecution to disclose evidence',
    icon:        '📋',
    fields: ['defendant_name','case_number','court_name','state','charge','items_requested'],
    grounds_options: ['Brady material','Witness statements','Lab reports','Body camera footage','Police reports','Expert witness information'],
  },
  limine: {
    label:       'Motion in Limine',
    description: 'Exclude prejudicial evidence from trial',
    icon:        '🚫',
    fields: ['defendant_name','case_number','court_name','state','charge','evidence_to_exclude','grounds'],
    grounds_options: ['Unfair prejudice outweighs probative value','Hearsay','Prior bad acts','Irrelevant','Improperly obtained'],
  },
  speedy_trial: {
    label:       'Motion for Speedy Trial',
    description: 'Assert 6th Amendment speedy trial right — Barker v. Wingo four-factor test',
    icon:        '⏱️',
    fields: [
      'defendant_name','case_number','court_name','state','charge',
      'arrest_date','current_date','delays_caused_by',
      'date_right_asserted','prejudice_to_defendant',
    ],
    grounds_options: [],
  },
  compel: {
    label:       'Motion to Compel',
    description: 'Force prosecution to comply with discovery',
    icon:        '📌',
    fields: ['defendant_name','case_number','court_name','state','charge','items_withheld','request_date'],
    grounds_options: [],
  },

  // ── Appeal-stage motions ──────────────────────────────────────────────────
  notice_of_appeal: {
    label:       'Notice of Appeal',
    description: 'Preserve appellate rights — strict filing deadlines apply',
    icon:        '📣',
    fields: [
      'defendant_name','case_number','trial_court','appellate_court',
      'state','conviction_date','sentence','judgment_date',
      'grounds_preview','counsel_name','counsel_bar_number',
    ],
    grounds_options: [
      'Insufficient evidence to support conviction',
      'Ineffective assistance of counsel',
      'Prosecutorial misconduct',
      'Improper jury instruction',
      'Illegal search and seizure — 4th Amendment',
      'Coerced confession — 5th Amendment',
      'Confrontation Clause violation — 6th Amendment',
      'Cruel and unusual punishment — 8th Amendment',
      'Newly discovered evidence',
      'Sentencing error or guidelines miscalculation',
    ],
    deadline_warning: 'CRITICAL: Federal — 14 days from judgment. Most states — 30 days. Missing this deadline permanently waives appellate rights.',
  },

  appeal_brief: {
    label:       'Appellate Brief',
    description: 'Full substantive brief arguing grounds for reversal',
    icon:        '📜',
    fields: [
      'defendant_name','case_number','appellate_court','state',
      'trial_court_name','conviction','sentence',
      'standard_of_review','grounds_for_reversal',
      'key_facts','preserved_objections','relief_requested',
    ],
    grounds_options: [
      'De novo — legal error, question of law',
      'Abuse of discretion — evidentiary rulings',
      'Clearly erroneous — factual findings',
      'Plain error — unpreserved but obvious error',
      'Structural error — automatic reversal',
    ],
  },

  sentence_reduction: {
    label:       'Motion to Reduce Sentence',
    description: 'Post-conviction sentence modification or compassionate release',
    icon:        '🕊️',
    fields: [
      'defendant_name','case_number','court_name','state',
      'conviction','original_sentence','time_served',
      'rehabilitation','grounds','family_circumstances',
      'community_support','proposed_sentence',
    ],
    grounds_options: [
      'Retroactive guidelines amendment (18 U.S.C. § 3582)',
      'Compassionate release — extraordinary and compelling circumstances',
      'First Step Act eligibility',
      'Substantial assistance to authorities',
      'Changed circumstances since sentencing',
      'Medical condition requiring specialized care',
      'Caregiver of minor children or incapacitated spouse',
    ],
  },

  habeas_corpus: {
    label:       'Petition for Habeas Corpus',
    description: 'Collateral attack on unlawful detention — constitutional violations',
    icon:        '⚖️',
    fields: [
      'petitioner_name','case_number','court','state',
      'conviction_date','sentence','current_custodian',
      'constitutional_violation','grounds',
      'aedpa_standard',
      'prior_appeals','exhaustion_of_remedies',
      'timeliness_explanation',
    ],
    grounds_options: [
      'Ineffective assistance of counsel — Strickland v. Washington',
      'Brady violation — suppression of material evidence',
      'Actual innocence — newly discovered evidence',
      'Unconstitutional guilty plea — not knowing and voluntary',
      'Illegal sentence — exceeds statutory maximum',
      'Jurisdictional defect — court lacked authority',
      'Newly recognized constitutional right (retroactive)',
    ],
    deadline_warning: 'Federal habeas: 1-year statute of limitations from conviction becoming final (AEDPA, 28 U.S.C. § 2254/2255). State exhaustion required before federal filing.',
  },
};

// ── Ensure tables ─────────────────────────────────────────────────────────────

