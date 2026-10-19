/**
 * i18n_server_content.test.js — every piece of server text the core path
 * returns exists in en / es / pt / vi with the same structure, and the server
 * and the app say the same thing (no drift between the two copies).
 *
 *   catalogs   same keys, same {placeholders}, nothing empty, nothing left in
 *              English (one allowlisted punctuation-only template)
 *   rights     8 general sections (same keys / topics / paragraph count) + the
 *              30-second script in every language, word-for-word the app's
 *              bundled card (frontend/src/i18n/<lang>.json rc_* / rs_*)
 *   guidance   checklist + missed-date steps: same ids in every language, same
 *              text as the app's bundled copy (cg_*); last step = "call your
 *              lawyer or the court clerk" in that language
 *   reminders  owner / follower titles + bodies, e-mail and SMS wrappers:
 *              every language, no unfilled placeholder, localized day / time
 *   language   ?lang= / Accept-Language parsing; unknown → English; the
 *              `language` field is the language actually served
 *   names      state-name table identical to the app's
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  CATALOGS, SUPPORTED_LANGS, msg, normalizeLang, parseAcceptLanguage, resolveLang, formatDay, formatTime, stateName,
} from '../i18n/index.js';
import { STATE_NAMES_I18N } from '../i18n/stateNames.js';
import { generalSections, scriptFor, getRightsCard, buildLegacyRightsCard, GENERAL_SECTIONS } from '../services/rightsContent.js';
import { courtDayGuidance } from '../services/courtDayGuidance.js';
import express from 'express';
import request from 'supertest';
import pushRouter, { LEGAL_TIPS } from '../routes/push.js';
import { titleForDaysLeft, bodyFor, followerTitleFor, followerBodyFor, formatCourtTime } from '../services/courtReminders.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const app = Object.fromEntries(SUPPORTED_LANGS.map(l => [l, JSON.parse(readFileSync(resolve(REPO, `frontend/src/i18n/${l}.json`), 'utf8'))]));
const OTHER = ['es', 'pt', 'vi'];
const PH = /\{\w+\}/g;
const ph = (s) => (String(s).match(PH) || []).sort();
// Pure punctuation around a placeholder (" — {place}") is the same in every language.
const SAME_OK = new Set(['reminder.where']);

describe('server catalogs', () => {
  const en = CATALOGS.en;
  it('has a catalog for each app language', () => {
    expect(SUPPORTED_LANGS).toEqual(['en', 'es', 'pt', 'vi']);
    expect(Object.keys(en).length).toBeGreaterThan(150);
  });
  for (const l of OTHER) {
    it(`${l}: same keys and placeholders as English, nothing empty or left in English`, () => {
      const c = CATALOGS[l];
      expect(Object.keys(c).sort()).toEqual(Object.keys(en).sort());
      expect(Object.keys(en).filter(k => JSON.stringify(ph(en[k])) !== JSON.stringify(ph(c[k])))).toEqual([]);
      expect(Object.keys(c).filter(k => typeof c[k] !== 'string' || !c[k].trim())).toEqual([]);
      expect(Object.keys(en).filter(k => c[k] === en[k] && !SAME_OK.has(k))).toEqual([]);
    });
  }
  it('msg() fills placeholders and falls back to English for an unknown language', () => {
    expect(msg('es', 'follow.err.too_many', { max: 10 })).toBe('Un caso se puede compartir con un máximo de 10 personas.');
    expect(msg('fr', 'follow.err.too_many', { max: 10 })).toBe('A case can be shared with up to 10 people.');
    expect(msg('vi', 'no.such.key')).toBe('no.such.key');
  });
});

describe('rights card in every language', () => {
  const base = generalSections('en');
  for (const l of SUPPORTED_LANGS) {
    it(`${l}: 8 sections with the same keys / topics / structure, identical to the app's bundled card`, () => {
      const g = generalSections(l);
      expect(g.map(s => [s.key, s.topic])).toEqual(base.map(s => [s.key, s.topic]));
      g.forEach((s, i) => {
        expect(s.language).toBe(l);
        expect(s.heading).toBe(app[l][`rc_h${i + 1}`]);
        expect(s.body).toBe(app[l][`rc_b${i + 1}`]);
        expect(s.body.split('\n\n').length).toBe(base[i].body.split('\n\n').length);
        expect((s.body.match(/•/g) || []).length).toBe((base[i].body.match(/•/g) || []).length);
        expect(s.source).toBe(i < 3 ? app[l][`rc_src_${i + 1}`] : app[l].rc_src_card);
        expect(s.last_reviewed).toBe('2026-04');
        expect(s.lawyer_reviewed).toBe(false);
      });
    });
    it(`${l}: the 30-second script has the same lines and matches the app (rs_*)`, () => {
      const sc = scriptFor(l);
      expect(sc.say.map(x => [x.key, x.from])).toEqual(scriptFor('en').say.map(x => [x.key, x.from]));
      expect(sc.dont.map(x => [x.key, x.from])).toEqual(scriptFor('en').dont.map(x => [x.key, x.from]));
      for (const x of [...sc.say, ...sc.dont]) expect(x.text).toBe(app[l][x.key]);
      expect(sc.source).toBe(app[l].rc_script_source);
      expect(sc.language).toBe(l);
    });
  }
  it('the English export is unchanged (AI grounding, legacy callers)', () => {
    expect(GENERAL_SECTIONS.map(s => s.body)).toEqual(generalSections('en').map(s => s.body));
  });

  it.each(OTHER)('getRightsCard(%s): language field honest, notice / disclaimer / script in that language', async (l) => {
    const card = await getRightsCard(null, 'NY', { lang: l });
    expect(card.language).toBe(l);
    expect(card.mixed_language).toBe(false);
    expect(card.state_notice).toBe(app[l].rc_state_pending.replace('{state}', stateName('NY', 'New York', l)));
    expect(card.disclaimer).toBe(msg(l, 'rights.disclaimer'));
    expect(card.script.say[0].text).toBe(app[l].rs_say_1);
    const us = await getRightsCard(null, null, { lang: l });
    expect(us.state_notice).toBe(msg(l, 'rights.notice.choose_state'));
  });
  it('an unsupported language gets English and says so', async () => {
    const card = await getRightsCard(null, 'TN', { lang: 'fr' });
    expect(card.language).toBe('en');
    expect(card.requested_language).toBe('fr');
    expect(card.general[0].heading).toBe(app.en.rc_h1);
  });
  it('a reviewed English database section shows in a translated card only when lawyer-reviewed, labelled en', async () => {
    const rows = [
      { topic: 'rc_2', title: 'REVIEWED', content: 'Reviewed English text', state: null, source: 'Tenn. Code Ann. § 1', reviewed_by: 'Jane Doe, Esq.', language: 'en' },
      { topic: 'rc_3', title: 'UNREVIEWED', content: 'Unreviewed English text', state: null, source: 'Some source', reviewed_by: null, language: 'en' },
    ];
    const db = { all: async () => rows };
    const card = await getRightsCard(db, 'TN', { lang: 'es' });
    const s2 = card.general.find(s => s.key === 'rc_2'); const s3 = card.general.find(s => s.key === 'rc_3');
    expect(s2.body).toBe('Reviewed English text'); expect(s2.language).toBe('en');
    expect(s3.body).toBe(app.es.rc_b3); expect(s3.language).toBe('es');
    expect(card.mixed_language).toBe(true);
    expect(card.language).toBe('es');
  });
  it.each(SUPPORTED_LANGS)('legacy wallet card (%s) is built from the same text', (l) => {
    const c = buildLegacyRightsCard('TN', l);
    expect(c.language).toBe(l);
    expect(c.rights[0].body).toBe(app[l].rc_b1);
    expect(c.title).toBe(msg(l, 'rights.legacy.title'));
  });
});

describe('court-day guidance in every language', () => {
  const ids = (g) => [g.checklist.bring.map(x => x.id), g.checklist.wear.map(x => x.id), g.missed.steps.map(x => x.id)];
  const en = courtDayGuidance('en');
  for (const l of SUPPORTED_LANGS) {
    it(`${l}: same items, same text as the app's bundled copy, ends with "call your lawyer or the court clerk"`, () => {
      const g = courtDayGuidance(l);
      expect(g.language).toBe(l);
      expect(ids(g)).toEqual(ids(en));
      const b = app[l];
      expect(g.checklist.bring.map(x => x.text)).toEqual([b.cg_bring_1, b.cg_bring_2, b.cg_bring_3]);
      expect(g.checklist.wear.map(x => x.text)).toEqual([b.cg_wear_1]);
      expect(g.missed.steps.map(x => x.text)).toEqual([b.cg_missed_1, b.cg_missed_2, b.cg_missed_3, b.cg_missed_4]);
      expect(g.missed.title).toBe(b.cg_missed_title);
      expect(g.checklist.note).toBe(b.cg_checklist_note);
      expect(g.missed.steps.at(-1).text).toBe(msg(l, 'guidance.missed.4'));
      for (const s of [...g.checklist.bring, ...g.checklist.wear, ...g.missed.steps]) expect(s.source).toMatch(/Justice Gavel/);
      expect(JSON.stringify(g)).not.toMatch(/\b\d+\s*(days?|hours?|días|horas|dias|ngày|giờ)\b/);
    });
  }
  it('unknown language → English', () => {
    expect(courtDayGuidance('xx').language).toBe('en');
  });
});

describe('reminder text in every language', () => {
  for (const l of SUPPORTED_LANGS) {
    it(`${l}: titles and bodies fill every placeholder and use the language's day / time`, () => {
      const opts = { time: '09:30', place: 'Davidson County Courthouse, 1 Public Sq' };
      const texts = [
        titleForDaysLeft(0, l), titleForDaysLeft(1, l), titleForDaysLeft(3, l, { planned: true }), titleForDaysLeft(7, l),
        ...[0, 1, 7].map(d => bodyFor('DUI 2026', '2026-11-05', d, opts, l)),
        ...[0, 1, 7].map(d => followerTitleFor('Ana', d, l)),
        ...[0, 1, 7].map(d => followerBodyFor('Ana', '2026-11-05', d, opts, l)),
        followerBodyFor(null, '2026-11-05', 3, {}, l),
        msg(l, 'reminder.sms', { title: 'T', body: 'B' }),
        msg(l, 'reminder.email.court_date', { date: formatDay('2026-11-05', l, { year: true }) }),
        msg(l, 'reminder.email.warning'), msg(l, 'reminder.email.footer'),
      ];
      for (const s of texts) expect(s).not.toMatch(/\{\w+\}/);
      for (const s of texts) expect(s).not.toMatch(/\.\.(\s|$)/);   // "a.m." never doubles the period
      expect(bodyFor('DUI 2026', '2026-11-05', 1, opts, l)).toContain(formatDay('2026-11-05', l));
      expect(bodyFor('DUI 2026', '2026-11-05', 1, opts, l)).toContain(formatCourtTime('09:30', l));
      if (l !== 'en') {
        const english = ['Court date', 'court on', 'has court', 'Reply STOP', 'Your family member', 'Thursday', 'November'];
        for (const s of texts) for (const w of english) expect([l, s.includes(w) ? w : null]).toEqual([l, null]);
      }
    });
  }
  it('the English text is unchanged', () => {
    expect(titleForDaysLeft(3, 'en', { planned: true })).toBe('⚠️ Court date in 3 days');
    expect(titleForDaysLeft(2, 'en')).toBe('📅 Court date in 2 days');
    expect(bodyFor('DUI', '2026-11-05', 1, { time: '09:30' })).toBe('DUI — court is tomorrow, Thursday, November 5 at 9:30 AM. Be on time and bring all documents.');
    expect(followerTitleFor(null, 0, 'en')).toBe('🏛️ Family: court TODAY');
  });
  it('days and times are written the way each language writes them', () => {
    expect(formatDay('2026-11-05', 'es')).toBe('jueves, 5 de noviembre');
    expect(formatDay('2026-11-05', 'pt')).toBe('quinta-feira, 5 de novembro');
    expect(formatDay('2026-11-05', 'vi')).toBe('Thứ Năm, 5 tháng 11');
    expect(formatTime('09:30', 'en')).toBe('9:30 AM');
    expect(formatTime('18:05', 'pt')).toBe('18:05');
    expect(formatTime('09:30', 'vi')).toBe('09:30');
    expect(formatTime('09:30', 'es')).toMatch(/^9:30 a\.\s?m\.$/);
    expect(formatTime(null, 'es')).toBeNull();
  });
});

describe('request language', () => {
  it('normalizes tags and parses Accept-Language by q-value', () => {
    expect(normalizeLang('es-MX')).toBe('es');
    expect(normalizeLang('PT_br')).toBe('pt');
    expect(normalizeLang('fr')).toBeNull();
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,vi;q=0.8,en;q=0.5')).toBe('vi');
    expect(parseAcceptLanguage('en;q=0.2, pt-BR')).toBe('pt');
    expect(parseAcceptLanguage('de,fr')).toBeNull();
    expect(parseAcceptLanguage('')).toBeNull();
  });
  it('?lang= wins over the header; nothing usable → English', () => {
    const req = (q, h) => ({ query: q, get: (n) => (n.toLowerCase() === 'accept-language' ? h : undefined) });
    expect(resolveLang(req({ lang: 'vi' }, 'es'))).toBe('vi');
    expect(resolveLang(req({}, 'es-US,es;q=0.9'))).toBe('es');
    expect(resolveLang(req({ lang: 'xx' }, 'de'))).toBe('en');
  });
});

describe('state names match the app', () => {
  it('backend and frontend tables are identical', () => {
    const ts = readFileSync(resolve(REPO, 'frontend/src/i18n/stateNames.ts'), 'utf8');
    for (const l of ['es', 'pt', 'vi']) {
      const block = (new RegExp(`\\n  ${l}: \\{([\\s\\S]*?)\\n  \\}`).exec(ts) || ['', ''])[1];
      const fe = Object.fromEntries([...block.matchAll(/([A-Z]{2}): '([^']+)'/g)].map(m => [m[1], m[2]]));
      expect([l, fe]).toEqual([l, { ...STATE_NAMES_I18N[l] }]);
    }
  });
});

describe('the app carries the server text it shows offline (same strings)', () => {
  const MAP = {
    rc_state_pending: 'rights.notice.review_pending', bc_fee_note: 'bail.fee_note', cd_delivery_problem: 'cd.delivery_problem',
    cd_family_title: 'follow.email.label', hn_reason_wrong_phone: 'help.reason.wrong_phone', hearing_arraignment: 'hearing.arraignment',
    cg_src_reminder: 'guidance.src.reminder', rc_script_source: 'rights.script.source',
  };
  it.each(SUPPORTED_LANGS)('%s', (l) => {
    for (const [feKey, srvKey] of Object.entries(MAP)) expect([feKey, app[l][feKey]]).toEqual([feKey, CATALOGS[l][srvKey]]);
  });
});

describe('legal tip of the day (Home) in every language', () => {
  it('the English catalog is word-for-word LEGAL_TIPS, and every tip exists in es / pt / vi', () => {
    expect(LEGAL_TIPS.length).toBeGreaterThan(10);
    LEGAL_TIPS.forEach((entry, i) => {
      expect(CATALOGS.en[`tip.${i}`]).toBe(entry.tip);
      for (const lang of OTHER) {
        expect(CATALOGS[lang][`tip.${i}`]).toBeTruthy();
        expect(CATALOGS[lang][`tip.${i}`]).not.toBe(entry.tip);
      }
    });
    expect(Object.keys(CATALOGS.en).filter(k => k.startsWith('tip.')).length).toBe(LEGAL_TIPS.length);
  });
  it('tip is served in the requested language (Accept-Language / ?lang=), English fallback', async () => {
    const app = express(); app.use('/push', pushRouter);
    const en = await request(app).get('/push/tip');
    expect(en.body.language).toBe('en');
    expect(en.body.tip).toBe(CATALOGS.en[`tip.${en.body.index}`]);
    for (const lang of ['es', 'pt', 'vi']) {
      const r = await request(app).get('/push/tip').set('Accept-Language', `${lang};q=0.9, en;q=0.5`);
      expect(r.body.language).toBe(lang);
      expect(r.headers['content-language']).toBe(lang);
      expect(r.body.tip).toBe(CATALOGS[lang][`tip.${r.body.index}`]);
      expect(r.body.tip).not.toBe(CATALOGS.en[`tip.${r.body.index}`]);
    }
    const q = await request(app).get('/push/tip?lang=vi');
    expect(q.body.language).toBe('vi');
    const unk = await request(app).get('/push/tip').set('Accept-Language', 'fr-FR');
    expect(unk.body.language).toBe('en');
  });
});
