import { getDb } from '../db/index.js';
import logger    from './logger.js';


// Strip sensitive fields before writing to audit log
function scrubMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const SENSITIVE = ['password','token','secret','ssn','dob','credit_card','cvv','pin'];
  const out = { ...meta };
  for (const key of Object.keys(out)) {
    if (SENSITIVE.some(s => key.toLowerCase().includes(s))) {
      out[key] = '[REDACTED]';
    }
  }
  return out;
}

export async function auditLog({ userId, action, entityType, entityId, meta = {}, req }) {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO audit_log
         (user_id, action, entity_type, entity_id, ip_address, user_agent, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [ userId || null, String(action).slice(0, 100), entityType || null,
        entityId || null, req?.ip || null,
        String(req?.headers?.['user-agent'] || '').slice(0, 200),
        JSON.stringify(scrubMeta(meta)) ]
    );
  } catch (err) { logger.error('[audit] write failed:', err?.message); }
}
