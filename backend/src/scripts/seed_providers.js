/**
 * seed_providers.js — no-op kept for old runbooks and `npm run seed:providers`.
 *
 * The canonical provider directory (lawyers, bail agents, recovery agents) is
 * seeded by supabase/migrations/00000000000001_seed_reference_data.sql. New
 * providers arrive through the data-refresh scripts (refresh.js,
 * scrape_providers_national.js, import_*.js), which write the main Postgres
 * database and never overwrite or delete an existing row.
 */

export function seedProviders() {
  console.log('[seed_providers] Nothing to do: provider rows are seeded by supabase/migrations '
    + '(00000000000001_seed_reference_data.sql). Use src/scripts/refresh.js to add new providers.');
}

if (process.argv[1]?.includes('seed_providers')) {
  seedProviders();
}
