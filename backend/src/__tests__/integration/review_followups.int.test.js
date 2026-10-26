/**
 * review_followups.int.test.js — owner rules applied after the independent
 * review ("never present unsourced or possibly-wrong legal content as fact";
 * "no privacy leaks"), on the real app + real Postgres.
 *
 *   F1  state notes without a citation / reviewer are never shown; every
 *       state gets the general card + "haven't been reviewed yet"
 *   F2  no bail-agent premium claim anywhere (calculator, immigration, total
 *       estimate, seeded lesson, provider listings)
 *   F3  public-defender note has no timing claim
 *   F4  followers get a push ONLY for court-date add / change / cancel, with a
 *       fixed text (no case title, no free-text location); never for other
 *       case edits; follower reminders never carry the free-text location
 *   F5  /api/cases/family/contacts + the owner's follower list: active follows
 *       only, and never the follower's account e-mail / phone / name
 *   F6  invite e-mails: 10 per user per day, 3 per recipient per day → 429
 *   F7  a reminder that reached no channel is 'undeliverable' (not sent), is
 *       counted in /metrics, and the court-date list asks for notifications /
 *       an e-mail
 */
import http from 'http';
import { describeIntegration, initSuite } from './_harness.js';

const dayPlus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const expo = { server: null, received: [] };

describeIntegration('review follow-ups: legal content + privacy (real Postgres)', () => {
  beforeAll(async () => {
    expo.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        const msgs = JSON.parse(data || '[]');
        expo.received.push(...msgs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: msgs.map((_, i) => ({ status: 'ok', id: `f-${Date.now()}-${i}` })) }));
      });
    });
    await new Promise(r => expo.server.listen(0, '127.0.0.1', r));
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.server.address().port}/--/api/v2`;
    delete process.env.RESEND_API_KEY;
  });
  afterAll(async () => { if (expo.server) await new Promise(r => expo.server.close(r)); });

  const ctx = initSuite();

  it('F1: no state shows the built-in (unreviewed) notes; all states say "haven\'t been reviewed yet"', async () => {
    const { STATE_RIGHTS, STATE_NAMES } = await import('../../services/rightsContent.js');
    for (const code of Object.keys(STATE_NAMES)) {
      const r = await ctx.request().get(`/api/rights/${code}`);
      expect(r.status).toBe(200);
      expect(r.body.state_specific).toEqual([]);
      expect(r.body.state_notice).toBe(`State-specific details for ${STATE_NAMES[code]} haven't been reviewed yet — ask a local lawyer or public defender.`);
      if (STATE_RIGHTS[code]) expect(JSON.stringify(r.body)).not.toContain(STATE_RIGHTS[code].stopRule);
    }
    const states = await ctx.request().get('/api/rights/states');
    expect(states.body.states.every(s => s.state_specific_available === false)).toBe(true);
    const legacy = await ctx.request().get('/api/lessons/rights-card?state=TX');
    if (legacy.status === 200) expect(JSON.stringify(legacy.body)).not.toContain(STATE_RIGHTS.TX.stopRule);
  });

  it('F2 + F3: no bail-agent premium or timing claim in any response', async () => {
    const calc = await ctx.request().post('/api/bail/calculate')
      .send({ state: 'TN', charge_type: 'felony', severity: 'medium', prior_record: 'none', flight_risk: 'low', employed: true });
    expect(calc.status).toBe(404); // removed: unsourced multipliers
    const imm = await ctx.request().get('/api/bail/immigration');
    expect(imm.body).not.toHaveProperty('premium_rate');
    const est = await ctx.request().get('/api/bail/estimate-total?bail_amount=10000');
    expect(est.body.premium).toBeNull();
    const quoted = await ctx.request().get('/api/bail/estimate-total?bail_amount=10000&rate=0.08');
    expect(quoted.body.premium).toBe(800);
    expect(quoted.body).not.toHaveProperty('estimated_fees');
    for (const body of [imm.body, est.body]) expect(JSON.stringify(body)).not.toMatch(/1[05]\s?%/);
    const lesson = await ctx.db.get('SELECT content FROM lessons WHERE id = 9');
    if (lesson) expect(lesson.content).not.toMatch(/10\s?%/);
    const nearby = await ctx.request().get('/api/help/nearby?state=TN&limit=3');
    expect(JSON.stringify(nearby.body)).not.toMatch(/first appearance|fee_percent/);
    if (nearby.body.public_defender) expect(nearby.body.public_defender.note).toBe('If you cannot afford a lawyer, ask the court how to request a public defender.');
  });

  let owner, follower, caseId, cdId;
  it('F4: followers get pushes only for court-date changes, with a fixed text', async () => {
    owner = await ctx.register({ displayName: 'Owner Person' });
    follower = await ctx.register({ displayName: 'Follower Person' });
    await ctx.request().post('/api/push/token').set(follower.headers).send({ token: 'ExponentPushToken[followups-follower]' });
    const cd = await ctx.request().post('/api/court-dates').set(owner.headers)
      .send({ case_title: `${ctx.tag} SECRET-TITLE DUI`, court_date: dayPlus(12), location: 'SECRET-ROOM 4B' });
    caseId = cd.body.case_id; cdId = cd.body.id;
    const inv = await ctx.request().post(`/api/cases/${caseId}/followers`).set(owner.headers).send({ consent: true, name: 'Mom' });
    expect((await ctx.request().post('/api/following/accept').set(follower.headers).send({ code: inv.body.invite_code })).status).toBe(201);
    const pushesTo = () => expo.received.filter(m => m.to === 'ExponentPushToken[followups-follower]');
    const settle = () => new Promise(r => setTimeout(r, 300));

    // a non-court edit of the case → no follower push
    expo.received.length = 0;
    await ctx.request().put(`/api/cases/${caseId}`).set(owner.headers).send({ notes: 'private note', title: `${ctx.tag} SECRET-TITLE renamed` });
    await settle();
    expect(pushesTo()).toHaveLength(0);

    // court-date add / change / cancel → one fixed-text push each
    const add = await ctx.request().post('/api/court-dates').set(owner.headers).send({ case_id: caseId, court_date: dayPlus(30) });
    await ctx.request().patch(`/api/court-dates/${cdId}`).set(owner.headers).send({ court_time: '10:00' });
    await ctx.request().delete(`/api/court-dates/${add.body.id}`).set(owner.headers);
    await settle();
    const got = pushesTo();
    expect(got.map(m => m.data.change)).toEqual(['added', 'changed', 'cancelled']);
    for (const m of got) {
      expect(m.title).toBe('Court date update');
      expect(m.body).toBe('A court date you follow was updated. Open Justice Gavel to see the details.');
      expect(JSON.stringify(m)).not.toMatch(/SECRET-|DUI/);
    }
    // marking attended is not a change to the date → no push
    expo.received.length = 0;
    await ctx.request().patch(`/api/court-dates/${cdId}`).set(owner.headers).send({ status: 'attended' });
    await ctx.request().patch(`/api/court-dates/${cdId}`).set(owner.headers).send({ status: 'scheduled' });
    await settle();
    expect(pushesTo()).toHaveLength(0);
    // the follower's own court reminders never carry the case title or the free-text location
    const rem = await ctx.db.all(
      `SELECT title, body FROM scheduled_pushes WHERE user_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`, [follower.user.id]);
    expect(rem.length).toBeGreaterThan(0);
    for (const r of rem) expect(`${r.title} ${r.body}`).not.toMatch(/SECRET-|DUI/);
  });

  it('F5: contact lists show active follows only, and never the follower\'s account details', async () => {
    const pending = await ctx.request().post(`/api/cases/${caseId}/followers`).set(owner.headers).send({ consent: true, name: 'Pending Aunt' });
    expect(pending.status).toBe(201);
    const revokedUser = await ctx.register({ displayName: 'Revoked Cousin', phone: undefined });
    const inv = await ctx.request().post(`/api/cases/${caseId}/followers`).set(owner.headers).send({ consent: true, name: 'Cousin' });
    await ctx.request().post('/api/following/accept').set(revokedUser.headers).send({ code: inv.body.invite_code });
    await ctx.request().delete(`/api/cases/${caseId}/followers/${inv.body.id}`).set(owner.headers);
    await ctx.db.run('UPDATE users SET phone = ? WHERE id = ?', ['+16155550177', follower.user.id]);

    const c = await ctx.request().get('/api/cases/family/contacts').set(owner.headers);
    expect(c.status).toBe(200);
    expect(c.body.map(x => x.name)).toEqual(['Mom']);                  // active only
    const blob = JSON.stringify(c.body);
    expect(blob).not.toContain(follower.email);
    expect(blob).not.toContain(revokedUser.email);
    expect(blob).not.toContain('6155550177');
    expect(blob).not.toMatch(/Follower Person|Revoked Cousin|Pending Aunt/);

    const list = await ctx.request().get(`/api/cases/${caseId}/followers`).set(owner.headers);
    const lblob = JSON.stringify(list.body);
    expect(lblob).not.toContain(follower.email);
    expect(lblob).not.toMatch(/Follower Person|6155550177/);
  });

  it('F6: invite e-mails are capped per recipient (3/day) and per user (10/day) with a clear 429', async () => {
    const a = await ctx.register({ displayName: 'Cap One' });
    const cd = await ctx.request().post('/api/court-dates').set(a.headers).send({ case_title: `${ctx.tag} cap`, court_date: dayPlus(14) });
    const to = `${ctx.tag}-recipient@it.example.test`;
    for (let i = 0; i < 3; i++) {
      expect((await ctx.request().post(`/api/cases/${cd.body.case_id}/followers`).set(a.headers).send({ consent: true, email: to })).status).toBe(201);
    }
    const fourth = await ctx.request().post(`/api/cases/${cd.body.case_id}/followers`).set(a.headers).send({ consent: true, email: to });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('invite_email_recipient_limit');
    expect(fourth.body.error).toMatch(/Share the code with them another way/);
    // without an e-mail the invite still works
    expect((await ctx.request().post(`/api/cases/${cd.body.case_id}/followers`).set(a.headers).send({ consent: true })).status).toBe(201);

    const b = await ctx.register({ displayName: 'Cap Two' });
    const c1 = await ctx.request().post('/api/court-dates').set(b.headers).send({ case_title: `${ctx.tag} cap b1`, court_date: dayPlus(15) });
    const c2 = await ctx.request().post('/api/court-dates').set(b.headers).send({ case_title: `${ctx.tag} cap b2`, court_date: dayPlus(16) });
    for (let i = 0; i < 10; i++) {
      const cid = i < 5 ? c1.body.case_id : c2.body.case_id;
      const r = await ctx.request().post(`/api/cases/${cid}/followers`).set(b.headers).send({ consent: true, email: `${ctx.tag}-u${i}@it.example.test` });
      expect(r.status).toBe(201);
    }
    const eleventh = await ctx.request().post(`/api/cases/${c2.body.case_id}/followers`).set(b.headers).send({ consent: true, email: `${ctx.tag}-u10@it.example.test` });
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe('invite_email_daily_limit');
    expect(eleventh.body.error).toMatch(/daily limit/);
  });

  it('F7: a reminder that reaches no channel is "undeliverable", counted in /metrics, and the app is told', async () => {
    const { dispatchDueReminders } = await import('../../services/reminderDispatcher.js');
    const u = await ctx.register({ displayName: 'No Channel' });
    const cd = await ctx.request().post('/api/court-dates').set(u.headers).send({ case_title: `${ctx.tag} nochan`, court_date: dayPlus(8) });
    const before = await ctx.request().get('/api/court-dates').set(u.headers);
    expect(before.body.reminder_delivery).toEqual(expect.objectContaining({
      undeliverable: 0, needs_attention: true, channels: { push: false, web_push: false, email: false, sms: false },
    }));
    const row = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [cd.body.id]);
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [row.id]);
    await dispatchDueReminders({ now: new Date() });
    const after = await ctx.db.get('SELECT status, delivered, channel, error, sent_at FROM scheduled_pushes WHERE id = ?', [row.id]);
    expect(after.status).toBe('undeliverable');
    expect(Number(after.delivered || 0)).toBe(0);
    expect(after.channel).toBeNull();
    expect(after.sent_at).toBeNull();
    const list = await ctx.request().get('/api/court-dates').set(u.headers);
    expect(list.body.reminder_delivery.undeliverable).toBe(1);
    expect(list.body.reminder_delivery.message).toMatch(/Turn on notifications or add an e-mail/);
    const m = await ctx.request().get('/metrics');
    expect(m.status).toBe(200);
    expect(m.body.reminders.undeliverable_24h).toBeGreaterThanOrEqual(1);
    expect(m.body.reminders.process.undeliverable).toBeGreaterThanOrEqual(1);
    const prom = await ctx.request().get('/metrics?format=prometheus');
    expect(prom.text).toMatch(/jg_reminders_undeliverable_24h [1-9]/);
  });
});
