/**
 * middleware/rbac.js — Role-Based Access Control for Justice Gavel Year 1
 *
 * Exports:
 *   ROLE_HIERARCHY, ROLE_ALIASES, resolveRole(), roleLevel(), hasMinRole()
 *   loadFirmContext(req)                    — loads firm membership, caches on req.firmCtx
 *   requireFirmRole(minRole)                — firm membership + role check middleware
 *   requirePermission(resource, action)     — DB-backed permission check middleware
 *   requireMatterAccess(opts)               — matter team membership + ethics wall middleware
 *   auditLog(action, targetType)            — async audit trail middleware (non-blocking)
 *   checkConflicts(db, firmId, partyNames)  — advisory conflict check utility
 *
 * Role hierarchy (index = authority, higher = more access):
 *   viewer(0) < client(1) < paralegal(2) < associate(3) < partner(4) < firm_admin(5) < super_admin(6)
 *
 * All middleware assumes authRequired has already run (req.user populated from JWT).
 * Firm context is loaded from DB once per request and cached on req.firmCtx.
 */

import { getDb }  from '../db/index.js';
import logger     from '../utils/logger.js';

// ── Role hierarchy ─────────────────────────────────────────────────────────────
// ROLES and ROLE_HIERARCHY are the same array — ROLES kept for backward compat
export const ROLE_HIERARCHY = [
  'viewer',       // 0 — read-only, specific shared matters
  'client',       // 1 — read own matters, send messages
  'paralegal',    // 2 — read assigned matters, limited write
  'associate',    // 3 — read/write assigned matters
  'partner',      // 4 — full matter access, can approve, can manage team
  'firm_admin',   // 5 — full firm access, manage members
  'super_admin',  // 6 — cross-firm system access
];
export const ROLES = [...ROLE_HIERARCHY].reverse(); // backward compat — highest first

/**
 * ROLE_ALIASES — maps simulation-derived granular role titles to their canonical
 * ROLE_HIERARCHY tier. Every role that appears in firm_members.firm_role must be
 * represented here OR in ROLE_HIERARCHY so hasMinRole() resolves correctly.
 *
 * Tier mapping rationale:
 *   partner-equiv  → 'partner'    : lead attorneys, managing/senior partners
 *   associate-equiv → 'associate' : co-counsel, senior/junior associates, clerks
 *   paralegal-equiv → 'paralegal' : non-attorney professionals
 */
export const ROLE_ALIASES = {
  // ── Partner-tier (authority level 4) ──────────────────────────────────
  managing_partner:          'partner',
  senior_partner:            'partner',
  lead_partner:              'partner',
  lead_esquire:             'partner',
  lead_trial_esquire:       'partner',
  lead_appellate:            'partner',
  supervising_pd:            'partner',
  supervising_esquire:      'partner',
  senior_family_esquire:    'partner',
  senior_military_esquire:  'partner',
  // ── Associate-tier (authority level 3) ────────────────────────────────
  co_counsel:                'associate',
  senior_associate:          'associate',
  junior_associate:          'associate',
  associate_juvenile:        'associate',
  military_associate:        'associate',
  staff_pd:                  'associate',
  law_student_intern:        'associate',
  // ── Paralegal-tier (authority level 2) ────────────────────────────────
  law_clerk:                 'paralegal',
  investigator:              'paralegal',
  compliance_analyst:        'paralegal',
  forensic_accountant:       'paralegal',
  guardian_ad_litem:         'paralegal',
  case_manager:              'paralegal',
  mitigation_specialist:     'paralegal',
  interpreter:               'paralegal',
  expert_witness:            'paralegal',
};

/** Resolve an aliased role to its canonical ROLE_HIERARCHY tier. */
export function resolveRole(role) {
  return ROLE_ALIASES[role] ?? role;
}

export function roleLevel(role) {
  const canonical = resolveRole(role);
  const idx = ROLE_HIERARCHY.indexOf(canonical);
  return idx === -1 ? -1 : idx;
}

export function hasMinRole(userRole, minRole) {
  return roleLevel(userRole) >= roleLevel(minRole);
}

// ── Permission matrix (in-memory, seeded into DB) ─────────────────────────────
// Format: PERMISSIONS[resource][action] = minimum_firm_role
export const PERMISSIONS = {
  cases: {
    read:    'viewer',
    write:   'associate',
    delete:  'partner',
    export:  'associate',
  },
  contracts: {
    read:      'viewer',
    write:     'associate',
    delete:    'partner',
    approve:   'partner',
    sign:      'partner',
    export:    'associate',
  },
  motions: {
    read:   'paralegal',
    write:  'associate',
    delete: 'associate',
    file:   'partner',
  },
  messages: {
    read:   'viewer',
    write:  'paralegal',
    delete: 'associate',
  },
  billing: {
    read:  'partner',
    write: 'firm_admin',
  },
  users: {
    read:         'partner',
    write:        'firm_admin',
    invite:       'firm_admin',
    remove:       'firm_admin',
    change_role:  'firm_admin',
  },
  admin: {
    read:  'firm_admin',
    write: 'super_admin',
  },
  audit: {
    read:   'partner',
    export: 'firm_admin',
  },
};

// ── loadFirmContext ───────────────────────────────────────────────────────────
// Loads firm membership from DB and caches on req.firmCtx.
// Returns null if user is not a member of any firm.
export async function loadFirmContext(req) {
  if (req.firmCtx !== undefined) return req.firmCtx;

  try {
    const db     = await getDb();
    const member = await db.get(
      `SELECT fm.firm_id, fm.firm_role, fm.status,
              f.name  AS firm_name,
              f.plan  AS firm_plan,
              f.seat_limit
       FROM firm_members fm
       JOIN firms f ON f.id = fm.firm_id
       WHERE fm.user_id = ? AND fm.status = 'active'
       ORDER BY fm.firm_id ASC LIMIT 1`,
      [req.user.id]
    ).catch(() => null);

    req.firmCtx = member || null;
  } catch {
    req.firmCtx = null;
  }
  return req.firmCtx;
}

// ── requireFirmRole ──────────────────────────────────────────────────────────
// User must be an active firm member with at least minRole.
export function requireFirmRole(minRole) {
  return async function rbacFirmRole(req, res, next) {
    try {
      const ctx = await loadFirmContext(req);
      // Resolve role: DB firm membership first, then JWT firm_role, then JWT role
      const resolvedRole = ctx?.firm_role || req.user?.firm_role || req.user?.role || null;
      if (!resolvedRole) {
        return res.status(403).json({
          error: 'Firm membership required.',
          code:  'no_firm_membership',
        });
      }
      if (!hasMinRole(resolvedRole, minRole)) {
        return res.status(403).json({
          error:    `Requires ${minRole} role or higher. Your role: ${resolvedRole}.`,
          code:     'insufficient_role',
          required: minRole,
          actual:   resolvedRole,
        });
      }
      next();
    } catch (e) {
      logger.error('[rbac/requireFirmRole]', e.message);
      res.status(500).json({ error: 'Authorization check failed.' });
    }
  };
}

// ── requirePermission ────────────────────────────────────────────────────────
// User must have this resource+action in their role_permissions row.
// Checks the DB table (seeded by db/index.js) so permissions are runtime-editable.
export function requirePermission(resource, action) {
  return async function rbacPermission(req, res, next) {
    try {
      const ctx = await loadFirmContext(req);
      if (!ctx) {
        return res.status(403).json({
          error: 'Firm membership required.',
          code:  'no_firm_membership',
        });
      }

      // super_admin bypasses all permission checks
      if (ctx.firm_role === 'super_admin') return next();

      const db   = await getDb();
      const perm = await db.get(
        'SELECT id FROM role_permissions WHERE firm_role=? AND resource=? AND action=?',
        [ctx.firm_role, resource, action]
      ).catch(() => null);

      if (!perm) {
        // Fallback: check in-memory matrix
        const minRoleFromMatrix = PERMISSIONS[resource]?.[action];
        if (!minRoleFromMatrix || !hasMinRole(ctx.firm_role, minRoleFromMatrix)) {
          return res.status(403).json({
            error:    `Your role (${ctx.firm_role}) lacks ${action} on ${resource}.`,
            code:     'permission_denied',
            required: { resource, action },
            role:     ctx.firm_role,
          });
        }
      }

      next();
    } catch (e) {
      logger.error('[rbac/requirePermission]', e.message);
      res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

// ── requireMatterAccess ──────────────────────────────────────────────────────
// User must be on the matter team (matter_team_members) or own the case.
// opts:
//   minRole:        minimum matter_role to proceed (default: 'viewer')
//   requireEdit:    must have can_edit = 1
//   requireMessage: must have can_message = 1
//   idParam:        req.params key for case ID (default: 'id')
export function requireMatterAccess(opts = {}) {
  const {
    minRole        = 'viewer',
    requireEdit    = false,
    requireMessage = false,
    idParam        = 'id',
  } = opts;

  return async function rbacMatterAccess(req, res, next) {
    try {
      const db     = await getDb();
      const caseId = parseInt(req.params[idParam] || req.params.caseId, 10);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: 'Invalid matter ID.' });
      }

      // 1. Case owner → lead_partner access
      const owned = await db.get(
        'SELECT id FROM cases WHERE id=? AND user_id=?',
        [caseId, req.user.id]
      ).catch(() => null);

      if (owned) {
        req.matterAccess = {
          matter_role: 'lead_partner',
          can_edit:    1,
          can_message: 1,
          can_view_docs: 1,
          ethics_wall: 0,
        };
        return next();
      }

      // 2. Firm admin/super_admin bypass matter-team check (but still log)
      const ctx = await loadFirmContext(req);
      if (ctx && hasMinRole(ctx.firm_role, 'firm_admin')) {
        req.matterAccess = {
          matter_role: ctx.firm_role,
          can_edit:    1,
          can_message: 1,
          can_view_docs: 1,
          ethics_wall: 0,
        };
        return next();
      }

      // 3. Matter team member
      const member = await db.get(
        `SELECT matter_role, can_edit, can_message, can_view_docs, ethics_wall
         FROM matter_team_members
         WHERE case_id=? AND user_id=?`,
        [caseId, req.user.id]
      ).catch(() => null);

      if (!member) {
        // 4. Legacy: family access (backward compat with case_family_access)
        const family = await db.get(
          `SELECT 1 FROM case_family_access
           WHERE case_id=? AND user_id=? AND accepted=1`,
          [caseId, req.user.id]
        ).catch(() => null);

        if (family) {
          req.matterAccess = {
            matter_role: 'client',
            can_edit: 0, can_message: 1, can_view_docs: 1, ethics_wall: 0,
          };
          return next();
        }

        return res.status(403).json({
          error: 'You are not a member of this matter team.',
          code:  'not_matter_member',
        });
      }

      // 5. Ethics wall — hard block, no override
      if (member.ethics_wall) {
        return res.status(403).json({
          error: 'Access to this matter is restricted by an ethics wall.',
          code:  'ethics_wall',
        });
      }

      // 6. Role level check
      const effectiveRole = member.matter_role === 'lead_partner' ? 'partner'
                          : member.matter_role === 'co_counsel'   ? 'partner'
                          : member.matter_role || 'viewer';
      if (!hasMinRole(effectiveRole, minRole)) {
        return res.status(403).json({
          error:    `Requires ${minRole} role on this matter. Your role: ${member.matter_role}.`,
          code:     'insufficient_matter_role',
          required: minRole,
          actual:   member.matter_role,
        });
      }

      // 7. Edit / message capability checks
      if (requireEdit && !member.can_edit) {
        return res.status(403).json({
          error: 'You do not have edit access to this matter.',
          code:  'no_edit_permission',
        });
      }
      if (requireMessage && !member.can_message) {
        return res.status(403).json({
          error: 'You do not have messaging access to this matter.',
          code:  'no_message_permission',
        });
      }

      req.matterAccess = member;
      next();
    } catch (e) {
      logger.error('[rbac/requireMatterAccess]', e.message);
      res.status(500).json({ error: 'Matter access check failed.' });
    }
  };
}

// ── auditLog ──────────────────────────────────────────────────────────────────
// Post-handler audit trail — wraps res.json to capture response, writes async.
// Never blocks or fails the response.
//
// Usage:
//   router.post('/cases', authRequired, auditLog('create','case'), handler)
export function auditLog(action, targetType = null) {
  return function rbacAuditLog(req, res, next) {
    const origJson = res.json.bind(res);

    res.json = function auditedJson(body) {
      // Fire-and-forget — never await, never throw
      setImmediate(async () => {
        try {
          const db  = await getDb();
          const ctx = req.firmCtx || await loadFirmContext(req).catch(() => null);

          const targetId = (() => {
            const id = body?.id ?? body?.case_id ?? body?.contract_id ??
                       parseInt(req.params.id || req.params.caseId || '0', 10);
            return typeof id === 'number' && !isNaN(id) ? id : null;
          })();

          const detail = _buildDetail(req, body, action);

          await db.run(
            `INSERT INTO audit_log
              (firm_id, user_id, target_type, target_id, action, detail, ip_address, user_agent)
             VALUES (?,?,?,?,?,?,?,?)`,
            [
              ctx?.firm_id    ?? null,
              req.user?.id    ?? null,
              targetType,
              targetId,
              action,
              JSON.stringify(detail),
              (req.headers['x-forwarded-for'] || req.ip || '').slice(0, 45),
              (req.headers['user-agent'] || '').slice(0, 200),
            ]
          );
        } catch (e) {
          logger.warn('[audit] write failed (non-fatal):', e.message);
        }
      });

      return origJson(body);
    };

    next();
  };
}

function _buildDetail(req, body, action) {
  const d = { action };
  if (action === 'update' && req.body && typeof req.body === 'object') {
    d.fields = Object.keys(req.body).filter(k =>
      !['password','password_hash','token','secret'].includes(k)
    );
  }
  if (action === 'create' && body) {
    if (body.title)         d.title  = String(body.title).slice(0, 100);
    if (body.contract_type) d.type   = body.contract_type;
    if (body.status)        d.status = body.status;
  }
  if (req.params && Object.keys(req.params).length) {
    d.params = req.params;
  }
  return d;
}

// ── checkConflicts ────────────────────────────────────────────────────────────
// Advisory check — does NOT block. Returns { conflict: bool, parties: [] }.
// Call before adding a new client to a matter to detect adverse party conflicts.
export async function checkConflicts(db, firmId, partyNames = []) {
  if (!firmId || !partyNames.length) return { conflict: false, parties: [] };

  try {
    const lower = partyNames.map(n => n.toLowerCase());
    const placeholders = lower.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT mp.party_name, mp.party_type, mp.case_id,
              c.title AS case_title
       FROM matter_parties mp
       JOIN cases c ON c.id = mp.case_id
       WHERE mp.firm_id = ?
         AND LOWER(mp.party_name) IN (${placeholders})`,
      [firmId, ...lower]
    );
    return { conflict: rows.length > 0, parties: rows };
  } catch {
    return { conflict: false, parties: [] };
  }
}

// Backward-compat alias — tests and old routes use requireRole
export { requireFirmRole as requireRole };

// Alias for backward compatibility
export const loadMatterRole = requireMatterAccess;
