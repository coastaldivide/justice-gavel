/**
 * AI step 4 — documents on real Postgres (docs/AI_PLATFORM.md §11), against the documented mock
 * (images, PDFs, Files API — scripts/anthropic-mock-lib.mjs):
 *   D1 a photographed court paper → proposed lines with the words they came from; NOTHING saved
 *      until the person confirms through POST /court-dates (reminders planned, extra lines kept);
 *      the image went inline (no Files API copy for an upload)
 *   D2 not a court paper / unreadable / refused → clear message, nothing saved; MIME sniffed from
 *      the bytes; HEIC; disclaimer gate; per-person daily limit; feature off → 503
 *   D3 a case document read twice → uploaded to the Files API once, then referenced by file_id
 *      (with the beta header); an expired / removed remote copy falls back to inline bytes;
 *      taking the document back deletes the remote copy; the cleanup job deletes expired and
 *      orphaned copies; account deletion deletes them too
 *   D4 staff field-mapping suggestions on an agency's surety PDF: staff only, PDF + AcroForm list
 *      sent, nothing applied until a field is accepted (or edited and accepted), reject leaves the
 *      form alone; a PDF without fillable fields gets no AI call
 */
import { PDFDocument } from 'pdf-lib';
import { describeIntegration, initSuite } from './_harness.js';

/** A real (tiny) JPEG: SOI, APP0, SOF0 600×800, EOI. Enough for the type / size checks. */
function jpeg(w = 600, h = 800) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9)]);
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16), Buffer.from([0xff, 0xd9])]);
}
async function pdf({ fields = true, pages = 1 } = {}) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([612, 792]);
  if (fields) {
    const f = d.getForm();
    f.createTextField('DefendantName').addToPage(d.getPage(0), { x: 50, y: 700, width: 300, height: 20 });
    f.createTextField('BondAmt').addToPage(d.getPage(0), { x: 50, y: 660, width: 120, height: 20 });
    f.createTextField('OfficeUse').addToPage(d.getPage(0), { x: 50, y: 620, width: 120, height: 20 });
    f.createCheckBox('Married').addToPage(d.getPage(0), { x: 50, y: 580, width: 12, height: 12 });
  }
  return Buffer.from(await d.save());
}
const F = (value, source_text, confidence = 'high') => ({ value, source_text, confidence });
const READ = {
  kind: 'court_paper',
  fields: {
    court_date: F('2027-03-02', 'TUESDAY, MARCH 2, 2027'), court_time: F('09:00', '9:00 A.M.'),
    court_name: F('General Sessions Court', 'GENERAL SESSIONS COURT OF DAVIDSON COUNTY'), court_address: F('408 2nd Ave N, Nashville, TN 37201', '408 2nd Avenue North, Nashville, TN 37201'),
    courtroom: F('Courtroom 4B', 'Courtroom 4B', 'medium'), case_number: F('GS-778812', 'Docket No. GS-778812'), judge: F('', '', 'not_found'),
    hearing_type: F('arraignment', 'ARRAIGNMENT'),
  },
  bring: [{ text: 'Photo ID', source_text: 'Bring a photo ID and this notice', confidence: 'high' }],
};

describeIntegration('AI step 4 — court papers, Files API, surety-form suggestions (real Postgres)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let user, other, admin, agency, files;
  const msgs = () => ctx.anthropic.requests.filter((r) => r.path === '/v1/messages');
  const uploads = () => ctx.anthropic.requests.filter((r) => r.method === 'POST' && r.path === '/v1/files');
  const read = (who, buf, name = 'paper.jpg') => ctx.request().post('/api/court-papers/read').set(who.headers).attach('file', buf, name);

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
    process.env.AI_FILES_API = 'on';
    files = await import('../../services/aiFiles.js');
    [user, other, admin, agency] = await Promise.all(['U', 'O', 'A', 'G'].map((n) => ctx.register({ displayName: `Doc ${n}` })));
    await ctx.acceptDisclaimer(user);
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    (await import('../../middleware/auth.js')).invalidateUserCache(admin.user.id);
    ctx.addCleanup(async (db) => {
      const ids = [user, other, admin, agency].map((u) => u.user.id);
      await db.run(`DELETE FROM ai_files WHERE user_id = ANY(?::bigint[]) OR delete_reason = 'account_deleted' AND file_id LIKE 'file_mock_%'`, [`{${ids.join(',')}}`]);
      await db.run(`DELETE FROM bd_forms WHERE agent_id = ?`, [agency.user.id]);
      await db.run(`DELETE FROM bd_setup_requests WHERE agent_id = ?`, [agency.user.id]);
      await db.run(`DELETE FROM ai_document_reads WHERE user_id = ANY(?::bigint[])`, [`{${ids.join(',')}}`]);
      await db.run(`DELETE FROM court_dates WHERE user_id = ANY(?::bigint[])`, [`{${ids.join(',')}}`]);
    });
  });
  afterAll(() => { for (const k of ['AI_FILES_API', 'COURT_PAPER_READS_PER_DAY', 'COURT_PAPER_READER']) delete process.env[k]; });
  afterEach(() => { ctx.anthropic.json = null; ctx.anthropic.mode = 'ok'; delete process.env.COURT_PAPER_READS_PER_DAY; delete process.env.COURT_PAPER_READER; });

  test('D1 photo → proposed lines with their words; nothing saved until confirmed through the court-date path', async () => {
    if (!ctx.app) return;
    ctx.anthropic.json = READ;
    const before = (await ctx.db.get('SELECT COUNT(*)::int AS n FROM court_dates WHERE user_id = ?', [user.user.id])).n;
    const n0 = msgs().length;
    const r = await read(user, jpeg(), 'whatever.png');   // the name lies; the bytes are a JPEG
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: 'read', pages: 1, via_file_id: false, warnings: [] });
    expect(r.body.notice).toMatch(/Check every line against the paper before saving/);
    expect(r.body.fields.court_date).toEqual({ value: '2027-03-02', source_text: 'TUESDAY, MARCH 2, 2027', confidence: 'high' });
    expect(r.body.fields.judge).toEqual({ value: '', source_text: '', confidence: 'not_found' });
    expect(r.body.bring).toEqual([READ.bring[0]]);
    // the request: image before text, sniffed media type, structured output, no file id for an upload
    const sent = msgs().slice(n0)[0];
    expect(sent.body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(sent.body.messages[0].content[1].type).toBe('text');
    expect(sent.body.output_config.format.schema.properties.kind.enum).toEqual(['court_paper', 'not_court_paper', 'unreadable']);
    expect(uploads()).toHaveLength(0);
    // nothing saved yet; the read is logged without content
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM court_dates WHERE user_id = ?', [user.user.id])).n).toBe(before);
    const log = await ctx.db.get(`SELECT * FROM ai_document_reads WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [user.user.id]);
    expect(log).toMatchObject({ kind: 'court_paper', source: 'upload', mime_type: 'image/jpeg', outcome: 'read', page_count: 1 });
    // confirm: the ordinary POST /court-dates, with the extra lines and source 'paper'
    const c = await ctx.request().post('/api/court-dates').set(user.headers).send({
      case_title: 'My case', court_date: '2027-03-02', court_time: '09:00', hearing_type: 'arraignment',
      location: 'General Sessions Court, 408 2nd Ave N, Nashville, TN 37201', courtroom: 'Courtroom 4B', case_number: 'GS-778812', bring: 'Photo ID', source: 'paper',
    });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ courtroom: 'Courtroom 4B', case_number: 'GS-778812', judge: null, bring: 'Photo ID', source: 'paper', hearing_type: 'arraignment' });
    expect(c.body.reminders.length).toBeGreaterThan(0);
    const g = await ctx.request().get(`/api/court-dates/${c.body.id}`).set(user.headers);
    expect(g.body).toMatchObject({ courtroom: 'Courtroom 4B', source: 'paper' });
    expect((await ctx.request().patch(`/api/court-dates/${c.body.id}`).set(user.headers).send({ judge: 'Hon. A. Smith' })).body.judge).toBe('Hon. A. Smith');
    expect((await ctx.request().post('/api/court-dates').set(user.headers).send({ case_title: 'x', court_date: '2027-04-01', source: 'robot' })).status).toBe(400);
  });

  test('D2 not a court paper, unreadable, refused, bad files, gate, limits, switch', async () => {
    if (!ctx.app) return;
    const count = async () => (await ctx.db.get('SELECT COUNT(*)::int AS n FROM court_dates WHERE user_id = ?', [user.user.id])).n;
    const c0 = await count();
    ctx.anthropic.json = { ...READ, kind: 'not_court_paper' };
    let r = await read(user, jpeg());
    expect(r.body).toMatchObject({ result: 'not_court_paper', fields: null });
    expect(r.body.message).toMatch(/does not look like a court paper/);
    ctx.anthropic.json = { kind: 'court_paper', fields: Object.fromEntries(Object.keys(READ.fields).map((k) => [k, F(k === 'hearing_type' ? 'none' : '', '', 'not_found')])), bring: [] };
    r = await read(user, jpeg());
    expect([r.status, r.body.result, r.body.code]).toEqual([200, 'unreadable', undefined]);
    ctx.anthropic.json = null; ctx.anthropic.mode = 'refusal_hard';
    r = await read(user, jpeg());
    expect([r.status, r.body.code]).toEqual([422, 'ai_refused']);
    ctx.anthropic.mode = 'ok';
    r = await read(user, Buffer.from('this is not an image, it only has a .jpg name'), 'paper.jpg');
    expect([r.status, r.body.code]).toEqual([415, 'file_unsupported_type']);
    r = await read(user, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]), 'IMG_1.HEIC');
    expect([r.status, r.body.code]).toEqual([415, 'file_heic']);
    r = await read(user, await pdf({ fields: false, pages: 11 }), 'p.pdf');
    expect([r.status, r.body.code, r.body.pages]).toEqual([400, 'file_too_many_pages', 10]);
    expect(await count()).toBe(c0);
    // the disclaimer gate, sign-in, the switch, the daily limit
    expect((await read(other, jpeg())).status).toBe(451);
    expect((await ctx.request().post('/api/court-papers/read').attach('file', jpeg(), 'a.jpg')).status).toBe(401);
    process.env.COURT_PAPER_READER = 'off';
    expect((await read(user, jpeg())).body.code).toBe('feature_unavailable');
    expect((await ctx.request().get('/api/court-papers/status').set(user.headers)).body.enabled).toBe(false);
    delete process.env.COURT_PAPER_READER;
    const done = (await ctx.db.get(`SELECT COUNT(*)::int AS n FROM ai_document_reads WHERE user_id = ? AND kind = 'court_paper'`, [user.user.id])).n;
    process.env.COURT_PAPER_READS_PER_DAY = String(done);
    r = await read(user, jpeg());
    expect([r.status, r.body.code, r.body.n]).toEqual([429, 'daily_limit', done]);
    expect((await ctx.request().get('/api/court-papers/status').set(user.headers)).body).toMatchObject({ enabled: true, reads_left_today: 0 });
  });

  test('D3 a case document: uploaded to the Files API once, then by file_id; fallback; deletion paths', async () => {
    if (!ctx.app) return;
    ctx.anthropic.json = READ;
    const cs = await ctx.request().post('/api/cases').set(user.headers).send({ title: 'Paper case', state: 'TN' });
    const caseId = cs.body.id || cs.body.case?.id;
    const att = await ctx.request().post('/api/messages/attachment').set(user.headers).field('case_id', String(caseId)).attach('file', await pdf({ fields: false }), 'notice.pdf');
    expect(att.status).toBe(201);
    const aid = att.body.id;
    const u0 = uploads().length; const m0 = msgs().length;
    let r = await ctx.request().post('/api/court-papers/read-attachment').set(user.headers).send({ attachment_id: aid });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ result: 'read', via_file_id: true, case_id: Number(caseId), attachment_id: Number(aid) });
    expect(uploads().length).toBe(u0 + 1);
    const row = await ctx.db.get(`SELECT * FROM ai_files WHERE subject_type = 'message_attachment' AND subject_id = ?`, [aid]);
    expect(row).toMatchObject({ user_id: Number(user.user.id), mime_type: 'application/pdf', uses: 1 });
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const first = msgs().slice(m0)[0];
    expect(first.body.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'file', file_id: row.file_id } });
    expect(first.headers['anthropic-beta']).toContain('files-api-2025-04-14');
    // second read: no new upload
    r = await ctx.request().post('/api/court-papers/read-attachment').set(user.headers).send({ attachment_id: aid });
    expect(r.body.via_file_id).toBe(true);
    expect(uploads().length).toBe(u0 + 1);
    // someone else cannot read it
    expect((await ctx.request().post('/api/court-papers/read-attachment').set(other.headers).send({ attachment_id: aid })).status).toBe(451);
    await ctx.acceptDisclaimer(other);
    expect((await ctx.request().post('/api/court-papers/read-attachment').set(other.headers).send({ attachment_id: aid })).body.code).toBe('attachment_not_found');
    // the remote copy vanished (expired / removed): the read still works, inline, and the row is forgotten
    ctx.anthropic.files.files.delete(row.file_id);
    const m1 = msgs().length;
    r = await ctx.request().post('/api/court-papers/read-attachment').set(user.headers).send({ attachment_id: aid });
    expect(r.body).toMatchObject({ result: 'read', via_file_id: false });
    const tried = msgs().slice(m1);
    expect(tried.map((x) => x.body.messages[0].content[0].source.type)).toEqual(['file', 'base64']);
    expect((await ctx.db.get('SELECT deleted_at FROM ai_files WHERE file_id = ?', [row.file_id])).deleted_at).not.toBeNull();
    // read again → a new upload; then taking the document back deletes the remote copy
    r = await ctx.request().post('/api/court-papers/read-attachment').set(user.headers).send({ attachment_id: aid });
    const row2 = await ctx.db.get(`SELECT * FROM ai_files WHERE subject_id = ? AND deleted_at IS NULL`, [aid]);
    expect(row2.file_id).not.toBe(row.file_id);
    const thread = await ctx.request().get(`/api/messages/${caseId}`).set(user.headers);
    const msgId = (thread.body.messages || []).find((m) => Number(m.attachment_id) === Number(aid)).id;
    expect((await ctx.request().delete(`/api/messages/${msgId}`).set(user.headers)).body.deleted).toBe(true);
    for (let i = 0; i < 50 && ctx.anthropic.files.files.has(row2.file_id); i += 1) await new Promise((x) => setTimeout(x, 20));
    expect(ctx.anthropic.files.files.has(row2.file_id)).toBe(false);
    expect((await ctx.db.get('SELECT deleted_at, delete_reason FROM ai_files WHERE file_id = ?', [row2.file_id]))).toMatchObject({ delete_reason: 'document_deleted' });

    // the cleanup job: an expired row and an orphan row (document gone) are deleted remotely
    const up = await files.uploadFile({ buffer: await pdf({ fields: false }), mime: 'application/pdf', filename: 'jg-x-1.pdf' });
    const up2 = await files.uploadFile({ buffer: await pdf({ fields: false }), mime: 'application/pdf', filename: 'jg-x-2.pdf' });
    await ctx.db.run(`INSERT INTO ai_files (file_id, subject_type, subject_id, user_id, sha256, mime_type, size_bytes, expires_at) VALUES (?, 'message_attachment', ?, ?, 'x', 'application/pdf', 1, NOW() - INTERVAL '1 hour')`, [up.id, aid, user.user.id]);
    await ctx.db.run(`INSERT INTO ai_files (file_id, subject_type, subject_id, user_id, sha256, mime_type, size_bytes, expires_at) VALUES (?, 'bd_form', 999999999, ?, 'x', 'application/pdf', 1, NOW() + INTERVAL '1 day')`, [up2.id, user.user.id]);
    const out = await files.cleanupFiles(ctx.db);
    expect(out.checked).toBeGreaterThanOrEqual(2);
    expect(ctx.anthropic.files.files.has(up.id)).toBe(false);
    expect(ctx.anthropic.files.files.has(up2.id)).toBe(false);
    expect((await ctx.db.get('SELECT delete_reason FROM ai_files WHERE file_id = ?', [up.id])).delete_reason).toBe('document_deleted');
    expect((await ctx.db.get('SELECT delete_reason, deleted_at FROM ai_files WHERE file_id = ?', [up2.id])).deleted_at).not.toBeNull();
    const { jobHealth, EXPECTED } = await import('../../monitoring/jobHealth.js');
    expect(EXPECTED['ai-files-cleanup']).toBeTruthy();
    expect((await jobHealth(ctx.db)).find((j) => j.job === 'ai-files-cleanup')).toBeTruthy();
  });

  test('D3b account deletion removes the remote copies of the person\'s documents', async () => {
    if (!ctx.app) return;
    ctx.anthropic.json = READ;
    const leaver = await ctx.register({ displayName: 'Doc Leaver' });
    await ctx.acceptDisclaimer(leaver);
    const cs = await ctx.request().post('/api/cases').set(leaver.headers).send({ title: 'Leaving', state: 'TN' });
    const caseId = cs.body.id || cs.body.case?.id;
    const att = await ctx.request().post('/api/messages/attachment').set(leaver.headers).field('case_id', String(caseId)).attach('file', jpeg(), 'paper.jpg');
    const r = await ctx.request().post('/api/court-papers/read-attachment').set(leaver.headers).send({ attachment_id: att.body.id });
    expect(r.body.via_file_id).toBe(true);
    const row = await ctx.db.get('SELECT file_id FROM ai_files WHERE user_id = ?', [leaver.user.id]);
    expect(ctx.anthropic.files.files.has(row.file_id)).toBe(true);
    const del = await ctx.request().delete('/api/auth/account').set(leaver.headers).send({ password: leaver.password });
    expect(del.status).toBe(200);
    for (let i = 0; i < 50 && ctx.anthropic.files.files.has(row.file_id); i += 1) await new Promise((x) => setTimeout(x, 20));
    expect(ctx.anthropic.files.files.has(row.file_id)).toBe(false);
    expect(await ctx.db.get('SELECT user_id, delete_reason FROM ai_files WHERE file_id = ?', [row.file_id])).toMatchObject({ user_id: null, delete_reason: 'account_deleted' });
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM ai_document_reads WHERE user_id = ?', [leaver.user.id])).n).toBe(0);
  });

  test('D4 staff mapping suggestions: nothing applied until accepted; no fillable fields → no AI call', async () => {
    if (!ctx.app) return;
    const { getAttachmentStorage } = await import('../../services/attachmentStorage.js');
    const { putFile } = await import('../../services/bondDesk/packets.js');
    const storage = await getAttachmentStorage();
    const rq = await ctx.db.get(`INSERT INTO bd_setup_requests (agent_id, status, started_at) VALUES (?, 'in_progress', NOW()) RETURNING id`, [agency.user.id]);
    const mkForm = async (buf, fields) => ctx.db.get(
      `INSERT INTO bd_forms (agent_id, name, storage_key, sha256, size_bytes, page_count, fields, setup_request_id, setup_pending)
       VALUES (?, 'Surety app', ?, 'x', ?, 1, ?::jsonb, ?, TRUE) RETURNING id`,
      [agency.user.id, await putFile(storage, buf), buf.length, JSON.stringify(fields), rq.id]);
    const form = await mkForm(await pdf(), [{ name: 'DefendantName', type: 'text' }, { name: 'BondAmt', type: 'text' }, { name: 'OfficeUse', type: 'text' }, { name: 'Married', type: 'checkbox' }]);
    const base = `/api/admin/bd-setup/${rq.id}/forms/${form.id}/map-suggestions`;
    expect((await ctx.request().post(base).set(user.headers)).status).toBe(403);
    ctx.anthropic.json = { suggestions: [
      { field: 'DefendantName', data_key: 'bond.defendant_name', confidence: 'high', reason: 'Label "Defendant\'s Name" next to the box' },
      { field: 'BondAmt', data_key: 'bond.premium', confidence: 'medium', reason: 'Label "Amount"' },
      { field: 'Married', data_key: 'signer.full_name', confidence: 'high', reason: 'not a text field' },
      { field: 'Ghost', data_key: 'bond.charges', confidence: 'high', reason: 'invented' },
    ] };
    const m0 = msgs().length;
    const s = await ctx.request().post(base).set(admin.headers);
    expect(s.status).toBe(201);
    const sug = s.body.suggestion;
    expect(sug.suggestions.map((x) => [x.field, x.data_key])).toEqual([['DefendantName', 'bond.defendant_name'], ['BondAmt', 'bond.premium'], ['OfficeUse', null]]);
    const sent = msgs().slice(m0)[0];
    expect(sent.body.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'file' } });
    expect(sent.body.messages[0].content[1].text).toContain('"name":"DefendantName","page":1');
    expect(sent.body.messages[0].content[1].text).not.toContain('Married');
    // nothing applied yet
    expect((await ctx.db.get('SELECT field_map FROM bd_forms WHERE id = ?', [form.id])).field_map).toEqual({});
    let d = await ctx.request().post(`${base}/${sug.id}/decide`).set(admin.headers).send({ field: 'DefendantName', action: 'accept' });
    expect(d.status).toBe(200);
    expect(d.body.form.field_map).toEqual({ DefendantName: 'bond.defendant_name' });
    d = await ctx.request().post(`${base}/${sug.id}/decide`).set(admin.headers).send({ field: 'BondAmt', action: 'accept', data_key: 'bond.bond_amount' });
    expect(d.body.form.field_map).toEqual({ DefendantName: 'bond.defendant_name', BondAmt: 'bond.bond_amount' });
    expect(d.body.suggestion.decisions.BondAmt).toMatchObject({ action: 'accept', data_key: 'bond.bond_amount', edited: true });
    d = await ctx.request().post(`${base}/${sug.id}/decide`).set(admin.headers).send({ field: 'OfficeUse', action: 'reject' });
    expect(d.body.form.field_map).toEqual({ DefendantName: 'bond.defendant_name', BondAmt: 'bond.bond_amount' });
    expect(d.body.suggestion.status).toBe('done');
    expect((await ctx.request().post(`${base}/${sug.id}/decide`).set(admin.headers).send({ field: 'Married', action: 'accept', data_key: 'bond.charges' })).body.code).toBe('bad_field_map');
    expect((await ctx.request().get(base).set(admin.headers)).body.suggestion.id).toBe(sug.id);
    // the preview fills accepted fields through the existing path
    const prev = await ctx.request().get(`/api/admin/bd-setup/${rq.id}/forms/${form.id}/preview.pdf`).set(admin.headers)
      .buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect((await PDFDocument.load(prev.body)).getForm().getTextField('DefendantName').getText()).toBe('Sample Defendant');
    // a second suggestion reuses the Files API copy
    const u0 = uploads().length;
    await ctx.request().post(base).set(admin.headers);
    expect(uploads().length).toBe(u0);
    const audits = await ctx.db.all(`SELECT action FROM audit_log WHERE entity_type = 'bd_form' AND entity_id = ?`, [String(form.id)]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['admin.bd_setup_form_suggested', 'admin.bd_setup_form_mapped']));
    // no fillable fields: said so, no AI call
    const flat = await mkForm(await pdf({ fields: false }), []);
    const m1 = msgs().length;
    const n = await ctx.request().post(`/api/admin/bd-setup/${rq.id}/forms/${flat.id}/map-suggestions`).set(admin.headers);
    expect(n.body.suggestion).toMatchObject({ no_fields: true, suggestions: [] });
    expect(msgs().length).toBe(m1);
    // archiving the form deletes its Files API copy
    const fr = await ctx.db.get(`SELECT file_id FROM ai_files WHERE subject_type = 'bd_form' AND subject_id = ? AND deleted_at IS NULL`, [form.id]);
    await ctx.request().post(`/api/admin/bd-setup/${rq.id}/forms/${form.id}/archive`).set(admin.headers).send({});
    for (let i = 0; i < 50 && ctx.anthropic.files.files.has(fr.file_id); i += 1) await new Promise((x) => setTimeout(x, 20));
    expect(ctx.anthropic.files.files.has(fr.file_id)).toBe(false);
  });

  // Review findings #7 and #8: parallel requests.
  test('D5 parallel: limits are claimed atomically (25 reads, 20 allowed); two field accepts at once both stick', async () => {
    if (!ctx.app) return;
    const { readCourtPaper } = await import('../../services/courtPaper.js');
    const { suggestMapping } = await import('../../services/bondDesk/formMapping.js');
    const solo = await ctx.register({ displayName: 'Doc P' });
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM ai_document_reads WHERE user_id = ?', [solo.user.id]); });
    process.env.COURT_PAPER_READS_PER_DAY = '20';
    process.env.COURT_PAPER_READS_PER_HOUR = '100';
    process.env.AI_FILES_API = 'off';
    try {
      ctx.anthropic.json = READ;
      const m0 = msgs().length;
      const res = await Promise.allSettled(Array.from({ length: 25 }, () => readCourtPaper(ctx.db, { userId: solo.user.id, buffer: jpeg(), source: 'upload' })));
      const ok = res.filter((r) => r.status === 'fulfilled').length;
      const limited = res.filter((r) => r.status === 'rejected' && r.reason?.code === 'daily_limit').length;
      expect([ok, limited]).toEqual([20, 5]);
      expect(msgs().length - m0).toBe(20);                                  // at most 20 AI calls
      expect((await ctx.db.get(`SELECT COUNT(*)::int AS n FROM ai_document_reads WHERE user_id = ? AND kind = 'court_paper'`, [solo.user.id])).n).toBe(20);

      // surety-form suggestions: 25 at once for one staff member, 20 per hour
      const { getAttachmentStorage } = await import('../../services/attachmentStorage.js');
      const { putFile } = await import('../../services/bondDesk/packets.js');
      const storage = await getAttachmentStorage();
      const buf = await pdf();
      const rq = (await ctx.db.get(`SELECT id FROM bd_setup_requests WHERE agent_id = ? ORDER BY id DESC LIMIT 1`, [agency.user.id]))
        || await ctx.db.get(`INSERT INTO bd_setup_requests (agent_id, status, started_at) VALUES (?, 'in_progress', NOW()) RETURNING id`, [agency.user.id]);
      const fields = [{ name: 'DefendantName', type: 'text' }, { name: 'BondAmt', type: 'text' }, { name: 'OfficeUse', type: 'text' }, { name: 'Married', type: 'checkbox' }];
      const form = await ctx.db.get(
        `INSERT INTO bd_forms (agent_id, name, storage_key, sha256, size_bytes, page_count, fields, setup_request_id, setup_pending)
         VALUES (?, 'Parallel form', ?, 'x', ?, 1, ?::jsonb, ?, TRUE) RETURNING *`,
        [agency.user.id, await putFile(storage, buf), buf.length, JSON.stringify(fields), rq.id]);
      ctx.anthropic.json = { suggestions: [
        { field: 'DefendantName', data_key: 'bond.defendant_name', confidence: 'high', reason: 'label' },
        { field: 'BondAmt', data_key: 'bond.bond_amount', confidence: 'high', reason: 'label' },
        { field: 'OfficeUse', data_key: 'bond.charges', confidence: 'low', reason: 'label' },
      ] };
      const m1 = msgs().length;
      const sres = await Promise.allSettled(Array.from({ length: 25 }, () => suggestMapping(ctx.db, { form: { ...form, id: Number(form.id), agent_id: Number(form.agent_id) }, buffer: buf, staffId: solo.user.id })));
      expect(sres.filter((r) => r.status === 'fulfilled').length).toBe(20);
      expect(sres.filter((r) => r.status === 'rejected' && r.reason?.code === 'ai_suggest_limit').length).toBe(5);
      expect(msgs().length - m1).toBe(20);

      // two (three) accepts on different fields at the same time: every one is kept
      const sug = sres.find((r) => r.status === 'fulfilled').value;
      const base = `/api/admin/bd-setup/${rq.id}/forms/${form.id}/map-suggestions/${sug.id}/decide`;
      const rs = await Promise.all(['DefendantName', 'BondAmt', 'OfficeUse'].map((field) => ctx.request().post(base).set(admin.headers).send({ field, action: 'accept' })));
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
      const after = await ctx.db.get('SELECT field_map FROM bd_forms WHERE id = ?', [form.id]);
      expect(after.field_map).toEqual({ DefendantName: 'bond.defendant_name', BondAmt: 'bond.bond_amount', OfficeUse: 'bond.charges' });
      const dec = await ctx.db.get('SELECT decisions, status FROM bd_form_map_suggestions WHERE id = ?', [sug.id]);
      expect(Object.keys(dec.decisions).sort()).toEqual(['BondAmt', 'DefendantName', 'OfficeUse']);
      expect(dec.status).toBe('done');
    } finally {
      delete process.env.COURT_PAPER_READS_PER_HOUR;
      process.env.AI_FILES_API = 'on';
    }
  });
});
