/**
 * case_steps_court_guide.int.test.js — migration 43 on the real app + real Postgres.
 *
 *   CS1  "Your case, step by step": nothing is guessed (stage null until the person picks one);
 *        stage + ticks saved per case and merged; unknown stage / item and the court-date items
 *        are refused; the case's court dates tick "first court date saved" / "next court date"
 *   CS2  auth: signed out 401; another account's case 404 (read and write), nothing changed
 *   CS3  family: a follower sees the stage name only when the owner shares it — never the checklist
 *   CS4  account export carries the progress; account deletion and case deletion remove it
 *   CG1  the court date carries "This court's posted rules" for a listed court (Davidson County) and
 *        none elsewhere; the plan has "Clothes ready"
 *   CG2  the day-before reminder push points to the guide (data.guide); the reminder TEXT is unchanged
 */
import { describeIntegration, initSuite } from './_harness.js';
import { todayInZone, addDays } from '../../utils/timezone.js';

const TZ = 'America/Chicago';

describeIntegration('case steps + court guide (real Postgres)', () => {
  const ctx = initSuite();
  let owner; let other; let fam; let caseId; let cdId;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.43.${(++ipN >> 8) & 255}.${ipN & 255}`).set('X-Timezone', TZ);
    if (who) r = r.set(who.headers);
    return r;
  };
  const today = () => todayInZone(TZ);

  beforeAll(async () => {
    if (!ctx.app) return;
    [owner, other, fam] = await Promise.all(['Cass Owner', 'Otto Other', 'Faye Family'].map((n) => ctx.register({ displayName: n })));
    const c = await req('post', '/api/cases', owner).send({ title: 'Steps case', state: 'TN' });
    expect(c.status).toBeLessThan(300);
    caseId = Number(c.body.id ?? c.body.case?.id);
    expect(caseId).toBeGreaterThan(0);
  });

  test('CS1 nothing is guessed; progress is saved per case and merged; bad input refused; court dates tick their items', async () => {
    if (!ctx.app) return;
    const g0 = await req('get', `/api/case-steps/${caseId}`, owner);
    expect(g0.status).toBe(200);
    expect(g0.body).toMatchObject({ case_id: caseId, stage: null, checked: {}, auto: {}, share_stage: false, next_court_date: null });

    const s1 = await req('put', `/api/case-steps/${caseId}`, owner).send({ stage: 'release', checked: { 'release.bail_known': true, 'arrest.silent': true } });
    expect(s1.status).toBe(200);
    expect(s1.body.stage).toBe('release');
    expect(s1.body.checked).toEqual({ 'release.bail_known': true, 'arrest.silent': true });
    // ticks merge; false unticks; the stage stays when not sent
    const s2 = await req('put', `/api/case-steps/${caseId}`, owner).send({ checked: { 'arrest.silent': false, 'release.conditions_copy': true } });
    expect(s2.body).toMatchObject({ stage: 'release', checked: { 'release.bail_known': true, 'release.conditions_copy': true } });
    expect(s2.body.checked['arrest.silent']).toBeUndefined();

    for (const [body, code] of [
      [{ stage: 'appeal' }, 'bad_stage'],
      [{ checked: { 'release.bribe': true } }, 'bad_item'],
      [{ checked: { 'pretrial.next_date': true } }, 'bad_item'],     // ticked by court dates only
      [{ checked: { 'release.bail_known': 'yes' } }, 'bad_steps'],
      [{ share_stage: 'on' }, 'bad_steps'],
      [{}, 'bad_steps'],
    ]) {
      const r = await req('put', `/api/case-steps/${caseId}`, owner).send(body);
      expect([r.status, r.body.code, typeof r.body.error, typeof r.body.message]).toEqual([400, code, 'string', 'string']);
    }
    expect((await req('get', '/api/case-steps/abc', owner)).status).toBe(400);
    expect((await req('get', '/api/case-steps/0', owner)).status).toBe(400);

    // a court date on the case ticks both items (an upcoming one is the "next court date")
    const ch = await ctx.db.get(`SELECT id FROM courthouses WHERE state = 'TN' AND county = 'Davidson' LIMIT 1`);
    const cd = await req('post', '/api/court-dates', owner).send({ case_id: caseId, court_date: addDays(today(), 1), court_time: '09:00', courthouse_id: ch.id });
    expect(cd.status).toBe(201);
    cdId = cd.body.id;
    const g1 = await req('get', `/api/case-steps/${caseId}`, owner);
    expect(g1.body.auto).toEqual({ 'first.date_saved': true, 'pretrial.next_date': true });
    expect(g1.body.next_court_date).toBe(addDays(today(), 1));
    // once it is attended (no longer upcoming), only "first court date saved" stays ticked
    await req('patch', `/api/court-dates/${cdId}`, owner).send({ status: 'attended' });
    expect((await req('get', `/api/case-steps/${caseId}`, owner)).body.auto).toEqual({ 'first.date_saved': true });
    await req('patch', `/api/court-dates/${cdId}`, owner).send({ status: 'scheduled' });
  });

  test('CS2 signed out 401; another account cannot read or change a case\'s progress', async () => {
    if (!ctx.app) return;
    expect((await req('get', `/api/case-steps/${caseId}`)).status).toBe(401);
    expect((await req('put', `/api/case-steps/${caseId}`).send({ stage: 'plea' })).status).toBe(401);
    const r = await req('get', `/api/case-steps/${caseId}`, other);
    expect([r.status, r.body.code]).toEqual([404, 'not_found']);
    expect(JSON.stringify(r.body)).not.toContain('release');
    expect((await req('put', `/api/case-steps/${caseId}`, other).send({ stage: 'plea', checked: { 'plea.guide': true } })).status).toBe(404);
    const row = await ctx.db.get('SELECT stage, checked, user_id FROM case_steps WHERE case_id = ?', [caseId]);
    expect(row.stage).toBe('release');
    expect(Number(row.user_id)).toBe(owner.user.id);
    expect(row.checked['plea.guide']).toBeUndefined();
  });

  test('CS3 a family follower sees the stage name only when the owner shares it, never the checklist', async () => {
    if (!ctx.app) return;
    const inv = await req('post', `/api/cases/${caseId}/followers`, owner).send({ consent: true, name: 'Faye', share_reminders: false });
    expect(inv.status).toBe(201);
    expect((await req('post', '/api/following/accept', fam).send({ code: inv.body.invite_code })).status).toBeLessThan(300);
    const before = (await req('get', '/api/following', fam)).body.following.find((f) => f.case_id === caseId);
    expect(before.case_stage).toBeNull();
    expect((await req('put', `/api/case-steps/${caseId}`, owner).send({ share_stage: true })).body.share_stage).toBe(true);
    const after = (await req('get', '/api/following', fam)).body.following.find((f) => f.case_id === caseId);
    expect(after.case_stage).toBe('release');
    expect(JSON.stringify(after)).not.toMatch(/bail_known|conditions_copy|checked/);
    // the follower cannot read the owner's progress directly
    expect((await req('get', `/api/case-steps/${caseId}`, fam)).status).toBe(404);
    await req('put', `/api/case-steps/${caseId}`, owner).send({ share_stage: false });
    expect((await req('get', '/api/following', fam)).body.following.find((f) => f.case_id === caseId).case_stage).toBeNull();
  });

  test('CG1 the court date shows this court\'s posted rules (Davidson County) and the "Clothes ready" plan item; other courts none', async () => {
    if (!ctx.app) return;
    const g = await req('get', `/api/court-dates/${cdId}`, owner);
    expect(g.status).toBe(200);
    expect(g.body.plan.map((i) => i.id)).toContain('clothes');
    const ids = g.body.court_rules.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['tn-davidson-general-sessions-dress', 'tn-davidson-trial-courts-dress']));
    for (const r of g.body.court_rules) {
      expect(r.url).toMatch(/^https:\/\/[a-z.]+\.(gov|org)\//);
      expect(r.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.covers.length).toBeGreaterThan(0);
    }
    const p = await req('put', `/api/court-dates/${cdId}/plan`, owner).send({ items: { clothes: { done: true, note: 'Blue shirt' } } });
    expect(p.body.plan.find((i) => i.id === 'clothes')).toEqual({ id: 'clothes', done: true, note: 'Blue shirt' });
    // a court we have no posted rules for
    const shelby = await ctx.db.get(`SELECT id FROM courthouses WHERE state = 'TN' AND county = 'Shelby' LIMIT 1`);
    const cd2 = await req('post', '/api/court-dates', owner).send({ case_id: caseId, court_date: addDays(today(), 20), courthouse_id: shelby.id });
    expect((await req('get', `/api/court-dates/${cd2.body.id}`, owner)).body.court_rules).toEqual([]);
    const cd3 = await req('post', '/api/court-dates', owner).send({ case_id: caseId, court_date: addDays(today(), 21), location: 'Room 2' });
    expect((await req('get', `/api/court-dates/${cd3.body.id}`, owner)).body.court_rules).toEqual([]);
  });

  test('CG2 the day-before push points to the guide; the reminder text is unchanged', async () => {
    if (!ctx.app) return;
    const later = await req('post', '/api/court-dates', owner).send({ case_id: caseId, court_date: addDays(today(), 12), court_time: '10:00' });
    const rows = await ctx.db.all(`SELECT * FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_reminder' ORDER BY deliver_at`, [later.body.id]);
    const byDays = Object.fromEntries(rows.map((r) => [JSON.parse(r.data).days_before, r]));
    const { msg } = await import('../../i18n/index.js');
    const hint = msg('en', 'reminder.push.guide_hint');
    expect(byDays[1].body).toContain(hint);
    expect(JSON.parse(byDays[1].data)).toMatchObject({ guide: 'court', court_date_id: later.body.id });
    for (const d of [7, 3, 0]) {
      expect(byDays[d].body).not.toContain(hint);
      expect(JSON.parse(byDays[d].data).guide).toBeUndefined();
    }
    const { courtSmsText } = await import('../../services/reminderDispatcher.js');
    const { smsSegments } = await import('../../services/smsText.js');
    const text = await courtSmsText(ctx.db, byDays[1], JSON.parse(byDays[1].data), 'en');
    expect(text).not.toContain(hint);
    expect(text).toContain(`/court-dates/${later.body.id}`);
    expect(smsSegments(text).segments).toBeLessThanOrEqual(2);
  });

  test('CS4 the export carries the progress; deleting the case and the account removes it', async () => {
    if (!ctx.app) return;
    const { exportAccount } = await import('../../services/accountDeletion.js');
    const exp = await exportAccount(ctx.db, owner.user.id);
    const rows = exp.data.case_steps;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.find((r) => Number(r.case_id) === caseId)).toMatchObject({ stage: 'release' });
    // the other account's export has none of it
    const theirs = await exportAccount(ctx.db, other.user.id);
    expect(JSON.stringify(theirs)).not.toContain('bail_known');

    // a second case: deleting it removes its progress
    const c2 = await req('post', '/api/cases', owner).send({ title: 'Second', state: 'TN' });
    const id2 = Number(c2.body.id ?? c2.body.case?.id);
    expect((await req('put', `/api/case-steps/${id2}`, owner).send({ stage: 'record' })).status).toBe(200);
    expect((await req('delete', `/api/cases/${id2}`, owner)).status).toBeLessThan(300);
    expect((await req('get', `/api/case-steps/${id2}`, owner)).status).toBe(404);
    expect(await ctx.db.get('SELECT 1 AS x FROM case_steps WHERE case_id = ?', [id2])).toBeFalsy();

    const { purgeAccountData } = await import('../../services/accountDeletion.js');
    await ctx.db.transaction((tx) => purgeAccountData(tx, owner.user.id));
    expect(await ctx.db.get('SELECT 1 AS x FROM case_steps WHERE user_id = ?', [owner.user.id])).toBeFalsy();
  });
});
