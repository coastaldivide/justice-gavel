/**
 * db/index.js — Database adapter
 *
 * Uses SQLite by default (demo.db) — zero configuration needed.
 * Set POSTGRES_URL in .env to switch to Postgres for production.
 *
 * Both adapters expose the same interface:
 *   db.get(sql, params)   → single row or undefined
 *   db.all(sql, params)   → array of rows
 *   db.run(sql, params)   → { lastID, changes }
 *   db.exec(sql)          → void
 *
 * Usage:
 *   import { getDb } from '../db/index.js';
 *   const db = await getDb();
 */

import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import path from 'path';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.resolve(__dirname, '../../demo.db');

// ── Shared state ─────────────────────────────────────────────────────────────
let _db = null;

// ── SQLite adapter ────────────────────────────────────────────────────────────
async function initSqlite() {
  const sqlite3 = (await import('sqlite3')).default;
  const { open } = await import('sqlite');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  // ── FTS5 virtual tables for full-text search ────────────────────────────────
  // content= tables shadow the real tables — no data duplication.
  // After content changes, rebuild with: INSERT INTO cases_fts(cases_fts) VALUES('rebuild')
  let hasFts5 = false;
  try {
    const ftsRow = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='cases_fts'");
    hasFts5 = !!ftsRow;
  } catch { hasFts5 = false; }

  if (!hasFts5) {
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts
        USING fts5(title, notes, content=cases, content_rowid=id, tokenize='porter unicode61');
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(content, content_rowid=id, tokenize='porter unicode61');
      CREATE VIRTUAL TABLE IF NOT EXISTS lessons_fts
        USING fts5(title, category, content=lessons, content_rowid=id, tokenize='porter unicode61');

      -- Populate from existing data on first boot
      INSERT INTO cases_fts(rowid, title, notes)
        SELECT id, COALESCE(title,''), COALESCE(notes,'') FROM cases;
      INSERT INTO messages_fts(rowid, content)
        SELECT id, COALESCE(content,'') FROM messages;
      INSERT INTO lessons_fts(rowid, title, category)
        SELECT id, COALESCE(title,''), COALESCE(category,'') FROM lessons;
    `).catch(() => {}); // Silently ignore if FTS5 is not compiled into this SQLite build
  }

  // ── Performance indexes ────────────────────────────────────────────────────
  // Without these, every WHERE user_id=? does a full table scan.
  // IF NOT EXISTS makes all CREATE INDEX statements idempotent — safe on every boot.
  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cases_user         ON cases(user_id);
      CREATE INDEX IF NOT EXISTS idx_cases_court_date   ON cases(next_court_date) WHERE next_court_date IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_case      ON messages(case_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_saved_lawyers_user ON saved_lawyers(user_id);
                  CREATE INDEX IF NOT EXISTS idx_push_tokens_user   ON push_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_user      ON checkins(user_id);
      CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_rewards_user       ON rewards(user_id);

      -- ── Year 1 supplemental ──────────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_firms_slug          ON firms(slug);
      CREATE INDEX IF NOT EXISTS idx_firms_owner         ON firms(owner_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_firm_ts   ON audit_log(firm_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_ts   ON audit_log(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_target    ON audit_log(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_conflict_index_firm ON conflict_index(firm_id, party_name_norm);
      CREATE INDEX IF NOT EXISTS idx_role_perms_role     ON role_permissions(firm_role, resource);

      -- ── Year 2 supplemental ──────────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_time_entries_firm_status ON time_entries(firm_id, billing_status);
      CREATE INDEX IF NOT EXISTS idx_time_entries_invoice     ON time_entries(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_firm_status     ON invoices(firm_id, status);
      CREATE INDEX IF NOT EXISTS idx_docket_firm_date         ON docket_entries(firm_id, due_date, status);
      CREATE INDEX IF NOT EXISTS idx_docket_reminder          ON docket_entries(due_date, status, reminded_at);
      CREATE INDEX IF NOT EXISTS idx_privilege_matter_num     ON privilege_log(matter_id, doc_number);
      CREATE INDEX IF NOT EXISTS idx_privilege_reviewed       ON privilege_log(reviewed_by, matter_id);

      -- ── Year 3 supplemental ──────────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_intconn_firm_provider    ON integration_connections(firm_id, provider, status);
      CREATE INDEX IF NOT EXISTS idx_intconn_status           ON integration_connections(status);
      CREATE INDEX IF NOT EXISTS idx_synclog_conn_ts          ON integration_sync_log(connection_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_synclog_firm_ts          ON integration_sync_log(firm_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_docsync_conn_matter      ON document_sync_map(connection_id, matter_id);
      CREATE INDEX IF NOT EXISTS idx_wh_subs_firm_active      ON webhook_subscriptions(firm_id, active);
      CREATE INDEX IF NOT EXISTS idx_wh_deliveries_sub_ts     ON webhook_deliveries(subscription_id, attempted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wh_deliveries_success    ON webhook_deliveries(success, attempted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cal_push_docket          ON calendar_push_events(docket_entry_id, sync_status);
      CREATE INDEX IF NOT EXISTS idx_cal_push_conn_status     ON calendar_push_events(connection_id, sync_status);
      -- ── Supplemental indexes for v4.7.0 additions ──────────────────────────
      CREATE INDEX IF NOT EXISTS idx_contracts_type    ON contracts(contract_type, user_id);
      CREATE INDEX IF NOT EXISTS idx_contracts_expiry  ON contracts(expiry_date) WHERE expiry_date IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_crev_user_created ON contract_reviews(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cred_user_created ON contract_redlines(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cexec_contract    ON contract_executions(contract_id, status);
      CREATE INDEX IF NOT EXISTS idx_motion_type       ON motion_history(user_id, motion_type);
      CREATE INDEX IF NOT EXISTS idx_tsess_defender    ON translation_sessions(defender_id);
      CREATE INDEX IF NOT EXISTS idx_tsess_active      ON translation_sessions(last_active DESC);
      -- ── v4.9.0 supplemental indexes ─────────────────────────────────────────
      -- discovery_analyses: list and history queries hit user_id + created_at
      CREATE INDEX IF NOT EXISTS idx_disc_analyses_user
        ON discovery_analyses(user_id, created_at DESC);
      -- contract_executions: signer list filters by contract_id + status
      CREATE INDEX IF NOT EXISTS idx_cexec_contract_status
        ON contract_executions(contract_id, status);
      -- research_messages: conversation load hits session_id + created_at
      CREATE INDEX IF NOT EXISTS idx_rmsg_session
        ON research_messages(session_id, created_at ASC);
      -- role_permissions: RBAC middleware checks firm_role+resource+action
      CREATE INDEX IF NOT EXISTS idx_role_perms_lookup
        ON role_permissions(firm_role, resource, action);
      -- case_messages: unread badge hits sender_id; chat thread hits case_id+created_at
      CREATE INDEX IF NOT EXISTS idx_cmsg_sender_read
        ON case_messages(sender_id, read_at);
      -- push_tokens: delivery queries user_id ORDER BY id DESC LIMIT 3
      CREATE INDEX IF NOT EXISTS idx_push_tokens_user_desc
        ON push_tokens(user_id, id DESC);
    `);
  } catch (e) { /* Tables may not exist yet — migrations create them on first run */ }

  // ── Year 1: RBAC + Matter Teams + Audit Log ─────────────────────────────────
  try {
    await db.exec(`
      -- ── Firm / Organisation ──────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS firms (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        slug        TEXT    UNIQUE,           -- url-safe identifier e.g. "skadden"
        plan        TEXT    DEFAULT 'trial',  -- trial | pro | enterprise
        seat_limit  INTEGER DEFAULT 10,
        created_at  TEXT    DEFAULT (datetime('now')),
        updated_at  TEXT    DEFAULT (datetime('now'))
      ,
          owner_id                       INTEGER,


      CREATE TABLE IF NOT EXISTS firm_members (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id     INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        firm_role   TEXT    NOT NULL DEFAULT 'associate',
                    -- super_admin | firm_admin | partner | associate | paralegal | client | viewer
        invited_by  INTEGER REFERENCES users(id),
        status      TEXT    NOT NULL DEFAULT 'active',  -- active | suspended | pending
        joined_at   TEXT    DEFAULT (datetime('now')),
        UNIQUE(firm_id, user_id)
      ,
          title                          TEXT,
          pricing_tier  TEXT    DEFAULT 'starter',
          vertical      TEXT
          );

      CREATE INDEX IF NOT EXISTS idx_firm_members_firm ON firm_members(firm_id, status);
      CREATE INDEX IF NOT EXISTS idx_firm_members_user ON firm_members(user_id);

      -- ── Matter Teams ─────────────────────────────────────────────────────────
      -- A matter = what law firms call a case/project. We keep cases as the
      -- underlying table and overlay matter_team_members for multi-user access.
      CREATE TABLE IF NOT EXISTS matter_team_members (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        matter_role   TEXT    NOT NULL DEFAULT 'associate',
                      -- lead_partner | partner | associate | paralegal | client | viewer
        added_by      INTEGER REFERENCES users(id),
        can_edit      INTEGER NOT NULL DEFAULT 0,
        can_message   INTEGER NOT NULL DEFAULT 1,
        can_view_docs INTEGER NOT NULL DEFAULT 1,
        ethics_wall   INTEGER NOT NULL DEFAULT 0,  -- 1 = blocked from this matter
        added_at      TEXT    DEFAULT (datetime('now')),
        UNIQUE(case_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_matter_team_case ON matter_team_members(case_id);
      CREATE INDEX IF NOT EXISTS idx_matter_team_user ON matter_team_members(user_id);

      -- ── Matters + Matter Events (firm-level cases) ───────────────────────────
      CREATE TABLE IF NOT EXISTS matters (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id          INTEGER,
        created_by       INTEGER NOT NULL,
        title            TEXT    NOT NULL,
        matter_type      TEXT    DEFAULT 'general',
        practice_group   TEXT,
        client_name      TEXT,
        opposing_party   TEXT,
        opposing_counsel TEXT,
        jurisdiction     TEXT,
        status           TEXT    DEFAULT 'active',
        priority         TEXT    DEFAULT 'normal',
        billing_rate     INTEGER,
        estimated_value  INTEGER,
        actual_value     INTEGER,
        notes            TEXT,
        opened_date      TEXT    DEFAULT (date('now')),
        closed_date      TEXT,
        next_deadline    TEXT,
        tags             TEXT,
        created_at       TEXT    DEFAULT (datetime('now')),
        updated_at       TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS matter_teams (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        matter_id   INTEGER NOT NULL,
        user_id     INTEGER NOT NULL,
        role        TEXT    NOT NULL DEFAULT 'associate',
        added_by    INTEGER,
        active      INTEGER NOT NULL DEFAULT 1,
        added_at    TEXT    DEFAULT (datetime('now')),
        UNIQUE(matter_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS matter_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        matter_id    INTEGER NOT NULL,
        user_id      INTEGER NOT NULL,
        event_type   TEXT    DEFAULT 'note',
        title        TEXT    NOT NULL,
        description  TEXT,
        event_date   TEXT,
        amount_cents INTEGER,
        created_at   TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_matters_firm_status  ON matters(firm_id, status);
      CREATE INDEX IF NOT EXISTS idx_matters_created_by   ON matters(created_by);
      CREATE INDEX IF NOT EXISTS idx_matter_teams_matter  ON matter_teams(matter_id, active);
      CREATE INDEX IF NOT EXISTS idx_matter_teams_user    ON matter_teams(user_id, active);
      CREATE INDEX IF NOT EXISTS idx_matter_events_matter ON matter_events(matter_id, created_at DESC);

      -- ── RBAC Permissions ─────────────────────────────────────────────────────
      -- Resource-action permission table. Checked by requirePermission() middleware.
      CREATE TABLE IF NOT EXISTS role_permissions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_role   TEXT NOT NULL,  -- matches firm_members.firm_role
        resource    TEXT NOT NULL,  -- cases | contracts | motions | messages | billing | admin | audit
        action      TEXT NOT NULL,  -- read | write | delete | approve | export
        UNIQUE(firm_role, resource, action)
      );

      -- ── Audit Log ────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id     INTEGER REFERENCES firms(id),
        user_id     INTEGER REFERENCES users(id),
        target_type TEXT,          -- case | contract | motion | message | user | billing
        target_id   INTEGER,       -- pk of the affected row
        action      TEXT NOT NULL, -- create | read | update | delete | login | logout | export | sign | assign
        detail      TEXT,          -- JSON of changed fields {field, old, new}
        ip_address  TEXT,
        user_agent  TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_firm    ON audit_log(firm_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);

      -- ── Conflicts (adverse party) table ──────────────────────────────────────
      CREATE TABLE IF NOT EXISTS matter_parties (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        firm_id     INTEGER REFERENCES firms(id),
        party_name  TEXT NOT NULL,
        party_type  TEXT DEFAULT 'adverse',  -- client | adverse | witness | expert | court
        added_by    INTEGER REFERENCES users(id),
        added_at    TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_parties_firm ON matter_parties(firm_id, party_name);
      CREATE INDEX IF NOT EXISTS idx_parties_case ON matter_parties(case_id);
      -- ── Case Messages (encrypted defender-client messaging) ─────────────────
      CREATE TABLE IF NOT EXISTS case_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id      INTEGER NOT NULL,
        sender_id    INTEGER NOT NULL,
        sender_role  TEXT    NOT NULL DEFAULT 'client',
        body         TEXT    NOT NULL,
        lang         TEXT    DEFAULT 'en',
        read_at      TEXT,
        created_at   TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cmsg_case   ON case_messages(case_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cmsg_unread ON case_messages(sender_id, read_at);
    `);
  } catch (e) {
    // Tables already exist — safe to ignore on subsequent boots
    logger.info('[db] Year 1 tables: already present or partially created:', e.message.slice(0,60));
  }

  // ── Seed default RBAC permissions ──────────────────────────────────────────
  try {
    const existing = await db.get('SELECT id FROM role_permissions LIMIT 1');
    if (!existing) {
      const perms = [
        // super_admin: everything
        ['super_admin','cases','read'],['super_admin','cases','write'],['super_admin','cases','delete'],
        ['super_admin','contracts','read'],['super_admin','contracts','write'],['super_admin','contracts','delete'],['super_admin','contracts','approve'],
        ['super_admin','motions','read'],['super_admin','motions','write'],['super_admin','motions','delete'],
        ['super_admin','messages','read'],['super_admin','messages','write'],
        ['super_admin','billing','read'],['super_admin','billing','write'],
        ['super_admin','admin','read'],['super_admin','admin','write'],
        ['super_admin','audit','read'],['super_admin','audit','export'],
        ['super_admin','users','read'],['super_admin','users','write'],
        // firm_admin: everything except some admin
        ['firm_admin','cases','read'],['firm_admin','cases','write'],['firm_admin','cases','delete'],
        ['firm_admin','contracts','read'],['firm_admin','contracts','write'],['firm_admin','contracts','delete'],['firm_admin','contracts','approve'],
        ['firm_admin','motions','read'],['firm_admin','motions','write'],
        ['firm_admin','messages','read'],['firm_admin','messages','write'],
        ['firm_admin','billing','read'],['firm_admin','billing','write'],
        ['firm_admin','audit','read'],['firm_admin','audit','export'],
        ['firm_admin','users','read'],['firm_admin','users','write'],
        // partner: all case/contract work, can approve, can read billing
        ['partner','cases','read'],['partner','cases','write'],['partner','cases','delete'],
        ['partner','contracts','read'],['partner','contracts','write'],['partner','contracts','approve'],
        ['partner','motions','read'],['partner','motions','write'],
        ['partner','messages','read'],['partner','messages','write'],
        ['partner','billing','read'],
        ['partner','audit','read'],
        ['partner','users','read'],
        // associate: case/contract read+write, no delete, no billing, no approve
        ['associate','cases','read'],['associate','cases','write'],
        ['associate','contracts','read'],['associate','contracts','write'],
        ['associate','motions','read'],['associate','motions','write'],
        ['associate','messages','read'],['associate','messages','write'],
        ['associate','users','read'],
        // paralegal: read most things, write messages and docs, no billing
        ['paralegal','cases','read'],
        ['paralegal','contracts','read'],
        ['paralegal','motions','read'],
        ['paralegal','messages','read'],['paralegal','messages','write'],
        ['paralegal','users','read'],
        // client: read their own matter, send messages
        ['client','cases','read'],
        ['client','contracts','read'],
        ['client','messages','read'],['client','messages','write'],
        // viewer: read only
        ['viewer','cases','read'],
        ['viewer','contracts','read'],
        ['viewer','messages','read'],
      ];
      for (const [role, resource, action] of perms) {
        await db.run(
          'INSERT OR IGNORE INTO role_permissions (firm_role, resource, action) VALUES (?,?,?)',
          [role, resource, action]
        );
      }
      logger.info('[db] Default RBAC permissions seeded.');
    }
  } catch (e) {
    logger.info('[db] RBAC seed skipped:', e.message.slice(0,60));
  }

  // ── Year 1.5: SSO, Ethics Walls, Conflict Screening ─────────────────────────
  try {
    await db.exec(`
      -- ── SSO / SAML Configuration ─────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS sso_configurations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER NOT NULL UNIQUE REFERENCES firms(id) ON DELETE CASCADE,
        provider        TEXT    NOT NULL DEFAULT 'saml',  -- saml | oidc | azure_ad | okta | google
        entity_id       TEXT,          -- IdP entity ID / issuer
        sso_url         TEXT,          -- IdP SSO endpoint
        slo_url         TEXT,          -- IdP SLO endpoint (single logout)
        certificate     TEXT,          -- IdP public certificate (PEM, no private key)
        attribute_email TEXT    DEFAULT 'email',      -- claim name for email
        attribute_name  TEXT    DEFAULT 'displayName',-- claim name for display name
        attribute_role  TEXT,          -- claim name for role (optional)
        sp_entity_id    TEXT,          -- our SP entity ID (generated)
        sp_acs_url      TEXT,          -- our ACS URL (generated)
        force_sso       INTEGER DEFAULT 0,  -- 1 = password login disabled for firm
        active          INTEGER DEFAULT 1,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT    DEFAULT (datetime('now')),
        updated_at      TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sso_firm ON sso_configurations(firm_id);

      -- ── Ethics Wall Log ──────────────────────────────────────────────────────
      -- Every ethics wall set, reviewed, lifted, or overridden must be logged.
      CREATE TABLE IF NOT EXISTS ethics_wall_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,       -- NULL = firm-wide wall on member
        screened_user_id INTEGER NOT NULL REFERENCES users(id),
        action          TEXT    NOT NULL,  -- set | reviewed | lifted | auto_set | override
        reason          TEXT,          -- justification text (required for lift/override)
        set_by          INTEGER REFERENCES users(id),
        reviewed_by     INTEGER REFERENCES users(id),
        waiver_signed   INTEGER DEFAULT 0,
        created_at      TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ethics_wall_firm   ON ethics_wall_log(firm_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ethics_wall_user   ON ethics_wall_log(screened_user_id);
      CREATE INDEX IF NOT EXISTS idx_ethics_wall_matter ON ethics_wall_log(matter_id);

      -- ── Conflict Waivers ─────────────────────────────────────────────────────
      -- Records informed consent to proceed despite detected conflict.
      CREATE TABLE IF NOT EXISTS conflict_waivers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,
        conflicting_matter_id INTEGER,
        adverse_party   TEXT    NOT NULL,
        client_party    TEXT    NOT NULL,
        conflict_type   TEXT    DEFAULT 'adverse_party',  -- adverse_party | former_client | positional
        waiver_text     TEXT,          -- the full text of what was waived
        authorized_by   INTEGER REFERENCES users(id),  -- partner who approved
        client_consent  INTEGER DEFAULT 0,  -- 1 = client acknowledged
        created_at      TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_waivers_firm   ON conflict_waivers(firm_id);
      CREATE INDEX IF NOT EXISTS idx_waivers_matter ON conflict_waivers(matter_id);

      -- ── Conflict Check Cache ─────────────────────────────────────────────────
      -- Normalised party name → matter mapping for fast conflict searches.
      CREATE TABLE IF NOT EXISTS conflict_index (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        matter_id       INTEGER,       -- NULL = firm-level client relationship
        party_name_norm TEXT    NOT NULL,  -- lowercased, trimmed, strip punctuation
        party_name_orig TEXT    NOT NULL,
        party_role      TEXT    DEFAULT 'client',  -- client | adverse | former_client
        added_at        TEXT    DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conflict_index_uniq
        ON conflict_index(firm_id, matter_id, party_name_norm, party_role);
      CREATE INDEX IF NOT EXISTS idx_conflict_index_search
        ON conflict_index(firm_id, party_name_norm);

      -- ── SOC 2 Controls Checklist ────────────────────────────────────────────
      -- Runtime-queryable checklist of SOC 2 Type II controls and their status.
      CREATE TABLE IF NOT EXISTS soc2_controls (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        control_id   TEXT NOT NULL UNIQUE,  -- e.g. CC6.1
        category     TEXT NOT NULL,         -- Security | Availability | Confidentiality | etc.
        title        TEXT NOT NULL,
        description  TEXT,
        status       TEXT DEFAULT 'implemented',  -- implemented | partial | planned | not_applicable
        evidence     TEXT,   -- what code/config proves this is in place
        updated_at   TEXT DEFAULT (datetime('now'))
      );
    `);
    logger.info('[db] Year 1.5 tables ready.');
  } catch (e) {
    logger.info('[db] Year 1.5 tables: already present or partially created.');
  }

  // ── Seed SOC 2 Type II Controls ──────────────────────────────────────────────
  try {
    const soc2count = await db.get('SELECT COUNT(*) as n FROM soc2_controls');
    if (!soc2count?.n) {
      const controls = [
        ['CC1.1','Security','Control Environment','Management has defined organisational structure and reporting lines','implemented','firm_members RBAC table; requireFirmRole middleware'],
        ['CC2.1','Security','Information and Communication','Internal communication of security responsibilities','implemented','audit_log table; writeAuditLog on all writes'],
        ['CC3.1','Security','Risk Assessment','Risk assessment process exists','partial','Conflict screening; ethics wall system'],
        ['CC5.1','Security','Control Activities','RBAC enforced on all sensitive operations','implemented','requirePermission(); role_permissions table seeded'],
        ['CC6.1','Security','Logical Access Controls','Access restricted to authorised users','implemented','authRequired JWT; bcrypt/12; account lockout'],
        ['CC6.2','Security','Authentication','Multi-factor or strong authentication','partial','Password min 8 chars; account lockout; SSO/SAML available'],
        ['CC6.3','Security','Access Removal','Access removed when no longer needed','implemented','firm_members status=removed; matter ethics_wall'],
        ['CC6.6','Security','Encryption in Transit','Data encrypted in transit','implemented','HSTS; TLS enforced; helmet headers'],
        ['CC6.7','Security','Encryption at Rest','Sensitive data encrypted at rest','implemented','encryption.js AES-256 on case notes'],
        ['CC7.1','Security','System Operations','Monitoring of system availability','implemented','/health; /metrics; Sentry integration'],
        ['CC7.2','Security','Anomaly Detection','Security event detection','implemented','audit_log; rate limiting; account lockout on failed logins'],
        ['CC8.1','Security','Change Management','Changes reviewed before deployment','partial','Jest test suite 1,051 tests; node --check validation'],
        ['CC9.1','Security','Risk Mitigation','Vendor risk management','partial','SAML IdP validation; Stripe; Anthropic'],
        ['A1.1','Availability','Availability','System available per SLA','implemented','/health endpoint; WAL SQLite; graceful shutdown'],
        ['C1.1','Confidentiality','Data Classification','Sensitive data identified','implemented','encryption.js; audit_log; matter_parties'],
        ['PI1.1','Processing Integrity','Accurate Processing','Data integrity controls','implemented','safeInt/sanitizeStr; bcrypt; SQL parameterised queries'],
      ];
      for (const [control_id, category, title, description, status, evidence] of controls) {
        await db.run(
          'INSERT OR IGNORE INTO soc2_controls (control_id, category, title, description, status, evidence) VALUES (?,?,?,?,?,?)',
          [control_id, category, title, description, status, evidence]
        );
      }
      logger.info('[db] SOC 2 controls seeded.');
    }
  } catch (e) {
    logger.info('[db] SOC 2 seed skipped:', e.message?.slice(0, 50));
  }

  // ── Year 2: Time Tracking, Invoices, Dockets, Privilege Log ─────────────────
  try {
    await db.exec(`
      -- ── Time Entries (6-minute increment billing) ───────────────────────────
      CREATE TABLE IF NOT EXISTS time_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,           -- references matters.id OR cases.id
        matter_table    TEXT DEFAULT 'matters',  -- 'matters' | 'cases'
        user_id         INTEGER NOT NULL REFERENCES users(id),
        entry_date      TEXT    NOT NULL,  -- ISO date YYYY-MM-DD
        hours           REAL    NOT NULL,  -- stored in decimal (0.1 = 6 min)
        rate_cents      INTEGER NOT NULL,  -- billing rate at time of entry
        narrative       TEXT    NOT NULL,  -- billing description
        task_code       TEXT,             -- ABA task code (L110, L120, etc.)
        activity_code   TEXT,             -- ABA activity code (A101, A102, etc.)
        billing_status  TEXT DEFAULT 'unbilled', -- unbilled | billed | no_charge | written_off
        invoice_id      INTEGER REFERENCES invoices(id),
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_time_matter  ON time_entries(matter_id, matter_table);
      CREATE INDEX IF NOT EXISTS idx_time_user    ON time_entries(user_id, entry_date);
      CREATE INDEX IF NOT EXISTS idx_time_firm    ON time_entries(firm_id, billing_status);

      -- ── Invoices ────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS invoices (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,
        matter_table    TEXT DEFAULT 'matters',
        invoice_number  TEXT    NOT NULL UNIQUE,
        client_name     TEXT    NOT NULL,
        client_email    TEXT,
        billing_period_start TEXT,
        billing_period_end   TEXT,
        subtotal_cents  INTEGER NOT NULL DEFAULT 0,
        tax_rate        REAL    DEFAULT 0,
        tax_cents       INTEGER DEFAULT 0,
        total_cents     INTEGER NOT NULL DEFAULT 0,
        status          TEXT    DEFAULT 'draft',  -- draft | sent | paid | overdue | void
        due_date        TEXT,
        paid_date       TEXT,
        notes           TEXT,
        pdf_generated   INTEGER DEFAULT 0,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_firm   ON invoices(firm_id, status);
      CREATE INDEX IF NOT EXISTS idx_invoices_matter ON invoices(matter_id);

      -- ── Docket / Deadlines ──────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS docket_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,
        matter_table    TEXT DEFAULT 'matters',
        entry_type      TEXT NOT NULL,     -- deadline | hearing | filing | appointment | reminder
        title           TEXT NOT NULL,
        description     TEXT,
        due_date        TEXT NOT NULL,     -- ISO date
        due_time        TEXT,              -- HH:MM optional
        court           TEXT,
        rule_citation   TEXT,              -- e.g. FRCP 26(a)(1)
        calculated_from TEXT,             -- source event date
        days_from_event INTEGER,           -- if auto-calculated
        status          TEXT DEFAULT 'pending', -- pending | completed | missed | waived
        priority        TEXT DEFAULT 'normal',  -- critical | high | normal | low
        assigned_to     INTEGER REFERENCES users(id),
        reminder_days   INTEGER DEFAULT 3, -- days before due_date to send reminder
        reminded_at     TEXT,
        completed_at    TEXT,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      ,
          notes                          TEXT);
      CREATE INDEX IF NOT EXISTS idx_docket_firm   ON docket_entries(firm_id, due_date);
      CREATE INDEX IF NOT EXISTS idx_docket_matter ON docket_entries(matter_id, status);
      CREATE INDEX IF NOT EXISTS idx_docket_user   ON docket_entries(assigned_to, due_date);

      -- ── Privilege Log ───────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS privilege_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id),
        matter_id       INTEGER,
        matter_table    TEXT DEFAULT 'matters',
        doc_number      TEXT    NOT NULL,  -- e.g. PRIV-001
        doc_date        TEXT,              -- date of document
        doc_type        TEXT,              -- email | memo | letter | draft | notes | other
        author          TEXT,              -- who created the document
        recipients      TEXT,             -- comma-separated
        description     TEXT    NOT NULL, -- brief non-privileged description
        privilege_basis TEXT    NOT NULL, -- attorney_client | work_product | joint_defense | common_interest
        withheld        INTEGER DEFAULT 1, -- 1=withheld, 0=redacted_produced
        page_count      INTEGER,
        ai_generated    INTEGER DEFAULT 0,
        reviewed_by     INTEGER REFERENCES users(id),
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_privilege_firm   ON privilege_log(firm_id, matter_id);
      CREATE INDEX IF NOT EXISTS idx_privilege_matter ON privilege_log(matter_id, doc_number);

      -- ── ABA Task / Activity Code reference ──────────────────────────────────
      CREATE TABLE IF NOT EXISTS aba_codes (
        code     TEXT PRIMARY KEY,
        type     TEXT NOT NULL,  -- task | activity
        label    TEXT NOT NULL,
        category TEXT
      );

      -- ── AI Legal Research Sessions ────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS research_sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        title      TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS research_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rsess_user ON research_sessions(user_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_rmsg_sess  ON research_messages(session_id, created_at);
      -- ── Translation Sessions (live attorney-client translation) ─────────────
      CREATE TABLE IF NOT EXISTS translation_sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        code         TEXT    UNIQUE NOT NULL,
        defender_id  INTEGER,
        lang_a       TEXT    DEFAULT 'en',
        lang_b       TEXT    DEFAULT 'es',
        created_at   TEXT    DEFAULT (datetime('now')),
        last_active  TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS translation_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_code TEXT    NOT NULL,
        side         TEXT    NOT NULL,
        original     TEXT    NOT NULL,
        translated   TEXT    NOT NULL,
        src_lang     TEXT    NOT NULL,
        tgt_lang     TEXT    NOT NULL,
        created_at   TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tmsg_code ON translation_messages(session_code, created_at);
      CREATE INDEX IF NOT EXISTS idx_tsess_code ON translation_sessions(code);
      -- ── Contracts (AI-drafted, review, redline, execution) ─────────────────
      CREATE TABLE IF NOT EXISTS contracts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL,
        contract_type    TEXT    NOT NULL,
        title            TEXT    NOT NULL,
        party_a          TEXT,
        party_b          TEXT,
        fields           TEXT    NOT NULL,
        draft            TEXT    NOT NULL,
        status           TEXT    DEFAULT 'draft',
        execution_date   TEXT,
        expiry_date      TEXT,
        renewal_date     TEXT,
        value_cents      INTEGER,
        paid_cents       INTEGER DEFAULT 0,
        stripe_pi_id     TEXT,
        created_at       TEXT    DEFAULT (datetime('now')),
        updated_at       TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS contract_reviews (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL,
        contract_id      INTEGER,
        filename         TEXT,
        risk_level       TEXT,
        summary          TEXT,
        red_flags        TEXT,
        missing_clauses  TEXT,
        recommendations  TEXT,
        favorable_terms  TEXT,
        paid_cents       INTEGER DEFAULT 0,
        stripe_pi_id     TEXT,
        created_at       TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS contract_redlines (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL,
        contract_id      INTEGER,
        filename_original TEXT,
        filename_revised  TEXT,
        changes          TEXT,
        summary          TEXT,
        risk_delta       TEXT,
        created_at       TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS contract_executions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id      INTEGER NOT NULL,
        user_id          INTEGER NOT NULL,
        signer_name      TEXT    NOT NULL,
        signer_email     TEXT,
        signed_at        TEXT,
        signature_method TEXT    DEFAULT 'in-app',
        status           TEXT    DEFAULT 'pending',
        created_at       TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contracts_user   ON contracts(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status, expiry_date);
      CREATE INDEX IF NOT EXISTS idx_reviews_contract ON contract_reviews(user_id, contract_id);
      -- ── Motion History ──────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS motion_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        motion_type   TEXT    NOT NULL,
        case_fields   TEXT    NOT NULL,
        draft         TEXT    NOT NULL,
        filing_status TEXT    DEFAULT 'draft',
        filed_at      TEXT,
        paid_cents    INTEGER DEFAULT 999,
        stripe_pi_id  TEXT,
        created_at    TEXT    DEFAULT (datetime('now'))
      ,
          case_id                        INTEGER,
          content                        TEXT,
          status                         TEXT    DEFAULT 'draft',
          jurisdiction                   TEXT);
      CREATE INDEX IF NOT EXISTS idx_motion_user ON motion_history(user_id, created_at DESC);
      -- ── Discovery Document Analysis (AI-powered) ────────────────────────────
      CREATE TABLE IF NOT EXISTS discovery_analyses (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        filename        TEXT    NOT NULL,
        doc_type        TEXT,
        case_id         INTEGER,
        summary         TEXT,
        key_facts       TEXT,
        inconsistencies TEXT,
        questions       TEXT,
        page_count      INTEGER DEFAULT 0,
        paid_cents      INTEGER DEFAULT 1999,
        stripe_pi_id    TEXT,
        created_at      TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_disc_user    ON discovery_analyses(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_disc_case    ON discovery_analyses(case_id) WHERE case_id IS NOT NULL;
    `);
    logger.info('[db] Year 2 tables ready.');
  } catch (e) {
    logger.info('[db] Year 2 tables already present:', e.message?.slice(0,50));
  }

  // ── Seed ABA task/activity codes ──────────────────────────────────────────────
  try {
    const abaCount = await db.get('SELECT COUNT(*) as n FROM aba_codes');
    if (!abaCount?.n) {
      const taskCodes = [
        ['L110','task','Fact Investigation/Development','Litigation'],
        ['L120','task','Analysis/Strategy','Litigation'],
        ['L130','task','Experts/Consultants','Litigation'],
        ['L140','task','Document/File Management','Litigation'],
        ['L150','task','Budgeting','Litigation'],
        ['L160','task','Settlement/Non-Binding ADR','Litigation'],
        ['L190','task','Other Case Assessment, Development and Administration','Litigation'],
        ['L210','task','Pleadings','Pre-Trial'],
        ['L220','task','Preliminary Injunctions/Provisional Remedies','Pre-Trial'],
        ['L230','task','Court Mandated Conferences','Pre-Trial'],
        ['L240','task','Dispositive Motions','Pre-Trial'],
        ['L250','task','Other Written Motions and Submissions','Pre-Trial'],
        ['L260','task','Class Action Certification and Notice','Pre-Trial'],
        ['L310','task','Written Discovery','Discovery'],
        ['L320','task','Document Production','Discovery'],
        ['L330','task','Depositions','Discovery'],
        ['L340','task','Expert Discovery','Discovery'],
        ['L350','task','Discovery Motions','Discovery'],
        ['L390','task','Other Discovery','Discovery'],
        ['L410','task','Fact Witnesses','Trial'],
        ['L420','task','Expert Witnesses','Trial'],
        ['L430','task','Trial Preparation and Support','Trial'],
        ['L440','task','Trial','Trial'],
        ['L450','task','Post-Trial Motions and Submissions','Post-Trial'],
        ['L460','task','Appeals','Post-Trial'],
        ['L510','task','Initial Document Review','Transactional'],
        ['L520','task','Research','Transactional'],
        ['L530','task','Drafting','Transactional'],
        ['L540','task','Negotiations','Transactional'],
        ['L550','task','Closing','Transactional'],
      ];
      const actCodes = [
        ['A101','activity','Plan and Prepare for',''],
        ['A102','activity','Research',''],
        ['A103','activity','Draft/Revise',''],
        ['A104','activity','Review/Analyze',''],
        ['A105','activity','Communicate (with client)',''],
        ['A106','activity','Communicate (with opposing counsel)',''],
        ['A107','activity','Communicate (other outside)',''],
        ['A108','activity','Communicate (internal)',''],
        ['A109','activity','Appear For/Attend',''],
        ['A110','activity','Manage Data/Files',''],
      ];
      for (const [code, type, label, category] of [...taskCodes, ...actCodes]) {
        await db.run('INSERT OR IGNORE INTO aba_codes (code,type,label,category) VALUES (?,?,?,?)',
          [code, type, label, category]);
      }
      logger.info('[db] ABA codes seeded.');
    }
  } catch (e) {
    logger.info('[db] ABA seed skipped:', e.message?.slice(0,50));
  }

  // ── Year 3: Integration Layer ─────────────────────────────────────────────────
  try {
    await db.exec(`
      -- ── Integration Connections (DMS, Practice Mgmt, Calendar) ──────────────
      CREATE TABLE IF NOT EXISTS integration_connections (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id) ON DELETE CASCADE,
        user_id         INTEGER REFERENCES users(id),
        provider        TEXT    NOT NULL,
        -- providers: imanage | netdocuments | clio | practicepanther | mycase | caldav | google_calendar | outlook
        status          TEXT    NOT NULL DEFAULT 'pending',
        -- pending | active | error | revoked | expired
        access_token    TEXT,          -- encrypted OAuth access token
        refresh_token   TEXT,          -- encrypted OAuth refresh token
        token_expires_at TEXT,         -- ISO datetime
        instance_url    TEXT,          -- base URL (iManage server, NetDocs pod, etc.)
        customer_id     TEXT,          -- provider customer/account identifier
        scope           TEXT,          -- OAuth scopes granted
        metadata        TEXT,          -- JSON: extra provider-specific config
        last_sync_at    TEXT,          -- ISO datetime of last successful sync
        last_error      TEXT,          -- last error message if status=error
        webhook_secret  TEXT,          -- HMAC secret for verifying inbound webhooks
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now')),
        UNIQUE(firm_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_intconn_firm     ON integration_connections(firm_id, provider);
      CREATE INDEX IF NOT EXISTS idx_intconn_user     ON integration_connections(user_id);

      -- ── Integration Sync Log ──────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS integration_sync_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id   INTEGER REFERENCES integration_connections(id) ON DELETE CASCADE,
        firm_id         INTEGER REFERENCES firms(id),
        direction       TEXT NOT NULL,   -- push | pull | bidirectional
        entity_type     TEXT NOT NULL,   -- matter | document | contact | invoice | event | time_entry
        entity_id       INTEGER,
        external_id     TEXT,            -- provider's ID for the record
        status          TEXT NOT NULL,   -- success | error | skipped | conflict
        error_msg       TEXT,
        records_sent    INTEGER DEFAULT 0,
        records_received INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_synclog_conn     ON integration_sync_log(connection_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_synclog_firm     ON integration_sync_log(firm_id, created_at DESC);

      -- ── Document Sync Map (DMS: iManage / NetDocs) ───────────────────────────
      -- Maps local matter → external document workspace/folder
      CREATE TABLE IF NOT EXISTS document_sync_map (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id   INTEGER REFERENCES integration_connections(id) ON DELETE CASCADE,
        matter_id       INTEGER,
        external_workspace_id TEXT,      -- iManage workspace ID / NetDocs cabinet+folder
        external_folder_path  TEXT,      -- path within workspace
        sync_enabled    INTEGER DEFAULT 1,
        last_synced_at  TEXT,
        doc_count       INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      -- ── Web Push Subscriptions (browser/PWA/desktop VAPID push) ────────────────
      CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        endpoint    TEXT    NOT NULL,
        p256dh      TEXT,
        auth        TEXT,
        platform    TEXT    DEFAULT 'web',
        user_agent  TEXT,
        created_at  TEXT    DEFAULT (datetime('now')),
        UNIQUE(user_id, endpoint)
      );
      CREATE INDEX IF NOT EXISTS idx_wps_user ON web_push_subscriptions(user_id);

      -- ── Health Scan Results ────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS scan_results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id       TEXT    NOT NULL,
        started_at    TEXT    NOT NULL,
        completed_at  TEXT,
        elapsed_ms    INTEGER,
        overall       TEXT,
        summary_json  TEXT,
        findings_json TEXT,
        created_at    TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sr_created ON scan_results(created_at DESC);

      -- ── External ID Mapping ─────────────────────────────────────────────────
      -- Maps Justice Gavel entity IDs → external provider IDs.
      -- Lets sync handlers know whether to POST (create) or PATCH (update)
      -- and prevents duplicate records across sync cycles.
      CREATE TABLE IF NOT EXISTS integration_external_ids (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id       INTEGER NOT NULL,
        provider      TEXT    NOT NULL,
        entity_type   TEXT    NOT NULL,
        internal_id   INTEGER NOT NULL,
        external_id   TEXT    NOT NULL,
        synced_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(firm_id, provider, entity_type, internal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_iei_lookup
        ON integration_external_ids(firm_id, provider, entity_type, internal_id);
      CREATE INDEX IF NOT EXISTS idx_iei_external
        ON integration_external_ids(firm_id, provider, entity_type, external_id);

      -- ── Outbound Webhooks (billing system notifications) ─────────────────────
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id         INTEGER REFERENCES firms(id) ON DELETE CASCADE,
        name            TEXT    NOT NULL,
        url             TEXT    NOT NULL,          -- HTTPS endpoint
        secret          TEXT    NOT NULL,          -- HMAC-SHA256 signing secret
        events          TEXT    NOT NULL,          -- JSON array of event types
        active          INTEGER DEFAULT 1,
        last_triggered_at TEXT,
        failure_count   INTEGER DEFAULT 0,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_firm    ON webhook_subscriptions(firm_id, active);

      -- ── Webhook Delivery Log ──────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
        event_type      TEXT NOT NULL,
        payload         TEXT,           -- JSON event payload (truncated)
        response_status INTEGER,
        response_body   TEXT,
        delivery_ms     INTEGER,
        success         INTEGER DEFAULT 0,
        attempted_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wh_deliveries    ON webhook_deliveries(subscription_id, attempted_at DESC);

      -- ── CalDAV / Calendar Push ────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS calendar_push_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id   INTEGER REFERENCES integration_connections(id) ON DELETE CASCADE,
        docket_entry_id INTEGER REFERENCES docket_entries(id) ON DELETE SET NULL,
        external_uid    TEXT    NOT NULL,   -- iCal UID (stable across updates)
        external_href   TEXT,              -- CalDAV resource URL after creation
        calendar_url    TEXT,              -- CalDAV calendar collection URL
        summary         TEXT    NOT NULL,
        dtstart         TEXT    NOT NULL,   -- ISO 8601
        dtend           TEXT    NOT NULL,   -- ISO 8601
        status          TEXT    DEFAULT 'confirmed',
        sync_status     TEXT    DEFAULT 'pending', -- pending | synced | error | deleted
        last_sync_at    TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cal_conn         ON calendar_push_events(connection_id);
      CREATE INDEX IF NOT EXISTS idx_cal_docket       ON calendar_push_events(docket_entry_id);
      -- ── Consultation Callback Requests ──────────────────────────────────────
      -- Moved from consultations.js inline DDL (was exec'd on every POST)
      CREATE TABLE IF NOT EXISTS callback_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lawyer_id    TEXT,
        phone        TEXT    NOT NULL,
        notes        TEXT,
        duration_min INTEGER DEFAULT 30,
        status       TEXT    DEFAULT 'pending',
        created_at   TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_callback_user
        ON callback_requests(user_id, created_at DESC);

      -- ── PI / Civil Rights Lead Marketplace ──────────────────────────────────
      -- Moved from billing/pi_leads.js (two conflicting schemas merged here)
      CREATE TABLE IF NOT EXISTS pi_leads (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        case_type      TEXT    NOT NULL,
        incident_date  TEXT,
        description    TEXT,
        severity       TEXT    DEFAULT 'moderate',
        city           TEXT,
        state          TEXT,
        lat            REAL,
        lng            REAL,
        status         TEXT    DEFAULT 'open',
        accepted_by    INTEGER REFERENCES users(id),
        accepted_at    TEXT,
        lead_fee_cents INTEGER,
        created_at     TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pi_leads_status
        ON pi_leads(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pi_leads_type
        ON pi_leads(case_type, status);

      -- ── Attorney/Agent Alert Log ─────────────────────────────────────────────
      -- Moved from arrest_alerts.js (was exec'd on every nightly alert sweep)
      CREATE TABLE IF NOT EXISTS attorney_alerts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_id   INTEGER,
        recipient_type TEXT,
        subject        TEXT,
        body           TEXT,
        count          INTEGER DEFAULT 0,
        sent_at        TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_attorney_alerts_recipient
        ON attorney_alerts(recipient_id, recipient_type, sent_at DESC);
      -- ── Password Reset Tokens ───────────────────────────────────────────────
      -- Moved from auth.js inline DDL (was exec'd on every forgot-password request)
      CREATE TABLE IF NOT EXISTS password_resets (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT    PRIMARY KEY,
        expires_at TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pw_resets_user
        ON password_resets(user_id);
      CREATE INDEX IF NOT EXISTS idx_pw_resets_expires
        ON password_resets(expires_at);
    `);
    logger.info('[db] Year 3 tables ready.');
  } catch (e) {
    logger.info('[db] Year 3 tables already present:', e.message?.slice(0, 50));
  }

  // ── Migration: chat_sessions user_id column ──────────────────────────────────
  // Adds user_id to chat_sessions for O(1) per-user message counting.
  // Runs in its own try/catch so Year 3 DDL failures don't suppress it.
  // ALTER TABLE throws if the column already exists — that's the idempotency guard.
  try {
    await db.exec('ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER');
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_chat_user_date ON chat_sessions(user_id, created_at DESC)'
    );
    logger.info('[db] chat_sessions.user_id migration applied.');
  } catch {
    // Column already exists — safe to ignore on subsequent boots
  }

  // ── Migration 037: Firm Verticals ─────────────────────────────────────────
  try {
    await db.exec(`
      ALTER TABLE firms ADD COLUMN vertical TEXT DEFAULT 'general'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE firms ADD COLUMN pricing_tier TEXT DEFAULT 'standard'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE firms ADD COLUMN mission_verified INTEGER DEFAULT 0
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE firms ADD COLUMN features_json TEXT DEFAULT '{}'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE matters ADD COLUMN vulnerability_level TEXT DEFAULT 'moderate'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE matters ADD COLUMN evidence_score INTEGER DEFAULT 50
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE matters ADD COLUMN evidence_bucket TEXT DEFAULT 'moderate'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE matters ADD COLUMN vertical TEXT DEFAULT 'general'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      ALTER TABLE matters ADD COLUMN time_pressure TEXT DEFAULT 'standard'
    `);
  } catch { /* column exists */ }
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS firm_vertical_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL UNIQUE REFERENCES firms(id) ON DELETE CASCADE,
        vertical TEXT NOT NULL DEFAULT 'general',
        bail_calc_enabled INTEGER DEFAULT 0, expunge_pipeline INTEGER DEFAULT 0,
        class_action_track INTEGER DEFAULT 0, sol_calendar INTEGER DEFAULT 0,
        dpa_tracker INTEGER DEFAULT 0, coop_credit_model INTEGER DEFAULT 0,
        tro_alerts INTEGER DEFAULT 0, qdro_matching INTEGER DEFAULT 0,
        asylum_clock INTEGER DEFAULT 0, detention_alerts INTEGER DEFAULT 0,
        expert_matching INTEGER DEFAULT 0, damages_model INTEGER DEFAULT 0,
        caseload_dashboard INTEGER DEFAULT 0, diversion_tracker INTEGER DEFAULT 0,
        aedpa_tracker INTEGER DEFAULT 0, capital_flag INTEGER DEFAULT 0,
        ucmj_taxonomy INTEGER DEFAULT 0, clearance_workflow INTEGER DEFAULT 0,
        juvenile_expunge INTEGER DEFAULT 0, transfer_monitor INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      ,
          expunge_pipeline               INTEGER DEFAULT 0,
          sol_calendar                   INTEGER DEFAULT 0,
          coop_credit_model              INTEGER DEFAULT 0,
          qdro_matching                  INTEGER DEFAULT 0,
          detention_alerts               INTEGER DEFAULT 0,
          damages_model                  INTEGER DEFAULT 0,
          diversion_tracker              INTEGER DEFAULT 0,
          capital_flag                   INTEGER DEFAULT 0,

      CREATE INDEX IF NOT EXISTS idx_fvc_firm ON firm_vertical_config(firm_id,
          clearance_workflow             INTEGER DEFAULT 0,
          transfer_monitor               INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS idx_fvc_vert ON firm_vertical_config(vertical);

      CREATE TABLE IF NOT EXISTS firm_pricing_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tier_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        monthly_cents INTEGER NOT NULL,
        annual_cents INTEGER NOT NULL,
        seat_limit INTEGER DEFAULT 10,
        matter_limit INTEGER DEFAULT 500,
        ai_calls_daily INTEGER DEFAULT 100,
        description TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO firm_pricing_configs (tier_key, display_name, monthly_cents, annual_cents, seat_limit, matter_limit, ai_calls_daily, description) VALUES
        ('standard','Standard',19900,199000,25,2000,200,'Full platform for commercial law firms'),
        ('mission','Mission',4900,49000,15,999,100,'Nonprofit and public defender offices — verified required'),
        ('government','Government',9900,99000,50,9999,300,'Government agencies and court-administered programs'),
        ('enterprise','Enterprise',49900,499000,999,99999,999,'Large firms and institutional deployments');

      CREATE TABLE IF NOT EXISTS vertical_deadline_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vertical TEXT NOT NULL,
        rule_key TEXT NOT NULL,
        label TEXT NOT NULL,
        days INTEGER NOT NULL,
        business_days INTEGER DEFAULT 0,
        priority TEXT DEFAULT 'high',
        description TEXT,
        UNIQUE(vertical, rule_key)
      );
      CREATE INDEX IF NOT EXISTS idx_vdp_vertical ON vertical_deadline_presets(vertical);

      INSERT OR IGNORE INTO vertical_deadline_presets (vertical,rule_key,label,days,business_days,priority,description) VALUES
        ('criminal_defense','bail','Bail Hearing',1,0,'critical','First appearance / bail hearing'),
        ('criminal_defense','arraignment','Arraignment',3,1,'critical','Formal reading of charges'),
        ('criminal_defense','prelim','Preliminary Hearing',14,0,'high','Probable cause determination'),
        ('criminal_defense','speedy','Speedy Trial Deadline',70,0,'high','70-day Speedy Trial Act window'),
        ('criminal_defense','indictment','Grand Jury Indictment',30,0,'high','Federal indictment deadline'),
        ('criminal_defense','appeal_fed','Federal Appeal',14,0,'normal','Notice of appeal — federal conviction'),
        ('civil_rights','answer','Answer Due',21,0,'critical','FRCP Rule 12 — answer to complaint'),
        ('civil_rights','class_motion','Class Cert Motion',90,0,'critical','Motion for class certification'),
        ('civil_rights','discovery','Discovery Close',120,0,'high','Close of fact discovery'),
        ('civil_rights','sol','SOL Expiration',730,0,'critical','2-year § 1983 statute of limitations'),
        ('white_collar','wells','Wells Notice Response',30,0,'critical','SEC Wells Notice response window'),
        ('white_collar','subpoena','Subpoena Compliance',21,1,'critical','DOJ grand jury subpoena compliance'),
        ('family','tro','TRO Hearing',3,1,'critical','Emergency TRO — domestic violence'),
        ('family','answer','Answer Due',30,0,'high','Response to petition'),
        ('family','discovery','Discovery Deadline',120,0,'high','Family law discovery close'),
        ('family','trial_set','Trial Setting',180,0,'normal','Trial setting conference'),
        ('immigration','bia_appeal','BIA Appeal',30,0,'critical','Board of Immigration Appeals — 30-day deadline'),
        ('immigration','master_cal','Master Calendar',90,0,'high','Master calendar hearing'),
        ('immigration','circuit','Circuit Petition',30,0,'normal','Circuit court petition for review'),
        ('personal_injury','answer','Answer Due',30,0,'critical','Defendant answer — PI'),
        ('personal_injury','expert','Expert Disclosure',120,0,'high','Expert witness disclosure deadline'),
        ('personal_injury','discovery','Discovery Close',150,0,'high','Fact discovery close'),
        ('personal_injury','sol_2yr','SOL 2-Year',730,0,'critical','2-year PI statute of limitations'),
        ('personal_injury','sol_3yr','SOL 3-Year (Med Mal)',1095,0,'critical','3-year medical malpractice SOL'),
        ('public_defense','bail','Bail Hearing',1,0,'critical','First appearance'),
        ('public_defense','arraignment','Arraignment',3,1,'critical','Arraignment hearing'),
        ('public_defense','suppression','Suppression Motion',14,1,'high','Motion to suppress deadline'),
        ('public_defense','speedy','Speedy Trial',70,0,'normal','70-day speedy trial window'),
        ('appellate','direct_fed','Direct Appeal (Fed)',14,0,'critical','Federal conviction — notice of appeal'),
        ('appellate','direct_state','Direct Appeal (State)',30,0,'critical','State conviction — notice of appeal'),
        ('appellate','cert','Cert Petition',90,0,'high','SCOTUS certiorari petition'),
        ('appellate','aedpa','AEDPA Deadline',365,0,'critical','28 U.S.C. § 2254/2255 — 1-year AEDPA bar'),
        ('military','art32','Article 32 Hearing',5,1,'critical','Preliminary hearing under Article 32 UCMJ'),
        ('military','arraignment','Court-Martial Arraign',8,1,'critical','Court-martial arraignment'),
        ('military','discovery','Military Discovery',30,0,'high','Discovery in court-martial proceedings'),
        ('military','speedy','Military Speedy Trial',120,0,'normal','RCM 707 speedy trial — 120 days'),
        ('juvenile','detention','Detention Hearing',1,1,'critical','Juvenile detention hearing — 1 business day'),
        ('juvenile','jurisdiction','Jurisdiction Hearing',15,1,'critical','Jurisdictional / adjudication hearing'),
        ('juvenile','review','Disposition Review',180,0,'high','Periodic case review hearing'),
        ('juvenile','perm_plan','Permanency Plan',365,0,'normal','Annual permanency planning hearing');

      CREATE TABLE IF NOT EXISTS asylum_clocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
        client_name TEXT NOT NULL,
        a_number TEXT,
        clock_start TEXT NOT NULL,
        clock_paused INTEGER DEFAULT 0,
        paused_days INTEGER DEFAULT 0,
        relief_type TEXT DEFAULT 'asylum',
        country TEXT,
        detained INTEGER DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ac_firm ON asylum_clocks(firm_id);

      CREATE TABLE IF NOT EXISTS dpa_trackers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
        client_name TEXT NOT NULL,
        agency TEXT,
        investigation_type TEXT,
        cooperation_level TEXT DEFAULT 'unknown',
        dpa_status TEXT DEFAULT 'evaluating',
        base_fine_cents INTEGER DEFAULT 0,
        coop_discount_pct REAL DEFAULT 0,
        dpa_credit_pct REAL DEFAULT 0,
        effective_fine_cents INTEGER DEFAULT 0,
        wells_due TEXT,
        subpoena_due TEXT,
        dpa_sign_due TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dpa_firm ON dpa_trackers(firm_id);
      CREATE INDEX IF NOT EXISTS idx_dpa_status ON dpa_trackers(dpa_status);

      CREATE TABLE IF NOT EXISTS tro_trackers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
        client_name TEXT NOT NULL,
        dv_flag INTEGER DEFAULT 0,
        tro_filed TEXT,
        tro_hearing_due TEXT,
        tro_granted INTEGER DEFAULT 0,
        tro_served INTEGER DEFAULT 0,
        protective_order_due TEXT,
        asset_tier TEXT DEFAULT 'under_100k',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_tro_firm ON tro_trackers(firm_id);

      CREATE TABLE IF NOT EXISTS mission_verification_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        submitted_by INTEGER NOT NULL REFERENCES users(id),
        org_type TEXT NOT NULL,
        ein TEXT,
        website TEXT,
        documentation TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_mvr_firm ON mission_verification_requests(firm_id);
      CREATE INDEX IF NOT EXISTS idx_mvr_status ON mission_verification_requests(status);
    `);
    logger.info('[db] migration 037 — firm verticals applied.');
  } catch (e) {
    logger.warn('[db/init] migration 037:', e?.message?.slice(0, 200));
  }

  // ── Migration 038: Firm Acquisition Funnel ───────────────────────────────────
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS acquisition_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL, firm_name TEXT NOT NULL,
        vertical TEXT DEFAULT 'general', org_size INTEGER DEFAULT 0,
        message TEXT, status TEXT DEFAULT 'new',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(email, firm_name)
      ,
          firm_name                      TEXT,
          org_size                       TEXT);
      CREATE INDEX IF NOT EXISTS idx_al_email    ON acquisition_leads(email);
      CREATE INDEX IF NOT EXISTS idx_al_vertical ON acquisition_leads(vertical);
      CREATE INDEX IF NOT EXISTS idx_al_status   ON acquisition_leads(status);

      CREATE TABLE IF NOT EXISTS firm_trials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        vertical TEXT DEFAULT 'general',
        trial_start TEXT NOT NULL, trial_end TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        converted_at TEXT, created_at TEXT DEFAULT (datetime('now'))
      ,
          org_type                       TEXT,
          trial_end                      TEXT);
      CREATE INDEX IF NOT EXISTS idx_ft_firm   ON firm_trials(firm_id);
      CREATE INDEX IF NOT EXISTS idx_ft_status ON firm_trials(status);

      CREATE TABLE IF NOT EXISTS firm_upgrade_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES users(id),
        current_tier TEXT NOT NULL, target_tier TEXT NOT NULL,
        notes TEXT, status TEXT DEFAULT 'pending',
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
      ,
          target_tier                    TEXT);
      CREATE INDEX IF NOT EXISTS idx_fur_firm   ON firm_upgrade_requests(firm_id);
      CREATE INDEX IF NOT EXISTS idx_fur_status ON firm_upgrade_requests(status);

      CREATE TABLE IF NOT EXISTS firm_onboarding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        checklist_key TEXT NOT NULL,
        completed_at TEXT DEFAULT (datetime('now')),
        UNIQUE(firm_id, checklist_key)
      );
      CREATE INDEX IF NOT EXISTS idx_fo_firm ON firm_onboarding(firm_id);
    `);
    logger.info('[db] migration 038 — firm acquisition applied.');
  } catch (e) {
    logger.warn('[db/init] migration 038:', e?.message?.slice(0, 200));
  }

  // Add owner_id to firms if missing
  try { await db.exec('ALTER TABLE firms ADD COLUMN owner_id INTEGER'); }
  catch { /* exists */ }
  // Add org_type to firm_trials if missing (migration 040)
  try { await db.exec("ALTER TABLE firm_trials ADD COLUMN org_type TEXT"); }
  catch { /* exists */ }


  // ── Migration 039: Vertical Matter Intelligence Fields ────────────────────
  const MIGRATION_039_COLS = [
    ['matters', 'damages_type', "TEXT DEFAULT 'compensatory_only'"],
    ['matters', 'class_certification_status', "TEXT DEFAULT 'individual'"],
    ['matters', 'cooperation_level', "TEXT DEFAULT 'unknown'"],
    ['matters', 'dpa_status', "TEXT DEFAULT 'evaluating'"],
    ['matters', 'dv_flag', 'INTEGER DEFAULT 0'],
    ['matters', 'asset_tier', "TEXT DEFAULT 'under_100k'"],
    ['matters', 'custody_type', "TEXT DEFAULT 'joint_physical'"],
    ['matters', 'support_formula', "TEXT DEFAULT 'income_shares'"],
    ['matters', 'prenup_flag', 'INTEGER DEFAULT 0'],
    ['matters', 'country_condition', "TEXT DEFAULT 'stable'"],
    ['matters', 'relief_type', "TEXT DEFAULT 'asylum'"],
    ['matters', 'detained', 'INTEGER DEFAULT 0'],
    ['matters', 'years_us', 'INTEGER DEFAULT 0'],
    ['matters', 'removal_type', 'TEXT'],
    ['matters', 'clock_days', 'INTEGER DEFAULT 0'],
    ['matters', 'injury_severity', "TEXT DEFAULT 'moderate'"],
    ['matters', 'causation_type', "TEXT DEFAULT 'disputed'"],
    ['matters', 'plaintiff_fault_pct', 'INTEGER DEFAULT 0'],
    ['matters', 'economic_damages', 'INTEGER DEFAULT 0'],
    ['matters', 'noneconomic_damages', 'INTEGER DEFAULT 0'],
    ['matters', 'punitive_damages', 'INTEGER DEFAULT 0'],
    ['matters', 'policy_limit', 'INTEGER DEFAULT 0'],
    ['matters', 'prior_adjudications', 'INTEGER DEFAULT 0'],
    ['matters', 'client_age', 'INTEGER DEFAULT 18'],
    ['matters', 'case_track', "TEXT DEFAULT 'delinquency'"],
    ['matters', 'placement_type', 'TEXT'],
    ['matters', 'hab_track', 'TEXT'],
    ['matters', 'years_post_conviction', 'INTEGER DEFAULT 0'],
    ['matters', 'prior_appeals', 'INTEGER DEFAULT 0'],
    ['matters', 'is_capital', 'INTEGER DEFAULT 0'],
    ['matters', 'court_type', "TEXT DEFAULT 'general'"],
    ['matters', 'branch', 'TEXT'],
    ['matters', 'rank_e', 'INTEGER DEFAULT 5'],
    ['matters', 'service_years', 'INTEGER DEFAULT 0'],
    ['matters', 'prior_njp', 'INTEGER DEFAULT 0'],
    ['matters', 'class_size', 'INTEGER DEFAULT 0'],
    ['matters', 'matter_taxonomy', "TEXT DEFAULT 'general'"],
  ];
  for (const [tbl, col, def] of MIGRATION_039_COLS) {
    try { await db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); }
    catch { /* column exists */ }
  }
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS matter_intelligence_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matter_id INTEGER NOT NULL UNIQUE REFERENCES matters(id) ON DELETE CASCADE,
        signals TEXT NOT NULL, motions TEXT, diversion TEXT,
        escalation_level TEXT DEFAULT 'normal',
        computed_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT DEFAULT (datetime('now', '+24 hours'))
      );
      CREATE INDEX IF NOT EXISTS idx_mic_matter  ON matter_intelligence_cache(matter_id);
      CREATE INDEX IF NOT EXISTS idx_mic_escal   ON matter_intelligence_cache(escalation_level);
      CREATE INDEX IF NOT EXISTS idx_mic_expires ON matter_intelligence_cache(expires_at);
    `);
    logger.info('[db] migration 039 — vertical matter fields applied.');
  } catch (e) {
    logger.warn('[db/init] migration 039:', e?.message?.slice(0, 200));
  }
  // ── Users table column bootstrap (idempotent — safe on every startup) ──────
  // Applies the same columns as migrations 005, 017, 018, 019, 022, 042.
  // Ensures fresh deployments work without manually running migrate.js first.
  for (const sql of [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name     TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS login_identifier TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone            TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role             TEXT DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS verified         INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription     TEXT DEFAULT 'free'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gavel_level      INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_verified     INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_number       TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_state        TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version_accepted TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at  TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token       TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_defender      INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_new_case   INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_deadline   INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_message    INTEGER DEFAULT 1",
  ]) { try { await db.exec(sql); } catch { /* column already exists */ } }



  // ── Hague Convention Intake Records ──────────────────────────────────────
  await db.run(`CREATE TABLE IF NOT EXISTS hague_intakes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    country_code   TEXT    NOT NULL,
    child_name     TEXT    NOT NULL,
    child_age      INTEGER,
    abduction_date TEXT    NOT NULL,
    notes          TEXT,
    created_at     TEXT    DEFAULT (datetime('now')),
    updated_at     TEXT    DEFAULT (datetime('now')),
    UNIQUE(case_id, user_id)
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS expungement_referrals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    case_id    INTEGER,
    state      TEXT,
    partner    TEXT NOT NULL,
    created_at TEXT
  )`).catch(() => {});


  // ── Forum Posts ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      category     TEXT    NOT NULL DEFAULT 'general',
      title        TEXT    NOT NULL,
      body         TEXT    NOT NULL,
      upvotes      INTEGER NOT NULL DEFAULT 0,
      is_pinned    INTEGER NOT NULL DEFAULT 0,
      is_ai        INTEGER NOT NULL DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_forum_posts_category ON forum_posts(category);
    CREATE INDEX IF NOT EXISTS idx_forum_posts_created  ON forum_posts(created_at DESC);
  `);

  // ── Specialty Courts ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialty_courts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      court_type   TEXT    NOT NULL,  -- 'veteran','drug','mental_health','DUI','reentry'
      state        TEXT    NOT NULL,
      city         TEXT    NOT NULL,
      county       TEXT,
      address      TEXT,
      phone        TEXT,
      website      TEXT,
      eligibility  TEXT,
      notes        TEXT,
      lat          REAL,
      lng          REAL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_specialty_courts_state ON specialty_courts(state);
    CREATE INDEX IF NOT EXISTS idx_specialty_courts_type  ON specialty_courts(court_type);
  `);

  // Migration 043: Tables required by routes (added v158)
  db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, company TEXT, state TEXT NOT NULL, city TEXT NOT NULL,
      phone TEXT, email TEXT, license_num TEXT, active INTEGER DEFAULT 1,
      lat REAL, lng REAL, source TEXT DEFAULT 'seed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_agents_state ON recovery_agents(state);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL DEFAULT 'general', rating INTEGER, body TEXT NOT NULL,
      screen TEXT, app_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      comment TEXT
      ,
          rating                         INTEGER);

    CREATE TABLE IF NOT EXISTS firm_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'associate',
      token TEXT NOT NULL UNIQUE, invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      accepted_at DATETIME, expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          role                           TEXT    DEFAULT 'member',
          invited_by                     INTEGER,
          expires_at                     TEXT);
    CREATE INDEX IF NOT EXISTS idx_firm_invites_token ON firm_invites(token);

    CREATE TABLE IF NOT EXISTS account_deletion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, email_hash TEXT, reason TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at                     TEXT    DEFAULT (datetime('now')),
          region                         TEXT    DEFAULT 'US');

    CREATE TABLE IF NOT EXISTS ai_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      input TEXT, output TEXT, error TEXT,
      started_at DATETIME, completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status                         TEXT    NOT NULL DEFAULT 'pending',
          output                         TEXT,
          completed_at                   TEXT);
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs(user_id, status);
  `);


  
  // ── High-traffic composite indexes (added v162) ──────────────────────────
  // matters: queried by firm_id, user_id, and status in most routes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_matters_firm_status
      ON matters(firm_id, status);
    CREATE INDEX IF NOT EXISTS idx_matters_user_status
      ON matters(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_matters_firm_updated
      ON matters(firm_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_firms_name
      ON firms(name);

    CREATE INDEX IF NOT EXISTS idx_audit_log_firm_created
      ON audit_log(firm_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
      ON audit_log(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_cases_user_status
      ON cases(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_cases_next_court
      ON cases(next_court_date)
      WHERE next_court_date IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_docket_entries_matter_due
      ON docket_entries(matter_id, due_date)
      WHERE completed = 0;

    CREATE INDEX IF NOT EXISTS idx_time_entries_matter
      ON time_entries(matter_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
      ON subscriptions(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_push_tokens_user
      ON push_tokens(user_id)
      WHERE active = 1;
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id   INTEGER REFERENCES subscriptions(id),
      stripe_sub_id     TEXT,
      stripe_refund_id  TEXT,
      reason            TEXT NOT NULL,
      additional_info   TEXT,
      days_since_charge INTEGER,
      auto_approve      INTEGER DEFAULT 0,
      status            TEXT DEFAULT 'pending_review',
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
          created_at                     TEXT    DEFAULT (datetime('now')));
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_refund_requests_user ON refund_requests(user_id)`);

  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS family_connections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      arrest_id       INTEGER REFERENCES arrest_records(id),
      family_name     TEXT NOT NULL,
      family_phone    TEXT,
      family_email    TEXT,
      status          TEXT DEFAULT 'pending',
      attorneys_sent  INTEGER DEFAULT 0,
      agents_sent     INTEGER DEFAULT 0,
      stripe_pi_id    TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS revenue_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source            TEXT NOT NULL,
      recipient_type    TEXT,
      gross_cents       INTEGER DEFAULT 0,
      stripe_fee_cents  INTEGER DEFAULT 0,
      net_cents         INTEGER DEFAULT 0,
      stripe_pi_id      TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    return db; // sqlite library already matches our interface
}

// ── Postgres adapter ──────────────────────────────────────────────────────────
// Wraps pg's Client/Pool API to match the SQLite interface.
async function initPostgres(url) {
  let pkg;
  try {
    pkg = await import('pg');
  } catch {
    logger.error('[db] POSTGRES_URL is set but the "pg" package is not installed.');
    logger.error('[db] Run: cd backend && npm install pg');
    logger.error('[db] Falling back to SQLite.');
    return null;
  }

  const { Pool } = pkg.default || pkg;
  // Connection pool tuning: fail fast (5s), recycle idle connections (30s),
  // cap at 10 concurrent connections to avoid overwhelming the DB server.
  const pool = new Pool({
    connectionString:       url,
    ssl:                    { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis:       30000,
    max:                     10,
  });

  // Test connection
  try {
    await pool.query('SELECT 1');
    logger.info('[db] Connected to Postgres.');
  } catch (e) {
    logger.error('[db] Postgres connection failed:', e.message);
    logger.error('[db] Falling back to SQLite.');
    await pool.end().catch(() => {});
    return null;
  }

  // Wrap pool to match sqlite interface
  return {
    get:  async (sql, params = []) => {
      const res = await pool.query(pgSql(sql), params);
      return res.rows[0];
    },
    all:  async (sql, params = []) => {
      const res = await pool.query(pgSql(sql), params);
      return res.rows;
    },
    run:  async (sql, params = []) => {
      // For INSERT: automatically append RETURNING id so lastID is populated.
      // For UPDATE/DELETE: RETURNING id is not appended — lastID stays null.
      const isInsert = /^\s*INSERT/i.test(sql);
      const pgQuery  = isInsert ? pgSql(sql) + ' RETURNING id' : pgSql(sql);
      const res      = await pool.query(pgQuery, params);
      const lastID   = isInsert ? (res.rows[0]?.id ?? null) : null;
      return { lastID, changes: res.rowCount };
    },
    exec: async (sql) => { await pool.query(sql); },
    _pool: pool,
    _type: 'postgres',
  };
}

// Convert SQLite ? placeholders → Postgres $1, $2, … placeholders
function pgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── init ──────────────────────────────────────────────────────────────────────
export async function initDb() {
  if (_db) return _db;

  const pgUrl = process.env.POSTGRES_URL;
  if (pgUrl) {
    logger.info('[db] POSTGRES_URL detected — attempting Postgres connection…');
    const pg = await initPostgres(pgUrl);
    if (pg) {
      _db = pg;
      return _db;
    }
    logger.info('[db] Falling back to SQLite.');
  }

  logger.info('[db] Using SQLite:', DB_PATH);
  _db = await initSqlite();

  // Seed demo data on first boot — ONLY in development
  if (process.env.NODE_ENV !== 'production') {
    await seedDemoData(_db);
  }

  return _db;
}

export async function getDb() {
  if (!_db) await initDb();
  return _db;
}

// Keep backward-compat named export for legacy imports
export { _db as db };

// ── Demo data seed ────────────────────────────────────────────────────────────
async function seedDemoData(db) {
  try {
    const r = await db.get('SELECT COUNT(*) as c FROM resources');
    if (r?.c === 0) {
      await db.run(
        `INSERT INTO resources (title,category,body) VALUES
          ('Know Your Rights','General','You have the right to remain silent and the right to an attorney.'),
          ('DUI Basics','Criminal','First steps after a DUI arrest.'),
          ('Landlord-Tenant','Civil','How to handle rental disputes.')`
      );
    }
  } catch {}

  try {
    const u = await db.get('SELECT id FROM users WHERE email=?', ['demo@justicegavel.app']);
    if (!u) {
      const hash = await bcrypt.hash('password', 10);
      await db.run(
        'INSERT INTO users (email,password_hash,name,is_premium) VALUES (?,?,?,?)',
        ['demo@justicegavel.app', hash, 'Demo User', 0]
      );
    }
  } catch {}

  logger.info('[db] Demo data ready.');
}
