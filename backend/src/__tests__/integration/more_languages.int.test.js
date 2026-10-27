/**
 * more_languages.int.test.js — Haitian Creole, Chinese, Arabic and Tagalog on real Postgres
 * (migration 41).
 *
 *   constraints   every CHECK on a language column allows the eight codes and still refuses others
 *   account       the saved language (users.preferred_language) takes ht / zh / ar / tl; an unknown one
 *                 is refused with the eight codes named, in the request language
 *   requests      Accept-Language tags devices send (fil-PH, zh-Hans-CN, ar-EG, ht-HT) pick the language
 *   content       specialty-court text is served in ht / zh / ar / tl (content_translations rows of
 *                 migration 41, same English source as the Spanish rows)
 *   rights card   the whole card and script in each new language, the state name localized
 */
import { describeIntegration, initSuite } from './_harness.js';
import { CATALOGS, SUPPORTED_LANGS, stateName } from '../../i18n/index.js';

const NEW = ['ht', 'zh', 'ar', 'tl'];
const LANG_CHECKS = ['users_preferred_language_check', 'bd_packets_lang_check', 'bd_bonds_text_lang_check', 'bd_autopay_lang_check',
  'bd_pay_requests_lang_check', 'pd_clients_lang_check'];

describeIntegration('eight languages (real Postgres, migration 41)', () => {
  const ctx = initSuite();
  let u;
  let ipN = 0;
  const ip = () => `10.41.${(++ipN >> 8) & 255}.${ipN & 255}`;
  const get = (p) => ctx.request().get(p).set('X-Forwarded-For', ip());

  beforeAll(async () => {
    if (!ctx.app) return;
    u = await ctx.register({ displayName: 'Lia Multi' });
  });

  it('every language CHECK allows the eight codes and nothing else', async () => {
    for (const name of LANG_CHECKS) {
      const row = await ctx.db.get('SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ?', [name]);
      expect([name, !!row]).toEqual([name, true]);
      for (const l of SUPPORTED_LANGS) expect([name, l, row.def.includes(`'${l}'`)]).toEqual([name, l, true]);
      expect([name, row.def.includes("'fr'")]).toEqual([name, false]);
    }
    const ct = await ctx.db.get(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'content_translations_lang_check'`);
    for (const l of NEW) expect(ct.def).toContain(`'${l}'`);
    // the database itself refuses an unknown language
    await expect(ctx.db.run('UPDATE users SET preferred_language = ? WHERE id = ?', ['fr', u.user.id])).rejects.toThrow();
  });

  it('the account language saves ht / zh / ar / tl; an unknown one is refused with the eight codes, in the asked language', async () => {
    for (const l of NEW) {
      const r = await ctx.request().post('/api/push/language').set(u.headers).send({ language: l });
      expect([l, r.status]).toEqual([l, 200]);
      expect((await ctx.db.get('SELECT preferred_language FROM users WHERE id = ?', [u.user.id])).preferred_language).toBe(l);
    }
    const bad = await ctx.request().post('/api/push/language').set(u.headers).set('Accept-Language', 'zh-CN').send({ language: 'fr' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain(CATALOGS.zh['lang.err.bad']);
    expect(CATALOGS.en['lang.err.bad']).toContain('ht, zh, ar, tl');
  });

  it('device language tags pick the language: fil-PH → tl, zh-Hans-CN → zh, ar-EG → ar, ht-HT → ht', async () => {
    for (const [tag, l] of [['fil-PH,fil;q=0.9', 'tl'], ['zh-Hans-CN,zh;q=0.9', 'zh'], ['ar-EG', 'ar'], ['ht-HT,fr;q=0.5', 'ht']]) {
      const r = await get('/api/rights/TN').set('Accept-Language', tag);
      expect([tag, r.status, r.body.language]).toEqual([tag, 200, l]);
      expect(r.headers['content-language']).toBe(l);
    }
  });

  it.each(NEW)('rights card in %s: every section, the script and the state notice with the localized state name', async (l) => {
    const r = await get(`/api/rights/TN?lang=${l}`);
    expect(r.status).toBe(200);
    expect(r.body.general).toHaveLength(8);
    r.body.general.forEach((s, i) => expect(s.body).toBe(CATALOGS[l][`rights.rc_${i + 1}.body`]));
    expect(r.body.script.say.map((x) => x.text)).toEqual([1, 2, 3, 4, 5].map((n) => CATALOGS[l][`rights.rs_say_${n}`]));
    expect(r.body.state_notice).toBe(CATALOGS[l]['rights.notice.review_pending'].replace('{state}', stateName('TN', 'Tennessee', l)));
  });

  it('specialty-court text is served in ht / zh / ar / tl while the English is unchanged', async () => {
    const was = await ctx.db.get('SELECT source_url, verified_by FROM specialty_courts WHERE id = 1');
    await ctx.db.run(`UPDATE specialty_courts SET source_url = 'https://www.nashville.gov/departments/courts', verified_by = 'Source-checked 2026-10-27 (test)' WHERE id = 1`);
    try {
      const expect1 = { ht: /veteran/i, zh: /退伍军人/, ar: /محارب قديم/, tl: /beterano/i };
      for (const l of NEW) {
        const r = await get('/api/legaldata/specialty-courts?state=TN').set('Accept-Language', l);
        const row = r.body.data.find((x) => x.id === 1);
        expect([l, row.text_lang]).toEqual([l, l]);
        expect(row.eligibility).toMatch(expect1[l]);
        expect(row.notes).toContain('DD-214');
      }
      const n = await ctx.db.get(`SELECT COUNT(*)::int AS n FROM content_translations WHERE lang IN ('ht','zh','ar','tl')`);
      expect(n.n).toBe(240);
    } finally {
      await ctx.db.run('UPDATE specialty_courts SET source_url = ?, verified_by = ? WHERE id = 1', [was.source_url, was.verified_by]);
    }
  });
});
