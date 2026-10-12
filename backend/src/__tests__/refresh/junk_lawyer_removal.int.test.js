/**
 * junk_lawyer_removal.int.test.js — migration 016 (owner decision 2026-10-12).
 *
 * Two lawyer rows created from scraped page headings ("A Colorado Bar
 * Association membership…", "Layer") are removed, and a scrape can never
 * re-add them: provider_suppressions makes the refresh writer skip them.
 * Every other lawyer row is untouched.
 *
 * PG-gated (TEST_DATABASE_URL) like the other refresh suites.
 */
import { describeIntegration, initSecuritySuite } from '../security/_world.js';
import { createProviderWriter } from '../../services/dataRefresh/providerStore.js';

const JUNK = [
  { source_id: 'bar_CO_a_colorado_bar_association_mem',
    name: 'A Colorado Bar Association membership connects you to knowledge', city: 'Denver', state: 'CO' },
  { source_id: 'bar_AK_layer', name: 'Layer', city: 'Anchorage', state: 'AK' },
];

describeIntegration('Migration 016: junk lawyer rows removed and suppressed', () => {
  const ctx = initSecuritySuite();

  test('the two heading rows are gone', async () => {
    const rows = await ctx.db.all(
      `SELECT id FROM lawyers WHERE source_id = ANY(?::text[])`, [JUNK.map(j => j.source_id)]);
    expect(rows).toHaveLength(0);
    const byName = await ctx.db.all(
      `SELECT id FROM lawyers WHERE name = 'Layer' OR name ILIKE 'A Colorado Bar Association membership%'`);
    expect(byName).toHaveLength(0);
  });

  test('both are on the suppression list', async () => {
    const rows = await ctx.db.all(
      `SELECT source_id FROM provider_suppressions WHERE table_name = 'lawyers' ORDER BY source_id`);
    expect(rows.map(r => r.source_id)).toEqual(expect.arrayContaining(JUNK.map(j => j.source_id)));
  });

  test('a scrape returning them again skips them and inserts nothing', async () => {
    const before = await ctx.db.get(`SELECT COUNT(*)::int AS n, MAX(id) AS max FROM lawyers`);
    const counts = { inserted: 0, proposed: 0, unchanged: 0, skipped: 0, errors: 0 };
    const w = createProviderWriter(ctx.db, 'lawyers', { counts });
    await w.writeAll(JUNK.map(j => ({ ...j, source: 'state_bar', phone: '+13035550100' })));
    expect(counts.inserted).toBe(0);
    expect(counts.skipped).toBe(2);
    const after = await ctx.db.get(`SELECT COUNT(*)::int AS n, MAX(id) AS max FROM lawyers`);
    expect(after).toEqual(before);
  });

  test('a real new provider is still inserted (suppression is targeted)', async () => {
    const counts = { inserted: 0, proposed: 0, unchanged: 0, skipped: 0, errors: 0 };
    const sid = `bar_VT_jgtest_${Date.now().toString(36)}`;
    const w = createProviderWriter(ctx.db, 'lawyers', { counts });
    await w.writeAll([{ source_id: sid, source: 'state_bar', name: 'Jgtest Real Attorney',
      city: 'Montpelier', state: 'VT', phone: '+18025550123' }]);
    expect(counts.inserted).toBe(1);
    await ctx.db.run(`DELETE FROM lawyers WHERE source_id = ?`, [sid]);
  });
});
