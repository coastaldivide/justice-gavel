/**
 * services/supabase.js — Supabase client for SDK features
 * (Realtime, Storage, Edge Functions)
 * 
 * Main database queries still go through the pg pool (getDb()).
 * Use this client for Supabase-specific features.
 */
import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_PUBLISHABLE_KEY;

let _client = null;

export function getSupabaseClient() {
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, {
      auth: { persistSession: false }, // server-side — no session persistence
    });
  }
  return _client;
}

export default getSupabaseClient;
