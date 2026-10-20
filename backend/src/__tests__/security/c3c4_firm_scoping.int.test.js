/**
 * audit11 C3 (matters), C4 (privilege log), H5 (firm finance), H6 (platform
 * revenue stats), M8 (ethics walls) — every firm-owned resource is scoped to
 * the caller's ACTIVE membership in THAT firm (middleware/rbac.js), and
 * platform stats are super_admin only. Each attack is paired with the
 * legitimate flow for the owning firm.
 */
import { describeIntegration, initSecuritySuite, leaks, providerChecksum } from './_world.js';

describeIntegration('C3/C4/H5/H6/M8 — firm and matter scoping', () => {
  const ctx = initSecuritySuite();
  let lawyerL, partnerP, assocA, eve, stranger, superAdmin, firmL, firmE, matter, privId, before;

  beforeAll(async () => {
    if (!ctx.app) return;
    before    = await providerChecksum(ctx.db);
    lawyerL   = await ctx.persona('LawyerL', { attorney: true });
    partnerP  = await ctx.persona('PartnerP', { attorney: true });
    assocA    = await ctx.persona('AssocA', { attorney: true });
    eve       = await ctx.persona('Eve', { attorney: true });
    stranger  = await ctx.persona('Stranger');
    superAdmin = await ctx.persona('Root', { role: 'super_admin' });

    firmL = await ctx.makeFirm(lawyerL, 'Firm L');
    await ctx.addToFirm(firmL, lawyerL, partnerP, 'partner');
    await ctx.addToFirm(firmL, lawyerL, assocA, 'associate');
    firmE = await ctx.makeFirm(eve, 'Firm Eve');            // Eve → firm_admin of HER firm

    matter = await ctx.makeMatter(lawyerL, { title: `Secret matter ${ctx.tag}`, notes: 'Client admitted fraud' });
    expect(Number(matter.firm_id)).toBe(firmL);

    const pe = await ctx.request().post('/api/privilege/entries').set(lawyerL.headers).send({
      matter_id: matter.id, description: 'Memo re client confession', privilege_basis: 'attorney_client', author: 'L',
    });
    expect(pe.status).toBe(200);
    privId = pe.body.id;

    // Some firm money to look at
    await ctx.db.run(`INSERT INTO invoices (firm_id, matter_id, invoice_number, client_name, amount_cents, total_cents, status)
                      VALUES (?, ?, ?, 'John Smith', 987654, 987654, 'paid')`, [firmL, matter.id, `INV-${ctx.tag}`]);
    await ctx.db.run(`INSERT INTO time_entries (firm_id, matter_id, user_id, entry_date, hours, duration_minutes, rate_cents, narrative)
                      VALUES (?, ?, ?, CURRENT_DATE, 3.5, 210, 45000, 'Prep cross of informant')`, [firmL, matter.id, lawyerL.id]);
  });

  // ── C3 matters ─────────────────────────────────────────────────────────────
  it('C3 ATTACK: another firm\'s admin cannot read, edit, delete or re-team the matter', async () => {
    const get = await ctx.request().get(`/api/matters/${matter.id}`).set(eve.headers);
    expect(get.status).toBe(404);
    expect(leaks(get, 'admitted fraud')).toBe(false);
    expect((await ctx.request().put(`/api/matters/${matter.id}`).set(eve.headers).send({ notes: 'tampered' })).status).toBe(404);
    expect((await ctx.request().post(`/api/matters/${matter.id}/team`).set(eve.headers).send({ user_id: eve.id, role: 'lead_attorney' })).status).toBe(404);
    expect((await ctx.request().patch(`/api/matters/${matter.id}/status`).set(eve.headers).send({ status: 'closed' })).status).toBe(404);
    expect((await ctx.request().post(`/api/matters/${matter.id}/hold`).set(eve.headers).send({ reason: 'x' })).status).toBe(404);
    expect((await ctx.request().get(`/api/matters/${matter.id}/history`).set(eve.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/matters/${matter.id}`).set(eve.headers)).status).toBe(404);
    for (const u of [stranger]) {
      expect((await ctx.request().get(`/api/matters/${matter.id}`).set(u.headers)).status).toBe(404);
    }
    const row = await ctx.db.get('SELECT notes, status FROM matters WHERE id = ?', [matter.id]);
    expect(row.notes).toBe('Client admitted fraud');
    expect(row.status).toBe('active');
  });

  it('C3 ATTACK: owning a CASE with the same numeric id grants nothing on the matter', async () => {
    // the old check treated "you own cases.id = :id" as lead access to matters.id = :id
    // Forward only: other suites share this database, and moving the sequence back re-issues case ids they still hold.
    await ctx.db.run(`SELECT setval(pg_get_serial_sequence('cases','id'), GREATEST((SELECT last_value FROM cases_id_seq), (SELECT MAX(id) FROM cases), ?))`, [matter.id - 1]).catch(() => {});
    const r = await ctx.request().get(`/api/matters/${matter.id}`).set(stranger.headers);
    expect(r.status).toBe(404);
  });

  it('C3 LEGIT: firm members with the right role keep working; associate not on the team is refused', async () => {
    const own = await ctx.request().get(`/api/matters/${matter.id}`).set(lawyerL.headers);
    expect(own.status).toBe(200);
    expect(own.body.notes).toBe('Client admitted fraud');
    // associate is in the firm but not on the matter team
    expect((await ctx.request().get(`/api/matters/${matter.id}`).set(assocA.headers)).status).toBe(403);
    // firm admin adds the associate; now readable & editable
    const add = await ctx.request().post(`/api/matters/${matter.id}/team`).set(lawyerL.headers).send({ user_id: assocA.id, role: 'associate' });
    expect(add.status).toBe(201);
    expect((await ctx.request().get(`/api/matters/${matter.id}`).set(assocA.headers)).status).toBe(200);
    expect((await ctx.request().put(`/api/matters/${matter.id}`).set(assocA.headers).send({ priority: 'high' })).status).toBe(200);
    // an associate cannot delete (partner+)
    expect((await ctx.request().delete(`/api/matters/${matter.id}`).set(assocA.headers)).status).toBe(403);
    // non-firm users can only be added with read-only roles
    expect((await ctx.request().post(`/api/matters/${matter.id}/team`).set(lawyerL.headers).send({ user_id: eve.id, role: 'associate' })).status).toBe(400);
  });

  it('C3 LEGIT: removing someone from the firm removes matter access', async () => {
    const rm = await ctx.request().delete(`/api/firms/${firmL}/members/${assocA.id}`).set(lawyerL.headers);
    expect(rm.status).toBe(200);
    expect((await ctx.request().get(`/api/matters/${matter.id}`).set(assocA.headers)).status).toBe(404);
    await ctx.addToFirm(firmL, lawyerL, assocA, 'associate');   // re-invite for later tests
  });

  // ── C4 privilege log ───────────────────────────────────────────────────────
  it('C4 ATTACK: outsiders cannot read, edit or delete privilege entries or the matter log', async () => {
    for (const u of [stranger, eve]) {
      const g = await ctx.request().get(`/api/privilege/entries/${privId}`).set(u.headers);
      expect(g.status).toBe(404);
      expect(leaks(g, 'client confession')).toBe(false);
      const m = await ctx.request().get(`/api/privilege/matter/${matter.id}`).set(u.headers);
      expect(m.status).toBe(404);
      expect(leaks(m, 'client confession')).toBe(false);
      expect((await ctx.request().get(`/api/privilege/matter/${matter.id}/csv`).set(u.headers)).status).toBe(404);
      expect((await ctx.request().put(`/api/privilege/entries/${privId}`).set(u.headers).send({ description: 'gone' })).status).toBe(404);
      expect((await ctx.request().delete(`/api/privilege/entries/${privId}`).set(u.headers)).status).toBe(404);
      const list = await ctx.request().get('/api/privilege/entries').set(u.headers);
      expect(leaks(list, 'client confession')).toBe(false);
    }
    // writing into another firm's matter is refused
    const w = await ctx.request().post('/api/privilege/entries').set(eve.headers).send({
      matter_id: matter.id, description: 'planted', privilege_basis: 'work_product' });
    expect(w.status).toBe(404);
    const row = await ctx.db.get('SELECT description FROM privilege_log WHERE id = ?', [privId]);
    expect(row.description).toBe('Memo re client confession');
  });

  it('C4 LEGIT: the firm reads, edits and reviews its own log', async () => {
    const g = await ctx.request().get(`/api/privilege/entries/${privId}`).set(lawyerL.headers);
    expect(g.status).toBe(200);
    const m = await ctx.request().get(`/api/privilege/matter/${matter.id}`).set(lawyerL.headers);
    expect(m.status).toBe(200);
    expect(m.body.entries.some(e => e.id === privId)).toBe(true);
    expect((await ctx.request().put(`/api/privilege/entries/${privId}`).set(lawyerL.headers).send({ author: 'L.' })).status).toBe(200);
    expect((await ctx.request().put(`/api/privilege/entries/${privId}/review`).set(partnerP.headers).send({})).status).toBe(404); // partner not on team
    await ctx.request().post(`/api/matters/${matter.id}/team`).set(lawyerL.headers).send({ user_id: partnerP.id, role: 'co_counsel' });
    expect((await ctx.request().put(`/api/privilege/entries/${privId}/review`).set(partnerP.headers).send({})).status).toBe(200);
  });

  // ── M8 ethics walls ────────────────────────────────────────────────────────
  it('M8 ATTACK: a partner of another firm cannot read or set ethics walls on this firm\'s matter', async () => {
    const otherPartner = await ctx.persona('OtherPartner', { attorney: true });
    await ctx.addToFirm(firmE, eve, otherPartner, 'partner');
    expect((await ctx.request().get(`/api/conflicts/ethics-wall/${matter.id}`).set(otherPartner.headers)).status).toBe(404);
    expect((await ctx.request().post(`/api/conflicts/ethics-wall/${matter.id}`).set(otherPartner.headers)
      .send({ user_id: assocA.id, reason: 'sabotage' })).status).toBe(404);
    expect((await ctx.request().delete(`/api/conflicts/ethics-wall/${matter.id}/${assocA.id}`).set(eve.headers)
      .send({ reason: 'x' })).status).toBe(404);
  });

  it('M8 LEGIT: the firm walls its own associate, who then loses matter access (no override)', async () => {
    await ctx.request().post(`/api/matters/${matter.id}/team`).set(lawyerL.headers).send({ user_id: assocA.id, role: 'associate' });
    expect((await ctx.request().get(`/api/matters/${matter.id}`).set(assocA.headers)).status).toBe(200);
    const w = await ctx.request().post(`/api/conflicts/ethics-wall/${matter.id}`).set(partnerP.headers)
      .send({ user_id: assocA.id, reason: 'Former employer adverse' });
    expect(w.status).toBe(200);
    const g = await ctx.request().get(`/api/matters/${matter.id}`).set(assocA.headers);
    expect(g.status).toBe(403);
    expect(g.body.code).toBe('ethics_wall');
    const list = await ctx.request().get(`/api/conflicts/ethics-wall/${matter.id}`).set(partnerP.headers);
    expect(list.status).toBe(200);
  });

  // ── H5 firm finance ────────────────────────────────────────────────────────
  it('H5 ATTACK: non-members (and other firms) cannot read invoice totals or time entries', async () => {
    for (const u of [stranger, eve]) {
      const a = await ctx.request().get(`/api/firms/${firmL}/invoice-summary`).set(u.headers);
      expect(a.status).toBe(404);
      expect(leaks(a, '9876')).toBe(false);
      const b = await ctx.request().get(`/api/firms/${firmL}/time-entries`).set(u.headers);
      expect(b.status).toBe(404);
      expect(leaks(b, 'informant')).toBe(false);
    }
    // an associate of the SAME firm is below the billing role
    expect((await ctx.request().get(`/api/firms/${firmL}/invoice-summary`).set(assocA.headers)).status).toBe(403);
  });

  it('H5 LEGIT: the firm\'s partner / admin read their own finance', async () => {
    const a = await ctx.request().get(`/api/firms/${firmL}/invoice-summary`).set(partnerP.headers);
    expect(a.status).toBe(200);
    expect(a.body.summary.paid).toBe(9877);
    const b = await ctx.request().get(`/api/firms/${firmL}/time-entries`).set(lawyerL.headers);
    expect(b.status).toBe(200);
    expect(b.body.entries.length).toBeGreaterThan(0);
  });

  // ── H6 platform stats ──────────────────────────────────────────────────────
  it('H6: platform revenue stats are super_admin only', async () => {
    for (const u of [stranger, lawyerL, eve]) {
      expect((await ctx.request().get('/api/billing/admin/stats').set(u.headers)).status).toBe(403);
    }
    const ok = await ctx.request().get('/api/billing/admin/stats').set(superAdmin.headers);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('subscriptions');
    expect((await ctx.request().get('/api/jobs/stats').set(stranger.headers)).status).toBe(403);
    expect((await ctx.request().get('/api/jobs/stats')).status).toBe(401);
    expect((await ctx.request().get('/api/jobs/stats').set(superAdmin.headers)).status).toBe(200);
  });

  it('firm membership routes: other firms\' members/audit/settings are not reachable', async () => {
    expect((await ctx.request().get(`/api/firms/${firmL}/members`).set(eve.headers)).status).toBe(404);
    expect((await ctx.request().get(`/api/firms/${firmL}/audit`).set(eve.headers)).status).toBe(404);
    expect((await ctx.request().put(`/api/firms/${firmL}`).set(eve.headers).send({ name: 'pwned' })).status).toBe(404);
    expect((await ctx.request().post(`/api/firms/${firmL}/members/invite`).set(eve.headers).send({ email: eve.email, role: 'partner' })).status).toBe(404);
    // and the owning firm's admin can
    const mem = await ctx.request().get(`/api/firms/${firmL}/members`).set(lawyerL.headers);
    expect(mem.status).toBe(200);
    expect(mem.body.members.length).toBeGreaterThanOrEqual(3);
    expect((await ctx.request().put(`/api/firms/${firmL}`).set(lawyerL.headers).send({ name: `Firm L2 ${ctx.tag}` })).status).toBe(200);
  });

  it('verified lawyer / bail-agent rows are untouched by the whole suite', async () => {
    expect(await providerChecksum(ctx.db)).toEqual(before);
  });
});
