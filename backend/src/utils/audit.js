/**
 * utils/audit.js — Immutable audit trail for all sensitive operations
 *
 * Series A legal compliance requirement:
 * - Tracks all case creation/deletion, account changes, billing events,
 *   attorney verification actions, and AI output generation
 * - Records are append-only (no UPDATE/DELETE on audit_log)
 * - IP address and user agent captured for every event
 * - Used by compliance team and legal counsel in event of dispute
 */

import { getDb }  from '../db/index.js';
import logger     from './logger.js';

export const AUDIT_ACTIONS = {
  // Account
  USER_REGISTERED:          'user.registered',
  USER_LOGIN:               'user.login',
  USER_LOGOUT:              'user.logout',
  USER_DELETED:             'user.deleted',
  PASSWORD_RESET_REQUESTED: 'user.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'user.password_reset_completed',
  EMAIL_VERIFIED:           'user.email_verified',

  // Cases
  CASE_CREATED:             'case.created',
  CASE_UPDATED:             'case.updated',
  CASE_DELETED:             'case.deleted',  // soft delete
  CASE_SHARED:              'case.shared',

  // Billing
  SUBSCRIPTION_STARTED:     'billing.subscription_started',
  SUBSCRIPTION_UPGRADED:    'billing.subscription_upgraded',
  SUBSCRIPTION_CANCELLED:   'billing.subscription_cancelled',
  PAYMENT_SUCCEEDED:        'billing.payment_succeeded',
  PAYMENT_FAILED:           'billing.payment_failed',
  REFUND_ISSUED:            'billing.refund_issued',

  // Attorney platform
  ATTORNEY_VERIFIED:        'attorney.verified',
  ATTORNEY_REJECTED:        'attorney.rejected',
  FIRM_CREATED:             'firm.created',
  MATTER_CREATED:           'matter.created',
  MATTER_DELETED:           'matter.deleted',

  // AI
  AI_CHAT_SESSION:          'ai.chat_session',
  AI_MOTION_GENERATED:      'ai.motion_generated',
  AI_RESEARCH_QUERY:        'ai.research_query',

  // Compliance
  DISCLAIMER_ACCEPTED:      'compliance.disclaimer_accepted',
  DATA_EXPORT_REQUESTED:    'compliance.data_export_requested',
  DATA_DELETION_REQUESTED:  'compliance.data_deletion_requested',

  // Admin
  ADMIN_USER_ACCESSED:      'admin.user_accessed',
  ADMIN_SUBSCRIPTION_MODIFIED: 'admin.subscription_modified',
};

/**
 * Record an audit event.
 * Never throws — audit failures must never block the user action.
 */
export async function audit(action, {
  userId     = null,
  entityType = null,
  entityId   = null,
  metadata   = null,
  req        = null,
} = {}) {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO audit_log
         (user_id, action, entity_type, entity_id, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId     ?? req?.user?.id ?? null,
        action,
        entityType,
        entityId   ? String(entityId) : null,
        req?.ip    ?? req?.headers?.['x-forwarded-for'] ?? null,
        req?.headers?.['user-agent']?.slice(0, 200) ?? null,
        metadata   ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (e) {
    // Audit log failure is non-fatal — log the error but don't throw
    logger.error('[audit] Failed to write audit event:', action, e?.message);
  }
}
