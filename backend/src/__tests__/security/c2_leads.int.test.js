/**
 * audit11 C2 — lead contact details are revealed only after a COMPLETED
 * purchase. With payments unavailable (no Stripe key — the production state
 * today) every accept path returns 503 payments_unavailable and reveals
 * nothing; listings carry only non-identifying fields; only attorney (civil) /
 * bondsman (bail) accounts may browse at all.
 */
import { describeIntegration, initSecuritySuite, leaks, providerChecksum } from './_world.js';

const VICTIM_PHONE = '+17135550123';
const VICTIM_NAME  = 'Maria Detained-Victim';

describeIntegration('C2 — leads never reveal contact details without a completed purchase', () => {
  const ctx = initSecuritySuite();
  let victim, scraper, attorney, verifiedAtty, bondsman, leadId, piLeadId, before;

  beforeAll(async () => {
    if (!ctx.app) return;
    before       = await providerChecksum(ctx.db);
    victim       = await ctx.persona('Victim');
    scraper      = await ctx.persona('Scraper');
    attorney     = await ctx.persona('LeadAtty', { attorney: true });
    verifiedAtty = await ctx.persona('VerifiedAtty', { attorney: true, barVerified: true });
    bondsman     = await ctx.persona('Bondsman');

    const sub = await ctx.request().post('/api/pi-leads/submit').set(victim.headers).send({
      type: 'ice_detention', description: 'Detained by ICE',
      lead_type: 'ice_detention', city: 'Houston', state: 'TX', county: 'Harris',
      incident_type: 'ice_detention',
      incident_summary: `My husband was detained by ICE, he is undocumented, call ${VICTIM_PHONE}`,
      contact_name: VICTIM_NAME, contact_phone: VICTIM_PHONE, contact_email: `victim-${ctx.tag}@it.example.test`,
    });
    expect(sub.status).toBe(200);
    leadId = sub.body.lead_id;

    const pi = await ctx.request().post('/api/billing/pi-lead/submit').set(victim.headers).send({
      case_type: 'Civil Rights', description: `Officer beat me, my name is ${VICTIM_NAME} ${VICTIM_PHONE}`,
      severity: 'serious', city: 'Houston', state: 'TX',
    });
    expect(pi.status).toBe(201);
    piLeadId = pi.body.lead_id;
    expect(leaks(pi, VICTIM_PHONE)).toBe(false);

    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM civil_lead_purchases WHERE lead_id = ?', [leadId]);
      await db.run('DELETE FROM civil_leads WHERE id = ?', [leadId]);
      await db.run('DELETE FROM pi_leads WHERE id = ?', [piLeadId]);
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [bondsman.id]);
    });
  });

  it('ATTACK: a non-attorney cannot list civil leads at all', async () => {
    const r = await ctx.request().get('/api/pi-leads').set(scraper.headers);
    expect(r.status).toBe(403);
    expect(leaks(r, VICTIM_PHONE)).toBe(false);
    const r2 = await ctx.request().get('/api/billing/pi-leads').set(scraper.headers);
    expect(r2.status).toBe(403);
  });

  it('LEGIT: an attorney sees the lead, but only non-identifying fields', async () => {
    const r = await ctx.request().get('/api/pi-leads?state=TX').set(attorney.headers);
    expect(r.status).toBe(200);
    const lead = r.body.leads.find(l => Number(l.id) === Number(leadId));
    expect(lead).toMatchObject({ lead_type: 'ice_detention', city: 'Houston', state: 'TX', purchased: false });
    expect(lead.contact_phone).toBeNull();
    expect(lead.contact_name).toBeNull();
    expect(lead.incident_summary).toBeNull();
    expect(leaks(r, VICTIM_PHONE)).toBe(false);
    expect(leaks(r, VICTIM_NAME)).toBe(false);

    const r2 = await ctx.request().get('/api/billing/pi-leads?state=TX').set(attorney.headers);
    expect(r2.status).toBe(200);
    const pl = r2.body.find(l => Number(l.id) === Number(piLeadId));
    expect(pl).toBeTruthy();
    expect(pl.description).toBeNull();
    expect(leaks(r2, VICTIM_PHONE)).toBe(false);
  });

  it('ATTACK: accept with payments unavailable → 503 payments_unavailable, nothing revealed or recorded', async () => {
    for (const who of [scraper, attorney, verifiedAtty]) {
      const r = await ctx.request().post(`/api/pi-leads/${leadId}/accept`).set(who.headers).send({});
      expect([403, 503]).toContain(r.status);
      expect(leaks(r, VICTIM_PHONE)).toBe(false);
      expect(leaks(r, VICTIM_NAME)).toBe(false);
    }
    const v = await ctx.request().post(`/api/pi-leads/${leadId}/accept`).set(verifiedAtty.headers).send({});
    expect(v.status).toBe(503);
    expect(v.body.error).toBe('payments_unavailable');
    const rows = await ctx.db.all('SELECT * FROM civil_lead_purchases WHERE lead_id = ?', [leadId]);
    expect(rows).toHaveLength(0);

    const b = await ctx.request().post(`/api/billing/pi-lead/accept/${piLeadId}`).set(verifiedAtty.headers).send({});
    expect(b.status).toBe(503);
    expect(b.body.error).toBe('payments_unavailable');
    const still = await ctx.db.get('SELECT status, accepted_by FROM pi_leads WHERE id = ?', [piLeadId]);
    expect(still.status).toBe('open');
    expect(still.accepted_by).toBeNull();
  });

  it('ATTACK: a legacy unpaid "purchase" row does not unlock contact details', async () => {
    await ctx.db.run(
      `INSERT INTO civil_lead_purchases (attorney_id, lead_id, lead_fee_cents, status, stripe_pi_id, contact_revealed)
       VALUES (?, ?, 7500, 'charged', 'pi_civil_demo', 1)`, [attorney.id, leadId]);
    const r = await ctx.request().get('/api/pi-leads?state=TX').set(attorney.headers);
    const lead = r.body.leads.find(l => Number(l.id) === Number(leadId));
    expect(lead.purchased).toBe(false);
    expect(leaks(r, VICTIM_PHONE)).toBe(false);
    await ctx.db.run('DELETE FROM civil_lead_purchases WHERE lead_id = ?', [leadId]);
  });

  it('LEGIT: contact details ARE shown to an attorney after a completed (succeeded) purchase', async () => {
    await ctx.db.run(
      `INSERT INTO civil_lead_purchases (attorney_id, lead_id, lead_fee_cents, status, stripe_pi_id, contact_revealed)
       VALUES (?, ?, 7500, 'charged', 'pi_3RealSucceededCharge', 1)`, [verifiedAtty.id, leadId]);
    const r = await ctx.request().get('/api/pi-leads?state=TX').set(verifiedAtty.headers);
    const lead = r.body.leads.find(l => Number(l.id) === Number(leadId));
    expect(lead.purchased).toBe(true);
    expect(lead.contact_phone).toBe(VICTIM_PHONE);
    // …and still not to anyone else
    const other = await ctx.request().get('/api/pi-leads?state=TX').set(attorney.headers);
    expect(leaks(other, VICTIM_PHONE)).toBe(false);
  });

  it('bail leads: only bondsmen may browse; names are initials; accept is 503 with nothing revealed', async () => {
    expect((await ctx.request().get('/api/billing/leads').set(scraper.headers)).status).toBe(403);
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
