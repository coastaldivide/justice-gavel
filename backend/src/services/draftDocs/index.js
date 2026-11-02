/**
 * services/draftDocs — "Download as Word (.docx)" / "Download as PDF" for drafts (AI step 5,
 * docs/AI_PLATFORM.md §13): the expungement petition (routes/expungement/petition.js) and saved
 * motions (routes/motions/history.js). Generated on the server, nothing kept but the draft row.
 *
 * Why not Anthropic's pre-built Agent Skills (docx / pdf): docs read 2026-11-02 —
 * https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview — "Using Skills
 * through the API requires the code execution tool, whose container Skills run in"; Agent Skills
 * are "not covered by ZDR arrangements … Zero data retention: Not eligible; HIPAA: Not eligible",
 * and the file would be produced by a model run inside a container (an extra deep-class call per
 * download, the document's contents leaving our servers again, and a file whose text we would have
 * to re-check). Our documents are a fixed layout of text we already hold and have checked, so a
 * deterministic writer is cheaper, private and exact. Not used.
 */
import { fileName, MIME } from './model.js';
import { docxFromModel } from './docx.js';
import { pdfFromModel } from './pdf.js';

export { buildModel, checkDraft, checkStored, storedText, unsign, fileName, MIME, WITHHELD_MARK } from './model.js';
export { docxFromModel } from './docx.js';
export { pdfFromModel } from './pdf.js';

export const FORMATS = Object.freeze(['docx', 'pdf']);

/** model + format → { buffer, mime } */
export async function renderDocument(model, format) {
  if (format === 'docx') return { buffer: docxFromModel(model), mime: MIME.docx };
  if (format === 'pdf') return { buffer: await pdfFromModel(model), mime: MIME.pdf };
  throw Object.assign(new Error('unknown format'), { code: 'bad_format' });
}

/** Send a rendered document as a download. */
export async function sendDocument(res, model, format, { base, id }) {
  const { buffer, mime } = await renderDocument(model, format);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(base, id, format)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Withheld-Parts', String(model.withheld || 0));
  return res.send(buffer);
}

