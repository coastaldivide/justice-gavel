import { aiMessage, sendAiError } from '../../services/aiClient.js';
import { requireAi } from '../../utils/ai.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger from '../../utils/logger.js';
import { STATE_RULES, getEligibility, citationOf } from './rules.js';
import { checkedOn, isWithheld } from '../../ai/sourceOverlay.js';
import { buildModel, checkDraft, storedText, sendDocument, FORMATS } from '../../services/draftDocs/index.js';
import { getDb } from '../../db/index.js';
import { safeInt } from '../../utils/routeHelpers.js';
import { makeUserLimiter, perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
/**
 * expungement/petition.js
 *
 * POST /petition                       — AI petition draft → { draft, document_id, sources, withheld, disclaimer }
 * GET  /petition/:id/document?format=docx|pdf — the draft as a Word or PDF download (AI step 5)
 *
 * AI step 5 (docs/AI_PLATFORM.md §13): the draft may cite only the record-clearing rule the app
 * has a checked source for (the state × charge row that passes citationOf(), its official page and
 * the date it was checked). The model is given that rule and told to cite nothing else; then every
 * paragraph naming a statute / rule / case that is not that citation is withheld ("No source found
 * for this part — not shown") — in the app and in the downloads alike. The checked draft, the
 * person's own typed fields and the source are stored (draft_documents, the last
 * MAX_DRAFTS_PER_USER per person) so the download is the draft that was shown.
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';

const router = Router();
export const MAX_DRAFTS_PER_USER = 20;
const CHARGE_KINDS = new Set(['felony', 'misdemeanor', 'dui', 'domestic', 'sexual', 'dismissed']);
const downloadLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 60, message: (req) => msg(resolveLang(req), 'docs.err.limit') });

/** The checked source for a state × charge kind, or null. */
export function petitionSource(state, kind) {
  if (!CHARGE_KINDS.has(kind) || !Object.prototype.hasOwnProperty.call(STATE_RULES, state)) return null;
  const rule = getEligibility(state, kind, kind === 'dismissed' ? 'Dismissed' : 'Convicted');
  const citation = rule && citationOf(rule);
  if (!citation || isWithheld('expungement', `${state}.${kind}`)) return null;
  return { citation, url: rule.source_url, checked: checkedOn('expungement', `${state}.${kind}`, '2026-10-25'), note: String(rule.note || '').slice(0, 1200) };
}

router.post('/petition', authRequired, requireAi, perUserAiLimit, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const state = str(b.state, 3).toUpperCase();
    const charge_type = str(b.charge_type, 200);
    const charge_kind = str(b.charge_kind, 20).toLowerCase();
    const case_number = str(b.case_number, 60);
    const county = str(b.county, 80);
    const full_name = str(b.full_name, 120);
    const conviction_year = str(String(b.conviction_year ?? ''), 4);
    if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state) || !charge_type) {
      return res.status(400).json({ error: msg(lang, 'expungement.err.petition_fields'), code: 'validation_failed' });
    }
    const source = petitionSource(state, charge_kind);
    const authority = source
      ? `CHECKED SOURCE (the only legal authority you may cite): ${source.citation} — ${source.url}\nWhat the app's checked record says: ${source.note}`
      : 'CHECKED SOURCE: none for this state and charge. Do not cite any statute, rule or case; write [LEGAL BASIS — ask the court clerk or a legal aid office which law applies] where the legal basis goes.';

    const user = `State: ${state}
County: ${county || '[COUNTY]'}
Charge type: ${charge_type}
Case number: ${case_number || '[CASE NUMBER]'}
Petitioner name: ${full_name || '[FULL NAME]'}
Year of conviction/disposition: ${conviction_year || '[YEAR]'}

${authority}

Prepare the draft petition for expungement or record sealing for ${state}.`;

    // Routing (class 'deep'), caching, budget, timeout/retries, refusals, metering: aiClient.
    const out = await aiMessage({
      task: 'expungement_petition',
      system: [{ text: PETITION_SYSTEM, cache: '5m' }],
      messages: [{ role: 'user', content: user }],
      route: 'expungement_petition',
      userId: req.user.id,
      timeoutMs: 120_000,
    });
    const allowed = source ? [source.citation] : [];
    const checked = checkDraft(out.text, allowed, lang);
    const sources = source ? [{ citation: source.citation, url: source.url, checked: source.checked }] : [];
    const fields = { full_name, state, county, case_number, charge: charge_type, conviction_year };
    let documentId = null;
    try {
      const db = await getDb();
      const r = await db.run(
        `INSERT INTO draft_documents (user_id, kind, title, lang, state, fields, draft, sources, withheld)
         VALUES (?, 'expungement_petition', ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?) RETURNING id`,
        [req.user.id, msg(lang, 'docs.petition_title'), lang, state, JSON.stringify(fields),
          storedText(checked.paragraphs), JSON.stringify(sources), checked.withheld]);
      documentId = r.lastID || r.rows?.[0]?.id || null;
      await db.run(
        `DELETE FROM draft_documents WHERE user_id = ? AND id NOT IN (
           SELECT id FROM draft_documents WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${MAX_DRAFTS_PER_USER})`, [req.user.id, req.user.id]);
    } catch (e) {
      logger.warn({ err: e.message }, '[expungement/petition] draft not kept — no download for it');
    }
    return res.json({ draft: checked.text, document_id: documentId, sources, withheld: checked.withheld, disclaimer: msg(lang, 'expungement.petition_disclaimer') });
  } catch (e) {
    logger.error('[expungement/petition]', e.message);
    return sendAiError(res, lang, e);
  }
});

/** A stored petition → the document model (withheld paragraphs come back as markers). */
export function petitionModel(row, lang) {
  const f = row.fields || {};
  const t = (k) => msg(lang, `docs.field.${k}`);
  // withheld paragraphs were stored as a marker (never their words) and come back withheld
  return buildModel({
    title: msg(lang, 'docs.petition_title'), lang, draft: row.draft,
    allowed: (row.sources || []).map((s) => s.citation),
    sources: row.sources || [],
    fields: ['full_name', 'state', 'county', 'case_number', 'charge', 'conviction_year'].map((k) => ({ label: t(k), value: f[k] })),
    signerName: f.full_name || '',
  });
}

router.get('/petition/:id/document', authRequired, downloadLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const format = String(req.query.format || '').toLowerCase();
  if (!FORMATS.includes(format)) return res.status(400).json({ error: 'bad_format', code: 'bad_format', message: msg(lang, 'docs.err.format') });
  try {
    const db = await getDb();
    const row = await db.get('SELECT id, fields, draft, sources, lang FROM draft_documents WHERE id = ? AND user_id = ? AND kind = ?',
      [safeInt(req.params.id), req.user.id, 'expungement_petition']);
    if (!row) return res.status(404).json({ error: 'not_found', code: 'not_found', message: msg(lang, 'docs.err.not_found') });
    return await sendDocument(res, petitionModel(row, lang), format, { base: 'petition', id: row.id });
  } catch (e) {
    logger.error({ err: e.message }, '[expungement/petition/document]');
    return res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(lang, 'docs.err.server') });
  }
});

// Petition instructions (stable → prompt-cached).
const PETITION_SYSTEM = `You prepare a DRAFT petition to expunge or seal a criminal record, for a person who will review it, have a lawyer or the court clerk check it, and file it themselves. You give general legal information, never legal advice, and you do not speak as their lawyer.

Sources: the request names at most one CHECKED SOURCE — a statute the app has checked against its official page. It is the only law you may cite: cite it exactly as given, and do not name any other statute, rule, case, waiting period or deadline from memory. If there is no checked source, cite nothing and write the placeholder the request gives where the legal basis goes. (Anything else that names a law is removed from the draft before the person sees it.)

If the person may have been under 18 at the time, add one line asking them to check with the clerk whether juvenile record rules apply instead.

Use [PLACEHOLDER] for any required information not provided. Copy the person's details exactly as given.
Include: caption, statement of facts, legal basis (only the checked source), request to the court, and a verification with a blank signature line. Never write a signature, "/s/" or a name on a signature line.
Separate paragraphs with a blank line. Format as a plain-text court document.
Put at the top in ALL CAPS: DRAFT — GENERAL LEGAL INFORMATION, NOT LEGAL ADVICE — HAVE A LAWYER OR THE COURT CLERK REVIEW BEFORE FILING.`;

export default router;
