/**
 * services/translationDrafts.js — the admin tool "Translate new keys" (docs/AI_PLATFORM.md §10,
 * docs/TRANSLATIONS.md "Adding new text").
 *
 * Finds every key that exists in English but is missing in any of the seven other languages (app:
 * frontend/src/i18n/<lang>.json; server: backend/src/i18n/messages/<lang>.js), asks Claude for
 * draft translations as ONE Message Batch (one request per catalog × language × up to 60 keys, the
 * translator brief as the cached system prompt, structured output), then checks every draft with
 * the same rules the parity tests enforce (checkDraft):
 *   same {placeholders} / {{x}} / %s / ${…} and emoji as English · not empty · not identical to
 *   English · not much shorter than English (≥ 50 %; Chinese ≥ 15 %, Arabic ≥ 40 %) · STOP kept in
 *   text-message keys · only keys that really are missing.
 * Drafts that pass go into a REVIEW FILE (the batch output; downloaded from Admin → Batch tools or
 * GET /api/admin/ai-batches/:id/translation-draft); drafts that fail are listed with the reason.
 * Nothing is applied automatically: a developer reviews the file (ideally with a native speaker —
 * the translator brief's rule) and applies it with
 *   node backend/scripts/apply-translation-drafts.mjs <file.json>           (dry run: re-checks, shows)
 *   node backend/scripts/apply-translation-drafts.mjs <file.json> --write   (writes the catalogs)
 * then runs the i18n tests (frontend i18nParity, backend i18n_server_content).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createBatch } from './aiBatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LANGS = Object.freeze(['es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl']);
export const LANG_NAMES = Object.freeze({
  es: 'Spanish (neutral US / Latin American, "usted")', pt: 'Portuguese (Brazilian)', vi: 'Vietnamese (US diaspora)',
  ht: 'Haitian Creole (Kreyòl ayisyen as used in US Haitian communities)', zh: 'Chinese, Simplified (plain Mandarin as in US courts\' Simplified Chinese materials)',
  ar: 'Arabic (Modern Standard Arabic, plain style)', tl: 'Tagalog / Filipino (everyday US Filipino, polite "kayo/ninyo")',
});
export const DEFAULT_DIRS = Object.freeze({
  frontend: path.resolve(__dirname, '../../../frontend/src/i18n'),
  backend: path.resolve(__dirname, '../i18n/messages'),
});
export const CHUNK = 60;

// The parity tests' rules (frontend/src/__tests__/i18nParity.test.js, backend i18n_server_content.test.js).
const PLACEHOLDER = /\{\{?\w+\}?\}|%[sd]|\$\{[^}]*\}/g;
const BRACE = /\{[a-zA-Z0-9_.]+\}/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
const MIN_RATIO = { zh: 0.15, ar: 0.4 };
const sorted = (s, re) => JSON.stringify((String(s).match(re) || []).sort());

/** Problems with one draft value (empty list = passes). */
export function checkDraft(en, lang, key, text) {
  const out = [];
  if (typeof text !== 'string' || !text.trim()) return ['empty'];
  if (typeof en !== 'string') return ['not_in_english'];
  if (sorted(en, PLACEHOLDER) !== sorted(text, PLACEHOLDER) || sorted(en, BRACE) !== sorted(text, BRACE)) out.push('placeholders_differ');
  if (sorted(en, EMOJI) !== sorted(text, EMOJI)) out.push('emoji_differ');
  if (text === en && /[a-z]{3,}/i.test(en)) out.push('identical_to_english');
  if (en.length >= 30 && text.length < en.length * (MIN_RATIO[lang] ?? 0.5)) out.push('too_short');
  if (/sms|reply|opt/i.test(key) && /\bSTOP\b/.test(en) && !/\bSTOP\b/.test(text)) out.push('lost_STOP');
  return out;
}

export function readCatalogs(dirs = DEFAULT_DIRS) {
  const out = { frontend: null, backend: null };
  try {
    out.frontend = Object.fromEntries(['en', ...LANGS].map((l) => [l, JSON.parse(fs.readFileSync(path.join(dirs.frontend, `${l}.json`), 'utf8'))]));
  } catch { out.frontend = null; }   // a server deployed without the app's files: server catalog only
  return out;
}
export async function readBackendCatalogs(dirs = DEFAULT_DIRS) {
  const out = {};
  for (const l of ['en', ...LANGS]) {
    const f = path.join(dirs.backend, `${l}.js`);
    out[l] = (await import(`${pathToFileURL(f).href}?t=${fs.statSync(f).mtimeMs}`)).default;
  }
  return out;
}

/** { frontend: { es: [keys] … } | null, backend: { … } } — keys in English order. */
export async function missingKeys(dirs = DEFAULT_DIRS) {
  const fe = readCatalogs(dirs).frontend;
  const be = await readBackendCatalogs(dirs);
  const miss = (cat) => cat && Object.fromEntries(LANGS.map((l) => [l, Object.keys(cat.en).filter((k) => !(k in (cat[l] || {})) || !String(cat[l][k] ?? '').trim())]));
  return { frontend: miss(fe), backend: miss(be), english: { frontend: fe?.en || null, backend: be.en } };
}

const SYSTEM = `You translate short pieces of text for Justice Gavel, an app for people who were just arrested and their families, plus software for bail agents and lawyers. Readers may be scared, in crisis and not highly literate.

Rules:
- Use plain, everyday, respectful language (not legalese), in the variety most common among US immigrant communities for the language.
- Accuracy of meaning matters more than elegance: never add, soften or drop a warning, a right, a deadline, a price or a condition.
- Keep every {placeholder} (and {{x}}, %s, \${...}) exactly as written, untranslated, the same number of times.
- Keep unchanged: brand names (Justice Gavel, Bond Desk, Case Pass, Legal Pro, Ameelio, Stripe, Telnyx), the text-message keywords STOP, START and HELP and the replies 1 / 2 / 3, URLs, e-mail addresses, code-like tokens, \\n line breaks, numbers and prices, emoji.
- Keys with "sms" in them are text messages: keep them as short as the meaning allows.
- Where a US legal term has no real equivalent (bail bond, indemnitor, arraignment, public defender, expungement), use the term communities actually use.
- Translate every key you are given, and only those keys. Return the key exactly as given.`;

/** Batch items for the missing keys. */
export function draftItems(missing) {
  const items = [];
  for (const catalog of ['frontend', 'backend']) {
    const m = missing[catalog];
    const en = missing.english[catalog];
    if (!m || !en) continue;
    for (const lang of LANGS) {
      const keys = m[lang] || [];
      for (let i = 0; i < keys.length; i += CHUNK) {
        const part = keys.slice(i, i + CHUNK);
        const n = i / CHUNK;
        items.push({
          customId: `t_${catalog.slice(0, 2)}_${lang}_${n}`, logicalKey: `translate:${catalog}:${lang}:${part[0]}`,
          ref: { catalog, lang, keys: part }, task: 'translate_keys',
          system: [{ text: SYSTEM, cache: '1h' }],
          messages: [{ role: 'user', content: `Translate into ${LANG_NAMES[lang]} (language code ${lang}). Return every key.\n\n${JSON.stringify(Object.fromEntries(part.map((k) => [k, en[k]])), null, 1)}` }],
        });
      }
    }
  }
  return items;
}

/** Admin trigger. → { batch, created, missing: { frontend, backend } counts } */
export async function startTranslationDraft(db, { createdBy = null, dirs = DEFAULT_DIRS, fetchImpl } = {}) {
  const missing = await missingKeys(dirs);
  const count = (c) => (c ? Object.values(c).reduce((s, v) => s + v.length, 0) : null);
  const counts = { frontend: count(missing.frontend), backend: count(missing.backend) };
  const items = draftItems(missing);
  if (!items.length) return { batch: null, created: false, missing: counts };
  // Keep only the English of the missing keys with the batch (the checks run on it later).
  const english = {};
  for (const c of ['frontend', 'backend']) {
    if (!missing[c]) continue;
    english[c] = {};
    for (const keys of Object.values(missing[c])) for (const k of keys) english[c][k] = missing.english[c][k];
  }
  const out = await createBatch(db, { kind: 'translate_keys', items, idempotencyKey: `translate_keys:${new Date().toISOString().slice(0, 16)}`, createdBy,
    meta: { missing: counts, english }, fetchImpl });
  return { ...out, missing: counts };
}

/** aiBatch handler: check the drafts, build the review file (stored as the batch output). */
export async function onBatchProcessed(db, batch, handled) {
  const meta = typeof batch.meta === 'string' ? JSON.parse(batch.meta) : batch.meta || {};
  const english = meta.english || (await missingKeys()).english;
  const draft = { frontend: {}, backend: {} };
  const rejected = [];
  let failedRequests = 0;
  for (const h of handled) {
    const ref = (typeof h.item.ref === 'string' ? JSON.parse(h.item.ref) : h.item.ref) || {};
    const { catalog, lang, keys = [] } = ref;
    if (h.item.status !== 'succeeded' || !h.outcome?.json) { failedRequests += 1; for (const k of keys) rejected.push({ catalog, lang, key: k, problems: [`request_${h.item.status}`] }); continue; }
    const got = new Map((h.outcome.json.translations || []).map((t) => [t.key, t.text]));
    for (const k of keys) {
      const text = got.get(k);
      const problems = text === undefined ? ['not_returned'] : checkDraft(english?.[catalog]?.[k], lang, k, text);
      if (problems.length) rejected.push({ catalog, lang, key: k, problems });
      else (draft[catalog][lang] = draft[catalog][lang] || {})[k] = text;
    }
    for (const k of got.keys()) if (!keys.includes(k)) rejected.push({ catalog, lang, key: k, problems: ['not_asked'] });
  }
  const n = (o) => Object.values(o).reduce((s, v) => s + Object.keys(v).length, 0);
  return {
    kind: 'translation_draft', generated_at: new Date().toISOString(), batch_id: batch.id,
    note: 'Draft translations made by Claude — review (ideally by a native speaker) before applying. Apply with: node backend/scripts/apply-translation-drafts.mjs <this file> --write',
    counts: { accepted: n(draft.frontend) + n(draft.backend), rejected: rejected.length, failed_requests: failedRequests },
    draft, rejected,
  };
}

/**
 * Insert new `"key": "value",` lines into a server catalog file (es.js …), each after the nearest
 * preceding English key the file has — comments and layout are kept (apply-translation-drafts.mjs).
 */
export function insertBackendLines(src, enKeys, current, add) {
  const lines = src.split('\n');
  const keyLine = (k) => lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(k)}:`) || l.startsWith(`  '${k}':`));
  for (const k of enKeys) {
    if (!(k in add)) continue;
    const i = enKeys.indexOf(k);
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) if (enKeys[j] in current || enKeys[j] in add) at = keyLine(enKeys[j]);
    const line = `  ${JSON.stringify(k)}: ${JSON.stringify(add[k])},`;
    if (at < 0) at = lines.findIndex((l) => l.startsWith('export default {'));
    lines.splice(at + 1, 0, line);
    current[k] = add[k];
  }
  return lines.join('\n');
}
