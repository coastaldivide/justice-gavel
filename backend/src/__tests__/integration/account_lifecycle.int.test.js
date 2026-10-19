/**
 * account_lifecycle.int.test.js — checklist items 21/22 (export + delete, no
 * orphans) against the real app and the real migrated schema.
 *
 *  1. Every column in the schema that holds a users.id is classified in
 *     services/accountDeletion.js USER_REFS (a new table can't be forgotten).
 *  2. DELETE /api/auth/account leaves NO row anywhere that still points at the
 *     deleted user or at one of their deleted cases; other people's records
 *     survive de-linked; a firm with other members is handed over instead of
 *     being deleted; provider directory rows are byte-identical.
 *  3. GET /api/auth/export returns the same data the deletion removes:
 *     chat history, arrest monitors, family contacts, decrypted case notes —
 *     and never a password hash or token.
 *
 * Before this change, deletion purged a hand-written list of 16 tables:
 * chat history, arrest monitors, family contacts, reminders' case links …
 * survived the "permanent" delete, and deleting a firm owner deleted the whole
 * firm for every other member.
 */
import { describeIntegration, initSuite } from './_harness.js';
import { USER_REFS, CASE_CHILDREN } from '../../services/accountDeletion.js';

const USER_COL_SQL = `
  SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    JOIN information_schema.tables tb USING (table_schema, table_name)
   WHERE tb.table_type = 'BASE TABLE' AND c.table_schema = 'public'
     AND c.data_type IN ('bigint', 'integer')
     AND (c.column_name ~ '(_by|_by_id|user_id|_user)$'
          OR c.column_name ~ '^(sender|recipient|uploader|owner|attorney|client|bondsman|defender|participant|author|member|assigned_attorney|actor|follower|reporter|buyer|purchaser|staff|admin|agent|signer|reviewer|approver|assignee|assigned_to)(_id)?$')
  UNION
  SELECT cl.relname, a.attname
    FROM pg_constraint k
    JOIN pg_class cl ON cl.oid = k.conrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
   WHERE k.contype = 'f' AND k.confrelid = 'public.users'::regclass`;

const PROVIDER_MD5 = `
  SELECT (SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM lawyers t) AS l,
         (SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM bail_agents t) AS b`;

describeIntegration('account export + deletion (real Postgres)', () => {
  const ctx = initSuite();

  it('every user-referencing column in the schema is classified (no table can be forgotten)', async () => {
    const cols = (await ctx.db.all(USER_COL_SQL)).map(r => `${r.t}.${r.c}`)
      .filter(ref => ref !== 'users.id');
    const unclassified = cols.filter(ref => !(ref in USER_REFS));
    expect(unclassified).toEqual([]);
    // …and the registry names only real columns (no stale entries).
    const real = new Set(cols);
    const stale = Object.keys(USER_REFS).filter(ref => !real.has(ref));
    expect(stale).toEqual([]);
    // every case_id table is classified too
    const caseTables = (await ctx.db.all(
      `SELECT c.table_name AS t FROM information_schema.columns c
         JOIN information_schema.tables tb USING (table_schema, table_name)
        WHERE tb.table_type = 'BASE TABLE' AND c.table_schema = 'public' AND c.column_name = 'case_id'`)).map(r => r.t);
    expect(caseTables.filter(t => !(t in CASE_CHILDREN))).toEqual([]);
  });

  it('deleting an account leaves no orphans, keeps others\' data, hands over the firm, and never touches providers', async () => {
    const before = await ctx.db.get(PROVIDER_MD5);
    const victim = await ctx.register({ displayName: 'Leaving User' });
    const colleague = await ctx.register({ displayName: 'Firm Colleague' });
    const uid = victim.user.id;

    // Data created through the real routes the app calls
    const cas = await ctx.request().post('/api/cases').set(victim.headers)
      .send({ title: `${ctx.tag} my case`, next_court_date: '2031-05-06', notes: 'private notes' });
    expect(cas.status).toBe(201);
    const caseId = cas.body.id;
    expect((await ctx.request().post(`/api/messages/${caseId}`).set(victim.headers).send({ body: 'hello' })).status).toBeLessThan(300);
    expect((await ctx.request().post(`/api/cases/${caseId}/events`).set(victim.headers)
      .send({ event_type: 'note', title: 'Bail posted', event_date: '2031-01-01' })).status).toBeLessThan(300);
    expect((await ctx.request().post('/api/saved/lawyers').set(victim.headers).send({ name: 'Saved Counsel', phone: '6155550100' })).status).toBe(201);
    expect((await ctx.request().post('/api/feedback').set(victim.headers).send({ rating: 5, comment: 'great' })).status).toBe(201);
    const firm = await ctx.request().post('/api/firms').set(victim.headers).send({ name: `${ctx.tag} Firm` });
    expect(firm.status).toBe(201);
    const firmId = firm.body.id;
    await ctx.db.run(`INSERT INTO firm_members (firm_id, user_id, firm_role, role, invited_by) VALUES (?,?,?,?,?)`,
      [firmId, colleague.user.id, 'associate', 'associate', uid]);
    // Rows the app writes from other flows (chat, monitors, contacts, AI ledger)
    await ctx.db.run(`INSERT INTO chat_sessions (session_id, role, content, user_id) VALUES (?,?,?,?)`, [`${ctx.tag}-s`, 'user', 'was I arrested legally?', uid]);
    await ctx.db.run(`INSERT INTO arrest_monitors (user_id, watch_name, name, county, state, active) VALUES (?,?,?,?,?,1)`, [uid, 'Jo Doe', 'Jo Doe', 'Davidson', 'TN']);
    await ctx.db.run(`INSERT INTO family_contacts (user_id, name, phone) VALUES (?,?,?)`, [uid, 'Mom', '6155550101']);
    await ctx.db.run(`INSERT INTO ai_usage_log (user_id, route, model, cost_usd) VALUES (?,?,?,?)`, [uid, 'chat', 'claude-sonnet-4-6', 0.01]);
    const reminders = await ctx.db.get('SELECT COUNT(*) AS n FROM scheduled_pushes WHERE case_id = ?', [caseId]);
    expect(Number(reminders.n)).toBeGreaterThan(0);

    // Export (before deleting) covers the same data, decrypted, with no secrets
    const exp = await ctx.request().get('/api/auth/export').set(victim.headers);
    expect(exp.status).toBe(200);
    const t = exp.body.data.tables;
    expect(exp.body.data.profile.id).toBe(uid);
    expect(exp.body.data.cases.find(c => c.id === caseId).notes).toBe('private notes');
    expect(t.chat_sessions.map(r => r.content)).toContain('was I arrested legally?');
    expect(t.arrest_monitors[0].watch_name).toBe('Jo Doe');
    expect(t.family_contacts[0].name).toBe('Mom');
    expect(t.case_messages.map(m => m.body)).toContain('hello');
    const blob = JSON.stringify(exp.body);
    expect(blob).not.toMatch(/\$2[aby]\$\d\d\$/);          // no bcrypt hash
    expect(t.refresh_tokens).toBeUndefined();
    expect((await ctx.request().get('/api/auth/data/export').set(victim.headers)).status).toBe(200);

    // Delete through the real route
    const del = await ctx.request().delete('/api/auth/account').set(victim.headers).send({ password: victim.password });
    expect(del.status).toBe(200);

    // 1. nothing anywhere still references the user
    const leftovers = [];
    for (const [ref, action] of Object.entries(USER_REFS)) {
      if (action === 'retain') continue;
      const [tb, col] = ref.split('.');
      const r = await ctx.db.get(`SELECT COUNT(*) AS n FROM "${tb}" WHERE "${col}" = ?`, [uid]);
      if (Number(r.n)) leftovers.push(`${ref}=${r.n}`);
    }
    expect(leftovers).toEqual([]);
    // 2. nothing points at the deleted case
    const caseLeft = [];
    for (const tb of Object.keys(CASE_CHILDREN)) {
      const r = await ctx.db.get(`SELECT COUNT(*) AS n FROM "${tb}" WHERE case_id::text = ?`, [String(caseId)]);
      if (Number(r.n)) caseLeft.push(`${tb}=${r.n}`);
    }
    expect(caseLeft).toEqual([]);
    expect(await ctx.db.get('SELECT id FROM users WHERE id = ?', [uid])).toBeUndefined();
    // 3. other people's data survives, de-linked
    const fb = await ctx.db.get(`SELECT user_id FROM feedback WHERE comment = 'great' ORDER BY id DESC LIMIT 1`);
    expect(fb).toBeDefined();
    expect(fb.user_id).toBeNull();
    // 4. the firm passes to the remaining member (now firm_admin), not deleted
    const f = await ctx.db.get('SELECT owner_id FROM firms WHERE id = ?', [firmId]);
    expect(Number(f.owner_id)).toBe(colleague.user.id);
    const m = await ctx.db.get('SELECT firm_role FROM firm_members WHERE firm_id = ? AND user_id = ?', [firmId, colleague.user.id]);
    expect(m.firm_role).toBe('firm_admin');
    // 5. the old session is dead
    expect((await ctx.request().get('/api/auth/me').set(victim.headers)).status).toBe(401);
    // 6. provider directory untouched
    expect(await ctx.db.get(PROVIDER_MD5)).toEqual(before);

    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM firm_members WHERE firm_id = ?', [firmId]).catch(() => {});
      await db.run('DELETE FROM firms WHERE id = ?', [firmId]).catch(() => {});
      await db.run(`DELETE FROM feedback WHERE comment = 'great' AND user_id IS NULL`).catch(() => {});
      await db.run(`DELETE FROM ai_usage_log WHERE user_id IS NULL AND route = 'chat' AND cost_usd = 0.01`).catch(() => {});
    });
  });

  it('a sole-member firm is deleted with its owner (no ownerless firm left behind)', async () => {
    const solo = await ctx.register({ displayName: 'Solo Attorney' });
    const firm = await ctx.request().post('/api/firms').set(solo.headers).send({ name: `${ctx.tag} Solo Firm` });
    expect(firm.status).toBe(201);
    const del = await ctx.request().delete('/api/auth/account').set(solo.headers).send({ password: solo.password });
    expect(del.status).toBe(200);
    expect(await ctx.db.get('SELECT id FROM firms WHERE id = ?', [firm.body.id])).toBeUndefined();
  });
});
