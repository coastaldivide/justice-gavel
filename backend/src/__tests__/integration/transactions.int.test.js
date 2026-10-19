/**
 * transactions.int.test.js — checklist item 18: multi-step writes are all or
 * nothing. A failure injected into the SECOND statement (a temporary trigger
 * scoped to this suite's tag) must leave no half-written rows behind.
 *
 * Before: POST /api/firms inserted the firm, then the creator's membership,
 * then users.firm_id as three separate statements — a failure after the first
 * left a firm nobody administers; POST /api/matters could leave a matter with
 * no team; DELETE /api/matters/:id could delete the team and events and then
 * fail on the matter.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('multi-step writes are transactional (real Postgres)', () => {
  const ctx = initSuite();
  let atty;
  const fn = () => `jg_fail_${ctx.tag}`;

  beforeAll(async () => {
    if (!ctx.app) return;
    atty = await ctx.register({ displayName: 'Tx Attorney' });
    ctx.addCleanup(async (db) => {
      for (const [t, trg] of [['firm_members', 'trg_fail_fm'], ['matter_teams', 'trg_fail_mt'], ['matters', 'trg_fail_m']]) {
        await db.run(`DROP TRIGGER IF EXISTS ${trg}_${ctx.tag} ON ${t}`).catch(() => {});
      }
      await db.run(`DROP FUNCTION IF EXISTS ${fn()}()`).catch(() => {});
      await db.run('DELETE FROM matter_teams WHERE matter_id IN (SELECT id FROM matters WHERE title LIKE ?)', [`${ctx.tag}%`]).catch(() => {});
      await db.run('DELETE FROM matters WHERE title LIKE ?', [`${ctx.tag}%`]).catch(() => {});
    });
  });

  async function failOn(table, trg, op = 'INSERT') {
    await ctx.db.run(`CREATE OR REPLACE FUNCTION ${fn()}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
    await ctx.db.run(`CREATE TRIGGER ${trg}_${ctx.tag} BEFORE ${op} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn()}()`);
    return () => ctx.db.run(`DROP TRIGGER IF EXISTS ${trg}_${ctx.tag} ON ${table}`);
  }

  it('POST /api/firms: membership insert fails → no firm row, user.firm_id unchanged', async () => {
    const name = `${ctx.tag} Rollback Firm`;
    const drop = await failOn('firm_members', 'trg_fail_fm');
    try {
      const r = await ctx.request().post('/api/firms').set(atty.headers).send({ name });
      expect(r.status).toBeGreaterThanOrEqual(500);
    } finally { await drop(); }
    expect(await ctx.db.get('SELECT id FROM firms WHERE name = ?', [name])).toBeUndefined();
    const u = await ctx.db.get('SELECT firm_id FROM users WHERE id = ?', [atty.user.id]);
    expect(u.firm_id).toBeNull();
  });

  it('POST /api/matters: team insert fails → no matter row', async () => {
    const title = `${ctx.tag} rollback matter`;
    const drop = await failOn('matter_teams', 'trg_fail_mt');
    try {
      const r = await ctx.request().post('/api/matters').set(atty.headers).send({ title, matter_type: 'criminal', client_name: 'Test Client' });
      expect(r.status).toBeGreaterThanOrEqual(500);
    } finally { await drop(); }
    expect(await ctx.db.get('SELECT id FROM matters WHERE title = ?', [title])).toBeUndefined();
  });

  it('DELETE /api/matters/:id: final delete fails → team rows are still there', async () => {
    const title = `${ctx.tag} keep matter`;
    const created = await ctx.request().post('/api/matters').set(atty.headers).send({ title, matter_type: 'criminal', client_name: 'Test Client' });
    expect(created.status).toBe(201);
    const id = created.body.id ?? created.body.matter?.id;
    const drop = await failOn('matters', 'trg_fail_m', 'DELETE');
    try {
      const r = await ctx.request().delete(`/api/matters/${id}`).set(atty.headers);
      expect(r.status).toBeGreaterThanOrEqual(500);
    } finally { await drop(); }
    expect(await ctx.db.get('SELECT id FROM matters WHERE id = ?', [id])).toBeDefined();
    const team = await ctx.db.get('SELECT COUNT(*) AS n FROM matter_teams WHERE matter_id = ?', [id]);
    expect(Number(team.n)).toBe(1);
  });
});
