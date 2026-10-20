/**
 * crisisDetect.ts — does a chat message mention self-harm or domestic violence?
 *
 *   detectCrisis(text) → 'crisis' | 'dv' | null
 *
 * Keywords: x_ch_crisis_words / x_ch_dv_words (comma-separated) in every
 * app language. Matching ignores case and accents (so
 * "no quiero vivir" and "nao quero viver" or "muon chet" all match) and only
 * matches whole words: "end it all" matches "I want to end it all", not "spend it all".
 * Every language's list is checked, whatever the app language, so a person
 * typing Spanish in an English app is still recognised.
 */
import { tIn, LANGS } from '../i18n';

/** Lower-case, accents removed (đ → d), punctuation → spaces, single spaces. */
export function foldText(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function words(key: string): string[] {
  return LANGS.flatMap(l => tIn(l, key).split(',')).map(foldText).filter(Boolean);
}

const matches = (folded: string, list: string[]) => list.some(k => ` ${folded} `.includes(` ${k} `));

export function detectCrisis(text: string): 'crisis' | 'dv' | null {
  const folded = foldText(text);
  if (!folded) return null;
  if (matches(folded, words('x_ch_crisis_words'))) return 'crisis';
  if (matches(folded, words('x_ch_dv_words'))) return 'dv';
  return null;
}
