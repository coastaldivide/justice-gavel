/**
 * ai/legalRefs.js — find statute / rule / case references in text and check them against the
 * citations the app has a checked source for (AI step 5).
 *
 * Used where AI-written text leaves the app as a document (services/draftDocs): a paragraph that
 * names a statute, rule or case the app has no checked source for is withheld ("No source found
 * for this part — not shown", the step-2 rule), and by the conversation recap (a recap of what the
 * person said never carries a legal reference).
 *
 *   findRefs(text)                 → [{ text, numbers: ['40-32-101', …], kind: 'statute'|'case' }]
 *   checkParagraphs(text, allowed) → { paragraphs: [{ text } | { withheld: true }], withheld, kept }
 *       allowed: citation strings with a checked source (e.g. "Tenn. Code Ann. § 40-32-101").
 *       A paragraph is kept when every reference in it is covered: each section number it names
 *       appears in an allowed citation. Case citations ("X v. Y, 123 F.3d 456") are never covered
 *       (the app has no checked case-law source). A paragraph with no reference is kept as is.
 */

// Words that introduce a statute / rule / regulation reference (English — the language of the
// court papers this applies to — plus the abbreviations every state uses).
const MARKER = /§|\bsec(?:tion|s?\.)\s*\d|\bU\.?\s?S\.?\s?C\.?\b|\bC\.?F\.?R\.?\b|\bcode\s+ann\b|\bann(?:otated)?\.?\s+(?:code|laws|stat)|\brev(?:ised)?\.?\s+(?:stat|code)|\bstat(?:utes?)?\.?\s+(?:ann\.?\s*)?§?\s*\d|\b(?:penal|criminal|civil|vehicle|family|probate|government|welfare|health)\s+(?:and\s+\w+\s+)?code\b|\bT\.?C\.?A\.?\b|\bO\.?C\.?G\.?A\.?\b|\bM\.?C\.?L\.?\b|\bR\.?C\.?W\.?\b|\bG\.?S\.?\s*\d|\bILCS\b|\b(?:rule|r\.)\s+\d+(?:\.\d+)*\b|\bpub(?:lic)?\.?\s+l(?:aw|\.)\s*\d/i;
// A case citation: "v." between names followed by a reporter cite ("123 F.3d 456", "45 S.W.3d 12", "510 U.S. 1").
const CASE = /\b[A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*)*\s+v\.?\s+[A-Z][\w.'&-]*[^.\n]{0,80}?\b\d{1,4}\s+[A-Z][A-Za-z.]*(?:\s?\d?d|\s?[234]th)?\.?\s+\d{1,5}\b/;
// Section numbers: "40-32-101", "2C:52-2", "1203.4", "4.1(b)", "13-1", plus a bare number right after §.
const SECTION_NUM = /\d+[A-Za-z]?(?:[-:.]\d+[A-Za-z]?)+(?:\([a-z0-9]+\))*/g;
const AFTER_SECTION = /§+\s*(\d+[A-Za-z]?(?:[-:.]\d+[A-Za-z]?)*)/g;

const normNum = (s) => String(s).toLowerCase().replace(/\([a-z0-9]+\)/g, '').replace(/[.:]+$/, '');

/** Every section number named in a string (normalised). */
export function sectionNumbers(text) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(SECTION_NUM)) {
    // a date (2026-11-02, 11.02.2026) or a money amount is not a section number
    if (/^\d{4}-\d{2}-\d{2}$/.test(m[0]) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(m[0])) continue;
    out.add(normNum(m[0]));
  }
  for (const m of s.matchAll(AFTER_SECTION)) out.add(normNum(m[1]));
  return [...out];
}

/** Does the text contain a statute / rule reference or a case citation? */
export function hasLegalRef(text) {
  const s = String(text || '');
  return MARKER.test(s) || CASE.test(s);
}

export function findRefs(text) {
  const s = String(text || '');
  const refs = [];
  if (CASE.test(s)) refs.push({ kind: 'case', text: s.match(CASE)[0], numbers: [] });
  if (MARKER.test(s)) refs.push({ kind: 'statute', text: s.match(MARKER)[0], numbers: sectionNumbers(s) });
  return refs;
}

/** Is every reference in this paragraph covered by an allowed (checked) citation? */
export function paragraphCovered(text, allowed = []) {
  if (!hasLegalRef(text)) return true;
  if (CASE.test(text)) return false;
  const nums = sectionNumbers(text);
  const allowedNums = new Set(allowed.flatMap(sectionNumbers));
  // A reference with no section number ("under the Tennessee Code") is covered only when a
  // checked citation exists at all.
  if (!nums.length) return allowed.length > 0;
  return nums.every((n) => allowedNums.has(n) || [...allowedNums].some((a) => n.startsWith(`${a}(`)));
}

/**
 * Split into paragraphs (blank lines) and withhold the ones whose references are not covered.
 * Line breaks inside a paragraph are kept (captions, addresses).
 */
export function checkParagraphs(text, allowed = []) {
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/\s+$/g, '')).filter((p) => p.trim());
  let withheld = 0;
  const paragraphs = paras.map((p) => {
    if (paragraphCovered(p, allowed)) return { text: p };
    withheld += 1;
    return { withheld: true };
  });
  return { paragraphs, withheld, kept: paragraphs.length - withheld };
}
