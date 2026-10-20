/**
 * messages.int.test.js — /api/messages against real Postgres: case threads
 * (send, history, read receipts, unread badge), bulk outreach to directory
 * attorneys, attachment upload + download (sniffed type, encrypted at rest)
 * and the access-control matrix. Creates its own tagged lawyer rows and
 * deletes them afterwards; the verified directory rows are never touched.
 */
import { describeIntegration, initSuite, FIXTURE_MARK } from './_harness.js';

// 1×1 transparent PNG (real bytes — the server sniffs the magic number)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64');

describeIntegration('messages routes (real Postgres)', () => {
  const ctx = initSuite();

  let client, attorney, strangerAtty, stranger, caseId;
  beforeAll(async () => {
    if (!ctx.app) return;
    client       = await ctx.register({ displayName: 'Msg Client' });
    attorney     = await ctx.register({ displayName: 'Assigned Atty', isAttorney: true, barNumber: 'BPR123', barState: 'TN' });
    strangerAtty = await ctx.register({ displayName: 'Other Atty', isAttorney: true, barNumber: 'BPR999', barState: 'TN' });
    stranger     = await ctx.register({ displayName: 'Msg Stranger' });

    const cas = await ctx.request().post('/api/cases').set(client.headers).send({ title: `${ctx.tag} msg case` });
    caseId = cas.body.id;
    await ctx.db.run(
      `INSERT INTO case_assignments (case_id, defender_id, status) VALUES (?, ?, 'active')`,
      [caseId, attorney.user.id]);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM case_assignments WHERE case_id = ?', [caseId]);
      await db.run('DELETE FROM lawyers WHERE name LIKE ?', [`${ctx.tag}%`]);
    });
  });

  it('client sends in the case thread; the row is encrypted at rest and decrypted in the API', async () => {
    const res = await ctx.request().post(`/api/messages/${caseId}`).set(client.headers)
      .send({ body: 'My hearing moved to Tuesday.' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ sender_type: 'user', body: 'My hearing moved to Tuesday.' });

    const row = await ctx.db.get('SELECT body FROM case_messages WHERE id = ?', [res.body.message.id]);
    expect(row.body).not.toContain('hearing moved');            // AES-GCM at rest
    expect(row.body).toMatch(/^[0-9a-f]+:[0-9a-f]+:/);
  });

  it('unread badge counts the attorney reply; fetching the thread marks it read', async () => {
    const reply = await ctx.request().post(`/api/messages/${caseId}`).set(attorney.headers)
      .send({ body: 'Understood — I will file a notice.' });
    expect(reply.status).toBe(200);
    expect(reply.body.message.sender_type).toBe('attorney');

    const unread = await ctx.request().get('/api/messages/unread/count').set(client.headers);
    expect(unread.status).toBe(200);
    expect(Number(unread.body.count)).toBe(1);

    const thread = await ctx.request().get(`/api/messages/${caseId}`).set(client.headers);
    expect(thread.status).toBe(200);
    expect(thread.body.messages.length).toBeGreaterThanOrEqual(2);
    const last = thread.body.messages[thread.body.messages.length - 1];
    expect(last).toMatchObject({ sender_type: 'attorney', body: 'Understood — I will file a notice.' });

    const after = await ctx.request().get('/api/messages/unread/count').set(client.headers);
    expect(Number(after.body.count)).toBe(0);
    const dbRead = await ctx.db.get('SELECT read_at FROM case_messages WHERE id = ?', [reply.body.message.id]);
    expect(dbRead.read_at).not.toBeNull();
  });

  it('access control: stranger 404, unassigned attorney 403, no token 401; empty body 400', async () => {
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(stranger.headers)).status).toBe(404);
    expect((await ctx.request().post(`/api/messages/${caseId}`).set(stranger.headers).send({ body: 'hi' })).status).toBe(404);
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(strangerAtty.headers)).status).toBe(403);
    expect((await ctx.request().get(`/api/messages/${caseId}`)).status).toBe(401);
    expect((await ctx.request().post(`/api/messages/${caseId}`).set(client.headers).send({ body: '   ' })).status).toBe(400);
    expect((await ctx.request().get('/api/messages/999999999').set(client.headers)).status).toBe(404);
  });

  it('bulk: delivers to the attorney with an account, reports the rest with contact details', async () => {
    // one tagged directory row linked to strangerAtty's account, one with no account
    const linked = await ctx.db.get(
      `INSERT INTO lawyers (name, city, state, phone, active, user_id, source_id)
       VALUES (?, 'Nashville', 'TN', '615-555-0100', 1, ?, ?) RETURNING id`,
      [`${ctx.tag} Linked Lawyer`, strangerAtty.user.id, `${FIXTURE_MARK}_${ctx.tag}_linked`]);
    const unlinked = await ctx.db.get(
      `INSERT INTO lawyers (name, city, state, phone, website, active, source_id)
       VALUES (?, 'Nashville', 'TN', '615-555-0101', 'https://example.test', 1, ?) RETURNING id`,
      [`${ctx.tag} Unlinked Lawyer`, `${FIXTURE_MARK}_${ctx.tag}_unlinked`]);

    const res = await ctx.request().post('/api/messages/bulk').set(client.headers)
      .send({ lawyer_ids: [Number(linked.id), Number(unlinked.id)], message: 'I need representation for a DUI in Davidson County.' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.recipients[0]).toMatchObject({ lawyer_id: Number(linked.id) });
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0]).toMatchObject({ reason: 'no_account', phone: '615-555-0101' });

    // DB: a messages row to the linked account, encrypted at rest
    const row = await ctx.db.get(
      'SELECT content FROM messages WHERE sender_id = ? AND recipient_id = ?', [client.user.id, strangerAtty.user.id]);
    expect(row).toBeTruthy();
    expect(row.content).not.toContain('representation');

    // …and the recipient sees it decrypted in /messages/direct
    const direct = await ctx.request().get('/api/messages/direct').set(strangerAtty.headers);
    expect(direct.status).toBe(200);
    const got = direct.body.messages.find(m => m.sender_id === client.user.id);
    expect(got).toMatchObject({ direction: 'received', content: 'I need representation for a DUI in Davidson County.' });
  });

  it('bulk input validation: empty ids, non-numeric ids, >3 ids, empty message → 400', async () => {
    const h = client.headers;
    expect((await ctx.request().post('/api/messages/bulk').set(h).send({ lawyer_ids: [], message: 'x' })).status).toBe(400);
    expect((await ctx.request().post('/api/messages/bulk').set(h).send({ lawyer_ids: ['a'], message: 'x' })).status).toBe(400);
    expect((await ctx.request().post('/api/messages/bulk').set(h).send({ lawyer_ids: [1, 2, 3, 4], message: 'x' })).status).toBe(400);
    expect((await ctx.request().post('/api/messages/bulk').set(h).send({ lawyer_ids: [1] })).status).toBe(400);
  });

  it('attachment: upload into the case thread, appears in the thread, downloads byte-identical', async () => {
    const up = await ctx.request().post('/api/messages/attachment').set(client.headers)
      .field('case_id', String(caseId))
      .field('message', 'Bail receipt attached')
      .attach('file', PNG, 'receipt.png');
    expect(up.status).toBe(201);
    expect(up.body.attachment).toMatchObject({ mime_type: 'image/png', case_id: caseId });
    expect(up.body.url).toBe(`/api/messages/attachment/${up.body.id}`);

    // DB: stored encrypted (bytes on disk differ from the plaintext PNG)
    const arow = await ctx.db.get('SELECT storage, storage_key, encrypted, sha256, size_bytes FROM message_attachments WHERE id = ?', [up.body.id]);
    expect(arow).toMatchObject({ storage: 'local', encrypted: 1 });
    expect(Number(arow.size_bytes)).toBe(PNG.length);

    const thread = await ctx.request().get(`/api/messages/${caseId}`).set(attorney.headers);
    const attMsg = thread.body.messages.find(m => m.attachment_id === up.body.id);
    expect(attMsg).toMatchObject({ message_type: 'attachment', attachment_type: 'image/png', body: 'Bail receipt attached' });

    // Download: assigned attorney can fetch it, bytes identical
    const dl = await ctx.request().get(`/api/messages/attachment/${up.body.id}`).set(attorney.headers).buffer().parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(dl.body, PNG)).toBe(0);

    // Wrong user cannot download (404, not 403 — ids are not revealed)
    expect((await ctx.request().get(`/api/messages/attachment/${up.body.id}`).set(stranger.headers)).status).toBe(404);
    expect((await ctx.request().get(`/api/messages/attachment/${up.body.id}`)).status).toBe(401);
  });

  it('attachment rejects non-allowlisted bytes (415), missing file (400), foreign case (404)', async () => {
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');
    const bad = await ctx.request().post('/api/messages/attachment').set(client.headers)
      .attach('file', exe, 'tool.exe');
    expect(bad.status).toBe(415);
    expect((await ctx.request().post('/api/messages/attachment').set(client.headers)
      .field('note', 'nothing attached').field('x', 'y')).status).toBe(400);
    const foreign = await ctx.request().post('/api/messages/attachment').set(stranger.headers)
      .field('case_id', String(caseId))
      .attach('file', PNG, 'sneak.png');
    expect(foreign.status).toBe(404);
  });

  it('sender can soft-delete a message; a stranger cannot', async () => {
    const sent = await ctx.request().post(`/api/messages/${caseId}`).set(client.headers).send({ body: 'delete me' });
    const mid = sent.body.message.id;
    // a stranger cannot even learn that the message exists
    expect((await ctx.request().delete(`/api/messages/${mid}`).set(stranger.headers)).status).toBe(404);
    const del = await ctx.request().delete(`/api/messages/${mid}`).set(client.headers);
    expect(del.status).toBe(200);
    const row = await ctx.db.get('SELECT deleted_at FROM case_messages WHERE id = ?', [mid]);
    expect(row.deleted_at).not.toBeNull();
    const thread = await ctx.request().get(`/api/messages/${caseId}`).set(client.headers);
    expect(thread.body.messages.some(m => m.id === mid)).toBe(false);
  });
});
