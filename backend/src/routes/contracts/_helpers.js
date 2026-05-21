/**
 * contracts/_helpers.js — DB schema + core AI functions
 *
 * Four AI functions, each isolated and independently testable:
 *
 *   generateContract()  — draft a new contract from structured fields
 *   reviewContract()    — analyze an uploaded contract for risks/red flags
 *   redlineContracts()  — compare two versions and explain every change
 *   negotiationPoints() — generate negotiation strategy from a draft
 */

import { getDb }   from '../../db/index.js';
import { enqueue } from '../../services/aiQueue.js';
import logger      from '../../utils/logger.js';
import { CONTRACT_TYPES } from './_contract_types.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL       = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-sonnet-4-20250514';

// contracts, contract_reviews, contract_redlines, contract_executions managed by db/index.js Year 2.
// ensureTables kept as a no-op export to avoid import-side errors in legacy callers.
export async function ensureTables(_db) { /* no-op — tables created at startup */ }

// ── hasContractPro — checks subscription tier ──────────────────────────────────
export async function hasContractPro(db, userId) {
  const sub = await db.get(
    `SELECT id FROM subscriptions
     WHERE user_id=? AND tier IN ('contract_pro','enterprise')
     AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1`,
    [userId]
  ).catch(() => null);
  return !!sub;
}

// ── callClaude — shared AI call wrapper ───────────────────────────────────────
async function callClaude({ system, userMessage, maxTokens = 4000, temperature = 0.10 }) {
  if (!ANTHROPIC_KEY) return null; // demo mode handled by caller

  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:       MODEL,
      temperature,
      max_tokens:  maxTokens,
      system,
      messages:    [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GENERATE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
export async function generateContract(contractType, fields) {
  const def = CONTRACT_TYPES[contractType];
  if (!def) throw new Error(`Unknown contract type: ${contractType}`);

  if (!ANTHROPIC_KEY) {
    return buildDemoContract(contractType, fields, def);
  }

  const fieldSummary = Object.entries(fields)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join('\n');

  const system = `You are a senior transactional attorney at a major law firm drafting a ${def.label}.

CRITICAL HALLUCINATION GUARD:
- Do NOT fabricate statute numbers, case citations, or regulatory thresholds.
- Use [CITATION NEEDED] for any statute you cannot state with certainty.
- Use [ATTORNEY TO VERIFY: local rule] for jurisdiction-specific provisions.
- Use [ATTORNEY TO VERIFY: current threshold] for regulatory figures that change annually.
- Real harm results from filing documents with fabricated law.

OUTPUT REQUIREMENTS:
- Output the complete contract document ONLY — no explanatory notes, no meta-commentary.
- Use proper legal document formatting: RECITALS, numbered sections, exhibit references.
- All defined terms must be capitalized consistently after first definition.
- End with signature blocks for all parties.
- Add a final disclaimer: "This AI-generated document requires review by a licensed attorney before execution."`;

  const userMessage = `Draft a complete, professional-grade ${def.label} based on the following information:

${fieldSummary}

CONTRACT-SPECIFIC REQUIREMENTS:
${def.prompt_suffix}

Generate the complete contract document now. Be thorough — cover all standard provisions for this contract type.`;

  const draft = await callClaude({ system, userMessage, maxTokens: 6000 });

  return draft + '\n\n---\n*This AI-generated document requires review by a licensed attorney before execution. All citations and regulatory thresholds must be independently verified.*';
}

function buildDemoContract(contractType, fields, def) {
  const partyA = fields.disclosing_party || fields.employer_name || fields.company_name ||
                 fields.buyer_name || fields.licensor_name || fields.landlord_name ||
                 fields.settling_party_1 || fields.assignor_name || 'Party A';
  const partyB = fields.receiving_party || fields.employee_name || fields.contractor_name ||
                 fields.target_name || fields.licensee_name || fields.tenant_name ||
                 fields.settling_party_2 || fields.assignee_name || 'Party B';
  const date   = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  return `${def.label.toUpperCase()}

This ${def.label} (this "Agreement") is entered into as of ${date}, by and between:

${partyA} ("Party A"); and
${partyB} ("Party B").

[DEMO MODE — Add ANTHROPIC_API_KEY to backend/.env for live AI generation]

This demo shows the document structure. With an API key, Justice Gavel generates a complete,
professionally-drafted ${def.label} covering all standard provisions including:

${def.prompt_suffix.trim().split('\n').filter(l => l.trim().startsWith('-')).slice(0,6).join('\n')}

---
*This document requires review by a licensed attorney before execution.*`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REVIEW CONTRACT — risk analysis of uploaded or drafted contract
// ─────────────────────────────────────────────────────────────────────────────
export async function reviewContract(contractText, contractType = null, partyRepresented = null) {
  if (!ANTHROPIC_KEY) {
    return buildDemoReview(contractText, contractType);
  }

  const context = contractType
    ? `The document is a ${CONTRACT_TYPES[contractType]?.label || contractType}.`
    : 'Identify the contract type from the document.';

  const representation = partyRepresented
    ? `You are reviewing this contract from the perspective of ${partyRepresented}. Identify provisions that favor the other party and recommend changes.`
    : 'Review this contract objectively and flag provisions that favor either party.';

  const system = `You are a senior transactional attorney conducting a contract risk review.
${representation}

CRITICAL: Do NOT fabricate statute numbers or case citations. Use [CITATION NEEDED] if uncertain.
Respond ONLY with valid JSON matching the schema below. No preamble, no markdown.`;

  const userMessage = `${context}

Analyze this contract and respond with JSON in this exact format:
{
  "contract_type": "string — identified or provided type",
  "risk_level": "low | medium | high | critical",
  "summary": "3-5 sentence executive summary of the contract and overall risk assessment",
  "red_flags": [
    { "clause": "clause name or section", "issue": "description of the problem", "severity": "low|medium|high|critical" }
  ],
  "missing_clauses": [
    { "clause": "clause name", "reason": "why it should be included" }
  ],
  "recommendations": [
    { "action": "specific recommended change", "priority": "low|medium|high" }
  ],
  "favorable_terms": [
    { "clause": "clause name", "reason": "why this term is favorable to the client" }
  ],
  "one_sided_provisions": [
    { "clause": "clause name", "favors": "party name", "issue": "explanation" }
  ]
}

CONTRACT TEXT:
${contractText.slice(0, 12000)}`;

  const raw = await callClaude({ system, userMessage, maxTokens: 3000, temperature: 0.05 });

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    logger.warn('[contracts/review] JSON parse failed — returning raw text', e?.message);
    return {
      risk_level: 'medium',
      summary: raw.slice(0, 500),
      red_flags: [],
      missing_clauses: [],
      recommendations: [],
      favorable_terms: [],
    };
  }
}

function buildDemoReview(contractText, contractType) {
  return {
    contract_type: contractType || 'Contract (Demo Mode)',
    risk_level:    'medium',
    summary:       'Demo mode: Add ANTHROPIC_API_KEY to enable live contract review. This analysis would identify red flags, missing clauses, one-sided provisions, and specific recommended changes.',
    red_flags:     [{ clause: 'Indemnification', issue: 'Broad indemnification with no cap — demo example', severity: 'high' }],
    missing_clauses: [{ clause: 'Limitation of Liability', reason: 'No liability cap found — demo example' }],
    recommendations: [{ action: 'Negotiate liability cap at 12 months of fees', priority: 'high' }],
    favorable_terms: [{ clause: 'Payment Terms', reason: 'Net-30 is standard — demo example' }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REDLINE — compare two contract versions
// ─────────────────────────────────────────────────────────────────────────────
export async function redlineContracts(originalText, revisedText) {
  if (!ANTHROPIC_KEY) {
    return {
      risk_delta: 'neutral',
      summary:    'Demo mode: Add ANTHROPIC_API_KEY to enable redline comparison.',
      changes:    [{ section: 'Demo', original: 'Original clause text', revised: 'Revised clause text', type: 'modification', impact: 'neutral', explanation: 'Demo redline' }],
    };
  }

  const system = `You are a senior attorney comparing two versions of a contract to identify all changes.
Respond ONLY with valid JSON. No preamble, no markdown fences.`;

  const userMessage = `Compare these two contract versions and identify every meaningful change.

Respond with JSON in this exact format:
{
  "risk_delta": "improved | neutral | worsened — overall change in favorability to the signing party",
  "summary": "2-3 sentence summary of the most significant changes and their combined impact",
  "changes": [
    {
      "section": "section or clause name",
      "type": "addition | deletion | modification | reordering",
      "original": "original text (or null for additions)",
      "revised": "revised text (or null for deletions)",
      "impact": "favorable | unfavorable | neutral",
      "explanation": "1-2 sentences explaining the legal significance of this change"
    }
  ]
}

ORIGINAL CONTRACT:
${originalText.slice(0, 6000)}

REVISED CONTRACT:
${revisedText.slice(0, 6000)}`;

  const raw = await callClaude({ system, userMessage, maxTokens: 3000, temperature: 0.05 });

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    logger.warn('[contracts/redline] JSON parse:', e?.message);
    return { risk_delta: 'neutral', summary: raw.slice(0, 300), changes: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. NEGOTIATION POINTS — generate talking points from a draft
// ─────────────────────────────────────────────────────────────────────────────
export async function negotiationPoints(contractText, partyRepresented, priorities = []) {
  if (!ANTHROPIC_KEY) {
    return {
      strategy: 'Demo mode: Add ANTHROPIC_API_KEY to enable negotiation strategy generation.',
      opening_position: [],
      must_haves: [],
      trade_offs: [],
      walk_away_triggers: [],
    };
  }

  const system = `You are a senior transactional attorney preparing negotiation strategy.
You represent: ${partyRepresented}.
${priorities.length ? `Client priorities: ${priorities.join(', ')}.` : ''}
Respond ONLY with valid JSON. No preamble, no markdown.`;

  const userMessage = `Based on this contract draft, generate a negotiation strategy for ${partyRepresented}.

Respond with JSON in this exact format:
{
  "strategy": "2-3 sentence overall negotiation strategy and tone recommendation",
  "opening_position": [
    { "clause": "clause name", "current_text": "brief summary", "our_ask": "what to request", "rationale": "why we're asking" }
  ],
  "must_haves": [
    { "clause": "clause name", "requirement": "what we need", "reason": "why it's non-negotiable" }
  ],
  "trade_offs": [
    { "give": "what we can concede", "get": "what we want in return", "rationale": "why this trade makes sense" }
  ],
  "walk_away_triggers": [
    { "issue": "issue that would kill the deal", "threshold": "the specific limit" }
  ],
  "market_benchmarks": [
    { "clause": "clause name", "market_standard": "what is typical in this type of deal" }
  ]
}

CONTRACT:
${contractText.slice(0, 8000)}`;

  const raw = await callClaude({ system, userMessage, maxTokens: 2500, temperature: 0.15 });

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    logger.warn('[contracts/negotiation] JSON parse:', e?.message);
    return { strategy: raw.slice(0, 300), opening_position: [], must_haves: [], trade_offs: [], walk_away_triggers: [] };
  }
}
