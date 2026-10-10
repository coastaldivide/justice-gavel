/**
 * seed_providers.js — DEV ONLY seed script
 * Original data content was corrupted during generation.
 * Run manually against a dev database only.
 * NOTE: Never run in production.
 */

export function seedProviders() {
  console.log('[seed_providers] Provider data seed — see supabase/migrations for canonical data.');
}

if (process.argv[1]?.includes('seed_providers')) {
  seedProviders();
}
