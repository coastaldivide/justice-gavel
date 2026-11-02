/**
 * services/draftDocs/model.js — what goes into a downloadable draft (AI step 5,
 * docs/AI_PLATFORM.md §13). One model, two writers (docx.js, pdf.js), so the Word and PDF copies
 * always say the same thing.
 *
 * Rules (owner):
 *   - every page carries the notice, in the person's language: "Prepared by you with Justice
 *     Gavel — general legal information, not legal advice. Have a lawyer or the court clerk
 *     review before filing." (header and footer);
 *   - only sourced legal text: a draft paragraph that names a statute / rule / case the app has no
 *     checked source for is withheld (ai/legalRefs.js checkParagraphs) and shows the step-2 marker
 *     "No source found for this part — not shown"; the checked sources are listed with their
 *     official page and the date they were checked;
 *   - the person's own words are kept exactly as typed (their own section, verbatim);
 *   - no drawn or fake signatures: any "/s/ …" mark in the draft (at the start of a line or after "By:" / "Signature:") becomes a blank line, and the
 *     document ends with a blank signature line, date line and the printed name as typed.
 *
 * Model: { title, lang, notice, blocks: [
 *   { type: 'title', text } | { type: 'heading', text } | { type: 'para', text } |
 *   { type: 'withheld', text } | { type: 'field', label, value } |
 *   { type: 'source', citation, url, checked } | { type: 'signature', signature, date, name, nameLabel } ] }
 */
import { checkParagraphs, paragraphCovered } from '../../ai/legalRefs.js';
import { msg } from '../../i18n/index.js';

export const MAX_DRAFT_CHARS = 100_000;
/** How a withheld paragraph is stored (draft_documents.draft): never the original words. */
export const WITHHELD_MARK = '[[jg:withheld]]';
// "/s/ Jane Doe", "By: /s/ Jane Doe", "Signature: /s/ Jane Doe" — an electronic signature mark
// anywhere on a line: the mark and everything after it on that line become the blank line
// (what comes before it, such as "By:", is kept).
const SIGNED = /(?<![\w/.~%-])\/ ?s ?\/.*$/gim;
const BLANK_LINE = '______________________________';

/** The draft text with any "/s/ name" line replaced by a blank signature line. */
export function unsign(text) {
  return String(text || '').replace(SIGNED, BLANK_LINE).replace(/^[ \t]+(?=_{30}$)/gm, '');
}

/**
 * Check the draft's paragraphs against the citations with a checked source.
 * → { paragraphs: [{ text } | { withheld: true }], withheld, kept, text }  (text: kept paragraphs + markers)
 */
export function checkDraft(draft, allowed, lang = 'en') {
  const r = checkParagraphs(unsign(String(draft || '').slice(0, MAX_DRAFT_CHARS)), allowed);
  const marker = msg(lang, 'ai.cite.withheld');
  return { ...r, text: r.paragraphs.map((p) => (p.withheld ? marker : p.text)).join('\n\n') };
}

/** The paragraphs as stored (checked once already, WITHHELD_MARK in place of withheld ones) — checked again. */
export function checkStored(draft, allowed, lang = 'en') {
  const parts = String(draft || '').split(/\n\s*\n/);
  if (!parts.includes(WITHHELD_MARK)) return checkDraft(draft, allowed, lang);
  const paragraphs = [];
  let withheld = 0;
  for (const p of parts) {
    if (!p.trim()) continue;
    if (p.trim() === WITHHELD_MARK) { paragraphs.push({ withheld: true }); withheld += 1; continue; }
    const u = unsign(p);
    if (paragraphCovered(u, allowed)) paragraphs.push({ text: u }); else { paragraphs.push({ withheld: true }); withheld += 1; }
  }
  return { paragraphs, withheld, kept: paragraphs.length - withheld };
}

/** Checked paragraphs → the text stored in draft_documents.draft. */
export function storedText(paragraphs) {
  return paragraphs.map((p) => (p.withheld ? WITHHELD_MARK : p.text)).join('\n\n');
}

/**
 * The document model.
 *   { title, lang, draft, allowed: [citation], sources: [{ citation, url, checked }],
 *     fields: [{ label, value }]  (the person's own words), signerName }
 */
export function buildModel({ title, lang = 'en', draft, allowed = [], sources = [], fields = [], signerName = '' }) {
  const t = (k, p) => msg(lang, `docs.${k}`, p);
  const checked = checkStored(draft, allowed, lang);
  const blocks = [{ type: 'title', text: title }];
  const own = fields.filter((f) => f && String(f.value ?? '').trim());
  if (own.length) {
    blocks.push({ type: 'heading', text: t('your_words') });
    for (const f of own) blocks.push({ type: 'field', label: f.label, value: String(f.value) });
  }
  blocks.push({ type: 'heading', text: t('draft') });
  for (const p of checked.paragraphs) {
    blocks.push(p.withheld ? { type: 'withheld', text: msg(lang, 'ai.cite.withheld') } : { type: 'para', text: p.text });
  }
  const shown = sources.filter((s) => s && s.citation);
  blocks.push({ type: 'heading', text: t('sources') });
  if (shown.length) for (const s of shown) blocks.push({ type: 'source', citation: s.citation, url: s.url || '', checked: s.checked ? t('checked', { date: s.checked }) : '' });
  else blocks.push({ type: 'para', text: t('no_sources') });
  blocks.push({
    type: 'signature', signature: t('signature'), date: t('date'), nameLabel: t('printed_name'),
    name: String(signerName || ''),
  });
  return { title, lang, notice: t('notice'), withheld: checked.withheld, blocks };
}

/** A safe ASCII file name: "petition-12.docx". */
export function fileName(base, id, ext) {
  const b = String(base || 'draft').toLowerCase().normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'draft';
  return `${b}-${id}.${ext}`;
}

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};
