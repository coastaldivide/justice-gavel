/**
 * audit11 C1 — a self-registered "attorney" must not be able to attach
 * themselves to someone else's case, read the privileged thread, or message the
 * client as counsel. Legitimate path: the client invites the attorney, the
 * attorney accepts (inbox or /assign), messaging works; the client can revoke.
 */
import { describeIntegration, initSecuritySuite, providerChecksum } from './_world.js';

describeIntegration('C1 — attorney case assignment requires a client-created relationship', () => {
  const ctx = initSecuritySuite();
  let client, mallory, counsel, colleague, outsider, caseId, before;

  beforeAll(async () => {
    if (!ctx.app) return;
    before    = await providerChecksum(ctx.db);
    client    = await ctx.persona('Client');
    mallory   = await ctx.persona('Mallory', { attorney: true });
    counsel   = await ctx.persona('Counsel', { attorney: true });
    colleague = await ctx.persona('Colleague', { attorney: true });
    outsider  = await ctx.persona('OutsideAtty', { attorney: true });
    const cas = await ctx.makeCase(client, { title: `C1 case ${ctx.tag}` });
    caseId = cas.id;
    const m = await ctx.request().post(`/api/messages/${caseId}`).set(client.headers).send({ body: 'PRIVILEGED: I did it' });
    expect(m.status).toBe(200);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM case_assignments WHERE case_id = ?', [caseId]); });
  });


  it('ATTACK: unrelated attorney self-assign → 403, still cannot read or post', async () => {
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(mallory.headers)).status).toBe(403);
    const assign = await ctx.request().post(`/api/attorney/cases/${caseId}/assign`).set(mallory.headers).send({});
    expect(assign.status).toBe(403);
    expect(assign.body.error).toBe('no_client_relationship');
    const read = await ctx.request().get(`/api/messages/${caseId}`).set(mallory.headers);
    expect(read.status).toBe(403);
    expect(JSON.stringify(read.body)).not.toContain('I did it');
    const post = await ctx.request().post(`/api/messages/${caseId}`).set(mallory.headers)
      .send({ body: 'This is your attorney. Wire $5000 bail to…' });
    expect(post.status).toBe(403);
    const rows = await ctx.db.all('SELECT * FROM case_assignments WHERE case_id = ? AND defender_id = ?', [caseId, mallory.id]);
    expect(rows).toHaveLength(0);
  });

  it('ATTACK: assigning someone else / a colleague without being counsel → 403', async () => {
    const r = await ctx.request().post(`/api/attorney/cases/${caseId}/assign`).set(mallory.headers)
      .send({ defender_id: colleague.id });
    expect(r.status).toBe(403);
  });

  it('ATTACK: only the case owner can invite counsel (others get 404)', async () => {
    const r = await ctx.request().post(`/api/cases/${caseId}/counsel`).set(mallory.headers)
      .send({ attorney_user_id: mallory.id });
    expect(r.status).toBe(404);
    const list = await ctx.request().get(`/api/cases/${caseId}/counsel`).set(mallory.headers);
    expect(list.status).toBe(404);
  });

  it('LEGIT: client invites → attorney sees it pending → accepts in inbox → reads & replies as counsel', async () => {
    const inv = await ctx.request().post(`/api/cases/${caseId}/counsel`).set(client.headers)
      .send({ attorney_user_id: counsel.id, note: 'Please take my case' });
    expect(inv.status).toBe(201);
    expect(inv.body.status).toBe('pending');

    // pending is NOT access yet
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(counsel.headers)).status).toBe(403);

    const inbox = await ctx.request().get('/api/attorney/inbox').set(counsel.headers);
    expect(inbox.status).toBe(200);
    const pending = inbox.body.pending_assignments.find(a => Number(a.case_id) === Number(caseId));
    expect(pending).toBeTruthy();

    const acc = await ctx.request().post(`/api/attorney/inbox/accept/${pending.assignment_id}`).set(counsel.headers);
    expect(acc.status).toBe(200);

    const read = await ctx.request().get(`/api/messages/${caseId}`).set(counsel.headers);
    expect(read.status).toBe(200);
    expect(read.body.messages.some(m => m.body === 'PRIVILEGED: I did it')).toBe(true);
    const reply = await ctx.request().post(`/api/messages/${caseId}`).set(counsel.headers).send({ body: 'I will call you.' });
    expect(reply.status).toBe(200);
    expect(reply.body.message.sender_type).toBe('attorney');
  });

  it('LEGIT: active counsel may add a colleague from the same firm; an outsider may not be added', async () => {
    const firmId = await ctx.makeFirm(counsel, 'C1 Firm');
    await ctx.addToFirm(firmId, counsel, colleague, 'associate');
    const ok = await ctx.request().post(`/api/attorney/cases/${caseId}/assign`).set(counsel.headers)
      .send({ defender_id: colleague.id });
    expect(ok.status).toBe(201);
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(colleague.headers)).status).toBe(200);

    const no = await ctx.request().post(`/api/attorney/cases/${caseId}/assign`).set(counsel.headers)
      .send({ defender_id: outsider.id });
    expect(no.status).toBe(403);
    // the existing counsel assignment was not overwritten by the colleague assignment
    const rows = await ctx.db.all(`SELECT defender_id FROM case_assignments WHERE case_id = ? AND status = 'active'`, [caseId]);
    expect(rows.map(r => Number(r.defender_id)).sort()).toEqual([counsel.id, colleague.id].sort());
  });

  it('LEGIT: client revokes counsel → access ends immediately', async () => {
    const del = await ctx.request().delete(`/api/cases/${caseId}/counsel/${colleague.id}`).set(client.headers);
    expect(del.status).toBe(200);
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(colleague.headers)).status).toBe(403);
    // revoked counsel cannot re-activate by self-assigning
    expect((await ctx.request().post(`/api/attorney/cases/${caseId}/assign`).set(colleague.headers).send({})).status).toBe(403);
    // the other counsel is unaffected
    expect((await ctx.request().get(`/api/messages/${caseId}`).set(counsel.headers)).status).toBe(200);
  });

  it('LEGIT: a confirmed consultation between client and attorney allows self-assignment', async () => {
    const cas2 = await ctx.makeCase(client, { title: `C1 consult case ${ctx.tag}` });
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM case_assignments WHERE case_id = ?', [cas2.id]); });
    // no relationship yet
    expect((await ctx.request().post(`/api/attorney/cases/${cas2.id}/assign`).set(outsider.headers).send({})).status).toBe(403);
    // consultation bookings require payments (503 today) — insert the confirmed booking the
    // booking flow would create, keyed to the attorney's account id.
    await ctx.db.run(
      `INSERT INTO consultation_bookings (user_id, lawyer_id, date_slot, time_slot, status, lawyer_name)
       VALUES (?, ?, CURRENT_DATE + 1, '9:00 AM', 'confirmed', 'Outside Atty')`, [client.id, outsider.id]);
    const ok = await ctx.request().post(`/api/attorney/cases/${cas2.id}/assign`).set(outsider.headers).send({});
    expect(ok.status).toBe(201);
    expect((await ctx.request().get(`/api/messages/${cas2.id}`).set(outsider.headers)).status).toBe(200);
  });

  it('LEGIT: platform staff can assign; a non-attorney target is rejected', async () => {
    const staff = await ctx.persona('Staff', { attorney: true, role: 'admin' });
    const cas3 = await ctx.makeCase(client, { title: `C1 staff case ${ctx.tag}` });
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM case_assignments WHERE case_id = ?', [cas3.id]); });
    expect((await ctx.request().post(`/api/attorney/cases/${cas3.id}/assign`).set(staff.headers)
      .send({ defender_id: client.id })).status).toBe(400);
    expect((await ctx.request().post(`/api/attorney/cases/${cas3.id}/assign`).set(staff.headers)
      .send({ defender_id: counsel.id })).status).toBe(201);
  });

  it('verified lawyer / bail-agent rows are untouched by the whole suite', async () => {
    expect(await providerChecksum(ctx.db)).toEqual(before);
  });
});
