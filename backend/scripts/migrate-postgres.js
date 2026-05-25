/**
 * scripts/migrate-postgres.js
 * Run this ONCE after setting DATABASE_URL to Postgres
 * node scripts/migrate-postgres.js
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  login_identifier TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user',
  bar_number TEXT,
  bar_verified INTEGER DEFAULT 0,
  push_token TEXT,
  is_premium INTEGER DEFAULT 0,
  credit_cents INTEGER DEFAULT 0,
  stripe_cus_id TEXT,
  refresh_token_hash TEXT,
  last_seen TEXT,
  account_status TEXT DEFAULT 'active',
  failed_login_attempts INTEGER DEFAULT 0,
  lock_until TEXT,
  golden_gavel INTEGER DEFAULT 0,
  golden_gavel_awarded_at TEXT,
  golden_gavel_tier TEXT,
  golden_gavel_tier TEXT,
  gavel_level INTEGER DEFAULT 0,
  notif_court_reminders INTEGER DEFAULT 1,
  notif_legal_tips INTEGER DEFAULT 1,
  notif_arrest_alerts INTEGER DEFAULT 1,
  notif_motion_updates INTEGER DEFAULT 1,
  notif_checkin_reminders INTEGER DEFAULT 1,
  notif_expungement INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  state TEXT,
  charge TEXT,
  court_date TEXT,
  next_court_date TEXT,
  attorney_id INTEGER,
  notes TEXT,
  _offline INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  lat REAL, lng REAL,
  location_label TEXT,
  notes TEXT,
  streak INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  push_token TEXT,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  deliver_at TEXT NOT NULL,
  notification_type TEXT DEFAULT 'reminder',
  case_id INTEGER,
  channelId TEXT DEFAULT 'default',
  expo_ticket_id TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  error TEXT,
  delivered INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  relationship TEXT DEFAULT 'family',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_lawyers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  provider_id INTEGER,
  name TEXT, phone TEXT,
  address TEXT, specialties TEXT,
  rating REAL, notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  title TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE,
  token TEXT NOT NULL,
  platform TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lawyers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  firm TEXT, phone TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT,
  lat REAL, lng REAL,
  specialties TEXT DEFAULT '["Criminal Defense"]',
  rating REAL DEFAULT 4.5,
  review_count INTEGER DEFAULT 0,
  bar_number TEXT, bar_verified INTEGER DEFAULT 0,
  free_consult INTEGER DEFAULT 0,
  bio TEXT, website TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bail_agents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, company TEXT,
  phone TEXT, address TEXT,
  city TEXT, state TEXT,
  lat REAL, lng REAL,
  rate_pct REAL DEFAULT 10,
  rating REAL DEFAULT 4.0,
  verified INTEGER DEFAULT 0,
  available_now INTEGER DEFAULT 1,
  payment_plan INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

try {
  await pool.query(schema);
  console.log('✅ Postgres schema created');
  await pool.end();
  process.exit(0);
} catch(e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
}
