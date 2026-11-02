#!/usr/bin/env node
/**
 * apply-translation-drafts.mjs — apply a reviewed "Translate new keys" review file
 * (Admin → Batch tools → Download draft, or GET /api/admin/ai-batches/:id/translation-draft).
 *
 *   node backend/scripts/apply-translation-drafts.mjs <draft.json>            dry run: re-check + list
 *   node backend/scripts/apply-translation-drafts.mjs <draft.json> --write    write the catalogs
 *
 * Every draft is checked again against the CURRENT catalogs (services/translationDrafts.js
 * checkDraft — the parity tests' rules) and only keys that are still missing are applied:
 *   app     frontend/src/i18n/<lang>.json   rewritten in English key order (2-space JSON)
 *   server  backend/src/i18n/messages/<lang>.js   each new line inserted after the nearest
 *           preceding English key that the file already has (comments and layout kept)
 * Then run the i18n tests: frontend `npm test -- i18nParity`, backend
 * `npx jest src/__tests__/i18n_server_content.test.js`.
 */
import fs from 'fs';
import path from 'path';
import { checkDraft, LANGS, DEFAULT_DIRS, readCatalogs, readBackendCatalogs, insertBackendLines } from '../src/services/translationDrafts.js';

const [file, ...flags] = process.argv.slice(2);
const WRITE = flags.includes('--write');
if (!file) { console.error('usage: apply-translation-drafts.mjs <draft.json> [--write]'); process.exit(2); }
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const draft = doc.draft || doc.output?.draft;
if (!draft) { console.error('not a translation draft file (no "draft")'); process.exit(2); }

const dirs = DEFAULT_DIRS;
const fe = readCatalogs(dirs).frontend;
const be = await readBackendCatalogs(dirs);
let applied = 0; let skipped = 0;
const report = [];

for (const lang of LANGS) {
  // App catalog
  const fAdd = {};
  for (const [k, text] of Object.entries(draft.frontend?.[lang] || {})) {
    if (!fe) { skipped += 1; report.push(`frontend ${lang} ${k}: app catalog not found`); continue; }
    if (k in fe[lang]) { skipped += 1; report.push(`frontend ${lang} ${k}: already translated — skipped`); continue; }
    const p = checkDraft(fe.en[k], lang, k, text);
    if (p.length) { skipped += 1; report.push(`frontend ${lang} ${k}: ${p.join(', ')}`); continue; }
    fAdd[k] = text;
  }
  if (Object.keys(fAdd).length) {
    const merged = {};
    for (const k of Object.keys(fe.en)) if (k in fe[lang] || k in fAdd) merged[k] = k in fAdd ? fAdd[k] : fe[lang][k];
    if (WRITE) fs.writeFileSync(path.join(dirs.frontend, `${lang}.json`), `${JSON.stringify(merged, null, 2)}\n`);
    applied += Object.keys(fAdd).length;
    report.push(`frontend ${lang}: ${Object.keys(fAdd).length} key(s) ${WRITE ? 'written' : 'would be written'}`);
  }
  // Server catalog
  const bAdd = {};
  for (const [k, text] of Object.entries(draft.backend?.[lang] || {})) {
    if (k in be[lang]) { skipped += 1; report.push(`backend ${lang} ${k}: already translated — skipped`); continue; }
    const p = checkDraft(be.en[k], lang, k, text);
    if (p.length) { skipped += 1; report.push(`backend ${lang} ${k}: ${p.join(', ')}`); continue; }
    bAdd[k] = text;
  }
  if (Object.keys(bAdd).length) {
    const f = path.join(dirs.backend, `${lang}.js`);
    const out = insertBackendLines(fs.readFileSync(f, 'utf8'), Object.keys(be.en), { ...be[lang] }, bAdd);
    if (WRITE) fs.writeFileSync(f, out);
    applied += Object.keys(bAdd).length;
    report.push(`backend ${lang}: ${Object.keys(bAdd).length} key(s) ${WRITE ? 'written' : 'would be written'}`);
  }
}
console.log(report.join('\n') || 'nothing to apply');
console.log(`${WRITE ? 'applied' : 'dry run —'} ${applied} key(s); ${skipped} skipped. Next: run the i18n parity tests.`);
