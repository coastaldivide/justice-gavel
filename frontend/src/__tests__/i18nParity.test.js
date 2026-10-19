/**
 * i18nParity.test.js — the four language files must be complete translations.
 *
 *   - every key in all four files (none extra, none empty)
 *   - placeholders ({name}, {{x}}, %s, ${...}) and emoji identical to English
 *   - no value identical to English, except a tiny allowlist of proper nouns /
 *     codes (ALLOW_SAME, each justified below)
 *   - no value much shorter than the English (a cut-down legal sentence is a
 *     wrong translation): ≥ 50 % of the English length for values ≥ 30 chars
 *   - cheap "wrong language" guards: Spanish words in Portuguese and vice
 *     versa; a Vietnamese value of 4+ words with no Vietnamese letter (English)
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../i18n');
const LANGS = ['es', 'pt', 'vi'];
const files = Object.fromEntries(['en', ...LANGS].map(l => [l, JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'))]));
const en = files.en;

// Values that are legitimately the same in every language (or the listed ones).
const ALLOW_SAME = {
  app_name: LANGS,          // brand: "Justice Gavel"
  home_title: LANGS,        // brand: "Justice Gavel"
  disc_upload_types: LANGS, // file-format codes: "PDF · JPEG · PNG · …"
  tier_legal_radar: LANGS,  // plan names are product names
  tier_legal_pro: LANGS,
  tier_esquire: LANGS,
  booking_min: ['es', 'pt'], // the unit abbreviation "min" is the same word
};

const PLACEHOLDER = /\{\{?\w+\}?\}|%[sd]|\$\{[^}]*\}/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
const sorted = (s, re) => (String(s).match(re) || []).sort();
const VI_LETTER = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

describe('i18n parity — es / pt / vi are complete translations of en', () => {
  it('has a meaningful number of keys', () => {
    expect(Object.keys(en).length).toBeGreaterThan(1000);
  });

  for (const lang of LANGS) {
    const d = files[lang];
    describe(lang, () => {
      it('has exactly the English keys, none empty', () => {
        expect(Object.keys(d).filter(k => !(k in en))).toEqual([]);
        expect(Object.keys(en).filter(k => !(k in d))).toEqual([]);
        expect(Object.keys(d).filter(k => typeof d[k] !== 'string' || !d[k].trim())).toEqual([]);
      });

      it('keeps every placeholder and emoji of the English value', () => {
        const bad = Object.keys(en).filter(k => JSON.stringify(sorted(en[k], PLACEHOLDER)) !== JSON.stringify(sorted(d[k], PLACEHOLDER)));
        expect(bad).toEqual([]);
        const badEmoji = Object.keys(en).filter(k => JSON.stringify(sorted(en[k], EMOJI)) !== JSON.stringify(sorted(d[k], EMOJI)));
        expect(badEmoji).toEqual([]);
      });

      it('translates every value (only the allowlisted proper nouns / codes may equal English)', () => {
        const same = Object.keys(en).filter(k => d[k] === en[k] && !(ALLOW_SAME[k] || []).includes(lang));
        expect(same).toEqual([]);
      });

      it('allowlist stays tiny and every entry is still identical (no stale entries)', () => {
        expect(Object.keys(ALLOW_SAME).length).toBeLessThanOrEqual(7);
        for (const [k, langs] of Object.entries(ALLOW_SAME)) {
          if (langs.includes(lang)) expect(d[k]).toBe(en[k]);
        }
      });

      it('no translation is much shorter than the English (nothing dropped)', () => {
        const short = Object.keys(en).filter(k => en[k].length >= 30 && d[k].length < en[k].length * 0.5);
        expect(short).toEqual([]);
      });

      it('is in the right language', () => {
        if (lang === 'pt') expect(Object.keys(d).filter(k => /ñ|ción\b|ciones\b|\busted\b|\bdel\b/.test(d[k]))).toEqual([]);
        if (lang === 'es') expect(Object.keys(d).filter(k => /ção|ões\b|\bvocê\b|\bnão\b/.test(d[k]))).toEqual([]);
        if (lang === 'vi') {
          const english = Object.keys(d).filter(k => !ALLOW_SAME[k] && (d[k].match(/[A-Za-z]{2,}/g) || []).length >= 4 && !VI_LETTER.test(d[k]));
          expect(english).toEqual([]);
        }
      });
    });
  }

  it('the rights-card sections say the same thing in every language (same paragraph and bullet structure)', () => {
    for (const lang of LANGS) {
      for (let i = 1; i <= 8; i++) {
        const k = `rc_b${i}`;
        expect([lang, k, files[lang][k].split('\n\n').length]).toEqual([lang, k, en[k].split('\n\n').length]);
        expect([lang, k, (files[lang][k].match(/•/g) || []).length]).toEqual([lang, k, (en[k].match(/•/g) || []).length]);
      }
    }
  });
});
