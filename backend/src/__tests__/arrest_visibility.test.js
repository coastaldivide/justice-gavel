/**
 * arrest_visibility.test.js — seeded sample arrest rows (source 'seed_v1' etc.)
 * must never reach users or automated jobs by default, and must come back
 * flagged `is_sample: true` only when SHOW_SAMPLE_ARRESTS=true.
 *
 * Part 1 (always runs): the central helper in utils/arrestVisibility.js.
 * Part 2 (needs Postgres): the REAL routers and services against a database
 *   with all supabase/migrations applied (so the 600 seed_v1 rows exist).
 *   Set TEST_DATABASE_URL to run it, e.g.
 *     TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/jg_ci npx jest arrest_visibility
 *   CI runs it against the migrated jg_ci database. Without TEST_DATABASE_URL
 *   it is skipped (the default jest run has no database).
 *
 * The integration part inserts its own rows (marked by a unique name prefix)
 * and deletes them afterwards. It never touches lawyers or bail_agents.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  isSampleSource, isSampleSql, realArrestSql, visibleArrestSql, sampleArrestsEnabled, isSampleColumnSql,
} from '../utils/arrestVisibility.js';
import { toPgPlaceholders } from '../db/index.js';

const ORIGINAL_TOGGLE = process.env.SHOW_SAMPLE_ARRESTS;
afterAll(() => {
  if (ORIGINAL_TOGGLE === undefined) delete process.env.SHOW_SAMPLE_ARRESTS;
  else process.env.SHOW_SAMPLE_ARRESTS = ORIGINAL_TOGGLE;
});

// ── Part 1: helper ────────────────────────────────────────────────────────────
describe('arrestVisibility helper', () => {
  afterEach(() => { delete process.env.SHOW_SAMPLE_ARRESTS; });

  it('classifies sample sources', () => {
    for (const s of ['seed_v1', 'SEED_V2', 'seed', 'sample', 'sample-data', 'demo', 'demo_2026', 'mock', 'fake_rows', 'test', 'test-fixture']) {
      expect(isSampleSource(s)).toBe(true);
    }
    for (const s of [null, undefined, '', 'county_roster', 'county_roster_json', 'judyrecords', 'seedling_county', 'testudo', 'tennessee_doc', 'demographics']) {
      expect(isSampleSource(s)).toBe(false);
    }
  });

  it('is OFF by default', () => {
    delete process.env.SHOW_SAMPLE_ARRESTS;
    expect(sampleArrestsEnabled()).toBe(false);
    expect(visibleArrestSql()).toBe(realArrestSql());
    for (const v of ['false', '0', 'yes', '1', '']) {
      process.env.SHOW_SAMPLE_ARRESTS = v;
      expect(sampleArrestsEnabled()).toBe(false);
    }
  });

  it('SHOW_SAMPLE_ARRESTS=true widens only the read-only filter', () => {
    const realBefore = realArrestSql('ar');
    process.env.SHOW_SAMPLE_ARRESTS = 'true';
    expect(sampleArrestsEnabled()).toBe(true);
    expect(visibleArrestSql('ar')).not.toMatch(/~\*/);           // samples allowed
    expect(visibleArrestSql('ar')).toMatch(/suppressed/);         // takedowns still hidden
    expect(realArrestSql('ar')).toBe(realBefore);                 // automated paths unchanged
    expect(realArrestSql('ar')).toMatch(/NOT .*ar\.source/);
  });

  it('the toggle is documented (Railway doc + config optional vars)', async () => {
    const fs = await import('fs');
    const doc = fs.readFileSync(new URL('../../../RAILWAY_ENV_SETUP.md', import.meta.url), 'utf8');
    expect(doc).toMatch(/SHOW_SAMPLE_ARRESTS=false/);
    const cfg = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
    expect(cfg).toMatch(/OPTIONAL_FEATURES = \{[\s\S]*SHOW_SAMPLE_ARRESTS:/);
  });

  it('fragments are placeholder-safe and alias-checked', () => {
    for (const frag of [isSampleSql(), realArrestSql('ar'), visibleArrestSql(), isSampleColumnSql('x')]) {
      expect(toPgPlaceholders(`SELECT 1 WHERE ${frag} AND id = ?`)).toMatch(/id = \$1$/);
    }
    expect(() => realArrestSql('ar; DROP TABLE x')).toThrow();
  });
});

// ── Part 2: real routes + services on Postgres ────────────────────────────────
const PG_URL = process.env.TEST_DATABASE_URL || '';
const describePg = PG_URL ? describe : describe.skip;

describePg('sample arrests on Postgres (real routes)', () => {
  const TAG = `ZZVisTest${Date.now()}`;
  // Tokens must belong to a REAL account: authorization reads the live users row
  // (audit11 H3), and the bondsman lead list requires a bondsman profile (C2).
  let viewerId = null;
  const tok = (id = viewerId, role = 'user') => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  let db; let app; const ids = {};
  let outbound; let alerts;

  beforeAll(async () => {
    process.env.DATABASE_URL = PG_URL;
    delete process.env.SHOW_SAMPLE_ARRESTS;
    // Payments disabled (the production default): no network calls to Stripe,
    // POST billing endpoints answer 503 payments_unavailable.
    delete process.env.STRIPE_SECRET; delete process.env.STRIPE_SECRET_KEY;
    ({ getDb: db } = await import('../db/index.js'));
    db = await db();
    const viewer = await db.get(
      `INSERT INTO users (email, display_name, role) VALUES (?, 'Visibility bondsman', 'user') RETURNING id`,
      [`${TAG.toLowerCase()}@vis.example.test`]);
    viewerId = Number(viewer.id);
    await db.run(`INSERT INTO bondsman_profiles (user_id, company_name) VALUES (?, 'Vis Bonds')`, [viewerId]);

    const ins = async (name, source, extra = {}) => {
      const r = await db.get(
        `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, has_attorney, county, state, source,
                                     alert_sent, created_at, jail_location, case_number, suppressed)
         VALUES (?, NOW(), 'DUI First Offense', ?, 0, 'Zedcounty', 'TN', ?, ?, NOW(), 'Zed Jail', ?, ?)
         RETURNING id`,
        [name, extra.bail ?? 250000, source, extra.alert_sent ?? 0, `${TAG}-${name}`, extra.suppressed ?? 0]
      );
      return Number(r.id);
    };
    ids.real       = await ins(`${TAG} Realperson`, 'county_roster', { alert_sent: 1 });
    ids.seed       = await ins(`${TAG} Seedperson`, 'seed_v1');
    ids.sample     = await ins(`${TAG} Sampleperson`, 'sample');
    ids.suppressed = await ins(`${TAG} Takendown`, 'county_roster', { alert_sent: 1, suppressed: 1 });

    const { default: arrestsRouter } = await import('../routes/arrests.js');
    const { default: billingRouter } = await import('../routes/billing/index.js');
    outbound = await import('../services/outbound_bot.js');
    alerts   = await import('../services/arrest_alerts.js');
    app = express();
    app.use(express.json());
    app.use('/api/arrests', arrestsRouter);
    app.use('/api/billing', billingRouter);
  });

  afterAll(async () => {
    if (!db) return;
    const all = Object.values(ids);
    await db.run(`DELETE FROM payment_links WHERE arrest_id = ANY(?::bigint[])`, [all]).catch(() => {});
    await db.run(`DELETE FROM outbound_messages WHERE arrest_id = ANY(?::bigint[])`, [all]).catch(() => {});
    await db.run(`DELETE FROM arrest_records WHERE name LIKE ?`, [`${TAG}%`]);
    if (viewerId) {
      await db.run('DELETE FROM lead_purchases WHERE bondsman_id = ?', [viewerId]).catch(() => {});
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [viewerId]).catch(() => {});
      await db.run('DELETE FROM users WHERE id = ?', [viewerId]).catch(() => {});
    }
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  afterEach(() => { delete process.env.SHOW_SAMPLE_ARRESTS; });

  const get = (path) => request(app).get(path).set('Authorization', `Bearer ${tok()}`);

  it('the migration seed rows are still in the database', async () => {
    const r = await db.get("SELECT COUNT(*)::int AS n FROM arrest_records WHERE source = 'seed_v1'");
    expect(r.n).toBeGreaterThanOrEqual(600);
  });

  describe('default (SHOW_SAMPLE_ARRESTS unset)', () => {
    it('/search returns only real rows, flagged is_sample:false', async () => {
      const r = await get(`/api/arrests/search?name=${TAG}&state=TN`);
      expect(r.status).toBe(200);
      expect(r.body.records.map(x => Number(x.id))).toEqual([ids.real]);
      expect(r.body.records[0].is_sample).toBe(false);
      expect(r.body.total).toBe(1);
      expect(r.body.sample_mode).toBe(false);
    });

    it('/search over the seeded counties returns no seed rows at all', async () => {
      for (const [county, state] of [['Harris', 'TX'], ['Hillsborough', 'FL'], ['Mecklenburg', 'NC'], ['Hamilton', 'TN']]) {
        const r = await get(`/api/arrests/search?county=${county}&state=${state}&limit=100`);
        expect(r.status).toBe(200);
        expect(r.body.records).toEqual([]);
        expect(r.body.total).toBe(0);
      }
    });

    it('/recent, /:id, warrant-check and county stats exclude samples', async () => {
      const recent = await get('/api/arrests/recent?county=Zedcounty&state=TN&hours=8760&limit=500');
      expect(recent.status).toBe(200);
      expect(recent.body.records.map(x => Number(x.id))).toEqual([ids.real]);

      const all = await get('/api/arrests/recent?hours=8760&state=TX&limit=500');
      expect(all.body.records.filter(x => x.source === 'seed_v1')).toEqual([]);

      expect((await get(`/api/arrests/${ids.seed}`)).status).toBe(404);
      expect((await get(`/api/arrests/${ids.sample}`)).status).toBe(404);
      expect((await get(`/api/arrests/${ids.suppressed}`)).status).toBe(404);
      const real = await get(`/api/arrests/${ids.real}`);
      expect(real.status).toBe(200);
      expect(real.body.is_sample).toBe(false);

      const stats = await get('/api/arrests/stats/county/Zedcounty?days=30');
      expect(Number(stats.body.total)).toBe(1);

      // warrant check: a seeded name never shows up as a "warrant"
      const seedFta = await db.get("SELECT name FROM arrest_records WHERE source='seed_v1' LIMIT 1");
      const w = await get(`/api/arrests/warrant-check?name=${encodeURIComponent(seedFta.name)}&state=`);
      expect(w.status).toBe(200);
      expect(w.body.active_warrants.every(x => x.is_sample === false)).toBe(true);
    });

    it('bondsman /billing/leads lists no samples and quotes the flat fee', async () => {
      const r = await get('/api/billing/leads?county=Zedcounty&state=TN&hours=48&limit=50');
      expect(r.status).toBe(200);
      expect(r.body.leads.map(x => Number(x.id))).toEqual([ids.real]);
      expect(r.body.leads[0].lead_fee_cents).toBe(10000);
      expect(r.body.leads[0].lead_fee_display).toBe('$100');
      expect(r.body.lead_fee).toMatchObject({ cents: 10000, model: 'flat' });
    });
  });

  describe('SHOW_SAMPLE_ARRESTS=true', () => {
    beforeEach(() => { process.env.SHOW_SAMPLE_ARRESTS = 'true'; });

    it('/search and /:id return samples flagged is_sample:true (takedowns stay hidden)', async () => {
      const r = await get(`/api/arrests/search?name=${TAG}&state=TN`);
      expect(r.status).toBe(200);
      expect(r.body.sample_mode).toBe(true);
      const byId = Object.fromEntries(r.body.records.map(x => [Number(x.id), x.is_sample]));
      expect(byId).toEqual({ [ids.real]: false, [ids.seed]: true, [ids.sample]: true });

      const seeded = await get('/api/arrests/search?county=Harris&state=TX&limit=5');
      expect(seeded.body.records.length).toBeGreaterThan(0);
      expect(seeded.body.records.every(x => x.is_sample === true)).toBe(true);

      const one = await get(`/api/arrests/${ids.seed}`);
      expect(one.status).toBe(200);
      expect(one.body.is_sample).toBe(true);
      expect((await get(`/api/arrests/${ids.suppressed}`)).status).toBe(404);
    });

    it('bondsman lead list shows samples flagged, but they can never be bought', async () => {
      const r = await get('/api/billing/leads?county=Zedcounty&state=TN&hours=48&limit=50');
      const flags = Object.fromEntries(r.body.leads.map(x => [Number(x.id), x.is_sample]));
      expect(flags).toEqual({ [ids.real]: false, [ids.seed]: true, [ids.sample]: true });

      const buy = await request(app).post(`/api/billing/leads/${ids.seed}/accept`)
        .set('Authorization', `Bearer ${tok()}`).send({});
      expect(buy.status).toBe(503);                       // payments stay disabled
      expect(buy.body.error).toBe('payments_unavailable');
      const sold = await db.get('SELECT COUNT(*)::int AS n FROM lead_purchases WHERE arrest_id = ?', [ids.seed]);
      expect(sold.n).toBe(0);
    });

    it('automated paths still ignore samples (bot, payment links, lead delivery, alerts)', async () => {
      const actionable = await outbound.selectActionableArrests(db);
      const actionableIds = actionable.map(a => Number(a.id));
      expect(actionableIds).not.toContain(ids.seed);
      expect(actionableIds).not.toContain(ids.sample);
      expect(actionable.filter(a => /seed/i.test(String(a.source || '')))).toEqual([]);

      expect(await outbound.getRealArrest(db, ids.seed)).toBeUndefined();
      expect(await outbound.sendPaymentLink({ phone: '+16155550100', arrestId: ids.seed, recipientType: 'bail_agent', recipientId: null }))
        .toEqual({ error: 'arrest_not_found' });
      expect(await outbound.deliverLead({ phone: '+16155550100', arrestId: ids.sample }))
        .toEqual({ error: 'arrest_not_found' });
      const links = await db.get('SELECT COUNT(*)::int AS n FROM payment_links WHERE arrest_id = ANY(?::bigint[])', [[ids.seed, ids.sample]]);
      expect(links.n).toBe(0);

      // Alerts: only run when no other real unsent arrests exist (so nobody real is emailed).
      const pending = await db.get(
        `SELECT COUNT(*)::int AS n FROM arrest_records
          WHERE alert_sent = 0 AND created_at >= NOW() - INTERVAL '24 hours' AND ${realArrestSql()}`);
      if (pending.n === 0) {
        const res = await alerts.sendArrestAlerts();
        // Step 6 added user-monitor checking to the same run, so the result
        // also reports monitors_checked / monitor_matches.
        expect(res).toMatchObject({ alerts_sent: 0, monitor_matches: 0 });
        const row = await db.get('SELECT alert_sent FROM arrest_records WHERE id = ?', [ids.seed]);
        expect(Number(row.alert_sent)).toBe(0);   // never processed
      }
    });
  });

  it('a real lead is quoted the flat fee whatever the bail amount', async () => {
    // bail on this row is $250,000 — the old bail-scaled table charged $300 for it.
    const res = await outbound.sendPaymentLink({ phone: '+16155550101', arrestId: ids.real, recipientType: 'bail_agent', recipientId: null });
    expect(res).toMatchObject({ success: true, feeCents: 10000, mock: true });   // mock link: no Stripe, nothing charged
    const msg = await db.get(
      "SELECT body FROM outbound_messages WHERE arrest_id = ? AND message_type = 'payment_link' ORDER BY id DESC LIMIT 1", [ids.real]);
    expect(msg?.body).toMatch(/Pay \$100 to unlock/);
  });
});
