/**
 * audit11 C2 — lead contact details are revealed only after a COMPLETED
 * purchase. With payments unavailable (no Stripe key — the production state
 * today) every accept path returns 503 payments_unavailable and reveals
 * nothing; listings carry only non-identifying fields; only attorney (case) /
 * bail-agent (bail) accounts may browse at all.
 *
 * Section G: the legacy /api/pi-leads (civil_leads) routes are gone; case leads
 * are /api/billing/pi-lead(s) only, and a case lead's contact details come from
 * GET /api/billing/pi-leads/mine for the attorney whose purchase Stripe verified.
 */
import { describeIntegration, initSecuritySuite, leaks, providerChecksum } from './_world.js';

const VICTIM_PHONE = `+1713555${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
const VICTIM_NAME  = 'Maria Detained-Victim';

describeIntegration('C2 — leads never reveal contact details without a completed purchase', () => {
  const ctx = initSecuritySuite();
  let victim, scraper, attorney, verifiedAtty, bondsman, piLeadId, iceLeadId, before;

  beforeAll(async () => {
    if (!ctx.app) return;
    before       = await providerChecksum(ctx.db);
    victim       = await ctx.persona('Victim');
    await ctx.db.run('UPDATE users SET phone = ? WHERE id = ?', [VICTIM_PHONE, victim.id]);
    scraper      = await ctx.persona('Scraper');
    attorney     = await ctx.persona('LeadAtty', { attorney: true });
    verifiedAtty = await ctx.persona('VerifiedAtty', { attorney: true, barVerified: true });
    bondsman     = await ctx.persona('Bondsman', { accountType: 'bail_agent' });

    const pi = await ctx.request().post('/api/billing/pi-lead/submit').set(victim.headers).send({
      case_type: 'Civil Rights', description: `Officer beat me, my name is ${VICTIM_NAME} ${VICTIM_PHONE}`,
      severity: 'serious', city: 'Houston', state: 'TX',
    });
    expect(pi.status).toBe(201);
    piLeadId = pi.body.lead_id;
    expect(leaks(pi, VICTIM_PHONE)).toBe(false);
    const ice = await ctx.request().post('/api/billing/pi-lead/submit').set(victim.headers).send({
      case_type: 'ice_detention', description: `My husband was detained by ICE, call ${VICTIM_PHONE}`, city: 'Houston', state: 'TX',
    });
    expect(ice.status).toBe(201);
    iceLeadId = ice.body.lead_id;

    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM pi_leads WHERE id IN (?, ?)', [piLeadId, iceLeadId]);
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [bondsman.id]);
    });
  });

  it('ATTACK: a non-attorney cannot list case leads at all; the legacy civil-lead routes are gone', async () => {
    const r = await ctx.request().get('/api/billing/pi-leads').set(scraper.headers);
    expect(r.status).toBe(403);
    expect(leaks(r, VICTIM_PHONE)).toBe(false);
    expect((await ctx.request().get('/api/billing/pi-leads/mine').set(scraper.headers)).status).toBe(403);
    expect((await ctx.request().get('/api/pi-leads').set(attorney.headers)).status).toBe(404);
    expect((await ctx.request().post('/api/pi-leads/submit').set(victim.headers).send({})).status).toBe(404);
  });

  it('LEGIT: an attorney sees the lead, but only non-identifying fields and the flat fee', async () => {
    const r = await ctx.request().get('/api/billing/pi-leads?state=TX').set(attorney.headers);
    expect(r.status).toBe(200);
    const pl = r.body.find(l => Number(l.id) === Number(piLeadId));
    expect(pl).toBeTruthy();
    expect(pl.description ?? null).toBeNull();
    expect(pl.lead_fee_cents).toBe(20000);
    expect(r.body.find(l => Number(l.id) === Number(iceLeadId)).lead_fee_cents).toBe(7500);
    expect(leaks(r, VICTIM_PHONE)).toBe(false);
    expect(leaks(r, VICTIM_NAME)).toBe(false);
  });

  it('ATTACK: accept with payments unavailable → 503 payments_unavailable, nothing revealed or recorded', async () => {
    for (const who of [scraper, attorney, verifiedAtty]) {
      const r = await ctx.request().post(`/api/billing/pi-lead/accept/${piLeadId}`).set(who.headers).send({});
      expect([403, 503]).toContain(r.status);
      expect(leaks(r, VICTIM_PHONE)).toBe(false);
      expect(leaks(r, VICTIM_NAME)).toBe(false);
    }
    const b = await ctx.request().post(`/api/billing/pi-lead/accept/${piLeadId}`).set(verifiedAtty.headers).send({});
    expect(b.status).toBe(503);
    expect(b.body.error).toBe('payments_unavailable');
    const still = await ctx.db.get('SELECT status, accepted_by FROM pi_leads WHERE id = ?', [piLeadId]);
    expect(still.status).toBe('open');
    expect(still.accepted_by).toBeNull();
    expect((await ctx.request().get('/api/billing/pi-leads/mine').set(verifiedAtty.headers)).body.leads).toHaveLength(0);
  });

  it('ATTACK: a legacy "accepted" row without a verified payment does not unlock contact details', async () => {
    for (const piId of [null, 'pi_demo_123', 'pi_mock_1']) {
      await ctx.db.run(`UPDATE pi_leads SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), stripe_pi_id = ? WHERE id = ?`,
        [attorney.id, piId, iceLeadId]);
      const r = await ctx.request().get('/api/billing/pi-leads/mine').set(attorney.headers);
      expect(r.body.leads.find(l => Number(l.id) === Number(iceLeadId))).toBeUndefined();
      expect(leaks(r, VICTIM_PHONE)).toBe(false);
    }
    await ctx.db.run(`UPDATE pi_leads SET status = 'open', accepted_by = NULL, accepted_at = NULL, stripe_pi_id = NULL WHERE id = ?`, [iceLeadId]);
  });

  it('LEGIT: contact details ARE shown to the buyer after a verified purchase — and to nobody else', async () => {
    await ctx.db.run(`UPDATE pi_leads SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), stripe_pi_id = 'pi_3RealSucceededCharge' WHERE id = ?`,
      [verifiedAtty.id, iceLeadId]);
    const r = await ctx.request().get('/api/billing/pi-leads/mine').set(verifiedAtty.headers);
    const lead = r.body.leads.find(l => Number(l.id) === Number(iceLeadId));
    expect(lead.contact_phone).toBe(VICTIM_PHONE);
    for (const other of [attorney, scraper]) {
      const o = await ctx.request().get('/api/billing/pi-leads/mine').set(other.headers);
      expect(leaks(o, VICTIM_PHONE)).toBe(false);
    }
    const open = await ctx.request().get('/api/billing/pi-leads?state=TX').set(attorney.headers);
    expect(open.body.find(l => Number(l.id) === Number(iceLeadId))).toBeUndefined();   // sold: off the open list
  });

  it('bail leads: only bail agents may browse; names are initials; accept is 503 with nothing revealed', async () => {
    expect((await ctx.request().get('/api/billing/leads').set(scraper.headers)).status).toBe(403);
    expect((await ctx.request().post('/api/billing/bondsman/profile').set(scraper.headers)
      .send({ company_name: 'Scraper Bail', license_state: 'TX' })).status).toBe(403);
    const prof = await ctx.request().post('/api/billing/bondsman/profile').set(bondsman.headers)
      .send({ company_name: `${ctx.tag} Bail`, license_number: 'TX-1', license_state: 'TX', counties: ['Harris'], states: ['TX'] });
    expect(prof.status).toBe(200);
    const list = await ctx.request().get('/api/billing/leads?state=TN&hours=87600').set(bondsman.headers);
    expect(list.status).toBe(200);
    for (const l of list.body.leads) {
      if (!l.purchased) expect(l.name).toMatch(/^([A-Z]\.\s?){0,2}$|^Unnamed$/);
    }
    const acc = await ctx.request().post('/api/billing/leads/1/accept').set(bondsman.headers).send({});
    expect(acc.status).toBe(503);
    expect(acc.body.error).toBe('payments_unavailable');
    expect(acc.body.arrest).toBeUndefined();
  });

  it('verified lawyer / bail-agent rows are untouched by the whole suite', async () => {
    expect(await providerChecksum(ctx.db)).toEqual(before);
  });
});
