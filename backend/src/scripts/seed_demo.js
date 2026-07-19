/**
 * seed_demo.js — DEV ONLY seed script
 * Original data content was corrupted during generation.
 * Run manually against a dev database only.
 * NOTE: Never run in production.
 */
import { getDb } from '../db/index.js';

export async function seedDemo() {
  const db = await getDb();
  // Seed data was moved to Supabase migrations 20260717000002 and 20260717000003
  console.log('[seed_demo] Seed data is in Supabase migrations — run those instead.');
}

// Allow direct invocation
if (process.argv[1]?.includes('seed_demo')) {
  seedDemo().catch(console.error);
}
