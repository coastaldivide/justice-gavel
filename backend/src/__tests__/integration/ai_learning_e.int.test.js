/**
 * ai_learning_e.int.test.js — section E (AI, research & learning) against the
 * real app on real Postgres, Anthropic mocked locally (no real API traffic).
 *
 *  chat      free limit (3 a local day, 402 in the asker's language), a retry
 *            with the same clientMessageId replays instead of asking again,
 *            defender mode only for attorneys, failed jobs carry a code and a
 *            sentence for people (never upstream text), no temperature sent.
 *  research  access = attorney or a paid plan; another account's session is
 *            404 for read and delete (nothing deleted).
 *  translate a message the model could not translate is stored with
 *            translated NULL and flagged — the original is never passed off
 *            as the translation; a guest joins with the session token.
 *  motions   generated drafts land in motion_history (what history/PDF read).
 *  lessons   public list with content; completing twice awards points once.
 *  legaldata / resources / advocacy stats are public; impact is staff-only.
 *  bar prep  only the session's questions count, each once; score is
 *            correct / all questions; review sessions from question_ids.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('section E: AI, research & learning (real Postgres, mock Anthropic)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let u, atty;

  const ask = (user, body, lang = 'en') => ctx.request().post('/api/chat/ask').set(user.headers)
    .set('Accept-Language', lang).set('X-Timezone', 'America/Chicago').send(body);

  beforeAll(async () => {
    if (!ctx.app) return;
    u = await ctx.register({ displayName: 'Erin E' });
    await ctx.acceptDisclaimer(u);
    atty = await ctx.register({ displayName: 'Atty E' });
    await ctx.acceptDisclaimer(atty);
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id = ?`, [atty.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(atty.user.id);
    ctx.addCleanup(async (db) => {
      const ids = [u.user.id, atty.user.id];
      await db.run(`DELETE FROM research_messages WHERE session_id IN (SELECT id FROM research_sessions WHERE user_id IN (?, ?))`, ids).catch(() => {});
      await db.run(`DELETE FROM research_sessions WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM motion_history WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM lesson_progress WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM rewards WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM quiz_answers WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM quiz_sessions WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM spaced_repetition_state WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM study_streaks WHERE user_id IN (?, ?)`, ids).catch(() => {});
      await db.run(`DELETE FROM translation_messages WHERE session_code IN (SELECT code FROM translation_sessions WHERE defender_id IN (?, ?))`, ids).catch(() => {});
      await db.run(`DELETE FROM translation_sessions WHERE defender_id IN (?, ?)`, ids).catch(() => {});
    });
  });

  // ── chat ────────────────────────────────────────────────────────────────
  it('a retry with the same clientMessageId replays the answer (one exchange stored, one model call)', async () => {
    ctx.anthropic.replyText = `E-${ctx.tag}: You may stay silent.`;
    const body = { message: 'Do I have to answer questions?', sessionId: `${ctx.tag}-c1`, clientMessageId: `${ctx.tag}m1` };
    const first = await ask(u, body);
    expect(first.status).toBe(200);
    expect((await ctx.pollJob(u, first.body.jobId)).body.result.reply).toBe(ctx.anthropic.replyText);
    const calls = ctx.anthropic.requests.length;

    const again = await ask(u, body);
    expect(again.status).toBe(200);
    const replay = again.body.jobId ? (await ctx.pollJob(u, again.body.jobId)).body.result : again.body;
    expect(replay.reply).toBe(ctx.anthropic.replyText);
    expect(ctx.anthropic.requests.length).toBe(calls);            // not asked again
    const n = await ctx.db.get(`SELECT COUNT(*) AS n FROM chat_sessions WHERE session_id = ? AND user_id = ?`, [body.sessionId, u.user.id]);
    expect(Number(n.n)).toBe(2);
  });

  it('no request to the model carries temperature (rejected by current models)', () => {
    const sent = ctx.anthropic.requests.filter(r => r.path === '/v1/messages');
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) expect(r.body).not.toHaveProperty('temperature');
  });

  it('defender mode is refused for a non-attorney (consumer prompt used) and allowed for an attorney', async () => {
    const before = ctx.anthropic.requests.length;
    const a = await ask(atty, { message: 'Suppression standard for a Terry stop?', sessionId: `${ctx.tag}-d1`, mode: 'defender' });
    expect(a.status).toBe(200);
    await ctx.pollJob(atty, a.body.jobId);
    const attySys = JSON.stringify(ctx.anthropic.requests.slice(before).find(r => r.path === '/v1/messages').body.system);
    const { DEFENDER_SYSTEM_PROMPT } = await import('../../routes/chat/_prompts.js');
    expect(attySys).toContain(JSON.stringify(DEFENDER_SYSTEM_PROMPT.slice(0, 80)).slice(1, -1));

    const mid = ctx.anthropic.requests.length;
    const c = await ask(u, { message: 'Suppression standard for a Terry stop?', sessionId: `${ctx.tag}-d2`, mode: 'defender', clientMessageId: `${ctx.tag}d2` });
    expect(c.status).toBe(200);
    await ctx.pollJob(u, c.body.jobId);
    const userSys = JSON.stringify(ctx.anthropic.requests.slice(mid).find(r => r.path === '/v1/messages').body.system);
    expect(userSys).not.toContain(JSON.stringify(DEFENDER_SYSTEM_PROMPT.slice(0, 80)).slice(1, -1));
  });

  it('the 4th question of the local day is a 402 in the asker’s language; replays still allowed', async () => {
    // u has asked 2 questions so far today (c1 + the refused defender one)
    for (const i of [3]) {
      const r = await ask(u, { message: `Question ${i}?`, sessionId: `${ctx.tag}-c2`, clientMessageId: `${ctx.tag}q${i}` });
      expect(r.status).toBe(200);
      await ctx.pollJob(u, r.body.jobId);
    }
    const over = await ask(u, { message: 'One more?', sessionId: `${ctx.tag}-c2`, clientMessageId: `${ctx.tag}q4` }, 'es');
    expect(over.status).toBe(402);
    expect(over.body.code).toBe('chat_limit_reached');
    expect(over.body.message).not.toMatch(/\b(the|you|today)\b/i);   // Spanish, not English
    // the replay of an answered question is still allowed when over the limit
    const replay = await ask(u, { message: 'Do I have to answer questions?', sessionId: `${ctx.tag}-c1`, clientMessageId: `${ctx.tag}m1` });
    expect(replay.status).toBe(200);
  });

  it('a failed model call is a coded job failure worded for people', async () => {
    ctx.anthropic.status = 529;
    const r = await ask(atty, { message: 'Will this fail?', sessionId: `${ctx.tag}-f1`, clientMessageId: `${ctx.tag}f1` }, 'pt');
    const failed = await ctx.pollJob(atty, r.body.jobId);
    ctx.anthropic.status = 200;
    expect(failed.body.status).toBe('failed');
    expect(failed.body.code).toBe('ai_busy');
    expect(String(failed.body.error)).not.toMatch(/Anthropic|529|mock failure/);
    // nothing half-saved for the failed question
    const n = await ctx.db.get(`SELECT COUNT(*) AS n FROM chat_sessions WHERE session_id = ?`, [`${ctx.tag}-f1`]);
    expect(Number(n.n)).toBe(0);
  });

  it('bad chat bodies are localized 400s', async () => {
    const r = await ask(u, { sessionId: 'x' }, 'vi');
    expect(r.status).toBe(400);
    expect(typeof r.body.message).toBe('string');
    const bad = await ask(u, { message: 'hi', sessionId: 'x', clientMessageId: 'no spaces allowed!' });
    expect(bad.status).toBe(400);
  });

  // ── research ────────────────────────────────────────────────────────────
  it('research needs a plan for a consumer (402 with real plans) and works for an attorney', async () => {
    const st = await ctx.request().get('/api/research/status').set(u.headers);
    expect(st.body).toMatchObject({ has_access: false });
    expect(Array.isArray(st.body.plans) && st.body.plans.length).toBeTruthy();
    const no = await ctx.request().post('/api/research/ask').set(u.headers).send({ query: 'Terry stop standard' });
    expect(no.status).toBe(402);

    ctx.anthropic.replyText = `R-${ctx.tag}: Terry v. Ohio, 392 U.S. 1 (1968).`;
    const yes = await ctx.request().post('/api/research/ask').set(atty.headers).send({ query: 'Terry stop standard' });
    expect(yes.status).toBe(200);
    const done = await ctx.pollJob(atty, yes.body.jobId);
    expect(done.body.result.answer).toBe(ctx.anthropic.replyText);
    const hist = await ctx.request().get('/api/research/history').set(atty.headers);
    expect(hist.body.map(s => Number(s.id))).toContain(Number(yes.body.session_id));

    // another account cannot read or delete it
    const peek = await ctx.request().get(`/api/research/session/${yes.body.session_id}`).set(u.headers);
    expect(peek.status).toBe(404);
    const del = await ctx.request().delete(`/api/research/session/${yes.body.session_id}`).set(u.headers);
    expect(del.status).toBe(404);
    const still = await ctx.db.get('SELECT COUNT(*) AS n FROM research_messages WHERE session_id = ?', [yes.body.session_id]);
    expect(Number(still.n)).toBe(2);
  });

  // ── translate ───────────────────────────────────────────────────────────
  it('a guest joins with the session token; an untranslated message is flagged, never passed off', async () => {
    const s = await ctx.request().post('/api/translate/session').set(atty.headers).send({ lang_a: 'en', lang_b: 'es' });
    expect(s.status).toBe(200);
    const same = await ctx.request().post('/api/translate/session').set(atty.headers).send({ lang_a: 'es', lang_b: 'es' });
    expect(same.status).toBe(400);

    const join = await ctx.request().get(`/api/translate/session/${s.body.code}`);
    expect(join.status).toBe(200);
    expect(join.body.session_token).toBeTruthy();
    const second = await ctx.request().get(`/api/translate/session/${s.body.code}`);
    expect(second.status).toBe(409);                                   // the seat is taken

    ctx.anthropic.status = 500;
    const m = await ctx.request().post(`/api/translate/session/${s.body.code}/message`)
      .set('X-Translate-Token', join.body.session_token).send({ text: 'Necesito un abogado', side: 'b' });
    ctx.anthropic.status = 200;
    expect(m.status).toBe(200);
    expect(m.body.translated).toBeNull();
    expect(m.body.translation_error).toBe('ai_busy');
    const wrong = await ctx.request().post(`/api/translate/session/${s.body.code}/message`)
      .set('X-Translate-Token', join.body.session_token).send({ text: 'hola', side: 'a' });
    expect(wrong.status).toBe(403);
    const list = await ctx.request().get(`/api/translate/session/${s.body.code}/messages?since=0`).set(atty.headers);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ original: 'Necesito un abogado', translated: null });
  });

  // ── motions ─────────────────────────────────────────────────────────────
  it('a generated motion is saved to motion_history and listed in history', async () => {
    ctx.anthropic.replyText = `MOTION-${ctx.tag}: IN THE CIRCUIT COURT…`;
    const g = await ctx.request().post('/api/motions/generate').set(atty.headers)
      .send({ motion_type: 'suppress', fields: { defendant_name: 'Test', state: 'TN' } });
    expect(g.status).toBe(202);
    const done = await ctx.pollJob(atty, g.body.jobId);
    expect(done.body.result.motion_id).toBeTruthy();
    const h = await ctx.request().get('/api/motions/history').set(atty.headers);
    const rows = Array.isArray(h.body) ? h.body : (h.body.history || h.body.motions || []);
    expect(rows.map(r => Number(r.id))).toContain(Number(done.body.result.motion_id));
    const bad = await ctx.request().post('/api/motions/generate').set(atty.headers).send({ motion_type: 'nope' });
    expect(bad.status).toBe(400);
    const other = await ctx.request().delete(`/api/motions/history/${done.body.result.motion_id}`).set(u.headers);
    expect(other.status).toBe(404);
  });

  // ── lessons ─────────────────────────────────────────────────────────────
  it('lessons are public with content; completing twice awards the points once', async () => {
    const list = await ctx.request().get('/api/lessons');
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    const lesson = list.body[0];
    expect(typeof lesson.content).toBe('string');
    expect(lesson.content.length).toBeGreaterThan(0);

    const a = await ctx.request().post(`/api/lessons/${lesson.id}/complete`).set(u.headers);
    const b = await ctx.request().post(`/api/lessons/${lesson.id}/complete`).set(u.headers);
    expect(a.body).toMatchObject({ alreadyCompleted: false, pointsAwarded: lesson.points });
    expect(b.body).toMatchObject({ alreadyCompleted: true, pointsAwarded: 0 });
    const pts = await ctx.db.get('SELECT points FROM rewards WHERE user_id = ?', [u.user.id]);
    expect(Number(pts.points)).toBe(lesson.points);
    const me = await ctx.request().get('/api/lessons/progress/me').set(u.headers);
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain(String(lesson.id));
    expect((await ctx.request().post('/api/lessons/999999/complete').set(u.headers)).status).toBe(404);
    expect((await ctx.request().get(`/api/lessons/streak/${atty.user.id}`).set(u.headers)).status).toBe(403);
  });

  // ── public data + staff-only impact ─────────────────────────────────────
  it('legal data, resources and advocacy stats are public; impact is staff-only', async () => {
    const drugs = await ctx.request().get('/api/legaldata/drugs?state=TN');
    expect(drugs.status).toBe(200);
    expect(drugs.body.meta).toHaveProperty('last_verified');
    expect((await ctx.request().get('/api/legaldata/nope')).status).toBe(404);
    expect((await ctx.request().get('/api/resources?limit=5')).status).toBe(200);
    expect((await ctx.request().get('/api/advocacy/stats')).status).toBe(200);
    expect((await ctx.request().get('/api/impact/report')).status).toBe(401);
    expect((await ctx.request().get('/api/impact/report').set(u.headers)).status).toBe(403);
  });

  // ── bar prep ────────────────────────────────────────────────────────────
  it('bar prep scores correct / all questions, counts each question once, ignores foreign ids', async () => {
    const subj = (await ctx.request().get('/api/bar-prep/subjects').set(u.headers)).body;
    const subjects = Array.isArray(subj) ? subj : subj.subjects;
    const s = await ctx.request().post('/api/bar-prep/sessions').set(u.headers)
      .send({ subject_id: subjects[0].id, question_count: 4 });
    expect(s.status).toBe(201);
    const qs = s.body.questions;
    expect(qs.length).toBeGreaterThan(1);
    expect(qs[0]).not.toHaveProperty('correct_answer');

    const truth = await ctx.db.all(`SELECT id, correct_answer FROM quiz_questions WHERE id IN (${qs.map(() => '?').join(',')})`, qs.map(q => q.id));
    const right = Object.fromEntries(truth.map(q => [String(q.id), String(q.correct_answer).trim().toUpperCase()]));
    const first = qs[0].id;
    const r1 = await ctx.request().post(`/api/bar-prep/sessions/${s.body.session_id}/answers`).set(u.headers)
      .send({ answers: [{ question_id: first, selected_answer: right[first] }, { question_id: '00000000-0000-4000-8000-000000000000', selected_answer: 'A' }] });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ answered: 1, correct: 1, completed: false });
    // the same question again: the first answer stands
    const wrongLetter = ['A', 'B', 'C', 'D'].find(l => l !== right[first]);
    const r2 = await ctx.request().post(`/api/bar-prep/sessions/${s.body.session_id}/answers`).set(u.headers)
      .send({ answers: [{ question_id: first, selected_answer: wrongLetter }] });
    expect(r2.body).toMatchObject({ answered: 1, correct: 1 });
    expect(r2.body.results[0]).toMatchObject({ already_answered: true, is_correct: true });
    // submit with one right out of all questions
    const done = await ctx.request().post(`/api/bar-prep/sessions/${s.body.session_id}/answers`).set(u.headers)
      .send({ answers: [], complete: true });
    expect(done.body.completed).toBe(true);
    expect(done.body.score_pct).toBe(Math.round(100 / qs.length));
    expect((await ctx.request().post(`/api/bar-prep/sessions/${s.body.session_id}/answers`).set(u.headers)
      .send({ answers: [], complete: true })).status).toBe(400);   // already submitted

    // retry the missed ones: a review session of exactly those questions
    const missed = qs.slice(1).map(q => q.id);
    const review = await ctx.request().post('/api/bar-prep/sessions').set(u.headers).send({ question_ids: missed });
    expect(review.status).toBe(201);
    expect(review.body.questions.map(q => q.id).sort()).toEqual([...missed].sort());
    // invalid letter
    const bad = await ctx.request().post(`/api/bar-prep/sessions/${review.body.session_id}/answers`).set(u.headers)
      .send({ answers: [{ question_id: missed[0], selected_answer: 'E' }] });
    expect(bad.status).toBe(400);
  });

  it('bar prep schedule is a 14-day calendar starting today in the user’s time zone', async () => {
    const r = await ctx.request().get('/api/bar-prep/schedule').set(u.headers).set('X-Timezone', 'Pacific/Kiritimati');
    expect(r.status).toBe(200);
    expect(r.body.calendar).toHaveLength(14);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    expect(String(r.body.calendar[0].date).slice(0, 10)).toBe(today);
    const badDate = await ctx.request().put('/api/bar-prep/progress').set(u.headers).send({ exam_date: '2027-02-30' });
    expect(badDate.status).toBe(400);
  });
});
