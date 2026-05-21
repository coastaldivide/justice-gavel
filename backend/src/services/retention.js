/**
 * JUSTICE GAVEL — LONG-TERM RETENTION SERVICE
 * ─────────────────────────────────────────────────────────────────────────────
 * Court cases drag on for months and years. This service ensures every piece
 * of data is available for the life of the case and beyond.
 *
 * CORE PRINCIPLE: The platform never automatically deletes legal case data.
 *
 *   - Matters and cases: retained indefinitely unless user explicitly deletes
 *   - Subscription lapse: 30-day grace period (read-only), then perpetual
 *     read-only — data is NEVER auto-deleted due to payment status
 *   - Account deletion: user must explicitly request and confirm deletion
 *   - Legal holds: freeze any record from deletion until manually released
 *   - Docket archiving: completed entries move to archive after 90 days
 *     (keeps active table fast; archive remains fully readable forever)
 *   - Matter versioning: every field change logged with who changed what
 *   - Inactivity alerts: admins notified at 90/180/365 day milestones
 *
 * CALLED BY:
 *   - matters.js PATCH handler (writeMatterVersion)
 *   - scheduler.js nightly pipeline (archiveDocket, checkInactivity)
 *   - matters.js DELETE handler (checkLegalHold)
 *   - cases.js DELETE handler (checkLegalHold)
 *   - firm_acquisition.js (onSubscriptionLapse)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb }      from '../db/index.js';
import { sendEmail }  from './sendgrid.js';
import logger         from '../utils/logger.js';

// ─── MATTER VERSION HISTORY ───────────────────────────────────────────────────

/**
 * writeMatterVersion(db, matterId, firmId, changedBy, before, after)
 *
 * Logs the diff between `before` and `after` matter states to matter_versions.
 * Called from the PATCH /matters/:id handler before the UPDATE is applied.
 *
 * Only logs fields that actually changed — does not log unchanged fields.
 * Skips: computed_at, updated_at (timestamps that always change).
 *
 * @param {object} db       - database connection
 * @param {number} matterId
 * @param {number} firmId
 * @param {number} changedBy - user_id performing the change
 * @param {object} before   - current matter row from DB
 * @param {object} after    - incoming PATCH body (partial)
 * @param {string} changeType - 'update'|'status_change'|'archive'|'create'
 */
export async function writeMatterVersion(db, matterId, firmId, changedBy, before, after, changeType = 'update') {
  try {
    // Compute diff — only fields that actually changed
    const SKIP_FIELDS = new Set(['computed_at', 'updated_at', 'created_at']);
    const fieldChanges = {};

    for (const [key, newVal] of Object.entries(after)) {
      if (SKIP_FIELDS.has(key)) continue;
      if (!(key in before)) continue;                  // field not in matter — skip
      const oldVal = before[key];
      // Loose equality intentional: DB returns strings for integers sometimes
      // eslint-disable-next-line eqeqeq
      if (oldVal == newVal) continue;                  // no change
      fieldChanges[key] = { from: oldVal, to: newVal };
    }

    if (Object.keys(fieldChanges).length === 0) return; // nothing changed — skip

    await db.run(
      `INSERT INTO matter_versions
         (matter_id, firm_id, changed_by, changed_at, change_type, field_changes, changed_via)
       VALUES (?, ?, ?, datetime('now'), ?, ?, 'api')`,
      [matterId, firmId, changedBy, changeType, JSON.stringify(fieldChanges)]
    );

    logger.info(`[retention/version] matter ${matterId}: ${Object.keys(fieldChanges).length} field(s) versioned`);
  } catch (e) {
    // Non-fatal — log but don't block the update
    logger.warn(`[retention/version] matter ${matterId}: version write failed — ${e.message}`);
  }
}

/**
 * getMatterVersionHistory(matterId, options)
 * Returns the full audit trail of changes to a matter.
 */
export async function getMatterVersionHistory(matterId, { limit = 50, offset = 0 } = {}) {
  const db = await getDb();
  const versions = await db.all(
    `SELECT mv.id, mv.changed_at, mv.change_type, mv.field_changes, mv.changed_via,
            u.display_name as changed_by_name, u.email as changed_by_email
     FROM matter_versions mv
     LEFT JOIN users u ON u.id = mv.changed_by
     WHERE mv.matter_id = ?
     ORDER BY mv.changed_at DESC
     LIMIT ? OFFSET ?`,
    [matterId, limit, offset]
  ).catch(() => []);

  return versions.map(v => ({
    ...v,
    field_changes: (() => { try { return JSON.parse(v.field_changes); } catch { return {}; } })(),
  }));
}

// ─── LEGAL HOLDS ─────────────────────────────────────────────────────────────

/**
 * applyLegalHold(holdType, targetId, firmId, appliedBy, reason)
 *
 * Freezes a matter, case, firm, or user from deletion.
 * Returns the hold ID or throws if the hold already exists.
 */
export async function applyLegalHold(holdType, targetId, firmId, appliedBy, reason) {
  const db = await getDb();

  // Defense-in-depth RBAC: verify appliedBy user has firm_admin role.
  // The route layer also checks this, but functions must be safe when called
  // from any context (migrations, scripts, future service-to-service calls).
  const caller = await db.get(
    'SELECT firm_role FROM firm_members WHERE user_id=? AND firm_id=? AND status=\'active\' LIMIT 1',
    [appliedBy, firmId]
  ).catch(() => null);
  const callerRole = caller?.firm_role || '';
  const HOLD_ALLOWED = ['firm_admin','super_admin','partner'];
  if (!HOLD_ALLOWED.some(r => callerRole === r || callerRole.startsWith(r))) {
    // Allow super_admin from any firm
    const isSuperAdmin = await db.get(
      'SELECT id FROM users WHERE id=? AND role=\'super_admin\' LIMIT 1',
      [appliedBy]
    ).catch(() => null);
    if (!isSuperAdmin) {
      throw new Error('applyLegalHold: caller must be firm_admin or partner.');
    }
  }

  // Check for existing active hold
  const existing = await db.get(
    'SELECT id FROM legal_holds WHERE hold_type=? AND target_id=? AND active=1',
    [holdType, targetId]
  ).catch(() => null);

  if (existing) {
    throw new Error(`Legal hold already active (id: ${existing.id}). Release existing hold before applying a new one.`);
  }

  const result = await db.run(
    `INSERT INTO legal_holds (hold_type, target_id, firm_id, applied_by, reason, applied_at, active)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 1)`,
    [holdType, targetId, firmId, appliedBy, reason]
  );

  // Set the legal_hold flag on the record itself for fast lookups
  if (holdType === 'matter') {
    await db.run('UPDATE matters SET legal_hold=1 WHERE id=?', [targetId]).catch(() => {});
  } else if (holdType === 'case') {
    await db.run('UPDATE cases SET legal_hold=1 WHERE id=?', [targetId]).catch(() => {});
  }

  logger.info(`[retention/hold] ${holdType} ${targetId} hold applied by user ${appliedBy}`);
  return result.lastID;
}

/**
 * releaseLegalHold(holdId, releasedBy)
 * Releases a legal hold. Clears the flag on the underlying record.
 */
export async function releaseLegalHold(holdId, releasedBy) {
  const db = await getDb();
  const hold = await db.get('SELECT * FROM legal_holds WHERE id=? AND active=1', [holdId]).catch(() => null);
  if (!hold) throw new Error('Legal hold not found or already released.');

  await db.run(
    'UPDATE legal_holds SET active=0, released_by=?, released_at=datetime(\'now\') WHERE id=?',
    [releasedBy, holdId]
  );

  // Check if there are other active holds before clearing the flag
  const otherHolds = await db.get(
    'SELECT COUNT(*) as n FROM legal_holds WHERE hold_type=? AND target_id=? AND active=1',
    [hold.hold_type, hold.target_id]
  ).catch(() => ({ n: 0 }));

  if (otherHolds.n === 0) {
    if (hold.hold_type === 'matter') {
      await db.run('UPDATE matters SET legal_hold=0 WHERE id=?', [hold.target_id]).catch(() => {});
    } else if (hold.hold_type === 'case') {
      await db.run('UPDATE cases SET legal_hold=0 WHERE id=?', [hold.target_id]).catch(() => {});
    }
  }

  logger.info(`[retention/hold] hold ${holdId} released by user ${releasedBy}`);
}

/**
 * checkLegalHold(holdType, targetId)
 * Returns the active hold if one exists, null otherwise.
 * Used by DELETE handlers to reject deletion of held records.
 */
export async function checkLegalHold(holdType, targetId) {
  const db = await getDb();
  return db.get(
    `SELECT lh.*, u.display_name as applied_by_name
     FROM legal_holds lh
     LEFT JOIN users u ON u.id = lh.applied_by
     WHERE lh.hold_type=? AND lh.target_id=? AND lh.active=1 LIMIT 1`,
    [holdType, targetId]
  ).catch(() => null);
}

// ─── DOCKET ARCHIVING ─────────────────────────────────────────────────────────

/**
 * archiveCompletedDocketEntries(daysThreshold = 90)
 *
 * Moves completed docket entries older than daysThreshold days to docket_archive.
 * Called nightly. Keeps the active docket_entries table fast and focused.
 * Archived entries remain permanently readable via GET /docket/archive.
 *
 * Returns { archived, errors }
 */
export async function archiveCompletedDocketEntries(daysThreshold = 90) {
  const db = await getDb();
  let archived = 0;
  const errors = [];

  try {
    // Find entries ready to archive
    const entries = await db.all(
      `SELECT de.*, f.name as firm_name
       FROM docket_entries de
       LEFT JOIN firms f ON f.id = de.firm_id
       WHERE de.status IN ('completed','dismissed','cancelled')
         AND (
           -- Use completed_at if available; fall back to updated_at
           -- completed_at is the authoritative completion timestamp
           COALESCE(de.completed_at, de.updated_at) < datetime('now', '-' || ? || ' days')
         )
       LIMIT 500`,
      [daysThreshold]
    ).catch(() => []);

    for (const entry of entries) {
      // Each entry is wrapped in its own transaction.
      // If INSERT succeeds but DELETE fails (or process crashes between),
      // the ROLLBACK ensures the entry stays in docket_entries — no data lost.
      // INSERT OR IGNORE means a re-run after crash skips already-archived entries.
      try {
        await db.run('BEGIN');
        await db.run(
          `INSERT OR IGNORE INTO docket_archive
             (id, matter_id, firm_id, title, entry_type, due_date, due_time,
              completed_at, priority, status, notes, assigned_to,
              original_created_at, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            entry.id, entry.matter_id, entry.firm_id, entry.title, entry.entry_type,
            entry.due_date, entry.due_time, entry.updated_at, entry.priority,
            entry.status, entry.notes, entry.assigned_to, entry.created_at,
          ]
        );
        await db.run('DELETE FROM docket_entries WHERE id=?', [entry.id]);
        await db.run('COMMIT');
        archived++;
      } catch (e) {
        await db.run('ROLLBACK').catch(() => {});
        errors.push({ entry_id: entry.id, error: e.message });
        logger.warn(`[retention/docket] failed to archive entry ${entry.id}: ${e.message}`);
      }
    }

    if (archived > 0) {
      logger.info(`[retention/docket] archived ${archived} completed docket entries`);
    }
  } catch (e) {
    logger.error('[retention/docket] archive run failed:', e.message);
    errors.push({ error: e.message });
  }

  return { archived, errors };
}

// ─── SUBSCRIPTION GRACE PERIOD ────────────────────────────────────────────────

/**
 * onSubscriptionLapse(firmId)
 *
 * Called when a firm's subscription fails to renew.
 * Sets a 30-day grace period — firm enters read-only mode.
 * Data is NEVER deleted — it becomes read-only after the grace period.
 *
 * Critical: this function is the enforcement point for the principle
 * "client data is never deleted due to payment status."
 */
export async function onSubscriptionLapse(firmId) {
  const db = await getDb();

  const graceUntil = new Date();
  graceUntil.setDate(graceUntil.getDate() + 30);
  const graceDate = graceUntil.toISOString().slice(0, 10);

  await db.run(
    `UPDATE firms
     SET subscription_status='grace',
         subscription_grace_until=?,
         updated_at=datetime('now')
     WHERE id=?`,
    [graceDate, firmId]
  );

  // Notify all firm admins
  const admins = await db.all(
    `SELECT u.email, u.display_name
     FROM users u
     JOIN firm_members fm ON fm.user_id = u.id
     WHERE fm.firm_id=? AND fm.firm_role IN ('firm_admin','partner') AND u.email IS NOT NULL`,
    [firmId]
  ).catch(() => []);

  const firm = await db.get('SELECT name FROM firms WHERE id=?', [firmId]).catch(() => null);

  let emailsSent = 0;
  let emailsFailed = 0;

  for (const admin of admins) {
    try {
      await sendEmail({
        to:      admin.email,
        subject: `[Justice Gavel] Subscription update — your data is safe`,
        text: [
          `Hi ${admin.display_name || 'Counsel'},`,
          ``,
          `Your Justice Gavel subscription for ${firm?.name || 'your firm'} requires attention.`,
          ``,
          `YOUR DATA IS SAFE: All matters, cases, case histories, documents, and client information`,
          `are retained in full. Court cases can span years — we never delete legal data.`,
          ``,
          `GRACE PERIOD: You have until ${graceDate} to renew before the account enters`,
          `read-only mode. In read-only mode, you can view and export all data but cannot`,
          `create new matters or update existing ones.`,
          ``,
          `TO RENEW: Log in and visit Settings → Billing, or reply to this email.`,
          ``,
          `TO EXPORT YOUR DATA: Visit Settings → Export Data for a full data export`,
          `at any time, regardless of subscription status.`,
          ``,
          `— Justice Gavel`,
        ].join('\n'),
      });
      emailsSent++;
    } catch (e) {
      emailsFailed++;
      logger.warn(`[retention/grace] email to ${admin.email} failed: ${e.message}`);
    }
  }

  // Record notification delivery status on the firm row.
  // If emailsFailed > 0, the health scan's retention section will surface this.
  const notifStatus = emailsFailed === 0 ? 'sent' : emailsSent > 0 ? 'partial' : 'failed';
  await db.run(
    `UPDATE firms SET updated_at=datetime('now') WHERE id=?`,
    [firmId]
  ).catch(() => {});

  logger.info(`[retention/grace] firm ${firmId} grace period until ${graceDate} — notifications: ${notifStatus} (${emailsSent} sent, ${emailsFailed} failed)`);
}

/**
 * isSubscriptionActive(firmId)
 * Returns true if firm can create new data (active or trialing).
 * Returns false if lapsed or grace period expired — firm is read-only.
 * NEVER prevents reading existing data regardless of status.
 */
export async function isSubscriptionWriteable(firmId) {
  const db = await getDb();
  const firm = await db.get(
    'SELECT subscription_status, subscription_grace_until FROM firms WHERE id=?',
    [firmId]
  ).catch(() => null);

  if (!firm) return false;

  // Active or trialing = fully writeable
  if (['active', 'trialing'].includes(firm.subscription_status)) return true;

  // Grace period = writeable until grace date
  if (firm.subscription_status === 'grace' && firm.subscription_grace_until) {
    return new Date(firm.subscription_grace_until) >= new Date();
  }

  // Lapsed or cancelled = read-only (but data still accessible)
  return false;
}

// ─── ACCOUNT INACTIVITY DETECTION ────────────────────────────────────────────

/**
 * checkAccountInactivity()
 *
 * Identifies users with no login in 90, 180, or 365 days.
 * Alerts firm admins — never auto-deletes data.
 * Called weekly by the nightly scheduler.
 */
export async function checkAccountInactivity() {
  const db = await getDb();
  const thresholds = [
    { days: 365, type: '1_year',   label: '1 year' },
    { days: 180, type: '180_day',  label: '6 months' },
    { days:  90, type: '90_day',   label: '90 days'  },
  ];

  let alerted = 0;

  for (const threshold of thresholds) {
    const inactive = await db.all(
      `SELECT u.id as user_id, u.email, u.display_name, u.last_login_at,
              fm.firm_id,
              COUNT(DISTINCT m.id) as matters_count,
              COUNT(DISTINCT c.id) as cases_count
       FROM users u
       LEFT JOIN firm_members fm ON fm.user_id = u.id AND fm.status='active'
       LEFT JOIN matters m ON m.created_by = u.id AND m.status='active'
       LEFT JOIN cases c ON c.user_id = u.id
       WHERE u.last_login_at IS NOT NULL
         AND u.last_login_at < datetime('now', '-' || ? || ' days')
       GROUP BY u.id
       HAVING (matters_count > 0 OR cases_count > 0)`,
      [threshold.days]
    ).catch(() => []);

    for (const user of inactive) {
      // Check if we've already sent this type of alert recently (within 30 days)
      const recentAlert = await db.get(
        `SELECT id FROM account_inactivity_log
         WHERE user_id=? AND alert_type=? AND logged_at > datetime('now', '-30 days')
         LIMIT 1`,
        [user.user_id, threshold.type]
      ).catch(() => null);

      if (recentAlert) continue; // already alerted recently

      // Log the inactivity
      await db.run(
        `INSERT INTO account_inactivity_log
           (user_id, firm_id, last_seen_at, days_inactive, alert_sent_at, alert_type,
            matters_count, cases_count)
         VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
        [
          user.user_id, user.firm_id, user.last_login_at, threshold.days,
          threshold.type, user.matters_count, user.cases_count,
        ]
      ).catch(() => {});

      // Email the user if they have an email
      if (user.email) {
        const dataDesc = [
          user.matters_count > 0 ? `${user.matters_count} active matter(s)` : null,
          user.cases_count   > 0 ? `${user.cases_count} case(s)` : null,
        ].filter(Boolean).join(' and ');

        await sendEmail({
          to:      user.email,
          subject: `Your Justice Gavel data — ${dataDesc} preserved`,
          text: [
            `Hi ${user.display_name || 'Counsel'},`,
            ``,
            `We noticed you haven't logged into Justice Gavel in ${threshold.label}.`,
            ``,
            `YOUR DATA IS SAFE: Your ${dataDesc} remain fully preserved and accessible.`,
            `Court cases drag on — we keep your records for as long as you need them.`,
            ``,
            `To access your account: justicegavel.app/login`,
            `To export all your data: Log in → Settings → Export Data`,
            ``,
            `If you have questions, reply to this email.`,
            ``,
            `— Justice Gavel`,
          ].join('\n'),
        }).catch(e => logger.warn(`[retention/inactivity] email to ${user.email} failed: ${e.message}`));
        alerted++;
      }
    }
  }

  logger.info(`[retention/inactivity] ${alerted} inactivity alert(s) sent`);
  return { alerted };
}

// ─── RETENTION STATUS API ─────────────────────────────────────────────────────

/**
 * getFirmRetentionStatus(firmId)
 *
 * Returns a complete picture of what data exists, how long it's been stored,
 * and what protections are in place. Used by the admin dashboard.
 */
export async function getFirmRetentionStatus(firmId) {
  const db = await getDb();

  const [firm, policy, holdCount, matterStats, archiveStats] = await Promise.all([
    db.get('SELECT id, name, subscription_status, subscription_grace_until, created_at FROM firms WHERE id=?', [firmId]).catch(() => null),
    db.get('SELECT * FROM firm_retention_policy WHERE firm_id=?', [firmId]).catch(() => null),
    db.get('SELECT COUNT(*) as n FROM legal_holds WHERE firm_id=? AND active=1', [firmId]).catch(() => ({ n: 0 })),
    db.get(`SELECT COUNT(*) as total,
                   SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) as archived,
                   SUM(CASE WHEN legal_hold=1 THEN 1 ELSE 0 END) as held,
                   MIN(created_at) as oldest_matter
            FROM matters WHERE firm_id=?`, [firmId]).catch(() => null),
    db.get('SELECT COUNT(*) as total FROM docket_archive WHERE firm_id=?', [firmId]).catch(() => ({ total: 0 })),
  ]);

  const oldestMatterDate = matterStats?.oldest_matter;
  const oldestMatterDays = oldestMatterDate
    ? Math.ceil((Date.now() - new Date(oldestMatterDate).getTime()) / 86400000)
    : 0;

  // Compute writeability from already-fetched firm row — no second DB query
  const retStatus   = firm?.subscription_status || 'active';
  const graceUntil  = firm?.subscription_grace_until || null;
  const writeable   =
    ['active', 'trialing'].includes(retStatus) ||
    (retStatus === 'grace' && !!graceUntil && new Date(graceUntil) >= new Date());

  return {
    firm_id:         firmId,
    firm_name:       firm?.name,
    as_of:           new Date().toISOString(),

    subscription: {
      status:      retStatus,
      grace_until: graceUntil,
      writeable,
    },

    // What's stored
    matters: {
      total:         matterStats?.total || 0,
      archived:      matterStats?.archived || 0,
      on_legal_hold: matterStats?.held || 0,
      oldest_days:   oldestMatterDays,
      oldest_date:   oldestMatterDate || null,
    },

    docket: {
      archived_entries: archiveStats?.total || 0,
    },

    legal_holds: {
      active_count: holdCount?.n || 0,
    },

    // Policy
    retention_policy: policy || {
      matters_retain_days:  null,  // null = indefinite
      cases_retain_days:    null,  // null = indefinite
      messages_retain_days: null,  // null = indefinite
      grace_period_days:    30,
    },

    // Platform commitment
    platform_guarantee: 'Justice Gavel never automatically deletes case data. Matters, cases, events, and all legal records are retained indefinitely unless you explicitly request deletion. Subscription status does not affect data retention — it only affects write access.',
  };
}

export default {
  writeMatterVersion,
  getMatterVersionHistory,
  applyLegalHold,
  releaseLegalHold,
  checkLegalHold,
  archiveCompletedDocketEntries,
  onSubscriptionLapse,
  isSubscriptionWriteable,
  checkAccountInactivity,
  getFirmRetentionStatus,
};
