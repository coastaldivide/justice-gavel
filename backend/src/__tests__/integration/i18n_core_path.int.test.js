/**
 * i18n_core_path.int.test.js — the core-path endpoints answer in the language
 * the app asks for (?lang= / Accept-Language), and reminders / follower
 * notices / invite messages go out in each person's saved language
 * (users.preferred_language). Real Postgres, mocked Expo push + Telnyx.
 *
 *   1 rights card / states / legacy card: es, pt, vi; `language` honest; Vary
 *   2 guidance, help (notes, PD note, report reasons, report reply, errors), bail fee note
 *   3 POST /api/push/language saves the language and re-plans reminder text;
 *     a court-date save remembers Accept-Language; list / detail / .ics / errors localized
 *   4 dispatch: push title/body and the SMS wrapper in the person's language
 *   5 family: invite share message in the owner's language; follower reminders
 *     and the "court date updated" push in the follower's; follow errors localized
 */
import http from 'http';
import { describeIntegration, initSuite } from './_harness.js';
import { CATALOGS } from '../../i18n/index.js';

const expo = { server: null, received: [] };
const twilio = { server: null, received: [] };   // Telnyx mock (name kept)
const dayPlus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const M = (l, k) => CATALOGS[l][k];

describeIntegration('core path in es / pt / vi (real Postgres)', () => {
  beforeAll(async () => {
    expo.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        const msgs = JSON.parse(data || '[]');
        expo.received.push(...msgs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: msgs.map((_, i) => ({ status: 'ok', id: `t-${Date.now()}-${i}` })) }));
      });
    });
    await new Promise(r => expo.server.listen(0, '127.0.0.1', r));
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.server.address().port}/--/api/v2`;
    // Telnyx Messaging API v2 mock: records { To, Body } for the assertions below
    twilio.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(data); } catch { /* keep {} */ }
        twilio.received.push({ To: j.to, From: j.from, Body: j.text, auth: req.headers.authorization, url: req.url });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { id: `msg-${twilio.received.length}` } }));
      });
    });
    await new Promise(r => twilio.server.listen(0, '127.0.0.1', r));
    delete process.env.RESEND_API_KEY;
  });

  const ctx = initSuite();
  let ana, bao, dispatch;

  beforeAll(async () => {
    if (!ctx.app) return;
    ({ dispatchDueReminders: dispatch } = await import('../../services/reminderDispatcher.js'));
    ana = await ctx.register({ displayName: 'Ana Lopez' });   // Spanish
    bao = await ctx.register({ displayName: 'Bao Tran' });    // Vietnamese
    for (const u of [ana, bao]) await ctx.request().post('/api/push/timezone').set(u.headers).send({ timezone: 'America/Chicago' });
  });

  afterAll(async () => {
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE']) delete process.env[k];
    await new Promise(r => expo.server.close(r));
    await new Promise(r => twilio.server.close(r));
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  it.each(['es', 'pt', 'vi'])('1: GET /api/rights/TN in %s — every section, the script and the notice', async (l) => {
    const r = await ctx.request().get('/api/rights/TN').set('Accept-Language', `${l},en;q=0.5`);
    expect(r.status).toBe(200);
    expect(r.headers.vary).toMatch(/Accept-Language/);
    expect(r.headers['content-language']).toBe(l);
    expect(r.body.language).toBe(l);
    expect(r.body.general).toHaveLength(8);
    r.body.general.forEach((s, i) => {
      expect(s.language).toBe(l);
      expect(s.body).toBe(M(l, `rights.rc_${i + 1}.body`));
    });
    expect(r.body.script.say.map(x => x.text)).toEqual([1, 2, 3, 4, 5].map(n => M(l, `rights.rs_say_${n}`)));
    expect(r.body.state_notice).toBe(M(l, 'rights.notice.review_pending').replace('{state}', 'Tennessee'));
    expect(r.body.disclaimer).toBe(M(l, 'rights.disclaimer'));
  });
  it('1: ?lang= wins over Accept-Language; unsupported → English; states list and legacy card localized', async () => {
    expect((await ctx.request().get('/api/rights/NY?lang=vi').set('Accept-Language', 'es')).body.language).toBe('vi');
    const fr = await ctx.request().get('/api/rights/TN').set('Accept-Language', 'fr-FR');
    expect(fr.body.language).toBe('en');
    expect(fr.body.general[0].body).toBe(M('en', 'rights.rc_1.body'));
    const ny = await ctx.request().get('/api/rights/NY').set('Accept-Language', 'es');
    expect(ny.body.state_notice).toContain('Nueva York');
    const st = await ctx.request().get('/api/rights/states').set('Accept-Language', 'pt-BR');
    expect(st.body.language).toBe('pt');
    expect(st.body.states.find(s => s.code === 'NY')).toEqual(expect.objectContaining({ name: 'New York', name_local: 'Nova York' }));
    const bad = await ctx.request().get('/api/rights/ZZ').set('Accept-Language', 'es');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe(M('es', 'rights.err.bad_state'));
    const legacy = await ctx.request().get('/api/lessons/rights-card?state=TN').set('Accept-Language', 'vi');
    expect(legacy.body.title).toBe(M('vi', 'rights.legacy.title'));
    expect(legacy.body.rights[0].body).toBe(M('vi', 'rights.rc_1.body'));
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  it.each(['es', 'pt', 'vi'])('2: guidance, help notes, report reasons, bail fee note in %s', async (l) => {
    const g = await ctx.request().get('/api/court-dates/guidance').set('Accept-Language', l);
    expect(g.body.language).toBe(l);
    expect(g.body.missed.steps.at(-1).text).toBe(M(l, 'guidance.missed.4'));
    expect(g.body.checklist.bring[0].text).toBe(M(l, 'guidance.bring.1'));

    const h = await ctx.request().get('/api/help/nearby?state=TN&charge=DUI').set('Accept-Language', l);
    expect(h.status).toBe(200);
    expect(h.body.meta).toEqual(expect.objectContaining({
      language: l, ranking: M(l, 'help.meta.ranking'), hours_note: M(l, 'help.meta.hours_note'), charge_note: M(l, 'help.meta.charge_note'),
    }));
    if (h.body.public_defender) expect(h.body.public_defender.note).toBe(M(l, 'help.pd_note'));
    const noLoc = await ctx.request().get('/api/help/nearby').set('Accept-Language', l);
    expect(noLoc.status).toBe(400);
    expect(noLoc.body.error).toBe(M(l, 'help.err.location_required'));

    const rr = await ctx.request().get('/api/help/report-reasons').set('Accept-Language', l);
    expect(rr.body.reasons.find(x => x.code === 'closed').label).toBe(M(l, 'help.reason.closed'));

    const bail = await ctx.request().get('/api/help/bail-schedule?state=TN').set('Accept-Language', l);
    expect(bail.body.meta).toEqual(expect.objectContaining({ language: l, fee_note: M(l, 'bail.fee_note'), disclaimer: M(l, 'bail.disclaimer') }));
  });
  it('2: reporting a listing answers in the language (and never touches the listing)', async () => {
    const lw = await ctx.db.get('SELECT id FROM lawyers ORDER BY id LIMIT 1');
    if (!lw) return;
    const before = await ctx.db.get('SELECT md5(t::text) AS h FROM lawyers t WHERE id = ?', [lw.id]);
    const r = await ctx.request().post('/api/help/reports').set(ana.headers).set('Accept-Language', 'es')
      .send({ provider_type: 'lawyer', provider_id: lw.id, reason: 'wrong_hours' });
    expect([200, 201]).toContain(r.status);
    expect([M('es', 'help.report.thanks'), M('es', 'help.report.duplicate')]).toContain(r.body.message);
    expect((await ctx.db.get('SELECT md5(t::text) AS h FROM lawyers t WHERE id = ?', [lw.id])).h).toBe(before.h);
    ctx.addCleanup((db) => db.run('DELETE FROM listing_reports WHERE reporter_user_id = ?', [ana.user.id]));
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  let anaDate;
  it('3: the saved language writes the reminders; a court-date save remembers Accept-Language', async () => {
    // Ana's app is in Spanish: the first save remembers it.
    const r = await ctx.request().post('/api/court-dates').set(ana.headers).set('Accept-Language', 'es')
      .send({ case_title: 'DUI 2026', court_date: dayPlus(10), court_time: '09:30', hearing_type: 'arraignment' });
    expect(r.status).toBe(201);
    anaDate = r.body.id;
    expect(r.body.hearing_label).toBe(M('es', 'hearing.arraignment'));
    expect(r.body.court_time_label).toMatch(/^9:30 a\.\s?m\.$/);
    expect((await ctx.db.get('SELECT preferred_language FROM users WHERE id = ?', [ana.user.id])).preferred_language).toBe('es');
    const rows = await ctx.db.all(`SELECT title, body, data FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' AND notification_type = 'court_reminder' ORDER BY deliver_at`, [anaDate]);
    expect(rows.map(x => x.title)).toEqual([
      M('es', 'reminder.title.in_days').replace('{days}', 7), M('es', 'reminder.title.in_3_days').replace('{days}', 3),
      M('es', 'reminder.title.tomorrow'), M('es', 'reminder.title.today')]);
    expect(rows[0].body).toMatch(/^DUI 2026: corte el .+ a las 9:30 a\.\s?m\. Si falta, pueden emitir una orden de arresto\./);
    expect(JSON.parse(rows[0].data).lang).toBe('es');

    // Switching the app to Portuguese re-plans the pending reminders in Portuguese.
    const sw = await ctx.request().post('/api/push/language').set(ana.headers).send({ language: 'pt' });
    expect(sw.body).toEqual(expect.objectContaining({ ok: true, language: 'pt', changed: true, message: M('pt', 'lang.saved') }));
    const pt = await ctx.db.all(`SELECT title FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at`, [anaDate]);
    expect(pt.map(x => x.title)).toEqual([
      M('pt', 'reminder.title.in_days').replace('{days}', 7), M('pt', 'reminder.title.in_3_days').replace('{days}', 3),
      M('pt', 'reminder.title.tomorrow'), M('pt', 'reminder.title.today'), M('pt', 'reminder.ask.title'), M('pt', 'reminder.missed.title')]);
    expect((await ctx.request().post('/api/push/language').set(ana.headers).send({ language: 'fr' })).status).toBe(400);
    // back to Spanish for the rest of the suite
    await ctx.request().post('/api/push/language').set(ana.headers).send({ language: 'es' });
  });
  it('3: list, detail, .ics and errors in the request language', async () => {
    const list = await ctx.request().get('/api/court-dates').set(ana.headers).set('Accept-Language', 'es');
    expect(list.body.language).toBe('es');
    expect(list.body.upcoming.find(x => x.id === anaDate).hearing_label).toBe(M('es', 'hearing.arraignment'));
    const one = await ctx.request().get(`/api/court-dates/${anaDate}`).set(ana.headers).set('Accept-Language', 'vi');
    expect(one.body.language).toBe('vi');
    expect(one.body.guidance.missed.steps.at(-1).text).toBe(M('vi', 'guidance.missed.4'));
    expect(one.body.court_time_label).toBe('09:30');
    const ics = await ctx.request().get(`/api/court-dates/${anaDate}/ics`).set(ana.headers).set('Accept-Language', 'es');
    const unfolded = ics.text.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain(`SUMMARY:${M('es', 'cd.ics.summary').replace('{case}', 'DUI 2026')}`);
    expect(unfolded).toContain(M('es', 'hearing.arraignment').replace(/[,;]/g, m => `\\${m}`));
    const bad = await ctx.request().post('/api/court-dates').set(ana.headers).set('Accept-Language', 'pt').send({ court_date: 'soon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe(M('pt', 'cd.err.bad_date'));
    const nf = await ctx.request().get('/api/court-dates/999999999').set(ana.headers).set('Accept-Language', 'vi');
    expect(nf.body.error).toBe(M('vi', 'cd.err.not_found'));
    const pref = await ctx.request().put('/api/court-dates/preferences').set(ana.headers).set('Accept-Language', 'es').send({ sms_reminders: 'yes' });
    expect(pref.body.error).toBe(M('es', 'cd.err.sms_bool'));
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  it('4: dispatch — the push and the SMS wrapper are in the person\'s language', async () => {
    await ctx.request().post('/api/push/token').set(ana.headers).send({ token: 'ExponentPushToken[i18n-ana]' });
    const row = await ctx.db.get(`SELECT id, title, body FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [anaDate]);
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [row.id]);
    expo.received.length = 0;
    await dispatch({ now: new Date() });
    const sent = expo.received.find(m => m.to === 'ExponentPushToken[i18n-ana]');
    expect(sent).toEqual(expect.objectContaining({ title: row.title, body: row.body }));
    expect(sent.title).toContain('Fecha de corte');

    // Bao (Vietnamese) has no device but opted into texts: the SMS is in Vietnamese.
    Object.assign(process.env, {
      TELNYX_API_KEY: 'KEYjgi18n', TELNYX_FROM_NUMBER: '+16155550000',
      TELNYX_API_BASE: `http://127.0.0.1:${twilio.server.address().port}`,
    });
    await ctx.request().post('/api/push/language').set(bao.headers).send({ language: 'vi' });
    await ctx.request().put('/api/court-dates/preferences').set(bao.headers).send({ sms_reminders: true, phone: '(615) 555-0177' });
    const b = await ctx.request().post('/api/court-dates').set(bao.headers).send({ case_title: 'Hồ sơ của Bảo', court_date: dayPlus(5) });
    const br = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [b.body.id]);
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [br.id]);
    await dispatch({ now: new Date() });
    const sms = twilio.received.at(-1);
    expect(sms.To).toBe('+16155550177');
    // texts are sent in the GSM-7 alphabet (services/smsText.js): Vietnamese without most accents
    expect(sms.Body).toContain('Neu vang mat, tòa co the ra lenh bat');
    expect(sms.Body).toContain('Tra loi STOP de ngung nhan tin');
    expect(sms.Body.startsWith('Justice Gavel: ')).toBe(true);
    expect(sms.Body).not.toMatch(/Court date|Reply STOP/);
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE']) delete process.env[k];
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  it('5: family — invite in the owner\'s language, follower reminders + update push in the follower\'s', async () => {
    const caseId = (await ctx.db.get('SELECT case_id FROM court_dates WHERE id = ?', [anaDate])).case_id;
    const inv = await ctx.request().post(`/api/cases/${caseId}/followers`)
      .set(ana.headers).set('Accept-Language', 'es').send({ consent: true });
    expect(inv.status).toBe(201);
    expect(inv.body.language).toBe('es');
    expect(inv.body.message).toBe(M('es', 'follow.invite_created'));
    expect(inv.body.share_message).toBe(M('es', 'follow.share_message').replace('{who}', 'Ana').replace('{code}', inv.body.invite_code).replace('{days}', 14));
    const noConsent = await ctx.request().post(`/api/cases/${caseId}/followers`).set(ana.headers).set('Accept-Language', 'pt').send({});
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.error).toBe(M('pt', 'follow.err.consent_required'));
    const stranger = await ctx.request().post(`/api/cases/${caseId}/followers`).set(bao.headers).set('Accept-Language', 'vi').send({ consent: true });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error).toBe(M('vi', 'follow.err.case_not_found'));

    // Bao (Vietnamese) accepts with a device: reminders in Vietnamese, naming Ana.
    await ctx.request().post('/api/push/token').set(bao.headers).send({ token: 'ExponentPushToken[i18n-bao]' });
    const bad = await ctx.request().post('/api/following/accept').set(bao.headers).set('Accept-Language', 'vi').send({ code: 'ABC' });
    expect(bad.body.error).toBe(M('vi', 'follow.err.bad_code'));
    const acc = await ctx.request().post('/api/following/accept').set(bao.headers).set('Accept-Language', 'vi').send({ code: inv.body.invite_code });
    expect(acc.status).toBe(201);
    const fr = await ctx.db.all(`SELECT title, body FROM scheduled_pushes WHERE user_id = ? AND court_date_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending' ORDER BY deliver_at`, [bao.user.id, anaDate]);
    expect(fr[0].title).toBe(M('vi', 'reminder.follower.title.in_days').replace('{who}', 'Ana').replace('{days}', 7));
    expect(fr[0].body).toMatch(/^Ana phải ra tòa vào /);
    const fol = await ctx.request().get('/api/following').set(bao.headers).set('Accept-Language', 'vi');
    expect(fol.body.language).toBe('vi');
    expect(fol.body.following[0].court_dates.find(d => d.id === anaDate).court_time_label).toBe('09:30');

    // Ana moves the date: Bao's "updated" push is in Vietnamese, Ana's own re-planned reminders in Spanish.
    expo.received.length = 0;
    await ctx.request().patch(`/api/court-dates/${anaDate}`).set(ana.headers).send({ court_date: dayPlus(12) });
    await new Promise(r => setTimeout(r, 300));
    const upd = expo.received.find(m => m.to === 'ExponentPushToken[i18n-bao]');
    expect(upd).toEqual(expect.objectContaining({ title: M('vi', 'follow.update.title'), body: M('vi', 'follow.update.body') }));
    const own = await ctx.db.get(`SELECT title FROM scheduled_pushes WHERE court_date_id = ? AND user_id = ? AND notification_type = 'court_reminder' AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [anaDate, ana.user.id]);
    expect(own.title).toBe(M('es', 'reminder.title.in_days').replace('{days}', 7));
  });
});
