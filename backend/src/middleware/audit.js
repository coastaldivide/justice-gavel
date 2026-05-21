/**
 * middleware/audit.js — Audit log writer and reader
 *
 * Provides:
 *   writeAuditLog(db, entry)  — write one audit entry (non-throwing)
 *   getAuditLog(db, filters)  — query audit log with filters
 *   auditMiddleware(action, resource) — route middleware version
 */

import logger from '../utils/logger.js';

// ── writeAuditLog — safe fire-and-forget writer ───────────────────────────────
export async function writeAuditLog(db, {
  user_id    = null,
  firm_id    = null,
  action,
  resource   = null,   // alias for target_type
  target_type = null,
  record_id  = null,   // alias for target_id
  target_id  = null,
  old_value  = null,
  new_value  = null,
  detail     = null,
  ip         = null,
  ua         = null,
  request_id = null,
}) {
  try {
    const effectiveTarget  = target_type || resource;
    const effectiveId      = target_id   ?? record_id;
    const effectiveDetail  = detail ?? JSON.stringify({
      old: old_value ?? undefined,
      new: new_value ?? undefined,
      request_id: request_id ?? undefined,
    });

    await db.run(
      `INSERT INTO audit_log
        (firm_id, user_id, target_type, target_id, action, detail, ip_address, user_agent)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        firm_id,
        user_id,
        effectiveTarget,
        typeof effectiveId === 'number' ? effectiveId : null,
        action,
        effectiveDetail,
        (ip  || '').toString().slice(0, 45),
        (ua  || '').toString().slice(0, 200),
      ]
    );
  } catch (e) {
    // Audit failure must NEVER surface to the caller
    logger.warn('[audit] write failed:', e.message?.slice(0, 80));
  }
}

// ── getAuditLog — query audit log with filters ────────────────────────────────
export async function getAuditLog(db, {
  firm_id    = null,
  user_id    = null,
  resource   = null,
  action     = null,
  target_id  = null,
  limit      = 50,
  offset     = 0,
  since      = null,
} = {}) {
  let sql    = `SELECT al.*, u.display_name AS user_name, u.email AS user_email
                FROM audit_log al
                LEFT JOIN users u ON u.id = al.user_id
                WHERE 1=1`;
  const params = [];

  if (firm_id)   { sql += ' AND al.firm_id=?';      params.push(firm_id);   }
  if (user_id)   { sql += ' AND al.user_id=?';      params.push(user_id);   }
  if (resource)  { sql += ' AND al.target_type=?';  params.push(resource);  }
  if (action)    { sql += ' AND al.action=?';        params.push(action);    }
  if (target_id) { sql += ' AND al.target_id=?';    params.push(target_id); }
  if (since)     { sql += ' AND al.created_at>=?';  params.push(since);     }

  const countSql    = sql.replace(/SELECT al\.\*.*?WHERE/, 'SELECT COUNT(*) as n FROM audit_log al WHERE');
  const countParams = [...params];

  sql += ` ORDER BY al.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Math.min(limit, 200), Math.max(offset, 0));

  const [rows, countRow] = await Promise.all([
    db.all(sql, params).catch(() => []),
    db.get(countSql, countParams).catch(() => ({ n: 0 })),
  ]);

  return { log: rows, total: countRow?.n ?? 0, limit, offset };
}

// ── auditMiddleware — route middleware alias ───────────────────────────────────
// Usage: router.post('/cases', authRequired, auditMiddleware('create','case'), handler)
export function auditMiddleware(action, resource = null) {
  return function(req, res, next) {
    const origJson = res.json.bind(res);
    res.json = function(body) {
      setImmediate(async () => {
        try {
          const db     = await (await import('../db/index.js')).getDb();
          const firmId = req.firmCtx?.firm_id ?? null;
          const _rawId   = body?.id ?? body?.case_id ?? body?.contract_id ?? parseInt(req.params.id || req.params.caseId || '0', 10);
          const targetId = (typeof _rawId === 'number' && !isNaN(_rawId)) ? _rawId : null;
          await writeAuditLog(db, {
            user_id:     req.user?.id ?? null,
            firm_id:     firmId,
            action,
            resource,
            target_id:   isNaN(targetId) ? null : targetId,
            ip:          req.headers['x-forwarded-for'] || req.ip,
            ua:          req.headers['user-agent'],
          });
        } catch (e) {
          logger.warn('[audit-mw]', e.message);
        }
      });
      return origJson(body);
    };
    next();
  };
}

// Alias for backward compat
export { auditMiddleware as auditLog };
