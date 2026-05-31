import { requireDisclaimer } from '../../middleware/disclaimer.js';
const MAX_MOTION_LENGTH = 50000; // ~12,500 words — covers any motion

/**
 * motions/_helpers.js — ensureTables() and generateMotion() AI function
 *
 * generateMotion() is the core AI call — builds the system prompt,
 * calls Claude, applies the hallucination guard, and returns the result.
 * Isolated here so it can be tested and updated independently of route logic.
 */
import { getDb }        from '../../db/index.js';
import { enqueue }      from '../../services/aiQueue.js';
import logger             from '../../utils/logger.js';
import { MOTION_TYPES } from './_motion_types.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// motion_history managed by db/index.js Year 2 block.
// ensureTables kept as a no-op export to avoid import-side errors in legacy callers.
export async function ensureTables(_db) { /* no-op — table created at startup */ }

// ── Claude motion generation ──────────────────────────────────────────────────
export async function generateMotion(motionType, fields) {
  const motionDef = MOTION_TYPES[motionType];
  if (!motionDef) throw new Error('Unknown motion type');

  if (!ANTHROPIC_KEY) {
    // Demo mode — return realistic mock
    return `IN THE ${(fields.court_name || 'CIRCUIT COURT').toUpperCase()}
${(fields.state || 'STATE').toUpperCase()}

Case No. ${fields.case_number || 'XX-XXXX'}

STATE OF ${(fields.state || 'STATE').toUpperCase()}
v.
${fields.defendant_name || 'DEFENDANT'}

${motionDef.label.toUpperCase()}

[DEMO MODE — Add ANTHROPIC_API_KEY to .env for live generation]

Comes now the Defendant, ${fields.defendant_name || 'Defendant'}, by and through undersigned counsel, and respectfully moves this Court pursuant to the applicable rules of criminal procedure for the following relief:

INTRODUCTION
This motion is submitted in the above-captioned matter. The Defendant respectfully requests that this Court grant the relief requested herein based on the grounds set forth below.

[Full motion would be generated here with ANTHROPIC_API_KEY configured]

WHEREFORE, Defendant respectfully requests that this Court grant this motion.

Respectfully submitted,

_______________________________
Defense Counsel
Date: ${new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })}`;
  }

  const fieldSummary = Object.entries(fields)
    .filter(([k, v]) => v && String(v).trim())
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join('\n');

  // Appellate motions need different prompt guidance
  const isAppellatMotion = ['notice_of_appeal','appeal_brief','sentence_reduction','habeas_corpus'].includes(motionType);

  const deadlineWarning = motionDef.deadline_warning
    ? `\n\nCRITICAL DEADLINE NOTICE: ${motionDef.deadline_warning}`
    : '';

  const prompt = isAppellatMotion
    ? `You are an experienced appellate defense attorney drafting a ${motionDef.label}.
This is appellate-stage work. The stakes are high — this document must be precise, persuasive, and procedurally correct\n\nCRITICAL: Do NOT invent or fabricate statute numbers, case citations, or legal deadlines. If the specific citation is unknown, write [CITATION NEEDED] — never guess a citation. A fabricated statute number filed in court causes irreparable harm..

CASE INFORMATION:
${fieldSummary}${deadlineWarning}

REQUIREMENTS:
- Use proper appellate court format for ${fields.state || 'US federal'} court
- Include full caption with correct appellate court designation
- For Notice of Appeal: include jurisdiction statement, timeliness statement, and specific judgments appealed
- For Appellate Brief: include Table of Contents, Table of Authorities, Jurisdictional Statement, Statement of Issues Presented, Statement of the Case, Statement of Facts, Standard of Review for EACH issue, Argument (with point headings), Conclusion, and Certificate of Service
- For Habeas Corpus: address exhaustion of state remedies, AEDPA timeliness, and procedural default where applicable
- Cite controlling precedent precisely — case name, citation, court, year, and the specific holding that supports your argument
- Apply the correct standard of review to each issue (de novo, abuse of discretion, clearly erroneous, plain error)
- Preserve all issues — do not waive any argument by omission
- Write in formal appellate legal language — persuasive but precise
- End with signature block, bar number line, and certificate of service
- Do NOT include any explanatory notes or meta-commentary — output the document only
- Flag [ATTORNEY TO VERIFY] wherever specific local rules, recent case law, or jurisdiction-specific procedure must be confirmed

Generate the complete document now:`
    : `You are a criminal defense attorney drafting a legal motion.

COURT FORMATTING REQUIREMENTS (apply to all generated motions):
- Use proper legal caption: Case Name, Case Number, Court Name, Judge
- Number all sections and paragraphs consecutively
- Include: COMES NOW, STATEMENT OF FACTS, LEGAL ARGUMENT, CONCLUSION, PRAYER FOR RELIEF
- End with signature block: "Respectfully submitted, [ATTORNEY NAME], [BAR NUMBER], [ADDRESS]"
- Use double-spacing and 1-inch margins (note these — the attorney's word processor handles it)
- All case citations must follow Bluebook format or the applicable jurisdiction's citation rules
- Flag every citation with [ATTORNEY TO VERIFY: cite] per the hallucination guard above

Generate a complete, court-ready ${motionDef.label} based on the following case information.\n\nCRITICAL: Do NOT invent statute numbers, case citations, or legal deadlines. Use [CITATION NEEDED] for unknown citations — never fabricate.

CASE INFORMATION:
${fieldSummary}

MOTION-SPECIFIC REQUIREMENTS:
${motionType === 'bail_reduction' ? `- Address all statutory bail factors: nature of offense, weight of evidence, personal history, criminal record, flight risk, danger to community, length of pre-trial detention, and ability to pay.
- Cite the relevant state bail statute by name and section.` : ''}
${motionType === 'speedy_trial' ? `- Apply the four-factor Barker v. Wingo, 407 U.S. 514 (1972) balancing test explicitly:
  1. Length of delay (presumptively prejudicial threshold)
  2. Reason for delay (attribute to prosecution or defense)
  3. Defendant's assertion of the right (date and how asserted)
  4. Prejudice to defendant (oppressive incarceration, anxiety, impaired defense)
- State whether the delay meets the Doggett v. United States, 505 U.S. 647 (1992) threshold.` : ''}
${motionType === 'habeas_corpus' ? `- Frame every claim under 28 U.S.C. § 2254(d): the state court's decision must have been (1) contrary to, or an unreasonable application of, clearly established federal law as determined by the Supreme Court (Williams v. Taylor, 529 U.S. 362 (2000)), OR (2) based on an unreasonable determination of the facts.
- Address AEDPA exhaustion requirement: all claims must have been presented to the highest available state court.
- Address statute of limitations: one year from when conviction became final under 28 U.S.C. § 2244(d).
- For ineffective assistance claims: apply Strickland v. Washington, 466 U.S. 668 (1984) two-prong test explicitly.` : ''}
${motionType === 'suppress' ? `- Identify the precise constitutional amendment and theory: 4th (unreasonable search/seizure), 5th (coerced statement), or 6th (interrogation without counsel).
- Address the applicable exclusionary rule standard (Mapp v. Ohio for state; Weeks v. United States for federal).
- If fruit of the poisonous tree is alleged, address whether independent source, inevitable discovery, or attenuation doctrine (Utah v. Strieff) applies.
- If good faith exception is raised by prosecution, address United States v. Leon, 468 U.S. 897 (1984) and its exceptions.` : ''}

GENERAL REQUIREMENTS:
- Use proper legal motion format for ${fields.state || 'US'} state court
- Include caption (court, case number, parties)
- Include proper legal headings (Introduction, Statement of Facts, Legal Standard, Argument, Conclusion)
- Cite relevant case law with full citations — case name, volume, reporter, page, court, year
- Write in formal legal language
- End with signature block with blanks for date and attorney signature
- Flag [ATTORNEY TO VERIFY: local rule] wherever local court rules may differ
- Flag [ATTORNEY TO VERIFY: cite] next to every case citation — AI citations must
   NEVER be relied upon without verification. If uncertain of a citation,
   write [CASE CITATION NEEDED] rather than guessing. Real harm results
   from filing motions with fabricated case law. be independently verified
- Do NOT include explanatory notes or meta-commentary — output the motion only

Generate the complete motion now:`;

  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      temperature: 0.15,
      max_tokens: isAppellatMotion ? 8000 : 2000, // appellate briefs need more room
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const motionText = data.content?.[0]?.text || '';
  return motionText + '\n\n---\n*This AI-generated motion requires attorney review before filing. All citations must be independently verified. Not legal advice.*';
}

// ── POST /api/motions/generate ────────────────────────────────────────────────

export const MOTION_DISCLAIMER = 'AI-generated motion drafts require attorney review before filing.';
