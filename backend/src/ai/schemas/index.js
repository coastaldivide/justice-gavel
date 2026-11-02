/**
 * ai/schemas — one JSON Schema per structured-output task, and the validator every parsed
 * answer goes through before anything is shown or saved.
 *
 * Structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 * (read 2026-11-02): request `output_config: { format: { type: 'json_schema', schema } }`, no
 * beta header (the old `output_format` + structured-outputs-2025-11-13 header is deprecated),
 * all models. The JSON arrives in the response's `text` block. Supported keywords: type
 * (object/array/string/integer/number/boolean/null), enum, const, anyOf, allOf, $ref/$defs,
 * default, required, additionalProperties: false (required on every object), string formats,
 * array minItems 0 or 1. NOT supported (400): minimum/maximum/multipleOf, minLength/maxLength,
 * other array constraints, recursion. Limits per request: 24 optional parameters, 16 anyOf /
 * type-array parameters, 20 strict tools. Incompatible with citations and prefill.
 * A refusal (stop_reason "refusal") or max_tokens stop may not match the schema — the gateway
 * treats both as failures and never shows the text.
 * Enum casing is not guaranteed: validate() matches enums case-insensitively and returns the
 * canonical value.
 *
 * Every property is required (nullable ones use a type array) so the 24-optional limit is
 * never in play, and the validator can rely on every key being present.
 */

const S = { type: 'string' };
const NS = { type: ['string', 'null'] };
const B = { type: 'boolean' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
const en = (...values) => ({ type: 'string', enum: values });

const CONFIDENCE = en('high', 'medium', 'low', 'not_found');
const PAPER_FIELD = obj({ value: S, source_text: S, confidence: CONFIDENCE });
/** routes/courtDates.js HEARING_TYPES + "none" (kept here so the schema has no import cycle; a test checks they match). */
export const HEARING_VALUES = Object.freeze(['arraignment', 'preliminary_hearing', 'pretrial', 'motion', 'trial', 'sentencing', 'probation', 'status', 'other', 'none']);
/** services/bondDesk/core.js DATA_KEYS without the signature keys (a test checks they match). */
export const FORM_MAP_KEYS = Object.freeze([
  'bond.defendant_name', 'bond.defendant_dob', 'bond.defendant_address', 'bond.defendant_phone', 'bond.defendant_email',
  'bond.case_number', 'bond.court_name', 'bond.county', 'bond.state', 'bond.court_date', 'bond.charges', 'bond.bond_amount',
  'bond.premium', 'bond.power_number', 'bond.surety_name', 'agent.name', 'agent.agency', 'agent.license', 'agent.phone',
  'agent.email', 'signer.full_name', 'signer.role', 'signer.relationship', 'signer.phone', 'signer.email', 'signer.address',
  'signer.dob', 'signer.employer', 'signer.employer_phone', 'signer.job_title', 'signer.monthly_income',
  'signer.years_at_address', 'signer.drivers_license', 'signer.vehicle', 'signer.reference_1', 'signer.reference_2',
  'date.today',
]);

export const SCHEMAS = Object.freeze({
  motion_review: obj({
    score: en('pass', 'warn', 'fail'),
    issues: arr(S),
    suggestions: arr(S),
    missing_fields: arr(S),
  }),

  discovery_intake: obj({
    title: S,
    charge: S,
    state: S,
    court_date: S,
    defendant_name: S,
    notes: S,
  }),

  discovery_analysis: obj({
    summary: S,
    key_facts: arr(S),
    inconsistencies: arr(S),
    questions: arr(S),
    page_count: { type: 'integer' },
    doc_type: en('Police Report', 'Lab Report', 'Medical Records', 'Witness Statement', 'Body Camera Log', 'Search Warrant', 'Other'),
  }),

  match_reports: obj({
    reports: arr(obj({ source_id: S, report: S })),
  }),

  note_structure: obj({
    summary: S,
    next_steps: arr(S),
    flags: arr(S),
  }),

  speaker_tags: obj({
    segments: arr(obj({ timestamp: S, speaker: en('OFFICER', 'SUSPECT', 'UNKNOWN'), text: S })),
  }),

  privilege_entries: obj({
    entries: arr(obj({
      doc_number_suffix: S,
      doc_type: en('email', 'memo', 'letter', 'draft', 'notes', 'other'),
      privilege_basis: en('attorney_client', 'work_product', 'joint_defense', 'common_interest'),
      withheld: B,
      description: S,
      privilege_assertion: S,
      doc_date: NS,
      author: NS,
      recipients: NS,
      page_count_estimate: { type: ['integer', 'null'] },
    })),
  }),

  contract_review: obj({
    contract_type: S,
    risk_level: en('low', 'medium', 'high', 'critical'),
    summary: S,
    red_flags: arr(obj({ clause: S, issue: S, severity: en('low', 'medium', 'high', 'critical') })),
    missing_clauses: arr(obj({ clause: S, reason: S })),
    recommendations: arr(obj({ action: S, priority: en('low', 'medium', 'high') })),
    favorable_terms: arr(obj({ clause: S, reason: S })),
    one_sided_provisions: arr(obj({ clause: S, favors: S, issue: S })),
  }),

  contract_redline: obj({
    risk_delta: en('improved', 'neutral', 'worsened'),
    summary: S,
    changes: arr(obj({
      section: S,
      type: en('addition', 'deletion', 'modification', 'reordering'),
      original: NS,
      revised: NS,
      impact: en('favorable', 'unfavorable', 'neutral'),
      explanation: S,
    })),
  }),

  contract_negotiation: obj({
    strategy: S,
    opening_position: arr(obj({ clause: S, current_text: S, our_ask: S, rationale: S })),
    must_haves: arr(obj({ clause: S, requirement: S, reason: S })),
    trade_offs: arr(obj({ give: S, get: S, rationale: S })),
    walk_away_triggers: arr(obj({ issue: S, threshold: S })),
    market_benchmarks: arr(obj({ clause: S, market_standard: S })),
  }),

  // Evaluation grader (scripts/grade_eval.js) — one schema per dimension.
  eval_factual_accuracy: obj({ score: { type: 'integer' }, rationale: S, errors: arr(S) }),
  eval_citation_validity: obj({ score: { type: 'integer' }, rationale: S, citations_found: arr(S), fabricated: arr(S) }),
  eval_refusal_correctness: obj({ score: { type: 'integer' }, rationale: S, refused: B, correct_to_refuse: B }),
  eval_calibration: obj({ score: { type: 'integer' }, rationale: S, overconfident: B, underconfident: B }),
  eval_state_specificity: obj({ score: { type: 'integer' }, rationale: S, state_specific_citations: arr(S) }),

  // Source re-check (services/sourceChecks, AI step 3): compare one stored row with its official
  // page fetched by the web fetch tool. `quote` must be copied word for word from the fetched page;
  // the server checks it is really there before a "still_matches" verdict changes anything.
  source_check: obj({
    verdict: en('still_matches', 'changed', 'page_gone', 'cant_tell'),
    quote: NS,
    what_changed: NS,
    fetched_url: NS,
  }),
  // Proposal for a withheld row: an official page (on the allowed domains) that states the rule.
  source_proposal: obj({
    found: B,
    url: NS,
    quote: NS,
    explanation: NS,
  }),
  // "Translate new keys" (services/translationDrafts.js): drafts for review, never applied automatically.
  translation_draft: obj({
    translations: arr(obj({ key: S, text: S })),
  }),

  // AI step 4 — a court paper (photo or PDF) read into proposed court-date fields
  // (services/courtPaper.js). Every field carries the exact words it was read from and a
  // confidence; "" + not_found when the paper does not say it. No type arrays / anyOf (the
  // 16-parameter limit), no PHI in the schema itself.
  court_paper: obj({
    kind: en('court_paper', 'not_court_paper', 'unreadable'),
    fields: obj({
      court_date: PAPER_FIELD,
      court_time: PAPER_FIELD,
      court_name: PAPER_FIELD,
      court_address: PAPER_FIELD,
      courtroom: PAPER_FIELD,
      case_number: PAPER_FIELD,
      judge: PAPER_FIELD,
      hearing_type: obj({ value: en(...HEARING_VALUES), source_text: S, confidence: CONFIDENCE }),
    }),
    bring: arr(obj({ text: S, source_text: S, confidence: CONFIDENCE })),
  }),

  // AI step 4 — which case-file value fills each fillable text field of a blank surety PDF
  // (services/bondDesk/formMapping.js). data_key is one of the app's data keys or "none"; the
  // signature keys are not offered (staff map those by hand; nothing is ever drawn).
  form_field_map: obj({
    suggestions: arr(obj({ field: S, data_key: en(...FORM_MAP_KEYS, 'none'), confidence: en('high', 'medium', 'low'), reason: S })),
  }),
});

export function schemaFor(name) {
  const s = SCHEMAS[name];
  if (!s) throw Object.assign(new Error(`unknown AI schema: ${name}`), { code: 'ai_failed' });
  return s;
}

/** `output_config.format` for a schema name. */
export function outputFormat(name) {
  return { type: 'json_schema', schema: schemaFor(name) };
}

const typeOk = (t, v) => {
  switch (t) {
    case 'null': return v === null;
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    default: return false;
  }
};

/**
 * Validate (and lightly normalise) a parsed value against a schema from this file.
 * Returns { ok: true, value } or { ok: false, errors: [path …] }. Normalisation: enum values
 * matched case-insensitively come back in their canonical spelling. Nothing else is coerced.
 */
export function validate(schema, value, path = '$') {
  const errors = [];
  const walk = (s, v, p) => {
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (types.length && !types.some((t) => typeOk(t, v))) { errors.push(`${p}: expected ${types.join('|')}`); return v; }
    if (v === null) return v;
    if (s.enum) {
      const hit = s.enum.find((e) => e === v || (typeof e === 'string' && typeof v === 'string' && e.toLowerCase() === v.toLowerCase()));
      if (hit === undefined) { errors.push(`${p}: not one of ${s.enum.join(', ')}`); return v; }
      return hit;
    }
    if (Array.isArray(v)) {
      if (s.minItems && v.length < s.minItems) errors.push(`${p}: fewer than ${s.minItems} items`);
      return s.items ? v.map((x, i) => walk(s.items, x, `${p}[${i}]`)) : v;
    }
    if (typeof v === 'object' && s.properties) {
      const out = {};
      for (const k of s.required || []) if (!(k in v)) errors.push(`${p}.${k}: missing`);
      for (const [k, x] of Object.entries(v)) {
        if (!s.properties[k]) { if (s.additionalProperties === false) errors.push(`${p}.${k}: not allowed`); continue; }
        out[k] = walk(s.properties[k], x, `${p}.${k}`);
      }
      return out;
    }
    return v;
  };
  const out = walk(schema, value, path);
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** Parse + validate model text against a named schema. → { ok, value } | { ok: false, errors } */
export function parseStructured(name, text) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? '')); } catch { return { ok: false, errors: ['$: not JSON'] }; }
  return validate(schemaFor(name), parsed);
}

/**
 * A minimal value that satisfies a schema — used by the Anthropic mocks (scripts/anthropic-mock.mjs
 * and the jest harness) to answer structured-output requests faithfully.
 */
export function sampleFor(schema, hint = 'MOCK') {
  const s = schema || {};
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') || 'null' : s.type;
  if (s.enum) return s.enum[0];
  if (s.const !== undefined) return s.const;
  switch (t) {
    case 'object': return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, sampleFor(v, `${hint} ${k}`)]));
    case 'array': return [sampleFor(s.items || { type: 'string' }, hint)];
    case 'integer': return 1;
    case 'number': return 1;
    case 'boolean': return true;
    case 'null': return null;
    default: return `${hint}: general legal information, not legal advice.`;
  }
}
