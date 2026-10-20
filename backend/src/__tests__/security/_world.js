/**
 * security/_world.js — personas and fixtures for the audit11 security suites.
 *
 * Every suite here drives the REAL app (src/app.js) over supertest against a
 * REAL migrated Postgres (TEST_DATABASE_URL) via the integration harness, so a
 * passing test proves the deployed code path, not a re-implementation.
 *
 * Personas are created through the real registration route; roles that cannot
 * be self-assigned (admin / super_admin, bar verification) are set directly in
 * the database exactly the way an operator would.
 *
 * Verified directory rows (lawyers / bail_agents) are never written. Suites
 * snapshot their checksums before and after (providerChecksum) to prove it.
 */
import { initSuite, describeIntegration, PG_URL } from '../integration/_harness.js';

export { describeIntegration, PG_URL };

export function initSecuritySuite(opts = {}) {
  const ctx = initSuite(opts);

  /** Register a persona. role/flags are applied in the DB after registration. */
  ctx.persona = async (name, { attorney = false, role = null, barVerified = false, ...extra } = {}) => {
    const u = await ctx.register({
      displayName: `${name} ${ctx.tag}`,
      ...(attorney ? { isAttorney: true, barNumber: `BPR${Math.floor(Math.random() * 1e6)}`, barState: 'TN' } : {}),
      ...extra,
    });
    if (role) await ctx.db.run('UPDATE users SET role = ? WHERE id = ?', [role, u.user.id]);
    if (barVerified) await ctx.db.run('UPDATE users SET bar_verified = 1 WHERE id = ?', [u.user.id]);
    u.id = u.user.id;
    u.name = name;
    return u;
  };

  /** Create a firm through the real route; the creator becomes firm_admin. */
  ctx.makeFirm = async (owner, name = 'Firm') => {
    const r = await ctx.request().post('/api/firms').set(owner.headers).send({ name: `${name} ${ctx.tag}` });
    if (r.status !== 201) throw new Error(`makeFirm ${r.status} ${JSON.stringify(r.body)}`);
    ctx._firms.push(r.body.id);
    return r.body.id;
  };

  /** Add an existing user to a firm with a role: the firm_admin invites, the member accepts (nobody is added without accepting). */
  ctx.addToFirm = async (firmId, admin, member, role = 'associate') => {
    const r = await ctx.request().post(`/api/firms/${firmId}/members/invite`).set(admin.headers)
      .send({ email: member.email, role });
    if (r.status !== 201) throw new Error(`addToFirm ${r.status} ${JSON.stringify(r.body)}`);
    const a = await ctx.request().post('/api/firms/accept-invite').set(member.headers).send({ token: r.body.token });
    if (a.status !== 200) throw new Error(`addToFirm accept ${a.status} ${JSON.stringify(a.body)}`);
    return { ...r.body, ...a.body };
  };

  ctx.makeMatter = async (user, fields = {}) => {
    const r = await ctx.request().post('/api/matters').set(user.headers)
      .send({ title: `Matter ${ctx.tag}`, client_name: 'John Smith', notes: 'Client admitted fraud', ...fields });
    if (r.status !== 201) throw new Error(`makeMatter ${r.status} ${JSON.stringify(r.body)}`);
    ctx._matters.push(r.body.id);
    return r.body;
  };

  ctx.makeCase = async (user, fields = {}) => {
    const r = await ctx.request().post('/api/cases').set(user.headers).send({ title: `Case ${ctx.tag}`, ...fields });
    if (r.status !== 201 && r.status !== 200) throw new Error(`makeCase ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  ctx._firms = [];
  ctx._matters = [];
  ctx.addCleanup(async (db) => {
    const purge = async (sql, p) => { try { await db.run(sql, p); } catch { /* table may not exist */ } };
    for (const id of ctx._matters) {
      await purge('DELETE FROM privilege_log WHERE matter_id = ?', [id]);
      await purge('DELETE FROM matter_team_members WHERE case_id = ?', [id]);
      await purge('DELETE FROM matter_teams WHERE matter_id = ?', [id]);
      await purge('DELETE FROM matter_events WHERE matter_id = ?', [id]);
      await purge('DELETE FROM matter_versions WHERE matter_id = ?', [id]);
      await purge('DELETE FROM docket_entries WHERE matter_id = ?', [id]);
      await purge('DELETE FROM matters WHERE id = ?', [id]);
    }
    for (const id of ctx._firms) {
      for (const t of ['privilege_log', 'webhook_subscriptions', 'invoices', 'time_entries', 'firm_invites',
        'ethics_wall_log', 'sso_configurations', 'audit_log', 'firm_members']) {
        await purge(`DELETE FROM ${t} WHERE firm_id = ?`, [id]);
      }
      await purge('DELETE FROM firms WHERE id = ?', [id]);
    }
  });
  return ctx;
}

/**
 * Checksum of the verified provider directory — must be identical before/after a suite.
 * Fixture rows (source_id marked JGTEST) are excluded so suites can run side by side.
 */
export { providerChecksum } from '../integration/_harness.js';

/** True when `needle` appears anywhere in the JSON body. */
export const leaks = (res, needle) => JSON.stringify(res.body ?? res.text ?? '').includes(needle);
