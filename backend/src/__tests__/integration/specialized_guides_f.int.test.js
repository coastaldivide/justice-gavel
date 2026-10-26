/**
 * specialized_guides_f.int.test.js — section F (specialized legal guides) on real
 * Postgres with the migrations' real data.
 *
 *  expungement  the check needs a real state (no silent TN default), "still open"
 *               is not treated as closed, an unrecognised charge is "unknown" (not a
 *               misdemeanor verdict), a verdict only comes with the statute the rule
 *               names, rules that contradict themselves give no verdict; every one of
 *               the 50 states + DC answers for every status / charge type; attorneys
 *               are the state's own listings; /eligibility never 500s.
 *  hague        countries and authorities come from the stored tables with their
 *               source; unknown country 404; intake validates and is owner-only.
 *  legaldata    specialty-court text is served translated only while the English
 *               it was translated from is unchanged.
 *  insurance    the fake quote endpoints are gone.
 *  immigration  bad dates are 400, not 500.
 */
import { describeIntegration, initSuite } from './_harness.js';

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

describeIntegration('section F: specialized legal guides (real Postgres)', () => {
  const ctx = initSuite();
  let u, other;

  beforeAll(async () => {
    if (!ctx.app) return;
    u = await ctx.register({ displayName: 'Fran F' });
    other = await ctx.register({ displayName: 'Other F' });
    ctx.addCleanup(async (db) => {
      await db.run(`DELETE FROM hague_intakes WHERE user_id IN (?, ?)`, [u.user.id, other.user.id]).catch(() => {});
      await db.run(`DELETE FROM cases WHERE user_id IN (?, ?)`, [u.user.id, other.user.id]).catch(() => {});
    });
  });

  // Public routes are IP rate limited: give every request its own address.
  let ipN = 0;
  const ip = () => `10.66.${(++ipN >> 8) & 255}.${ipN & 255}`;
  const get = (p) => ctx.request().get(p).set('X-Forwarded-For', ip());
  const post = (p) => ctx.request().post(p).set('X-Forwarded-For', ip());
  const check = (q, lang = 'en') => get(`/api/expungement/check?${q}`).set('Accept-Language', lang);

  // ── expungement ───────────────────────────────────────────────────────────
  it('needs a real state: no state / ZZ → 400 in the request language (was a silent Tennessee answer)', async () => {
    const none = await check('');
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('invalid_state');
    const zz = await check('state=ZZ', 'es');
    expect(zz.status).toBe(400);
    expect(zz.body.error).toMatch(/estados/);
    expect((await check('state=TN&status=whatever')).body.code).toBe('invalid_status');
    expect((await check('state=TN&type=whatever')).body.code).toBe('invalid_type');
  });

  it('a case that is still open gets no eligibility answer (it used to be checked as closed)', async () => {
    const r = await check('state=CA&status=Still%20open&charges=theft');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('Open');
    expect(r.body.eligibility.result).toBe('case_open');
    expect(r.body.eligibility.waitYears).toBeNull();
  });

  it('"Other / not sure" or "theft" is unknown, not a misdemeanor verdict', async () => {
    for (const c of ['Other%20%2F%20Not%20sure', 'Theft%20%2F%20Shoplifting', 'Assault']) {
      const r = await check(`state=CA&status=Convicted&charges=${c}`);
      expect(r.body.chargeType).toBe('unknown');
      expect(r.body.eligibility.result).toBe('unknown');
      expect(r.body.eligibility.likely).toBe(false);
    }
  });

  it('a verdict comes with the checked citation; a rule that could not be checked gives no verdict (Oct 2026 review)', async () => {
    const tn = await check('state=TN&status=Convicted&type=misdemeanor');
    expect(tn.body.eligibility.result).toBe('eligible');
    expect(tn.body.source.citation).toMatch(/^Tenn\. Code Ann\. § 40-32-107/);   // renumbered from § 40-32-101
    expect(tn.body.source.reviewed).toBe(false);
    expect(tn.body.eligibility.waitYears).toBe(5);
    const dv = await check('state=TN&status=Convicted&type=domestic');   // domestic assault is on the never-eligible list
    expect(dv.body.eligibility.result).toBe('not_eligible');
    expect(dv.body.eligibility.waitYears).toBeNull();
    expect(dv.body.source.citation).toMatch(/39-13-111/);
    const tx = await check('state=TX&status=Dismissed');               // ch. 55A: wait from arrest (was a contradiction)
    expect(tx.body.eligibility.result).toBe('eligible');
    expect(tx.body.eligibility.waitYears).toBe(1);
    const wi = await check('state=WI&status=Convicted&type=dui');      // could not be checked → no verdict
    expect(wi.body.eligibility.result).toBe('unsourced');
    expect(wi.body.eligibility.waitYears).toBeNull();
  });

  it('answers for all 50 states + DC × every status and charge type, in English and Spanish', async () => {
    const seen = new Set();
    for (const st of STATES) {
      for (const q of ['status=Dismissed', 'status=Open', ...['misdemeanor', 'felony', 'dui', 'domestic', 'sexual', 'unknown'].map(t => `status=Convicted&type=${t}`)]) {
        const r = await check(`state=${st}&${q}`, st === 'NY' ? 'es' : 'en');
        expect(r.status).toBe(200);
        const e = r.body.eligibility;
        seen.add(e.result);
        if (['eligible', 'conditional', 'not_eligible'].includes(e.result)) expect(r.body.source.citation).toBeTruthy();
        if (e.waitYears != null) expect(r.body.source.citation).toBeTruthy();
      }
    }
    expect([...seen].sort()).toEqual(['case_open', 'conditional', 'eligible', 'not_eligible', 'unknown', 'unsourced']);   // no contradictions left (Oct 2026)
  }, 60000);

  it('attorneys are listings from the asked state only (CA used to match "Chicago" by city LIKE)', async () => {
    const r = await get('/api/expungement/attorneys?state=CA&limit=5');
    expect(r.status).toBe(200);
    expect(r.body.attorneys.length).toBeGreaterThan(0);
    for (const a of r.body.attorneys) expect(a.state).toBe('CA');
    expect(r.body.attorneys[0]).toHaveProperty('phone');
    expect(r.body.attorneys[0]).not.toHaveProperty('email');
    expect((await get('/api/expungement/attorneys?state=XX')).status).toBe(400);
  });

  it('/eligibility never 500s: a string charge, a bad date', async () => {
    const s = await post('/api/expungement/eligibility').set(u.headers).send({ state: 'TN', charges: 'x' });
    expect(s.status).toBe(200);
    expect(s.body.results[0].charge_type).toBe('unknown');
    const d = await post('/api/expungement/eligibility').set(u.headers).send({ state: 'TN', conviction_date: 'garbage', charges: [{ charge_type: 'misdemeanor' }] });
    expect(d.status).toBe(400);
  });

  // ── hague ─────────────────────────────────────────────────────────────────
  it('countries and authorities come from stored data with their source (public)', async () => {
    const m = await get('/api/hague-contacts/member-states');
    expect(m.status).toBe(200);
    expect(m.body.member_states.length).toBeGreaterThanOrEqual(27);
    for (const c of m.body.member_states) {
      expect(c.source.label).toBeTruthy();
      expect(c.source.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const gb = await get('/api/hague-contacts/central-authority/gb').set('Accept-Language', 'pt');
    expect(gb.status).toBe(200);
    expect(gb.body.central_authority.website).toMatch(/^https:\/\//);
    expect(gb.body.note).toMatch(/Convenção/);
    expect(gb.body.source.last_verified_at).toBe('2026-10-26');   // checked against HCCH in the Oct 2026 review
    const us = await get('/api/hague-contacts/us-resources');
    expect(us.body.central_authority.central_authority.emergency_phone).toBe('+1-888-407-4747');
    expect(us.body.resources.map(r => r.key)).toEqual(['oci_application', 'ncmec', 'fbi', 'interpol']);
    expect((await get('/api/hague-contacts/central-authority/ZZ')).status).toBe(404);
    expect((await get('/api/hague-contacts/central-authority/USA')).status).toBe(400);
  });

  it('intake: validated (no 500), owner-only, upserts one row per case', async () => {
    const c = await post('/api/cases').set(u.headers).send({ title: `Hague ${ctx.tag}`, state: 'TN' });
    const caseId = c.body.id || c.body.case?.id;
    expect(caseId).toBeTruthy();
    const body = { caseId, countryCode: 'MX', childName: 'A. Child', childAge: 7, abductionDate: '2026-09-01', notes: 'x' };
    expect((await post('/api/hague-contacts/report-intake').set(u.headers).send({ ...body, caseId: 'abc' })).status).toBe(400);
    expect((await post('/api/hague-contacts/report-intake').set(u.headers).send({ ...body, countryCode: 123 })).status).toBe(400);
    expect((await post('/api/hague-contacts/report-intake').set(u.headers).send({ ...body, abductionDate: '2026-02-30' })).status).toBe(400);
    expect((await post('/api/hague-contacts/report-intake').set(u.headers).send({ ...body, childAge: 40 })).status).toBe(400);
    expect((await post('/api/hague-contacts/report-intake').set(other.headers).send(body)).status).toBe(404);
    expect((await post('/api/hague-contacts/report-intake').send(body)).status).toBe(401);
    const ok = await post('/api/hague-contacts/report-intake').set(u.headers).set('Accept-Language', 'vi').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.next_steps.length).toBe(5);
    expect(ok.body.next_steps[0]).toMatch(/\+1-888-407-4747/);
    expect(ok.body.next_steps_reviewed).toBe(false);
    await post('/api/hague-contacts/report-intake').set(u.headers).send({ ...body, countryCode: 'IN' });
    const rows = await ctx.db.all('SELECT country_code FROM hague_intakes WHERE case_id = ? AND user_id = ?', [String(caseId), u.user.id]);
    expect(rows.map(r => r.country_code)).toEqual(['IN']);
    const mine = await get(`/api/hague-contacts/intake/${caseId}`).set(u.headers);
    expect(mine.body.intake.child_name).toBe('A. Child');
    expect((await get(`/api/hague-contacts/intake/${caseId}`).set(other.headers)).status).toBe(404);
  });

  // ── legaldata translations ────────────────────────────────────────────────
  it('specialty courts: translated while the English is unchanged, English (labelled) after an edit', async () => {
    // Oct 2026 review: unverified specialty-court rows are withheld by default; mark row 1 checked for this test.
    await ctx.db.run(`UPDATE specialty_courts SET source_url = 'https://www.nashville.gov/departments/courts', verified_by = 'Source-checked 2026-10-26 (test)' WHERE id = 1`);
    const withheld = await get('/api/legaldata/specialty-courts?state=CA');
    expect(withheld.body.data).toEqual([]);
    expect(withheld.body.meta.withheld).toBeGreaterThan(0);
    const vi = await get('/api/legaldata/specialty-courts?state=TN').set('Accept-Language', 'vi');
    const row = vi.body.data.find(r => r.id === 1);
    expect(row.text_lang).toBe('vi');
    expect(row.eligibility).toMatch(/cựu chiến binh/i);
    const en = await get('/api/legaldata/specialty-courts?state=TN');
    expect(en.body.data.find(r => r.id === 1).text_lang).toBe('en');
    const before = await ctx.db.get('SELECT eligibility FROM specialty_courts WHERE id = 1');
    await ctx.db.run('UPDATE specialty_courts SET eligibility = ? WHERE id = 1', [`${before.eligibility} (edited)`]);
    try {
      const again = await get('/api/legaldata/specialty-courts?state=TN&lang=vi');
      const r1 = again.body.data.find(r => r.id === 1);
      expect(r1.eligibility).toMatch(/\(edited\)$/);                   // stale translation not served
    } finally {
      await ctx.db.run('UPDATE specialty_courts SET eligibility = ? WHERE id = 1', [before.eligibility]);
    }
  });

  // ── removed / validated ───────────────────────────────────────────────────
  it('the fake insurance quote is gone; immigration calculators answer 400 to bad dates', async () => {
    expect((await post('/api/insurance/quote').set(u.headers).send({})).status).toBe(404);
    expect((await get('/api/insurance/plans')).status).toBe(404);
    expect((await post('/api/immigration/asylum-clock').set(u.headers).send({ filing_date: 'garbage' })).status).toBe(400);
    expect((await post('/api/immigration/voluntary-departure').set(u.headers).send({ grant_date: '2026-10-01', days_granted: 'x' })).status).toBe(400);
  });
});
