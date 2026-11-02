/**
 * AI step 5 on real Postgres (docs/AI_PLATFORM.md §12–13), against the documented-API mock:
 *   P1 a long defender chat: older turns → a recap made from the PERSON's messages only (quick
 *      class, structured), checked (contact details scrubbed, legal references dropped), stored;
 *      the answer request carries the recap (system, after the cached prompt) + the recent turns
 *      only; GET shows it to the owner only; DELETE forgets it (no recap again, last 20 rows);
 *      clearing the chat removes the row
 *   P2 an invalid summary saves nothing and the question is still answered (recent rows)
 *   P3 research sessions: recap used, viewable / forgettable by the owner only, removed with the
 *      session; account deletion removes recaps and draft documents
 *   P4 petition: only the checked statute may stay; downloads as .docx (valid OOXML, notice in
 *      the person's language in header + footer, own words verbatim, blank signature line) and PDF;
 *      another account → 404; bad format → 400
 *   P5 saved motion → .docx / PDF: case-law paragraphs withheld, typed fields kept exactly
 */
import unzipper from 'unzipper';
import { DOMParser } from '@xmldom/xmldom';
import { describeIntegration, initSuite } from './_harness.js';

const LONG = (i) => `Question ${i}: I was arrested in Knox County on March 3 and my first court date is not set yet. ${'I keep worrying about what happens next and what I should bring with me. '.repeat(18)}`;

async function docxParts(buf) {
  const dir = await unzipper.Open.buffer(buf);
  const out = {};
  for (const f of dir.files) out[f.path] = (await f.buffer()).toString('utf8');
  return out;
}
function xmlOk(s) {
  let errors = 0;
  new DOMParser({ onError: () => { errors += 1; } }).parseFromString(s, 'application/xml');
  return errors === 0;
}
const binary = (r) => r.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

describeIntegration('AI step 5 — long chats (recap) and Word / PDF drafts (real Postgres)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let user, other;
  const sent = () => ctx.anthropic.requests.filter((r) => r.path === '/v1/messages');
  const streamChat = (u, body, lang = 'en') => ctx.request().post('/api/chat/stream').set(u.headers).set('Accept-Language', lang).send({ mode: 'defender', ...body })
    .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });
  const frames = (raw) => String(raw).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  const isSummary = (r) => r.body?.output_config?.format?.schema?.properties?.case_stage;
  async function seedChat(u, sessionId, exchanges) {
    const t0 = Date.now() - 3 * 86_400_000;
    for (let i = 0; i < exchanges; i += 1) {
      await ctx.db.run(`INSERT INTO chat_sessions (id, session_id, role, content, user_id, status, created_at) VALUES (gen_random_uuid(), ?, 'user', ?, ?, 'complete', ?)`,
        [sessionId, LONG(i), u.user.id, new Date(t0 + i * 60_000).toISOString()]);
      await ctx.db.run(`INSERT INTO chat_sessions (id, session_id, role, content, user_id, status, created_at) VALUES (gen_random_uuid(), ?, 'assistant', ?, ?, 'complete', ?)`,
        [sessionId, `ASSISTANT-ONLY-TEXT ${i}: general information about bail.`, u.user.id, new Date(t0 + i * 60_000 + 1).toISOString()]);
    }
  }
  const RECAP = {
    case_stage: 'Arrested, first court date not set yet',
    places: ['Knox County', 'Atlantis'],
    dates: [{ what: 'Arrest', date: 'March 3' }, { what: 'Hearing', date: 'June 30' }],
    facts: ['Worried about what to bring; call me at 615-555-1234', 'Under T.C.A. § 40-11-118 bail must be set'],
    asked: ['What happens next'],
  };

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
    process.env.AI_MEMORY_THRESHOLD_TOKENS = '4000';
    process.env.AI_MEMORY_KEEP_TURNS = '2';
    [user, other] = await Promise.all(['M', 'O'].map((n) => ctx.register({ displayName: `Mem ${n}` })));
    await ctx.acceptDisclaimer(user);
    await ctx.acceptDisclaimer(other);
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id IN (?, ?)`, [user.user.id, other.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(user.user.id); invalidateUserCache(other.user.id);
    ctx.addCleanup(async (db) => {
      const ids = [user.user.id, other.user.id];
      await db.run('DELETE FROM ai_conversation_memory WHERE user_id IN (?, ?)', ids);
      await db.run('DELETE FROM draft_documents WHERE user_id IN (?, ?)', ids);
      await db.run('DELETE FROM motion_history WHERE user_id IN (?, ?)', ids);
      await db.run('DELETE FROM research_messages WHERE session_id::text IN (SELECT id::text FROM research_sessions WHERE user_id IN (?, ?))', ids);
      await db.run('DELETE FROM research_sessions WHERE user_id IN (?, ?)', ids);
      await db.run('DELETE FROM ai_usage_log WHERE user_id IN (?, ?)', ids);
    });
  });
  afterAll(() => { for (const k of ['AI_MEMORY_THRESHOLD_TOKENS', 'AI_MEMORY_KEEP_TURNS', 'AI_MEMORY']) delete process.env[k]; });
  afterEach(() => { ctx.anthropic.json = null; ctx.anthropic.mode = 'ok'; ctx.anthropic.replyText = 'MOCK REPLY: general legal information, not legal advice.'; });

  test('P1 long chat → recap from the person\'s words; recent turns sent; view / forget / clear', async () => {
    if (!ctx.app) return;
    const sid = `${ctx.tag}-mem1`;
    await seedChat(user, sid, 8);
    ctx.anthropic.json = RECAP;
    const n0 = sent().length;
    const r = await streamChat(user, { message: 'What should I bring to court?', sessionId: sid, clientMessageId: `${ctx.tag}q1` });
    const f = frames(r.body);
    expect(f.find((x) => x.type === 'done')).toBeTruthy();
    const reqs = sent().slice(n0);
    const summary = reqs.find(isSummary);
    expect(summary).toBeTruthy();
    expect(summary.body.model).toBe('claude-haiku-5-5');                       // quick class
    const summaryText = JSON.stringify(summary.body.messages);
    expect(summaryText).toContain('Knox County');
    expect(summaryText).not.toContain('ASSISTANT-ONLY-TEXT');                  // never the assistant's answers
    const answer = reqs.filter((x) => !isSummary(x)).pop();
    const system = answer.body.system.map((b) => b.text).join('\n');
    expect(system).toContain('EARLIER IN THIS CONVERSATION');
    expect(system).toContain('Knox County');
    expect(answer.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });   // the cached prompt is unchanged
    expect(answer.body.system[1].cache_control).toBeUndefined();
    expect(answer.body.messages).toHaveLength(5);                               // 2 kept exchanges + the new question
    // stored recap: checked
    const row = await ctx.db.get('SELECT * FROM ai_conversation_memory WHERE user_id = ? AND kind = ? AND conversation_key = ?', [user.user.id, 'chat', sid]);
    expect(row.covered_rows).toBe(12);
    expect(row.recap.places).toEqual(['Knox County']);                          // "Atlantis" was never said
    expect(row.recap.dates).toEqual([{ what: 'Arrest', date: 'March 3' }]);     // June 30 was never said
    expect(row.recap.facts).toEqual(['Worried about what to bring; call me at […]']);   // phone scrubbed, § dropped
    expect(JSON.stringify(row.recap)).not.toMatch(/615|§/);
    // the owner sees it; another account does not
    const g = await ctx.request().get(`/api/chat/memory/${sid}`).set(user.headers);
    expect(g.body).toMatchObject({ enabled: true, remembered: true, forgotten: false, covered_turns: 6, recap: { case_stage: RECAP.case_stage } });
    const o = await ctx.request().get(`/api/chat/memory/${sid}`).set(other.headers);
    expect(o.body).toMatchObject({ remembered: false, recap: null });
    expect((await ctx.request().delete(`/api/chat/memory/${sid}`).set(other.headers)).status).toBe(200);
    expect((await ctx.db.get('SELECT recap FROM ai_conversation_memory WHERE user_id = ? AND conversation_key = ?', [user.user.id, sid])).recap).toBeTruthy();
    expect(await ctx.db.get('SELECT 1 FROM ai_conversation_memory WHERE user_id = ?', [other.user.id])).toBeFalsy();
    // the next question re-uses the recap
    const n1 = sent().length;
    await streamChat(user, { message: 'And after that?', sessionId: sid, clientMessageId: `${ctx.tag}q2` });
    const next = sent().slice(n1).filter((x) => !isSummary(x)).pop();
    expect(next.body.system.map((b) => b.text).join('\n')).toContain('Knox County');
    // forget: removed, no new recap, the last 20 rows are sent again
    const d = await ctx.request().delete(`/api/chat/memory/${sid}`).set(user.headers);
    expect(d.body).toMatchObject({ ok: true, forgotten: true, recap: null });
    expect((await ctx.request().get(`/api/chat/memory/${sid}`).set(user.headers)).body).toMatchObject({ forgotten: true, remembered: false, recap: null });
    const n2 = sent().length;
    await streamChat(user, { message: 'One more thing?', sessionId: sid, clientMessageId: `${ctx.tag}q3` });
    const after = sent().slice(n2);
    expect(after.some(isSummary)).toBe(false);
    expect(after[after.length - 1].body.system.map((b) => b.text).join('\n')).not.toContain('EARLIER IN THIS CONVERSATION');
    expect(after[after.length - 1].body.messages.length).toBe(21);   // 20 rows + the question
    // clearing the chat removes the row
    await ctx.request().delete(`/api/chat/history/${sid}`).set(user.headers);
    expect(await ctx.db.get('SELECT 1 FROM ai_conversation_memory WHERE user_id = ? AND conversation_key = ?', [user.user.id, sid])).toBeFalsy();
    // nothing about the content in the usage log
    const log = await ctx.db.get(`SELECT route, task, status FROM ai_usage_log WHERE user_id = ? AND task = 'chat_memory' ORDER BY id DESC LIMIT 1`, [user.user.id]);
    expect(log).toMatchObject({ route: 'chat_defender_memory', status: 'completed' });
  });

  test('P2 an invalid summary saves nothing; the question is still answered from the recent rows', async () => {
    if (!ctx.app) return;
    const sid = `${ctx.tag}-mem2`;
    await seedChat(user, sid, 12);
    ctx.anthropic.json = { nope: true };
    const n0 = sent().length;
    const r = await streamChat(user, { message: 'Is this still working?', sessionId: sid, clientMessageId: `${ctx.tag}q4` });
    expect(frames(r.body).find((x) => x.type === 'done')).toBeTruthy();
    const reqs = sent().slice(n0);
    expect(reqs.some(isSummary)).toBe(true);
    const answer = reqs.filter((x) => !isSummary(x)).pop();
    expect(answer.body.messages.length).toBe(21);
    expect(await ctx.db.get('SELECT 1 FROM ai_conversation_memory WHERE user_id = ? AND conversation_key = ?', [user.user.id, sid])).toBeFalsy();
    // off: no summary call at all
    process.env.AI_MEMORY = 'off';
    const n1 = sent().length;
    await streamChat(user, { message: 'And now?', sessionId: sid, clientMessageId: `${ctx.tag}q5` });
    expect(sent().slice(n1).some(isSummary)).toBe(false);
    expect((await ctx.request().get(`/api/chat/memory/${sid}`).set(user.headers)).body.enabled).toBe(false);
    delete process.env.AI_MEMORY;
  });

  test('P3 research recap: used, owner-only view / forget, removed with the session and the account', async () => {
    if (!ctx.app) return;
    const s = await ctx.db.run('INSERT INTO research_sessions (user_id, title) VALUES (?, ?) RETURNING id', [user.user.id, 'Long research']);
    const sessionId = s.lastID;
    const t0 = Date.now() - 86_400_000;
    for (let i = 0; i < 6; i += 1) {
      await ctx.db.run('INSERT INTO research_messages (session_id, role, content, created_at) VALUES (?,?,?,?)', [sessionId, 'user', LONG(i), new Date(t0 + i * 1000).toISOString()]);
      await ctx.db.run('INSERT INTO research_messages (session_id, role, content, created_at) VALUES (?,?,?,?)', [sessionId, 'assistant', `ASSISTANT-ONLY-TEXT ${i}`, new Date(t0 + i * 1000 + 1).toISOString()]);
    }
    ctx.anthropic.json = RECAP;
    const n0 = sent().length;
    const a = await ctx.request().post('/api/research/ask').set(user.headers).send({ query: 'Can I get my bail lowered in Tennessee?', session_id: sessionId });
    expect(a.status).toBe(200);
    await ctx.pollJob(user, a.body.jobId);
    const reqs = sent().slice(n0);
    expect(reqs.some(isSummary)).toBe(true);
    const answer = reqs.filter((x) => !isSummary(x)).pop();
    expect(answer.body.system.map((b) => b.text).join('\n')).toContain('EARLIER IN THIS CONVERSATION');
    expect((await ctx.request().get(`/api/research/session/${sessionId}/memory`).set(user.headers)).body).toMatchObject({ remembered: true });
    expect((await ctx.request().get(`/api/research/session/${sessionId}/memory`).set(other.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/research/session/${sessionId}/memory`).set(other.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/research/session/${sessionId}/memory`).set(user.headers)).body).toMatchObject({ forgotten: true });
    await ctx.request().delete(`/api/research/session/${sessionId}`).set(user.headers);
    expect(await ctx.db.get('SELECT 1 FROM ai_conversation_memory WHERE user_id = ? AND kind = ?', [user.user.id, 'research'])).toBeFalsy();

    // account deletion removes recaps and draft documents
    const leaver = await ctx.register({ displayName: 'Mem Leaver' });
    await ctx.db.run(`INSERT INTO ai_conversation_memory (user_id, kind, conversation_key, recap) VALUES (?, 'chat', 'x', '{"case_stage":"a"}'::jsonb)`, [leaver.user.id]);
    await ctx.db.run(`INSERT INTO draft_documents (user_id, kind, title, draft) VALUES (?, 'expungement_petition', 't', 'd')`, [leaver.user.id]);
    expect((await ctx.request().delete('/api/auth/account').set(leaver.headers).send({ password: leaver.password })).status).toBe(200);
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM ai_conversation_memory WHERE user_id = ?', [leaver.user.id])).n).toBe(0);
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM draft_documents WHERE user_id = ?', [leaver.user.id])).n).toBe(0);
  });

  test('P4 petition: only the checked statute stays; Word + PDF downloads with the notice', async () => {
    if (!ctx.app) return;
    const { petitionSource } = await import('../../routes/expungement/petition.js');
    const { STATE_RULES } = await import('../../routes/expungement/rules.js');
    const state = Object.keys(STATE_RULES).find((s) => petitionSource(s, 'misdemeanor'));
    const src = petitionSource(state, 'misdemeanor');
    const num = src.citation.match(/\d+[\w.:-]*\d/)[0];
    ctx.anthropic.replyText = [
      'DRAFT — GENERAL LEGAL INFORMATION, NOT LEGAL ADVICE',
      `IN THE COURT OF ${state}\nPetitioner: [FULL NAME]`,
      `The petitioner asks the Court under § ${num} to seal the record.`,
      'Under 18 U.S.C. § 3607 and State v. Smith, 123 S.W.3d 456 (2003), relief must be granted.',
      '/s/ José Núñez',
    ].join('\n\n');
    const p = await ctx.request().post('/api/expungement/petition').set(user.headers).set('Accept-Language', 'es')
      .send({ state, charge_type: 'misdemeanor theft', charge_kind: 'misdemeanor', full_name: 'José Núñez', county: 'Condado de Knox' });
    expect(p.status).toBe(200);
    expect(p.body.withheld).toBe(1);
    expect(p.body.draft).toContain(`§ ${num}`);
    expect(p.body.draft).not.toContain('3607');
    expect(p.body.draft).not.toContain('/s/');
    expect(p.body.draft).toContain('No se encontró una fuente');
    expect(p.body.sources).toEqual([{ citation: src.citation, url: src.url, checked: src.checked }]);
    const id = p.body.document_id;
    expect(id).toBeTruthy();
    // the model was given the checked source and told to cite nothing else
    const req = sent().filter((x) => JSON.stringify(x.body.messages).includes('CHECKED SOURCE')).pop();
    expect(JSON.stringify(req.body.messages)).toContain(src.citation);

    const w = await binary(ctx.request().get(`/api/expungement/petition/${id}/document?format=docx`).set(user.headers).set('Accept-Language', 'es'));
    expect(w.status).toBe(200);
    expect(w.headers['content-type']).toMatch(/wordprocessingml/);
    expect(w.headers['content-disposition']).toMatch(/petition-\d+\.docx/);
    const parts = await docxParts(w.body);
    expect(Object.keys(parts).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/header1.xml', 'word/styles.xml']);
    for (const [name, xml] of Object.entries(parts)) expect([name, xmlOk(xml)]).toEqual([name, true]);
    const notice = 'Preparado por usted con Justice Gavel — información legal general, no asesoría legal.';
    expect(parts['word/header1.xml']).toContain(notice);
    expect(parts['word/footer1.xml']).toContain(notice);
    expect(parts['word/footer1.xml']).toContain('PAGE');
    const doc = parts['word/document.xml'];
    expect(doc).toContain('José Núñez');          // typed exactly
    expect(doc).toContain('Condado de Knox');
    expect(doc).not.toContain('3607');
    expect(doc).not.toContain('/s/');
    expect(doc).toContain('Firma: ______________________________');
    expect(doc).toContain(src.citation);
    const pdf = await binary(ctx.request().get(`/api/expungement/petition/${id}/document?format=pdf`).set(user.headers));
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['x-withheld-parts']).toBe('1');
    expect((await ctx.request().get(`/api/expungement/petition/${id}/document?format=docx`).set(other.headers)).status).toBe(404);
    expect((await ctx.request().get(`/api/expungement/petition/${id}/document?format=rtf`).set(user.headers)).status).toBe(400);
    expect((await ctx.request().get(`/api/expungement/petition/${id}/document?format=pdf`)).status).toBe(401);
  });

  test('P5 saved motion → Word / PDF: case-law paragraphs withheld, typed fields verbatim (Arabic)', async () => {
    if (!ctx.app) return;
    const m = await ctx.db.run(`INSERT INTO motion_history (user_id, motion_type, draft, case_fields, filing_status, status) VALUES (?, ?, ?, ?, 'draft', 'active') RETURNING id`,
      [user.user.id, 'dismiss', 'MOTION TO DISMISS\n\nThe defendant moves to dismiss.\n\nSee Brady v. Maryland, 373 U.S. 83 (1963).\n\n/s/ Counsel', JSON.stringify({ defendant_name: 'محمد علي', case_number: 'CR-2026-77' })]);
    const w = await binary(ctx.request().get(`/api/motions/history/${m.lastID}/document?format=docx`).set(user.headers).set('Accept-Language', 'ar'));
    expect(w.status).toBe(200);
    const parts = await docxParts(w.body);
    for (const xml of Object.values(parts)) expect(xmlOk(xml)).toBe(true);
    expect(parts['word/document.xml']).toContain('محمد علي');
    expect(parts['word/document.xml']).toContain('<w:bidi/>');
    expect(parts['word/document.xml']).not.toContain('Brady');
    expect(parts['word/header1.xml']).toContain('Justice Gavel');
    expect(w.headers['x-withheld-parts']).toBe('1');
    const pdf = await binary(ctx.request().get(`/api/motions/history/${m.lastID}/document?format=pdf`).set(user.headers).set('Accept-Language', 'zh'));
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ctx.request().get(`/api/motions/history/${m.lastID}/document?format=pdf`).set(other.headers)).status).toBe(404);
  });

  // Review finding #9: the AI clean-up PDF and the saved-motion PDF use the same withholding.
  test('P6 motion PDF export (AI clean-up and saved draft): unsourced citations withheld, no /s/ signature', async () => {
    if (!ctx.app) return;
    const { extractPdfText } = await import('../helpers/pdfText.js');
    const pdfWords = async (b64OrBuf) => (await extractPdfText(Buffer.isBuffer(b64OrBuf) ? b64OrBuf : Buffer.from(b64OrBuf, 'base64'))).pages.join(' ');
    const m = await ctx.db.run(`INSERT INTO motion_history (user_id, motion_type, draft, case_fields, filing_status, status) VALUES (?, ?, ?, ?, 'draft', 'active') RETURNING id`,
      [user.user.id, 'dismiss', 'MOTION TO DISMISS\n\nThe defendant moves to dismiss.\n\nRelief under 42 U.S.C. § 1983 is due.\n\nKRS 431.073 also applies.\n\nBy: /s/ Saved Counsel',
        JSON.stringify({ defendant_name: 'Pat Doe', case_number: 'CR-2026-78' })]);
    ctx.anthropic.replyText = [
      'MOTION TO DISMISS',
      'The defendant respectfully moves the Court to dismiss the charge.',
      'Under 42 U.S.C. § 1983 the defendant is entitled to relief.',
      'By: /s/ Refined Counsel',
    ].join('\n\n');
    const r = await ctx.request().post(`/api/motions/export/${m.lastID}/refine`).set(user.headers).send({});
    expect(r.status).toBe(200);
    const job = await ctx.pollJob(user, r.body.jobId);
    expect(job.body.status).toBe('done');
    const text = await pdfWords(job.body.result.pdf_base64);
    expect(text).toContain('respectfully moves the Court to dismiss');
    expect(text).toContain('No source found for this part');
    expect(text).not.toContain('1983');
    expect(text).not.toContain('/s/');
    expect(text).not.toContain('Refined Counsel');
    // the saved-draft PDF: the same rule
    const saved = await binary(ctx.request().get(`/api/motions/export/${m.lastID}/pdf`).set(user.headers));
    expect(saved.status).toBe(200);
    const t2 = await pdfWords(saved.body);
    expect(t2).toContain('The defendant moves to dismiss.');
    expect(t2).toContain('No source found for this part');
    expect(t2).not.toContain('1983');
    expect(t2).not.toContain('431.073');
    expect(t2).not.toContain('Saved Counsel');
  });
});
