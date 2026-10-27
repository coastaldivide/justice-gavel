/**
 * accountDeletion.js — complete, consistent account deletion and data export.
 *
 * One registry (USER_REFS) classifies EVERY column in the schema that holds a
 * users.id. account_deletion.int.test.js scans the migrated schema and fails
 * when a new user-referencing column is not classified here, so a new table
 * can never silently leave orphans behind or be missed by the export.
 *
 *   'delete'   the row is the user's own data → deleted (and exported)
 *   'nullify'  the row belongs to someone else (a firm's matter, a staff
 *              review, an anonymised ledger) → the reference is cleared
 *   'retain'   never touched (reason given) — e.g. provider directory rows,
 *              which the owner has ruled are never modified
 *
 * CASE_CHILDREN lists every table keyed by case_id: rows hanging off the
 * user's own cases are deleted (or their case link cleared) before the cases
 * go, so other users' tables never point at a deleted case.
 *
 * Firms the user owns: if other members remain, ownership passes to the
 * longest-standing remaining member (promoted to firm_admin when the firm
 * would otherwise have none) instead of deleting everyone's firm data; a firm
 * with no other members is deleted with its data.
 */
import { decrypt } from './encryption.js';

export const USER_REFS = {
  // ── the user's own data ────────────────────────────────────────────────
  'ability_to_pay.user_id': 'delete',
  'account_inactivity_log.user_id': 'delete',
  'ai_job_state.user_id': 'delete',
  'ai_jobs.user_id': 'delete',
  'alert_log.user_id': 'delete',
  'arrest_monitors.user_id': 'delete',
  'attorney_alerts.recipient_id': 'delete',
  'attorney_profiles.user_id': 'delete',
  'bar_prep_progress.user_id': 'delete',
  'bondsman_profiles.user_id': 'delete',
  'bondsman_subscriptions.user_id': 'delete',
  'callback_requests.user_id': 'delete',
  'case_assignments.defender_id': 'delete',
  'case_assignments.user_id': 'delete',
  'case_events.user_id': 'delete',
  'case_family_access.user_id': 'delete',
  'case_messages.sender_id': 'delete',
  'case_messages.user_id': 'delete',
  'case_status_history.user_id': 'delete',
  'cases.user_id': 'delete',
  'chat_messages.user_id': 'delete',
  'chat_sessions.user_id': 'delete',
  'checkin_records.user_id': 'delete',
  'checkins.user_id': 'delete',
  'civil_attorney_profiles.user_id': 'delete',
  'civil_lead_purchases.attorney_id': 'delete',
  'civil_leads.submitter_user_id': 'delete',
  'cle_completions.user_id': 'delete',
  'client_assignments.attorney_id': 'delete',
  'client_assignments.client_id': 'delete',
  'client_assignments.user_id': 'delete',
  'codefendant_links.user_id': 'delete',
  'consultation_bookings.user_id': 'delete',
  'consultations.user_id': 'delete',
  'court_dates.user_id': 'delete',
  'idempotency_keys.user_id': 'delete',   // cached create responses (migration 21)
  'listing_claims.user_id': 'delete',
  'contract_executions.user_id': 'delete',
  'contract_redlines.user_id': 'delete',
  'contract_reviews.user_id': 'delete',
  'contracts.user_id': 'delete',
  'discovery_analyses.user_id': 'delete',
  'eviction_trackers.user_id': 'delete',
  'expungement_applications.user_id': 'delete',
  'expungement_check_log.user_id': 'delete',
  'expungement_referrals.user_id': 'delete',
  'family_contacts.user_id': 'delete',
  'firm_members.user_id': 'delete',
  'firm_trials.user_id': 'delete',
  'forum_posts.user_id': 'delete',
  'funnel_events.user_id': 'delete',
  'golden_gavel.user_id': 'delete',
  'golden_gavel_hall.user_id': 'delete',
  'golden_gavel_log.user_id': 'delete',
  'hague_intakes.user_id': 'delete',
  'integration_connections.user_id': 'delete',
  'integration_external_ids.user_id': 'delete',
  'last_active.user_id': 'delete',
  'lesson_progress.user_id': 'delete',
  'material_support_screening.user_id': 'delete',
  'matter_team_members.user_id': 'delete',
  'matter_teams.user_id': 'delete',
  'message_attachments.uploader_id': 'delete',
  'messages.recipient_id': 'delete',
  'messages.sender_id': 'delete',
  'motion_history.user_id': 'delete',
  'motions.user_id': 'delete',
  'office_members.user_id': 'delete',
  'offline_cases.user_id': 'delete',
  'padilla_warnings.user_id': 'delete',
  'password_resets.user_id': 'delete',
  'pi_leads.user_id': 'delete',
  'push_tickets.user_id': 'delete',
  'push_tokens.user_id': 'delete',
  'quiz_answers.user_id': 'delete',
  'quiz_question_flags.user_id': 'delete',
  'quiz_sessions.user_id': 'delete',
  'referrals.owner_user_id': 'delete',
  'refresh_tokens.user_id': 'delete',
  'research_sessions.user_id': 'delete',
  'review_reports.user_id': 'delete',
  'reviews.user_id': 'delete',
  'reviews_app.user_id': 'delete',
  'rewards.user_id': 'delete',
  'saved_lawyers.user_id': 'delete',
  'scheduled_pushes.user_id': 'delete',
  'session_events.user_id': 'delete',
  'spaced_repetition_state.user_id': 'delete',
  'study_streaks.user_id': 'delete',
  'subscriptions.user_id': 'delete',
  'translation_sessions.user_id': 'delete',
  'user_badges.user_id': 'delete',
  'user_disclaimer_acceptance.user_id': 'delete',
  'user_subscriptions.user_id': 'delete',
  'verified_badge_subscriptions.user_id': 'delete',
  'video_sessions.user_id': 'delete',
  'web_push_subscriptions.user_id': 'delete',
  'workspaces.owner_id': 'delete',

  // ── someone else's record that mentions the user: clear the reference ──
  'ability_to_pay.created_by': 'nullify',
  'ability_to_pay.reviewed_by': 'nullify',
  'account_deletion_log.deleted_by': 'nullify',
  'account_deletion_log.user_id': 'nullify',
  'ai_token_usage.user_id': 'nullify',          // cost ledger, anonymised
  'ai_usage_log.user_id': 'nullify',            // cost ledger, anonymised
  'arrest_takedown_log.requested_by': 'nullify',
  'arrest_takedown_log.reviewed_by': 'nullify',
  'arrest_takedown_log.taken_down_by': 'nullify',
  'audit_log.user_id': 'nullify',               // audit trail kept, anonymised
  'bop_exhaustion.created_by': 'nullify',
  'case_assignments.assigned_by': 'nullify',
  'case_family_access.invited_by': 'nullify',
  'listing_reports.reporter_user_id': 'nullify',
  'listing_reports.reviewed_by': 'nullify',
  'reviews.moderated_by': 'nullify',
  'listing_claims.decided_by': 'nullify',
  'cases.attorney_id': 'nullify',
  'cases.outcome_recorded_by': 'nullify',
  'checkin_enrollments.bondsman_id': 'nullify',
  'checkin_enrollments.enrolled_by': 'nullify',
  'checkin_enrollments.user_id': 'nullify',     // the bondsman's enrolment record
  'checkin_agent_settings.agent_id': 'delete',  // the agent's own alert choice (text me when a check-in is missed)
  'codefendant_links.created_by': 'nullify',
  'collateral_consequences.created_by': 'nullify',
  'conflict_waivers.authorized_by': 'nullify',
  'conflict_waivers.client_id': 'nullify',
  'docket_archive.assigned_to': 'nullify',
  'docket_entries.assigned_to': 'nullify',
  'docket_entries.created_by': 'nullify',
  'docket_entries.user_id': 'nullify',          // firm docket
  'dual_sovereignty_flags.created_by': 'nullify',
  'dv_firearm_surrender.created_by': 'nullify',
  'ethics_wall_log.reviewed_by': 'nullify',
  'ethics_wall_log.screened_user_id': 'nullify',
  'ethics_wall_log.set_by': 'nullify',
  'eviction_trackers.created_by': 'nullify',
  'feedback.user_id': 'nullify',                // anonymous feedback stays
  'firm_invites.invited_by': 'nullify',
  'firm_members.invited_by': 'nullify',
  'firm_retention_policy.updated_by': 'nullify',
  'firm_upgrade_requests.requested_by': 'nullify',
  'firm_upgrade_requests.reviewed_by': 'nullify',
  'hague_intakes.submitted_by': 'nullify',
  'hague_proceedings.created_by': 'nullify',
  'invoices.created_by': 'nullify',
  'lead_alert_log.user_id': 'delete',            // which new-arrest alerts were pushed (dedupe only)
  'lead_purchases.bondsman_id': 'nullify',      // payment ledger
  'lead_purchases.bondsman_user_id': 'nullify', // payment ledger
  'legal_holds.applied_by': 'nullify',
  'legal_holds.released_by': 'nullify',
  'material_support_screening.screened_by': 'nullify',
  'matter_events.user_id': 'nullify',
  'matter_team_members.added_by': 'nullify',
  'matter_teams.added_by': 'nullify',
  'matter_versions.changed_by': 'nullify',
  'matters.assigned_attorney_id': 'nullify',
  'matters.created_by': 'nullify',
  'matters.user_id': 'nullify',                 // the firm's matter
  'mission_verification_requests.submitted_by': 'nullify',
  'motion_templates.approved_by': 'nullify',
  'motion_templates.created_by': 'nullify',
  'outbound_messages.recipient_id': 'nullify',
  'padilla_warnings.given_by': 'nullify',
  'padilla_warnings.issued_by': 'nullify',
  'payment_history.user_id': 'nullify',         // payment ledger
  'payment_links.recipient_id': 'nullify',
  'pi_leads.accepted_by': 'nullify',
  'pi_leads.attorney_id': 'nullify',
  'pi_leads.bondsman_id': 'nullify',
  'plea_offers.created_by': 'nullify',
  'privilege_log.created_by': 'nullify',
  'privilege_log.reviewed_by': 'nullify',
  'provider_update_log.updated_by': 'nullify',
  'provider_update_proposals.decided_by': 'nullify',
  'refund_requests.user_id': 'nullify',         // payment ledger
  'soc2_controls.reviewed_by': 'nullify',
  'sso_configurations.created_by': 'nullify',
  'time_entries.user_id': 'nullify',            // the firm's billing record
  'tos_acceptance_log.user_id': 'nullify',
  'translation_sessions.defender_id': 'nullify',
  'translation_sessions.participant_id': 'nullify',
  'users.bar_verified_by': 'nullify',
  'video_sessions.attorney_id': 'nullify',
  'voluntary_departure.created_by': 'nullify',
  'vop_trackers.created_by': 'nullify',
  'webhook_subscriptions.created_by': 'nullify',

  // ── never touched ──────────────────────────────────────────────────────
  'firms.owner_id': 'retain',   // handled by transferOrDeleteFirms() first
  'lawyers.user_id': 'retain',  // verified directory rows are never modified (owner rule)
  // ── Bond Desk (docs/BOND_DESK.md) and the Case Pass ─────────────────────
  // powers first: deleting a bond would set an executed power's bond_id to NULL, which its CHECK refuses
  'bd_powers.agent_id': 'delete',
  'bd_bonds.agent_id': 'delete',        // the agent's own bond book (indemnitors, ledger, packets cascade)
  'bd_forms.agent_id': 'delete',
  'bd_counters.agent_id': 'delete',
  'bd_packets.agent_id': 'delete',
  'bd_payments.agent_id': 'delete',
  'bd_collateral.agent_id': 'delete',
  'bd_charges.created_by': 'nullify',
  'bd_payments.created_by': 'nullify',
  'bd_texts.agent_id': 'retain',        // billing record of texts charged at 5¢ (masked number only)
  'bd_text_batches.agent_id': 'retain', // invoice items already billed in Stripe
  'bd_uploads.signer_id': 'retain',     // bd_signers.id (a signing link), not a users.id
  'bd_events.signer_id': 'retain',      // bd_signers.id, not a users.id
  'bd_documents.signer_id': 'retain',   // bd_signers.id, not a users.id
  // card payments, staff, forms setup (migration 37)
  'bd_connect_accounts.agent_id': 'delete',   // the agency's link to its own Stripe Express account (the account and its money stay with Stripe)
  'bd_autopay.agent_id': 'delete',            // payers' automatic-payment set-ups (Stripe ids + consent snapshots)
  'bd_pay_requests.agent_id': 'delete',       // pay-page payments (the money is in the agency's own Stripe account)
  'bd_setup_requests.agent_id': 'delete',
  'bd_setup_requests.handled_by': 'nullify',  // the staff member who set the forms up
  'bd_staff.user_id': 'delete',               // the user's own seat in another agency
  'bd_staff.owner_id': 'delete',              // the agency's staff lose access with it
  'bd_staff_invites.owner_id': 'delete',
  'bd_staff_invites.accepted_user_id': 'nullify',
  'case_passes.user_id': 'delete',
  'attorney_lead_credits.attorney_id': 'delete', // prepaid lead-credit ledger (payments stay in Stripe)
};

/** Rows keyed by case_id: what happens to them when one of the user's cases goes. */
export const CASE_CHILDREN = {
  ability_to_pay: 'delete',
  case_assignments: 'delete',
  case_events: 'delete',
  case_family_access: 'delete',
  case_messages: 'delete',
  case_status_history: 'delete',
  cases_fts: 'delete',
  client_assignments: 'delete',
  codefendant_links: 'delete',
  court_dates: 'delete',
  discovery_analyses: 'nullify',
  evidence_score: 'delete',
  expungement_applications: 'nullify',
  expungement_check_log: 'nullify',
  expungement_referrals: 'nullify',
  hague_intakes: 'nullify',
  material_support_screening: 'delete',
  matter_parties: 'nullify',
  matter_team_members: 'nullify',
  message_attachments: 'delete',
  messages: 'nullify',
  motion_history: 'nullify',
  motions: 'nullify',
  padilla_warnings: 'nullify',
  scheduled_pushes: 'delete',
  translation_sessions: 'nullify',
};

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier: ${s}`);
  return `"${s}"`;
};
const split = (ref) => { const [t, c] = ref.split('.'); return [ident(t), ident(c)]; };
const MISSING = new Set(['42P01', '42703']);   // table / column absent (schema drift)

/** Run one statement inside a SAVEPOINT; a missing table/column is skipped. */
async function step(tx, sql, params) {
  await tx.run('SAVEPOINT purge_step');
  try {
    const r = await tx.run(sql, params);
    await tx.run('RELEASE SAVEPOINT purge_step');
    return r;
  } catch (e) {
    await tx.run('ROLLBACK TO SAVEPOINT purge_step');
    if (!MISSING.has(e.code)) throw e;
    return null;
  }
}
async function stepAll(tx, sql, params) {
  await tx.run('SAVEPOINT purge_step');
  try {
    const rows = await tx.all(sql, params);
    await tx.run('RELEASE SAVEPOINT purge_step');
    return rows;
  } catch (e) {
    await tx.run('ROLLBACK TO SAVEPOINT purge_step');
    if (!MISSING.has(e.code)) throw e;
    return [];
  }
}

const ROLE_RANK = "CASE COALESCE(firm_role, role) WHEN 'firm_admin' THEN 0 WHEN 'super_admin' THEN 0 WHEN 'partner' THEN 1 ELSE 2 END";

async function transferOrDeleteFirms(tx, uid) {
  const firms = await stepAll(tx, 'SELECT id FROM firms WHERE owner_id = ?', [uid]);
  const result = { transferred: [], deleted: [] };
  for (const { id } of firms) {
    const heir = (await stepAll(tx,
      `SELECT user_id FROM firm_members WHERE firm_id = ? AND user_id <> ? AND COALESCE(active, 1) = 1
        ORDER BY ${ROLE_RANK}, id ASC LIMIT 1`, [id, uid]))[0];
    if (heir) {
      await step(tx, 'UPDATE firms SET owner_id = ? WHERE id = ?', [heir.user_id, id]);
      const admins = (await stepAll(tx,
        "SELECT COUNT(*) AS n FROM firm_members WHERE firm_id = ? AND user_id <> ? AND COALESCE(active, 1) = 1 AND COALESCE(firm_role, role) IN ('firm_admin','super_admin')", [id, uid]))[0];
      if (!Number(admins?.n)) {
        await step(tx, "UPDATE firm_members SET firm_role = 'firm_admin', role = 'firm_admin' WHERE firm_id = ? AND user_id = ?", [id, heir.user_id]);
      }
      result.transferred.push({ firm_id: Number(id), new_owner_id: Number(heir.user_id) });
    } else {
      await step(tx, 'DELETE FROM firms WHERE id = ?', [id]);
      result.deleted.push(Number(id));
    }
  }
  return result;
}

/**
 * Delete everything that belongs to the account, inside `tx`
 * (db.transaction); the caller then deletes the users row in the same
 * transaction. Returns { attachmentKeys, firms } — the caller removes the
 * attachment files after commit.
 */
export async function purgeAccountData(tx, uid, { email = null } = {}) {
  const attachmentKeys = await stepAll(tx, 'SELECT storage, storage_key FROM message_attachments WHERE uploader_id = ? OR case_id IN (SELECT id FROM cases WHERE user_id = ?)', [uid, uid]);

  // 1. rows hanging off the user's own cases
  for (const [table, action] of Object.entries(CASE_CHILDREN)) {
    const t = ident(table);
    // ::text on both sides — one legacy table (hague_intakes) keys case_id as text.
    const mine = 'case_id::text IN (SELECT id::text FROM cases WHERE user_id = ?)';
    await step(tx, action === 'delete'
      ? `DELETE FROM ${t} WHERE ${mine}`
      : `UPDATE ${t} SET case_id = NULL WHERE ${mine}`, [uid]);
  }

  // 2. firms the user owns
  const firms = await transferOrDeleteFirms(tx, uid);

  // 2b. listing reports stay in the admin queue, but their reporter_key is a
  //     hash of the user id (sequential, so trivially reversible): replace it
  //     before the reporter link is cleared, so the report cannot be tied
  //     back to the deleted account.
  await step(tx, `UPDATE listing_reports SET reporter_key = 'deleted:' || id::text WHERE reporter_user_id = ?`, [uid]);

  // 3. other people's records: clear the reference
  for (const [ref, action] of Object.entries(USER_REFS)) {
    if (action !== 'nullify') continue;
    const [t, c] = split(ref);
    await step(tx, `UPDATE ${t} SET ${c} = NULL WHERE ${c} = ?`, [uid]);
  }

  // 4. the user's own rows (cases last so children above are already gone)
  const deletes = Object.entries(USER_REFS).filter(([, a]) => a === 'delete').map(([r]) => r);
  deletes.sort((a, b) => (a === 'cases.user_id') - (b === 'cases.user_id'));
  for (const ref of deletes) {
    const [t, c] = split(ref);
    await step(tx, `DELETE FROM ${t} WHERE ${c} = ?`, [uid]);
  }

  // 5. pending invitations addressed to the user's e-mail
  if (email) await step(tx, 'DELETE FROM firm_invites WHERE LOWER(email) = LOWER(?)', [email]);

  return { attachmentKeys, firms };
}

// ── Export ──────────────────────────────────────────────────────────────────
const NEVER_EXPORT_TABLES = new Set(['refresh_tokens', 'password_resets', 'idempotency_keys']);
const SECRET_COL = /(password|token|secret|hash|api_key|private_key|encryption|iv$|auth_tag)/i;
const ENCRYPTED = { cases: ['notes'], case_messages: ['body', 'content'], messages: ['body', 'content'] };
const EXPORT_LIMIT = 1000;

const USER_COLS = 'id, email, phone, name, display_name, role, subscription_tier, account_status, state, created_at, updated_at, tos_version_accepted, tos_accepted_at';

/**
 * Everything the account holds, grouped by table — the same registry the
 * deletion uses, so "export" and "delete" always cover the same data.
 * Secrets (password/token hashes, OAuth tokens) are omitted; encrypted case
 * notes and messages are decrypted for their owner.
 */
export async function exportAccount(db, uid) {
  const profile = await db.get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [uid]).catch(() =>
    db.get('SELECT id, email, phone, display_name, role, created_at FROM users WHERE id = ?', [uid]));
  const data = {};
  const truncated = [];
  const owned = Object.entries(USER_REFS).filter(([, a]) => a === 'delete').map(([r]) => r.split('.'));
  for (const [table, col] of owned) {
    if (NEVER_EXPORT_TABLES.has(table)) continue;
    let rows;
    try {
      rows = await db.all(`SELECT * FROM ${ident(table)} WHERE ${ident(col)} = ? ORDER BY 1 DESC LIMIT ${EXPORT_LIMIT + 1}`, [uid]);
    } catch (e) {
      if (MISSING.has(e.code) || /no such table|no such column/i.test(e.message)) continue;
      throw e;
    }
    if (!rows.length) continue;
    if (rows.length > EXPORT_LIMIT) { rows = rows.slice(0, EXPORT_LIMIT); truncated.push(table); }
    const enc = ENCRYPTED[table] || [];
    const seen = new Set((data[table] || []).map(r => r.id));
    rows = rows.filter(r => r.id == null || !seen.has(r.id));
    data[table] = [...(data[table] || []), ...rows.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        if (enc.includes(k) && v) { try { out[k] = decrypt(v); } catch { out[k] = '[unreadable]'; } continue; }
        out[k] = SECRET_COL.test(k) && v != null ? '[omitted]' : v;
      }
      return out;
    })];
  }
  return { profile, data, truncated };
}
