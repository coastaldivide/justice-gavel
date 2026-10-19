// feSource.js — read a frontend source file for "the screen says X" checks.
//
// Since the app was localised, user-visible text lives in
// frontend/src/i18n/en.json and screens call t('key'). Tests that pin what a
// screen shows read the file through this helper: it returns the source plus,
// appended as comments, the English catalogue value of every i18n key the file
// references — so "screen shows 'No internet connection'" still checks the
// screen's own text, wherever it now lives.
import fs from 'fs';

const REPO = decodeURIComponent(new URL('../../../../', import.meta.url).pathname).replace(/\/$/, '');
let EN = null;

export function feSource(file) {
  const path = file.startsWith('/') ? file : `${REPO}/${file.replace(/^\/+/, '')}`;
  const src = fs.readFileSync(path, 'utf8');
  if (!EN) EN = JSON.parse(fs.readFileSync(`${REPO}/frontend/src/i18n/en.json`, 'utf8'));
  const keys = [...new Set([...src.matchAll(/['"`]([a-z][A-Za-z0-9_.]*)['"`]/g)].map(m => m[1]).filter(k => typeof EN[k] === 'string'))];
  return `${src}\n/* i18n (en) */\n${keys.map(k => `/* ${k}: '${EN[k]}' */`).join('\n')}\n`;
}
