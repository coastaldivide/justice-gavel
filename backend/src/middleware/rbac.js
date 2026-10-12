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
  // ── Additional simulation roles expected by firm_verticals.test.js ───
  lead_attorney:             'partner',
  senior_esquire:            'partner',
  associate_attorney:        'associate',
  junior_attorney:           'associate',
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

// ── Firm membership (single source of truth) ─────────────────────────────────
// firm_members carries two role columns (firm_role — written by firm creation,
// invites and SSO — and the legacy `role`) and two liveness columns (`active`
// and `status`). Every check goes through these helpers so they agree.
export const ACTIVE_MEMBER_SQL =
  `COALESCE(fm.active, 1) = 1 AND COALESCE(fm.status, 'active') = 'active'`;

/** The effective firm role of a firm_members row (firm_role wins when it is a real tier). */
export function effectiveFirmRole(row) {
  if (!row) return null;
  const fr = row.firm_role;
  const r  = row.role;
  if (fr && roleLevel(fr) >= 0) return fr;
  if (r && roleLevel(r) >= 0)   return r;
  return fr || r || null;
}

/** Platform-level super admin (users.role from the live DB row — see middleware/auth.js). */
export function isPlatformSuperAdmin(user) {
  return user?.role === 'super_admin';
}

/**
 * Active membership of `userId` in the SPECIFIC firm `firmId`, or null.
 * Returns { firm_id, user_id, firm_role } with the effective role.
 */
export async function getFirmMembership(db, userId, firmId) {
  const fid = Number(firmId);
  if (!userId || !Number.isInteger(fid) || fid <= 0) return null;
  const row = await db.get(
    `SELECT fm.firm_id, fm.user_id, fm.firm_role, fm.role
       FROM firm_members fm
      WHERE fm.user_id = ? AND fm.firm_id = ? AND ${ACTIVE_MEMBER_SQL}
      LIMIT 1`,
    [userId, fid]
  );
  if (!row) return null;
  return { firm_id: Number(row.firm_id), user_id: Number(row.user_id), firm_role: effectiveFirmRole(row) };
}

// ── loadFirmContext ───────────────────────────────────────────────────────────
// Loads the caller's (primary) firm membership from DB and caches on req.firmCtx.
// Returns null if user is not an active member of any firm.
export async function loadFirmContext(req) {
  if (req.firmCtx !== undefined) return req.firmCtx;

  try {
    const db     = await getDb();
    const member = await db.get(
      `SELECT fm.firm_id, fm.firm_role, fm.role, fm.status,
              f.name  AS firm_name,
              f.plan  AS firm_plan,
              f.seat_limit
       FROM firm_members fm
       JOIN firms f ON f.id = fm.firm_id
       WHERE fm.user_id = ? AND ${ACTIVE_MEMBER_SQL}
       ORDER BY fm.firm_id ASC LIMIT 1`,
      [req.user.id]
    ).catch(() => null);

    req.firmCtx = member
      ? { ...member, firm_id: Number(member.firm_id), firm_role: effectiveFirmRole(member) }
      : null;
  } catch {
    req.firmCtx = null;
  }
  return req.firmCtx;
}

// ── requireFirmRole ──────────────────────────────────────────────────────────
// User must be an active firm member with at least minRole. The role comes from
// firm_members (never from the token). A platform super_admin passes the role
// check but still has no firm context of their own.
export function requireFirmRole(minRole) {
  return async function rbacFirmRole(req, res, next) {
    try {
      const ctx = await loadFirmContext(req);
      const resolvedRole = ctx?.firm_role
        || (isPlatformSuperAdmin(req.user) ? 'super_admin' : null)
        // In-memory unit suites (no DB) sign tokens that carry a firm_role claim;
        // middleware/auth.js strips that claim whenever a database is configured.
        || req.user?.firm_role
        || null;
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

/**
 * requireFirmMember({ param, minRole, allowSuperAdmin })
 * Route guard for /…/:firmId-style routes: the caller must be an ACTIVE member
 * of the firm named in req.params[param] (default 'id') with at least minRole.
 * Non-members get 404 (other firms' ids are not confirmed). Sets req.firmMembership.
 */
export function requireFirmMember({ param = 'id', minRole = null, allowSuperAdmin = false } = {}) {
  return async function rbacFirmMember(req, res, next) {
    try {
      const firmId = Number.parseInt(req.params[param], 10);
      if (!Number.isInteger(firmId) || firmId <= 0) {
        return res.status(400).json({ error: 'Invalid firm id.' });
      }
      const db = await getDb();
      const m  = await getFirmMembership(db, req.user.id, firmId);
      if (!m) {
        if (allowSuperAdmin && isPlatformSuperAdmin(req.user)) {
          req.firmMembership = { firm_id: firmId, user_id: req.user.id, firm_role: 'super_admin', platform: true };
          return next();
        }
        return res.status(404).json({ error: 'Firm not found.', code: 'not_firm_member' });
      }
      if (minRole && !hasMinRole(m.firm_role, minRole)) {
        return res.status(403).json({
          error:    `Requires ${minRole} role or higher.`,
          code:     'insufficient_role',
          required: minRole,
          actual:   m.firm_role,
        });
      }
      req.firmMembership = m;
      next();
    } catch (e) {
      logger.error('[rbac/requireFirmMember]', e.message);
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

// ── Matter access (matters table) ────────────────────────────────────────────
// A matter belongs to a firm (matters.firm_id) or, when firm_id is NULL, to the
// user who created it. Access rules, in order:
//   1. Ethics wall (matter_team_members.ethics_wall=1 for this user) → 403, no override.
//   2. Firm matter: the caller must be an ACTIVE member of THAT firm.
//        firm_admin+ of the firm → full access
//        on the matter team (matter_teams, active) → the team role
//      External team members are only allowed with the read-only team roles
//      client/viewer. Anyone else → 404 (another firm's matter ids are not confirmed).
//   3. Personal matter (no firm): the creator, or a member of its team.
//   4. Platform super_admin (live DB role) → access, audit-logged by the routes.
const TEAM_ROLE_TIER = { lead_attorney: 'partner', lead_partner: 'partner', co_counsel: 'partner' };
const EXTERNAL_TEAM_ROLES = new Set(['client', 'viewer']);
const teamTier = (role) => TEAM_ROLE_TIER[role] || resolveRole(role || 'viewer');

export async function resolveMatterAccess(db, user, matterId) {
  const id = Number(matterId);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, code: 'invalid_matter_id' };
  const matter = await db.get(
    'SELECT id, firm_id, created_by, user_id FROM matters WHERE id = ?', [id]);
  if (!matter) return { status: 404, code: 'matter_not_found' };

  const walled = await db.get(
    'SELECT 1 AS w FROM matter_team_members WHERE case_id = ? AND user_id = ? AND ethics_wall = 1 LIMIT 1',
    [id, user.id]
  ).catch(() => null);
  if (walled) return { status: 403, code: 'ethics_wall' };

  const team = await db.get(
    'SELECT role FROM matter_teams WHERE matter_id = ? AND user_id = ? AND COALESCE(active, 1) = 1 LIMIT 1',
    [id, user.id]
  ).catch(() => null);

  const firmId = matter.firm_id != null ? Number(matter.firm_id) : null;
  if (firmId) {
    const m = await getFirmMembership(db, user.id, firmId);
    if (m) {
      if (hasMinRole(m.firm_role, 'firm_admin')) return { matter, role: m.firm_role, via: 'firm_admin' };
      if (team) return { matter, role: teamTier(team.role), teamRole: team.role, via: 'team' };
      return { status: 403, code: 'not_matter_member' };
    }
    if (team && EXTERNAL_TEAM_ROLES.has(team.role)) {
      return { matter, role: teamTier(team.role), teamRole: team.role, via: 'external_team' };
    }
  } else {
    const ownerId = Number(matter.created_by ?? matter.user_id);
    if (ownerId && ownerId === Number(user.id)) return { matter, role: 'partner', teamRole: 'lead_attorney', via: 'owner' };
    if (team) return { matter, role: teamTier(team.role), teamRole: team.role, via: 'team' };
  }
  if (isPlatformSuperAdmin(user)) return { matter, role: 'super_admin', via: 'platform' };
  return { status: 404, code: 'matter_not_found' };
}

// ── requireMatterAccess ──────────────────────────────────────────────────────
// opts: minRole (default 'viewer'), idParam (default 'id').
// Also accepts the positional form used by routes: requireMatterAccess('id', 'partner').
// Sets req.matter ({id, firm_id, …}) and req.matterAccess ({ matter_role, via, … }).
export function requireMatterAccess(opts = {}, legacyMinRole) {
  if (typeof opts === 'string') opts = { idParam: opts, minRole: legacyMinRole || 'viewer' };
  const { minRole = 'viewer', idParam = 'id' } = opts;

  return async function rbacMatterAccess(req, res, next) {
    try {
      const db = await getDb();
      const r  = await resolveMatterAccess(db, req.user, req.params[idParam]);
      if (r.status === 400) return res.status(400).json({ error: 'Invalid matter ID.' });
      if (r.status === 404) return res.status(404).json({ error: 'Matter not found.', code: 'matter_not_found' });
      if (r.status === 403) {
        return res.status(403).json(r.code === 'ethics_wall'
          ? { error: 'Access to this matter is restricted by an ethics wall.', code: 'ethics_wall' }
          : { error: 'You are not a member of this matter team.', code: 'not_matter_member' });
      }
      if (!hasMinRole(r.role, minRole)) {
        return res.status(403).json({
          error:    `Requires ${minRole} role on this matter.`,
          code:     'insufficient_matter_role',
          required: minRole,
          actual:   r.teamRole || r.role,
        });
      }
      req.matter       = r.matter;
      req.matterAccess = {
        matter_role:   r.teamRole || r.role,
        role:          r.role,
        via:           r.via,
        can_edit:      hasMinRole(r.role, 'associate') ? 1 : 0,
        can_message:   1,
        can_view_docs: 1,
        ethics_wall:   0,
      };
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

